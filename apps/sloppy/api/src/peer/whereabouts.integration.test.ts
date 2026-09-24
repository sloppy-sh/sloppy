// What this instance serves about where somebody's graph is, against a real
// store: the row a person writes, the one row they keep however often they say
// it again, and the document a peer reads back at the site root.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import {
  type Server,
  type ServerResponse,
  createServer as createHttp,
} from "node:http";
import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type Principal,
  WHEREABOUTS_DOCUMENT,
  parseWhereabouts,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const USERNAME = `person${Date.now().toString(36)}`;
const PASSWORD = "a-long-enough-passphrase";
const DATABASE = `whereabouts_${Date.now()}`;

const STRANGER =
  "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG" as Principal;

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

/** One peer, answering every path the same way, and the origin it answers on. */
async function listening(
  answer: (path: string, res: ServerResponse) => void,
): Promise<{ origin: string; close: () => void }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server: Server = createHttp((req, res) =>
    answer(new URL(req.url ?? "/", origin).pathname, res),
  );
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return { origin, close: () => server.close() };
}

describe("where somebody says their graph is", () => {
  let runs = false;
  let app: INestApplication;
  let base: string;
  let cookie: string;
  let did: Principal;

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

  /** The declaration as a peer reads it: at the site root, out of the `/api`
   *  prefix, which is where a domain would serve one. */
  function served(principal: Principal) {
    return fetch(
      `${base}/.well-known/sloppy-whereabouts/${encodeURIComponent(principal)}`,
    );
  }

  function say(body: unknown) {
    return fetch(`${base}/api/whereabouts`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    runs = await integrationTarget(ENDPOINT);
    if (!runs) return;

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    Object.assign(process.env, {
      SLOPPY_LOCAL_IDP: "true",
      SLOPPY_IDP_SECRET: "integration-secret-of-sufficient-length",
      SLOPPY_SESSION_SECRET: "integration-session-secret-of-length",
      PUBLIC_URL: base,
      SURREALDB_NAMESPACE: "sloppy_test",
      SURREALDB_DATABASE: DATABASE,
    });

    const { AppModule } = await import("../app.module");
    app = await NestFactory.create(AppModule, { logger: false });
    // Mirrors `main.ts`: a peer resolves these at the site root, never under
    // the prefix.
    app.setGlobalPrefix("api", {
      exclude: [
        "/.well-known/syr",
        "/.well-known/syr/:did",
        "/.well-known/sloppy-whereabouts/:principal",
      ],
    });
    await app.listen(port, "127.0.0.1");

    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

    const registered = await post("/api/idp/register", {
      username: USERNAME,
      password: PASSWORD,
      display_name: "Someone",
    });
    expect(registered.status).toBe(201);
    did = registered.body.did;

    const started = await post("/api/auth/login", { instance_url: base });
    const url = new URL(started.body.consent_url);
    const opened = await post(
      "/api/idp/consent",
      {
        platform_origin: url.searchParams.get("platform_origin"),
        platform_name: url.searchParams.get("platform_name"),
        callback_url: url.searchParams.get("callback_url"),
        scopes: url.searchParams.get("scopes")?.split(","),
        state: url.searchParams.get("state"),
      },
      registered.body.access_token,
    );
    const approved = await post(
      `/api/idp/consent/${opened.body.challenge_id}/approve`,
      { password: PASSWORD },
      registered.body.access_token,
    );
    const landed = await fetch(new URL(approved.body.redirect_url), {
      redirect: "manual",
    });
    cookie = (
      landed.headers
        .getSetCookie()
        .find((one) => one.startsWith("sloppy_session=")) ?? ""
    ).split(";")[0];
    expect(cookie).not.toBe("");
  });

  afterAll(async () => {
    if (!app) return;
    const { DbService: Db } = await import("../db/db.service");
    await dropDatabase(app.get<DbService>(Db).handle, DATABASE);
    await app.close();
  });

  scenario("is nowhere until they say it", async () => {
    expect((await served(did)).status).toBe(404);
  });

  scenario("is served as a document about them once they have", async () => {
    expect((await say({ instance: "https://home.example" })).status).toBe(200);
    const answer = await served(did);
    expect(answer.status).toBe(200);
    expect(parseWhereabouts(await answer.json(), did)).toEqual({
      principal: did,
      instance: "https://home.example",
    });
  });

  scenario(
    "moves them rather than standing beside what they said",
    async () => {
      expect(
        (
          await say({
            domain: "mine.example",
            instance: "https://elsewhere.example",
          })
        ).status,
      ).toBe(200);
      const answer = await served(did);
      expect(parseWhereabouts(await answer.json(), did)).toEqual({
        principal: did,
        domain: "mine.example",
        instance: "https://elsewhere.example",
      });
    },
  );

  scenario("is theirs to take back down", async () => {
    const taken = await fetch(`${base}/api/whereabouts`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(taken.status).toBe(204);
    expect((await served(did)).status).toBe(404);
  });

  scenario("is not answered for somebody who has never been here", async () => {
    expect((await served(STRANGER)).status).toBe(404);
  });

  // The headline of the declaration: a reader hands over the instance they were
  // given, and the read lands where its subject says their graph is now.
  scenario("sends a reader on to where its subject says they are", async () => {
    const homeAsked: string[] = [];
    const hostAsked: string[] = [];
    const home = await listening((path, res) => {
      homeAsked.push(path);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ did: STRANGER, publications: [] }));
    });
    const host = await listening((path, res) => {
      hostAsked.push(path);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          type: WHEREABOUTS_DOCUMENT,
          principal: STRANGER,
          instance: home.origin,
        }),
      );
    });
    try {
      const answer = await fetch(
        `${base}/api/peers/publications?did=${encodeURIComponent(STRANGER)}` +
          `&source_url=${encodeURIComponent(host.origin)}`,
        { headers: { cookie } },
      );
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ did: STRANGER, publications: [] });
      expect(hostAsked).toEqual([
        `/.well-known/sloppy-whereabouts/${encodeURIComponent(STRANGER)}`,
      ]);
      expect(homeAsked).toEqual([
        `/api/public/publications/${encodeURIComponent(STRANGER)}`,
      ]);
    } finally {
      home.close();
      host.close();
    }
  });

  scenario("is nobody's to write but their own", async () => {
    const answer = await fetch(`${base}/api/whereabouts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance: "https://home.example" }),
    });
    expect(answer.status).toBe(401);
  });
});
