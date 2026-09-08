// A copy of somebody's own writing, against a real server: what the reads
// actually return, which rows they reach, and that the answer is written out
// rather than gathered first.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type BlockView,
  type DidSyr,
  type GraphExport,
  GraphExportSchema,
  type GraphView,
  type NodeView,
  type OwnedRef,
  ownedRefFrom,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `export_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

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
  let runs = false;
  let app: INestApplication;
  let base: string;
  let ada: Person;
  let bram: Person;

  const scenario = (name: string, run: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async (ctx) => {
        ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
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
    await dropDatabase(app.get(DbService).handle, DATABASE);
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

  scenario(
    "carries a branch that was put back, and what was written in it",
    async () => {
      const back = await newNode(ada, { title: "Back again" });
      const under = await newNode(ada, {
        from: { relation: "under", note: back.ref },
        title: "Under it",
      });
      const inside = await newBlock(ada, back.ref, "written before it went");
      await ok("DELETE", `/nodes/${at(back.ref)}`, ada);
      await ok("POST", `/nodes/${at(back.ref)}/restore`, ada);

      const { held } = await copyFor(ada);

      const notes = held.notes.map((note) => note.ref);
      expect(notes).toContain(back.ref);
      expect(notes).toContain(under.ref);
      const kept = held.blocks.find((block) => block.ref === inside.ref);
      expect(kept?.content).toEqual(inside.content);
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

  // The page keys are SurrealQL, and only a walk that actually turns a page
  // says whether the server orders and compares them the way the walk assumes.
  scenario(
    "reaches the same rows a page at a time as it does in one read",
    async () => {
      const shelf = (await ok("POST", "/graphs", ada, {
        title: "The long shelf",
      })) as GraphView;
      const written: NodeView[] = [];
      for (let n = 0; n < 5; n += 1) {
        written.push(
          await newNode(ada, {
            from: { relation: "branch", graph: shelf.ref },
            title: `Shelf ${n}`,
          }),
        );
      }
      // A note nobody numbered is in the walk too, and has to be able to say
      // where the page after it starts.
      for (let n = 0; n < 3; n += 1) {
        written.push(
          await newNode(ada, {
            from: { relation: "free", graph: shelf.ref },
            title: `On its own ${n}`,
          }),
        );
      }
      let after: OwnedRef | undefined;
      for (let s = 0; s < 5; s += 1) {
        after = (await newBlock(ada, written[0].ref, `section ${s}`, after))
          .ref;
      }

      const { ExportRepository } = await import("./export.repository");
      const rows = app.get(ExportRepository);
      const did = ada.did as DidSyr;

      const notesAtOnce = await rows.notesIn(did, shelf.ref, undefined, 100);
      const notesByPage: typeof notesAtOnce = [];
      for (;;) {
        const last = notesByPage.at(-1);
        const page = await rows.notesIn(
          did,
          shelf.ref,
          last && ownedRefFrom(last.id),
          2,
        );
        notesByPage.push(...page);
        if (page.length < 2) break;
      }
      expect(notesAtOnce.length).toBe(8);
      expect(
        notesAtOnce.filter((note) => note.address === undefined).length,
      ).toBe(3);
      expect(notesByPage.map((note) => ownedRefFrom(note.id))).toEqual(
        notesAtOnce.map((note) => ownedRefFrom(note.id)),
      );

      const notes = notesAtOnce.map((note) => ownedRefFrom(note.id));
      const stacksAtOnce = await rows.blocksOf(did, notes, undefined, 100);
      const stacksByPage: typeof stacksAtOnce = [];
      for (;;) {
        const last = stacksByPage.at(-1);
        const page = await rows.blocksOf(
          did,
          notes,
          last && { node: last.node, ord: last.ord },
          2,
        );
        stacksByPage.push(...page);
        if (page.length < 2) break;
      }
      expect(stacksAtOnce.length).toBe(5);
      expect(stacksByPage.map((block) => ownedRefFrom(block.id))).toEqual(
        stacksAtOnce.map((block) => ownedRefFrom(block.id)),
      );
    },
    30_000,
  );

  // The two halves of what a person holds meet here: the reading a copy was
  // taken at is the same reading a later write is measured against.
  scenario(
    "holds a later write to the reading its copy was taken at",
    async () => {
      const note = await newNode(ada, { title: "Copied, then written" });
      const section = await newBlock(ada, note.ref, "as the copy found it");
      const written = (words: string) => ({
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: words }] },
          ],
        },
      });
      const patch = (body: unknown) =>
        fetch(`${base}/api/blocks/${at(section.ref)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: ada.cookie },
          body: JSON.stringify(body),
        });

      const { held } = await copyFor(ada);
      const inCopy = held.blocks.find((block) => block.ref === section.ref);
      expect(inCopy?.updated_at).toBe(section.updated_at);

      const taken = (await ok("PATCH", `/blocks/${at(section.ref)}`, ada, {
        ...written("written after the copy"),
        expects: inCopy?.updated_at,
      })) as BlockView;
      expect(taken.updated_at).not.toBe(inCopy?.updated_at);

      const stale = await patch({
        ...written("from the copy, a second time"),
        expects: inCopy?.updated_at,
      });
      expect(stale.status).toBe(409);

      const { held: since } = await copyFor(ada);
      expect(
        since.blocks.find((block) => block.ref === section.ref)?.updated_at,
      ).toBe(taken.updated_at);
    },
    30_000,
  );
});
