// A copy of somebody's own writing, against a real server: what the reads
// actually return, which rows they reach, and that the answer is written out
// rather than gathered first.
//
// Skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection, createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type BlockView,
  type GraphExport,
  GraphExportSchema,
  type GraphView,
  type NodeView,
  type OwnedRef,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `export_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
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
}

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

interface Person {
  did: string;
  cookie: string;
}

describe("a copy of everything somebody keeps", () => {
  let listening = false;
  let app: INestApplication;
  let base: string;
  let ada: Person;
  let bram: Person;

  const scenario = (name: string, run: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async (ctx) => {
        ctx.skip(!listening, `nothing is listening at ${ENDPOINT.href}`);
        await run();
      },
      timeout,
    );

  const ok = async (
    method: string,
    path: string,
    person: Person,
    body?: unknown,
  ): Promise<unknown> => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: person.cookie },
      ...(body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    expect(
      response.status,
      `${method} ${path} answered ${response.status}: ${text}`,
    ).toBeLessThan(300);
    return text ? JSON.parse(text) : null;
  };

  const newNode = (
    person: Person,
    request: Record<string, unknown>,
  ): Promise<NodeView> =>
    ok("POST", "/nodes", person, request) as Promise<NodeView>;

  const newBlock = (
    person: Person,
    node: OwnedRef,
    words: string,
    after?: OwnedRef,
  ) =>
    ok("POST", "/blocks", person, {
      node,
      ...(after ? { after } : {}),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: words }] },
        ],
      },
    }) as Promise<BlockView>;

  const at = (ref: OwnedRef) =>
    `${encodeURIComponent(ref.slice(0, ref.lastIndexOf("/")))}/${encodeURIComponent(
      ref.slice(ref.lastIndexOf("/") + 1),
    )}`;

  async function copyFor(person: Person): Promise<{
    held: GraphExport;
    gathered: boolean;
  }> {
    const response = await fetch(`${base}/api/export`, {
      headers: { cookie: person.cookie },
    });
    expect(response.status).toBe(200);
    return {
      held: GraphExportSchema.parse(await response.json()),
      gathered: response.headers.get("content-length") !== null,
    };
  }

  async function signIn(username: string): Promise<Person> {
    const registered = (await (
      await fetch(`${base}/api/idp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password: PASSWORD,
          display_name: username,
        }),
      })
    ).json()) as { did: string; access_token: string };

    const started = (await (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instance_url: base }),
      })
    ).json()) as { consent_url: string };

    const asked = new URL(started.consent_url).searchParams;
    const idp = { authorization: `Bearer ${registered.access_token}` };
    const opened = (await (
      await fetch(`${base}/api/idp/consent`, {
        method: "POST",
        headers: { "content-type": "application/json", ...idp },
        body: JSON.stringify({
          platform_origin: asked.get("platform_origin"),
          platform_name: asked.get("platform_name"),
          callback_url: asked.get("callback_url"),
          scopes: asked.get("scopes")?.split(","),
          state: asked.get("state"),
        }),
      })
    ).json()) as { challenge_id: string };

    const approved = (await (
      await fetch(`${base}/api/idp/consent/${opened.challenge_id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", ...idp },
        body: JSON.stringify({ password: PASSWORD }),
      })
    ).json()) as { redirect_url: string };

    const landed = await fetch(approved.redirect_url, { redirect: "manual" });
    const cookie = landed.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("sloppy_session="))
      ?.split(";")[0];
    if (!cookie) throw new Error(`no session for ${username}`);
    return { did: registered.did, cookie };
  }

  beforeAll(async () => {
    listening = await probe();
    if (!listening) return;

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
    app.setGlobalPrefix("api", {
      exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
    });
    await app.listen(port, "127.0.0.1");

    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

    ada = await signIn(`ada${Date.now().toString(36)}`);
    bram = await signIn(`bram${Date.now().toString(36)}`);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await app.get(DbService).handle.query(`REMOVE DATABASE ${DATABASE}`);
    await app.close();
  });

  scenario(
    "carries every graph, note and section they have",
    async () => {
      const garden = (await ok("POST", "/graphs", ada, {
        title: "The garden",
      })) as GraphView;
      const home = await newNode(ada, { title: "A city remembers" });
      const under = await newNode(ada, {
        from: { relation: "under", note: home.ref },
        title: "Under it",
      });
      const elsewhere = await newNode(ada, {
        from: { relation: "branch", graph: garden.ref },
        title: "Seed",
      });
      const first = await newBlock(ada, home.ref, "the first section");
      const second = await newBlock(
        ada,
        home.ref,
        "the second section",
        first.ref,
      );

      const { held, gathered } = await copyFor(ada);

      expect(held.did).toBe(ada.did);
      expect(held.graphs.map((graph) => graph.title)).toContain("The garden");
      const mine = held.notes.map((note) => note.ref);
      expect(mine).toContain(home.ref);
      expect(mine).toContain(under.ref);
      expect(mine).toContain(elsewhere.ref);
      const stack = held.blocks.filter((block) => block.node === home.ref);
      expect(stack.map((block) => block.ref)).toEqual([first.ref, second.ref]);
      expect(stack[0].content).toEqual(first.content);
      // Written out as it is read, so nothing counted the whole of it first.
      expect(gathered).toBe(false);
    },
    30_000,
  );

  scenario(
    "leaves out a note they deleted, and its sections",
    async () => {
      const kept = await newNode(ada, { title: "Kept" });
      const going = await newNode(ada, { title: "Going" });
      const withIt = await newBlock(ada, going.ref, "goes with it");
      await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

      const { held } = await copyFor(ada);

      expect(held.notes.map((note) => note.ref)).toContain(kept.ref);
      expect(held.notes.map((note) => note.ref)).not.toContain(going.ref);
      expect(held.blocks.map((block) => block.ref)).not.toContain(withIt.ref);
    },
    30_000,
  );

  // A note that can still be put back is not part of what somebody has.
  scenario(
    "leaves out a note that is waiting to come back",
    async () => {
      const waiting = await newNode(ada, { title: "Waiting" });
      const inside = await newBlock(ada, waiting.ref, "still written");
      const { DbService } = await import("../db/db.service");
      await app.get(DbService).handle.query(
        `UPDATE $note SET deleted_at = $at;
       UPDATE $block SET deleted_at = $at;`,
        {
          note: recordIdFromOwnedRef("node", waiting.ref),
          block: recordIdFromOwnedRef("block", inside.ref),
          at: new Date().toISOString(),
        },
      );

      const { held } = await copyFor(ada);

      expect(held.notes.map((note) => note.ref)).not.toContain(waiting.ref);
      expect(held.blocks.map((block) => block.ref)).not.toContain(inside.ref);
    },
    30_000,
  );

  scenario(
    "is theirs alone, and asks who is calling",
    async () => {
      const hers = await newNode(bram, { title: "Bram's own" });
      const inIt = await newBlock(bram, hers.ref, "bram wrote this");

      const { held } = await copyFor(ada);
      expect(held.notes.map((note) => note.ref)).not.toContain(hers.ref);
      expect(held.blocks.map((block) => block.ref)).not.toContain(inIt.ref);

      const anonymous = await fetch(`${base}/api/export`);
      expect(anonymous.status).toBe(401);
    },
    30_000,
  );
});
