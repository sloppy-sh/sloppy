// Platform Delegation end to end, against a real SurrealDB and no network
// beyond it: register an identity, consent, exchange the code, sign, verify the
// signature the way a stranger would, and revoke.
//
// It runs without HTTP on purpose. Everything the controllers do is here, so
// what the shell adds is routing and nothing else — and the same functions are
// what the native app calls when it runs the provider in-process.
//
// Skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection } from "node:net";
import {
  nowIso,
  SyrPlatformChallengeResponseSchema,
  SyrPlatformSignResponseSchema,
  SyrPlatformTokenResponseSchema,
} from "@sloppy/types";
import { Surreal } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IdpContext } from "./context.js";
import {
  approveConsent,
  delegationsOf,
  denyConsent,
  exchangeToken,
  openConsent,
  resolvePlatformToken,
  revoke,
  signChallenge,
  signPayload,
} from "./delegation.js";
import { login, register, resolveSession } from "./identity.js";
import { deriveIdpSecrets } from "./secrets.js";
import {
  defineIdentitySchema,
  findActiveDelegation,
  IDENTITY_TABLES,
  purgeIdentity,
} from "./store.js";
import { verifyDelegationStatement, verifySignedPayload } from "./verify.js";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const USER = process.env.SURREALDB_USER ?? "root";
const PASS = process.env.SURREALDB_PASS ?? "sloppy-dev-password";

const NAMESPACE = "sloppy_test";
const DATABASE = `idp_${Date.now()}`;

const PASSWORD = "a-long-enough-passphrase";
const PLATFORM_ORIGIN = "https://sloppy.example";
const CALLBACK = "https://sloppy.example/auth/callback";

const listening = await new Promise<boolean>((resolve) => {
  const socket = createConnection({
    host: ENDPOINT.hostname,
    port: Number(ENDPOINT.port) || (ENDPOINT.protocol === "wss:" ? 443 : 80),
  });
  const settle = (answer: boolean) => {
    socket.destroy();
    resolve(answer);
  };
  socket.setTimeout(1000);
  socket.once("connect", () => settle(true));
  socket.once("timeout", () => settle(false));
  socket.once("error", () => settle(false));
});

describe.skipIf(!listening)(`the provider against ${ENDPOINT.href}`, () => {
  let ctx: IdpContext;
  let names = 0;

  const someone = () => `person${++names}`;

  beforeAll(async () => {
    const db = new Surreal();
    await db.connect(ENDPOINT.href);
    await db.signin({ username: USER, password: PASS });
    await db.use({ namespace: NAMESPACE, database: DATABASE });
    await defineIdentitySchema(db);
    // Twice, because it runs on every boot and a second run must be a no-op
    // rather than an error the caller has to know to swallow.
    await defineIdentitySchema(db);
    ctx = {
      db,
      secrets: deriveIdpSecrets("integration-secret-of-sufficient-length"),
      publicUrl: PLATFORM_ORIGIN,
    };
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.db.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
    await ctx.db.close();
  });

  it("declares every table it says it does", async () => {
    const [info] =
      await ctx.db.query<[{ tables: Record<string, string> }]>("INFO FOR DB;");
    expect(Object.keys(info.tables).sort()).toEqual(
      [...IDENTITY_TABLES].sort(),
    );
  });

  it("mints an identity whose DID is its own public key", async () => {
    const grant = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    expect(grant.did).toMatch(/^did:syr:z[1-9A-HJ-NP-Za-km-z]+$/);
    expect(await resolveSession(ctx, grant.access_token)).toEqual({
      did: grant.did,
      sessionId: expect.any(String),
    });
  });

  it("refuses a name somebody already answers to", async () => {
    const username = someone();
    await register(ctx, { username, password: PASSWORD });
    await expect(
      register(ctx, { username, password: "another-long-passphrase" }),
    ).rejects.toMatchObject({ code: "username_taken" });
  });

  it("signs somebody back in with the password that seals their key", async () => {
    const username = someone();
    const registered = await register(ctx, { username, password: PASSWORD });
    const returned = await login(ctx, { username, password: PASSWORD });
    expect(returned.did).toBe(registered.did);
    await expect(
      login(ctx, { username, password: "not-the-password" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      login(ctx, { username: "nobody-at-all", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("completes the whole delegation round trip against itself", async () => {
    const { did } = await register(ctx, {
      username: someone(),
      password: PASSWORD,
      display_name: "A Person",
    });

    const prompt = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      platform_name: "Sloppy",
      callback_url: CALLBACK,
      state: "opaque-state",
    });
    expect(prompt.display_name).toBe("A Person");
    expect(prompt.scopes).toEqual(["identity:read", "profile:read"]);

    const { redirect_url } = await approveConsent(
      ctx,
      did,
      prompt.challenge_id,
      PASSWORD,
    );
    const callback = new URL(redirect_url);
    expect(callback.origin + callback.pathname).toBe(CALLBACK);
    expect(callback.searchParams.get("state")).toBe("opaque-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await exchangeToken(ctx, {
      code: code as string,
      // What the callback carries, and what syr proper insists on.
      delegation_id: callback.searchParams.get("delegation_id") as string,
      callback_url: CALLBACK,
      platform_origin: PLATFORM_ORIGIN,
    });
    // Parsed by the schema Sloppy uses to read SOMEBODY ELSE'S instance: if
    // this instance's answer will not go through that reader, it is not
    // speaking syr.
    expect(() => SyrPlatformTokenResponseSchema.parse(token)).not.toThrow();
    expect(token.did).toBe(did);

    const grant = await resolvePlatformToken(ctx, token.access_token);
    if (!grant) throw new Error("the platform access token did not resolve");
    expect(grant.did).toBe(did);
    expect(grant.delegation.public_key).toBe(token.delegate_public_key);

    // The delegate key is only trustworthy because the root key said so, and
    // the root key is recoverable from the DID alone.
    expect(
      verifyDelegationStatement({
        canonicalStatement: grant.delegation.canonical_delegation,
        signature: grant.delegation.signature,
        did,
      }),
    ).toBe(true);

    const payload = { type: "sloppy-node@v1", did, address: "1a" };
    const signed = signPayload(ctx, grant.delegation, payload);
    expect(() => SyrPlatformSignResponseSchema.parse(signed)).not.toThrow();
    expect(signed.delegate_public_key).toBe(token.delegate_public_key);
    expect(
      verifySignedPayload({
        payload,
        signature: signed.signature,
        publicKeyMultibase: token.delegate_public_key,
      }),
    ).toBe(true);

    const challenged = signChallenge(ctx, grant.delegation, "nonce-1234");
    expect(() =>
      SyrPlatformChallengeResponseSchema.parse(challenged),
    ).not.toThrow();
    expect(
      verifySignedPayload({
        payload: {},
        signature: challenged.signature,
        publicKeyMultibase: token.delegate_public_key,
      }),
    ).toBe(false);

    expect(await revoke(ctx, did, PLATFORM_ORIGIN)).toEqual({
      status: "revoked",
    });
    expect(await resolvePlatformToken(ctx, token.access_token)).toBeNull();
    const listing = await delegationsOf(ctx, did);
    const [listed] = listing.data;
    expect(listed.revoked_at).toBeTruthy();
    // The public listing must never carry anything that could sign.
    expect(JSON.stringify(listing)).not.toContain(
      grant.delegation.sealed_delegate.ct,
    );
    // But it must carry enough for a stranger to check the chain themselves.
    expect(
      verifyDelegationStatement({
        canonicalStatement: listed.statement,
        signature: listed.statement_signature,
        did,
      }),
    ).toBe(true);
  });

  it("spends an authorization code exactly once", async () => {
    const { did } = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const prompt = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
    });
    const { redirect_url } = await approveConsent(
      ctx,
      did,
      prompt.challenge_id,
      PASSWORD,
    );
    const code = new URL(redirect_url).searchParams.get("code") as string;

    await exchangeToken(ctx, {
      code,
      callback_url: CALLBACK,
      platform_origin: PLATFORM_ORIGIN,
    });
    await expect(
      exchangeToken(ctx, {
        code,
        callback_url: CALLBACK,
        platform_origin: PLATFORM_ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("compares the callback byte for byte, trailing slash included", async () => {
    const { did } = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const prompt = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
    });
    const { redirect_url } = await approveConsent(
      ctx,
      did,
      prompt.challenge_id,
      PASSWORD,
    );
    await expect(
      exchangeToken(ctx, {
        code: new URL(redirect_url).searchParams.get("code") as string,
        callback_url: `${CALLBACK}/`,
        platform_origin: PLATFORM_ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("will not send a person holding a code to another site", async () => {
    const { did } = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    await expect(
      openConsent(ctx, did, {
        platform_origin: PLATFORM_ORIGIN,
        callback_url: "https://elsewhere.example/collect",
      }),
    ).rejects.toMatchObject({ code: "invalid_callback" });
  });

  it("costs the password on every approval, not only the first", async () => {
    const { did } = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const first = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
    });
    await approveConsent(ctx, did, first.challenge_id, PASSWORD);

    const again = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
    });
    await expect(
      approveConsent(ctx, did, again.challenge_id, "wrong-password"),
    ).rejects.toMatchObject({ code: "invalid_password" });
  });

  it("hands a denial back to the platform rather than a code", async () => {
    const { did } = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const prompt = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
      state: "s",
    });
    const { redirect_url } = await denyConsent(ctx, did, prompt.challenge_id);
    const callback = new URL(redirect_url);
    expect(callback.searchParams.get("error")).toBe("consent_denied");
    expect(callback.searchParams.get("code")).toBeNull();
    expect(callback.searchParams.get("state")).toBe("s");
  });

  it("keeps one person's consent request out of another's hands", async () => {
    const mine = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const theirs = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const prompt = await openConsent(ctx, mine.did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
    });
    await expect(
      approveConsent(ctx, theirs.did, prompt.challenge_id, PASSWORD),
    ).rejects.toMatchObject({ code: "consent_expired" });
  });

  it("erases an identity by the column that names its owner", async () => {
    const username = someone();
    const { did } = await register(ctx, { username, password: PASSWORD });
    const other = await register(ctx, {
      username: someone(),
      password: PASSWORD,
    });
    const prompt = await openConsent(ctx, did, {
      platform_origin: PLATFORM_ORIGIN,
      callback_url: CALLBACK,
    });
    await approveConsent(ctx, did, prompt.challenge_id, PASSWORD);

    await purgeIdentity(ctx.db, did);

    for (const table of IDENTITY_TABLES) {
      const [rows] = await ctx.db.query<[unknown[]]>(
        `SELECT * FROM ${table} WHERE did = $did;`,
        { did },
      );
      expect(rows).toEqual([]);
    }
    await expect(
      login(ctx, { username, password: PASSWORD }),
    ).rejects.toThrow();
    // And nobody else's rows went with it.
    expect(await findActiveDelegation(ctx.db, other.did, "x", nowIso())).toBe(
      null,
    );
    const [survivors] = await ctx.db.query<[unknown[]]>(
      "SELECT * FROM idp_identity WHERE did = $did;",
      { did: other.did },
    );
    expect(survivors).toHaveLength(1);
  });
});
