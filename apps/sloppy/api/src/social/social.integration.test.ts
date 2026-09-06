// The rows a conversation is assembled against, on a real store: the voices
// somebody refuses, the notes of theirs that have been answered, and where an
// answer of their own is deposited.
//
// Skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection, createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AnsweredNote, NodeView, RefusedVoiceView } from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `conversing_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

const THEM = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const STRANGER = "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const PEER = "https://author.example";

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

describe("what one person's instance assembles for them", () => {
  let listening = false;
  let app: INestApplication;
  let base: string;
  let reader: { did: string; cookie: string };

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!listening, `nothing is listening at ${ENDPOINT.href}`);
      await run();
    });

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: reader.cookie },
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
    body?: unknown,
  ): Promise<unknown> => {
    const answer = await call(method, path, body);
    expect(
      answer.status,
      `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
    ).toBeLessThan(300);
    return answer.body;
  };

  const refusals = () =>
    ok("GET", "/refused-voices") as Promise<RefusedVoiceView[]>;
  const answered = () =>
    ok("GET", "/answered-notes") as Promise<AnsweredNote[]>;

  /** A note of the reader's own, which is what a pointer is left on. */
  const wrote = async (title: string): Promise<NodeView> =>
    (await ok("POST", "/nodes", { title })) as NodeView;

  /** As a deposit that got in writes one: the author owns the row. */
  async function pointerOn(note: string, voice: string): Promise<void> {
    const { DbService } = await import("../db/db.service");
    const at = new Date().toISOString();
    await app.get(DbService).handle.query(
      `CREATE comment_pointer CONTENT {
         created_by: $author, created_at: $at, updated_at: $at,
         note: $note, voice: $voice, comment_id: $comment
       } RETURN NONE`,
      {
        author: reader.did,
        at,
        note,
        voice,
        comment: `${voice}:${Math.random().toString(36).slice(2)}`,
      },
    );
  }

  async function signIn(username: string) {
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

    const params = new URL(started.consent_url).searchParams;
    const idp = { authorization: `Bearer ${registered.access_token}` };
    const opened = (await (
      await fetch(`${base}/api/idp/consent`, {
        method: "POST",
        headers: { "content-type": "application/json", ...idp },
        body: JSON.stringify({
          platform_origin: params.get("platform_origin"),
          platform_name: params.get("platform_name"),
          callback_url: params.get("callback_url"),
          scopes: params.get("scopes")?.split(","),
          state: params.get("state"),
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

    reader = await signIn(`talker${Date.now().toString(36)}`);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await app.get(DbService).handle.query(`REMOVE DATABASE ${DATABASE}`);
    await app.close();
  });

  scenario(
    "keeps a blanket refusal apart from one made on a note",
    async () => {
      const note = await wrote("Where the refusals are read");
      const everywhere = (await ok("POST", "/refused-voices", {
        voice: THEM,
      })) as RefusedVoiceView;
      const here = (await ok("POST", "/refused-voices", {
        voice: STRANGER,
        note: note.ref,
      })) as RefusedVoiceView;

      expect(everywhere.note).toBeUndefined();
      expect(here.note).toBe(note.ref);
      expect((await refusals()).map((one) => one.ref)).toEqual(
        expect.arrayContaining([everywhere.ref, here.ref]),
      );

      // The pair is the row, so saying it twice does not write a second.
      const again = (await ok("POST", "/refused-voices", {
        voice: THEM,
      })) as RefusedVoiceView;
      expect(again.ref).toBe(everywhere.ref);

      await ok("DELETE", `/refused-voices?voice=${encodeURIComponent(THEM)}`);
      const left = await refusals();
      expect(left.map((one) => one.ref)).toEqual([here.ref]);

      await ok(
        "DELETE",
        `/refused-voices?voice=${encodeURIComponent(STRANGER)}` +
          `&note=${encodeURIComponent(note.ref)}`,
      );
      expect(await refusals()).toEqual([]);
    },
  );

  scenario("will not let somebody stop being shown themselves", async () => {
    const answer = await call("POST", "/refused-voices", {
      voice: reader.did,
    });
    expect(answer.status).toBe(400);
  });

  scenario("names the notes answered, and who answered them", async () => {
    const note = await wrote("A city remembers");
    await pointerOn(note.ref, THEM);
    await pointerOn(note.ref, STRANGER);
    await pointerOn(note.ref, THEM);

    const [entry] = (await answered()).filter((one) => one.note === note.ref);
    expect(entry.address).toBe(note.address);
    expect(entry.title).toBe("A city remembers");
    expect(entry.graph).toBe(note.graph);
    // One voice however many times they answered, in the order they arrived.
    expect(entry.voices).toEqual([THEM, STRANGER]);
  });

  scenario("drops a refused voice from the notes it names", async () => {
    const note = await wrote("Answered by one voice only");
    await pointerOn(note.ref, THEM);
    expect((await answered()).some((one) => one.note === note.ref)).toBe(true);

    await ok("POST", "/refused-voices", { voice: THEM, note: note.ref });

    expect((await answered()).some((one) => one.note === note.ref)).toBe(false);
    await ok(
      "DELETE",
      `/refused-voices?voice=${encodeURIComponent(THEM)}` +
        `&note=${encodeURIComponent(note.ref)}`,
    );
    expect((await answered()).some((one) => one.note === note.ref)).toBe(true);
  });

  scenario("finds where an answer to a held note is deposited", async () => {
    const { DbService } = await import("../db/db.service");
    const { PointerRepository } = await import("./pointer.repository");
    const { createOwnedRecordId, ownedRefFrom } = await import("@sloppy/types");
    const held = `${THEM}/01JQXR0000000000000000HELD`;
    const at = new Date().toISOString();
    const db = app.get(DbService).handle;
    const id = createOwnedRecordId("pull", reader.did);
    const region = ownedRefFrom(id);
    await db.query(
      `CREATE $id CONTENT {
         created_by: $reader, created_at: $at, updated_at: $at,
         publication: $publication, version: $version, root_address: '1a',
         comments: 'anyone', source_url: $source
       } RETURN NONE`,
      {
        id,
        reader: reader.did,
        at,
        source: PEER,
        publication: `${THEM}/01JQXR00000000000000000PUB`,
        version: `${THEM}/01JQXR00000000000000000VER`,
      },
    );
    await db.query(
      `CREATE pull_member CONTENT {
         created_by: $reader, created_at: $at, updated_at: $at,
         pull: $pull, source: $note
       } RETURN NONE`,
      { reader: reader.did, at, pull: region, note: held },
    );

    const pointers = app.get(PointerRepository);
    await expect(pointers.sourceOf(reader.did, held)).resolves.toBe(PEER);
    await expect(
      pointers.sourceOf(reader.did, `${THEM}/01JQXR0000000000000000NONE`),
    ).resolves.toBeNull();
  });
});
