// What a note's writing names, over real HTTP: a `[[` in a section becoming a
// line on the canvas, and going when the words do.
//
// `references.test.ts` has the derivation itself. What only a running system
// shows is that the write path reaches it on every road into a stack — a
// section added, rewritten, moved or deleted — that the derivation lands on the
// note's own row rather than the block's, and that the sweep puts right a note
// whose writing was already stored.
//
// Skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection, createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type BlockView,
  type GraphView,
  type NodeView,
  type OwnedRef,
  recordIdFromOwnedRef,
  REFERENCE_NOTE_ATTR,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `references_${Date.now()}`;
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

// DESIGN.md § Edges: a `[[` is a person saying two notes go together, so it
// draws a line — and the line is derived from the words, where a link is drawn
// and removed by hand.
describe("the notes a note's writing names", () => {
  let listening = false;
  let app: INestApplication;
  let base: string;
  let ada: Person;

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!listening, `nothing is listening at ${ENDPOINT.href}`);
      await run();
    });

  async function call(
    method: string,
    path: string,
    person: Person,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: person.cookie },
      ...(body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const ok = async (
    method: string,
    path: string,
    person: Person,
    body?: unknown,
  ): Promise<unknown> => {
    const answer = await call(method, path, person, body);
    expect(
      answer.status,
      `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
    ).toBeLessThan(300);
    return answer.body;
  };

  /** The two path segments `@sloppy/client` binds a reference as. */
  const at = (ref: OwnedRef) =>
    `${encodeURIComponent(ref.slice(0, ref.lastIndexOf("/")))}/${encodeURIComponent(
      ref.slice(ref.lastIndexOf("/") + 1),
    )}`;

  const newNode = (request: Record<string, unknown>): Promise<NodeView> =>
    ok("POST", "/nodes", ada, request) as Promise<NodeView>;

  const reread = async (note: NodeView): Promise<NodeView> =>
    (await ok("GET", `/nodes/${at(note.ref)}`, ada)) as NodeView;

  const write = (node: OwnedRef, content: unknown): Promise<BlockView> =>
    ok("POST", "/blocks", ada, { node, content }) as Promise<BlockView>;

  /** A section citing one note, written the way `reference-node.ts` writes it. */
  const citing = (cited: NodeView) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "As " },
          {
            type: "reference",
            attrs: { [REFERENCE_NOTE_ATTR]: cited.ref, label: cited.title },
          },
          { type: "text", text: " has it." },
        ],
      },
    ],
  });

  const plain = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "As." }] }],
  };

  /** Register on this instance's own provider, then spend the consent code the
   *  way a browser does, so the session is a real one. */
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

    const { DbService } = await import("../db/db.service");
    await app.get(DbService).whenOpen();

    ada = await signIn(`cita${Date.now().toString(36)}`);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await app.get(DbService).handle.query(`REMOVE DATABASE ${DATABASE}`);
    await app.close();
  });

  scenario("appears when the words do and goes when they go", async () => {
    const from = await newNode({ title: "The note doing the citing" });
    const cited = await newNode({ title: "The note being cited" });
    expect(from).not.toHaveProperty("references");

    const section = await write(from.ref, citing(cited));
    expect((await reread(from)).references).toEqual([cited.ref]);

    await ok("PATCH", `/blocks/${at(section.ref)}`, ada, { content: plain });
    expect((await reread(from)).references).toEqual([]);
  });

  // Deleting a whole section deletes the words in it.
  scenario("goes when the section holding them goes", async () => {
    const from = await newNode({ title: "Cites in a section" });
    const cited = await newNode({ title: "Cited from a section" });
    const section = await write(from.ref, citing(cited));
    expect((await reread(from)).references).toEqual([cited.ref]);

    expect(
      (await call("DELETE", `/blocks/${at(section.ref)}`, ada)).status,
    ).toBe(204);
    expect((await reread(from)).references).toEqual([]);
  });

  // A section moved names the same notes in a new order, and the derivation is
  // in `ord` order so that re-deriving an unchanged note produces the array it
  // already holds.
  scenario("follows a section moved within the stack", async () => {
    const from = await newNode({ title: "Two sections, two citations" });
    const first = await newNode({ title: "Named by the section on top" });
    const second = await newNode({ title: "Named by the one under it" });
    const top = await write(from.ref, citing(first));
    const below = (await ok("POST", "/blocks", ada, {
      node: from.ref,
      after: top.ref,
      content: citing(second),
    })) as BlockView;
    expect((await reread(from)).references).toEqual([first.ref, second.ref]);

    await ok("PATCH", `/blocks/${at(below.ref)}`, ada, { after: null });
    expect((await reread(from)).references).toEqual([second.ref, first.ref]);
  });

  scenario(
    "leaves a link somebody drew by hand exactly as it was",
    async () => {
      const from = await newNode({ title: "Linked and citing" });
      const cited = await newNode({ title: "Both ends of one pair" });
      await ok("PATCH", `/nodes/${at(from.ref)}`, ada, { links: [cited.ref] });

      const section = await write(from.ref, citing(cited));
      let held = await reread(from);
      expect(held.links).toEqual([cited.ref]);
      expect(held.references).toEqual([cited.ref]);

      await ok("PATCH", `/blocks/${at(section.ref)}`, ada, { content: plain });
      held = await reread(from);
      expect(held.links).toEqual([cited.ref]);
      expect(held.references).toEqual([]);
    },
  );

  // A ref names one note across every graph its author keeps, so a citation
  // typed in one graph reaches into another — docs/ARCHITECTURE.md § "Data
  // model", and the canvas draws it wherever both fields are on screen.
  scenario("names a note in another of the author's graphs", async () => {
    const garden = (await ok("POST", "/graphs", ada, {
      title: "The garden",
    })) as GraphView;
    const away = await newNode({
      from: { relation: "branch", graph: garden.ref },
      title: "A note in the other graph",
    });
    const from = await newNode({ title: "Citing across a graph" });

    await write(from.ref, citing(away));
    expect((await reread(from)).references).toEqual([away.ref]);
  });

  scenario("never names the note doing the naming", async () => {
    const alone = await newNode({ title: "Cites itself" });
    await write(alone.ref, citing(alone));
    expect((await reread(alone)).references).toEqual([]);
  });

  // Writing that was already there when the derivation shipped: the row is put
  // back the way it stood, and the sweep alone puts it right.
  scenario(
    "is derived for writing already stored, without a re-save",
    async () => {
      const from = await newNode({ title: "Written before the line" });
      const cited = await newNode({ title: "Named by older writing" });
      await write(from.ref, citing(cited));

      const { DbService } = await import("../db/db.service");
      await app
        .get(DbService)
        .handle.query("UPDATE $id SET references = NONE", {
          id: recordIdFromOwnedRef("node", from.ref),
        });
      expect(await reread(from)).not.toHaveProperty("references");

      const { ReferenceBackfill } = await import("./reference-backfill");
      expect(await app.get(ReferenceBackfill).run()).toBeGreaterThan(0);
      expect((await reread(from)).references).toEqual([cited.ref]);

      // What it writes is its own guard, so a second run has nothing to do.
      expect(await app.get(ReferenceBackfill).run()).toBe(0);
    },
  );
});
