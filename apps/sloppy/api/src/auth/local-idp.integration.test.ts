// Sloppy signing in to Sloppy: `AuthModule` pointed at the `IdpModule` running
// in the same process, over HTTP, with no syr instance anywhere.
//
// Both halves are tested apart from this — auth against a stubbed instance, the
// provider through `@sloppy/idp` with the controllers left out. Neither can see
// the seam, and the seam is where the two would disagree: the manifest auth
// reads is the one the provider writes, the `/api` prefix `main.ts` sets is the
// one `providerApiBase()` assumes, and `delegation_id` is minted by one side and
// spent by the other. That is what this file holds.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  SyrInstanceManifestSchema,
  SyrPlatformSignResponseSchema,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";
import type { SyrService } from "../syr/syr.service";
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const USERNAME = `person${Date.now().toString(36)}`;
const PASSWORD = "a-long-enough-passphrase";
const DATABASE = `roundtrip_${Date.now()}`;

/** The port has to be known before the app starts, because `PUBLIC_URL` is what
 *  every URL in the manifest — and the callback syr matches byte for byte — is
 *  built from. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const found = server.address();
      server.close(() =>
        typeof found === "object" && found
          ? resolve(found.port)
          : reject(new Error("no free port")),
      );
    });
  });
}

describe("Sloppy signing in against its own provider", () => {
  let runs = false;
  let app: INestApplication;
  let syr: SyrService;
  let base: string;
  let idpToken: string;
  let did: string;

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
      await run();
    });

  async function post(path: string, body: unknown, token?: string) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  /** What a shell does to start sign-in, answered with the provider's own URL. */
  async function consentParams() {
    const started = await post("/api/auth/login", { instance_url: base });
    const url = new URL(started.body.consent_url);
    return {
      url,
      params: {
        platform_origin: url.searchParams.get("platform_origin"),
        platform_name: url.searchParams.get("platform_name"),
        callback_url: url.searchParams.get("callback_url"),
        scopes: url.searchParams.get("scopes")?.split(","),
        state: url.searchParams.get("state"),
      },
    };
  }

  /** The consent page's own two calls, and the redirect the person leaves on. */
  async function decide(
    params: unknown,
    verdict: "approve" | "deny",
  ): Promise<URL> {
    const opened = await post("/api/idp/consent", params, idpToken);
    expect(opened.status).toBe(201);
    const done = await post(
      `/api/idp/consent/${opened.body.challenge_id}/${verdict}`,
      { password: PASSWORD },
      idpToken,
    );
    expect(done.status).toBe(200);
    return new URL(done.body.redirect_url);
  }

  /** Following that redirect reaches Sloppy's callback, which is where the code
   *  is spent. The session comes back as a cookie. */
  async function land(redirect: URL) {
    const response = await fetch(redirect, { redirect: "manual" });
    const session = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("sloppy_session="));
    return {
      status: response.status,
      location: response.headers.get("location"),
      cookie: session?.split(";")[0],
    };
  }

  async function signIn() {
    const { params } = await consentParams();
    return land(await decide(params, "approve"));
  }

  /** `/auth/me` answers "nobody" with an empty body rather than a refusal. */
  async function viewer(cookie: string) {
    const body = await fetch(`${base}/api/auth/me`, {
      headers: { cookie },
    }).then((response) => response.text());
    return body ? JSON.parse(body) : null;
  }

  beforeAll(async () => {
    runs = await integrationTarget(ENDPOINT);
    if (!runs) return;

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    Object.assign(process.env, {
      // Read by `IdpModule.forRoot()` when `app.module` is first required, so it
      // has to be set before the import below rather than after.
      SLOPPY_LOCAL_IDP: "true",
      SLOPPY_IDP_SECRET: "integration-secret-of-sufficient-length",
      SLOPPY_SESSION_SECRET: "integration-session-secret-of-length",
      PUBLIC_URL: base,
      SURREALDB_NAMESPACE: "sloppy_test",
      SURREALDB_DATABASE: DATABASE,
    });

    const { AppModule } = await import("../app.module");
    app = await NestFactory.create(AppModule, { logger: false });
    // Mirrors `main.ts`: the prefix, and the two discovery paths held out of it,
    // are what put the provider's routes where its own manifest says they are.
    app.setGlobalPrefix("api", {
      exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
    });
    await app.listen(port, "127.0.0.1");

    // The API listens before the store is open; these routes need it open.
    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

    const { SyrService: Syr } = await import("../syr/syr.service");
    syr = app.get(Syr);

    const registered = await post("/api/idp/register", {
      username: USERNAME,
      password: PASSWORD,
      display_name: "Someone",
    });
    expect(registered.status).toBe(201);
    idpToken = registered.body.access_token;
    did = registered.body.did;
  });

  afterAll(async () => {
    if (!app) return;
    const { DbService: Db } = await import("../db/db.service");
    await app
      .get<DbService>(Db)
      .handle.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
    await app.close();
  });

  scenario(
    "serves a manifest its own consumer reads, at the site root",
    async () => {
      const response = await fetch(`${base}/.well-known/syr`);
      const manifest = SyrInstanceManifestSchema.parse(await response.json());
      expect(manifest.platform?.consent).toBe(`${base}/api/idp/consent`);
      expect(manifest.platform?.token).toBe(`${base}/api/idp/platform/token`);
    },
  );

  scenario("starts sign-in at the URL the manifest names", async () => {
    const { url, params } = await consentParams();
    expect(url.origin + url.pathname).toBe(`${base}/api/idp/consent`);
    expect(params.callback_url).toBe(`${base}/api/auth/callback`);
    expect(params.scopes).toEqual([
      "identity:read",
      "profile:read",
      "posts:write",
    ]);
  });

  scenario(
    "comes back from consent with a code AND the delegation it belongs to",
    async () => {
      const { params } = await consentParams();
      const redirect = await decide(params, "approve");

      expect(redirect.origin + redirect.pathname).toBe(params.callback_url);
      expect(redirect.searchParams.get("code")).toBeTruthy();
      expect(redirect.searchParams.get("delegation_id")).toBeTruthy();
      expect(redirect.searchParams.get("state")).toBe(params.state);
    },
  );

  scenario(
    "spends both at the token endpoint and lands in the app signed in",
    async () => {
      const landed = await signIn();
      expect(landed.status).toBe(302);
      expect(landed.location).toBe("/");

      const who = await viewer(landed.cookie!);
      expect(who).toMatchObject({ did, syr_instance_url: base });

      const listing = await fetch(
        `${base}/api/idp/platform/delegations?did=${encodeURIComponent(did)}`,
      ).then((response) => response.json());
      const published = listing.data.map(
        (entry: { delegate_public_key: string }) => entry.delegate_public_key,
      );
      expect(published).toContain(who.delegate_public_key);
    },
  );

  scenario("signs content through the delegation it was granted", async () => {
    const { params } = await consentParams();
    const redirect = await decide(params, "approve");
    const tokens = await syr.exchangeCode(base, {
      code: redirect.searchParams.get("code")!,
      delegation_id: redirect.searchParams.get("delegation_id")!,
      callback_url: params.callback_url!,
      platform_origin: params.platform_origin!,
    });

    const signed = await syr.signContent(
      {
        did,
        syr_instance_url: base,
        delegate_public_key: tokens.delegate_public_key,
        access_token: tokens.access_token,
      },
      { type: "sloppy-node@v1", title: "a thought" },
    );
    expect(SyrPlatformSignResponseSchema.parse(signed).did).toBe(did);
  });

  scenario(
    "ends every session here when the person disconnects Sloppy",
    async () => {
      const first = await signIn();
      expect(await viewer(first.cookie!)).toMatchObject({ did });
      // A second sign-in, so what follows is the delegation ending rather than
      // one credential being spent.
      const second = await signIn();

      const revoked = await post(
        "/api/idp/platform/revoke",
        { platform_origin: base },
        idpToken,
      );
      expect(revoked.body).toEqual({ status: "revoked" });

      expect(await viewer(second.cookie!)).toBeNull();
      expect(await viewer(first.cookie!)).toBeNull();
    },
  );

  scenario("hands a denial back as a denial, and grants nothing", async () => {
    const { params } = await consentParams();
    const landed = await land(await decide(params, "deny"));

    expect(landed.cookie).toBeUndefined();
    const said = new URL(landed.location!, base).searchParams.get(
      "sloppy_error",
    );
    expect(said).toContain("not approved");
  });
});
