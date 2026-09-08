// Carrying a section between two notes, over real HTTP.
//
// `carry.test.ts` has the placement and the refusals. What only a running
// system shows is that one write moves the section out of one stack and into
// the other, that what the two notes cite follows it, and that a search of the
// writer's own words finds the section under the note it is in now.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type BlockView,
  type NodeView,
  type OwnedRef,
  REFERENCE_NOTE_ATTR,
  type SearchHit,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `carry_${Date.now()}`;
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

// AI.md § A Block Is a Section: a section is a thought somebody put in one
// place, so it goes where they put it — including into another note.
describe("a section carried between two notes", () => {
  let runs = false;
  let app: INestApplication;
  let base: string;
  let ada: Person;

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
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

  const write = (
    node: OwnedRef,
    content: unknown,
    after?: OwnedRef,
  ): Promise<BlockView> =>
    ok("POST", "/blocks", ada, { node, content, after }) as Promise<BlockView>;

  const stackOf = async (note: NodeView): Promise<OwnedRef[]> =>
    (
      (await ok("GET", `/nodes/${at(note.ref)}/blocks`, ada)) as BlockView[]
    ).map((section) => section.ref);

  const carry = (
    section: BlockView,
    node: OwnedRef,
    after?: OwnedRef | null,
  ): Promise<BlockView> =>
    ok("PATCH", `/blocks/${at(section.ref)}`, ada, {
      node,
      ...(after === undefined ? {} : { after }),
    }) as Promise<BlockView>;

  /** The notes a search of the writer's own words reaches. */
  const notesFound = async (words: string): Promise<OwnedRef[]> =>
    (
      (await ok(
        "GET",
        `/nodes/search?q=${encodeURIComponent(words)}`,
        ada,
      )) as SearchHit[]
    ).map((hit) => hit.note);

  const prose = (line: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: line }] }],
  });

  /** A section citing one note, written the way `reference-node.ts` writes it. */
  const citing = (cited: NodeView, line: string) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: `${line} ` },
          {
            type: "reference",
            attrs: { [REFERENCE_NOTE_ATTR]: cited.ref, label: cited.title },
          },
        ],
      },
    ],
  });

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

    const { DbService } = await import("../db/db.service");
    await app.get(DbService).whenOpen();

    ada = await signIn(`carr${Date.now().toString(36)}`);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await dropDatabase(app.get(DbService).handle, DATABASE);
    await app.close();
  });

  scenario("goes into the other note's stack and comes back", async () => {
    const cited = await newNode({ title: "Named by the travelling section" });
    const from = await newNode({ title: "Where the section was written" });
    const into = await newNode({ title: "Where it is carried" });
    const stayed = await write(from.ref, prose("The one that stays put."));
    const travelling = await write(
      from.ref,
      citing(cited, "kaleidoscope, as in"),
      stayed.ref,
    );
    const standing = await write(into.ref, prose("Already in the other note."));

    expect(await stackOf(from)).toEqual([stayed.ref, travelling.ref]);
    expect((await reread(from)).references).toEqual([cited.ref]);
    expect(await notesFound("kaleidoscope")).toEqual([from.ref]);

    const carried = await carry(travelling, into.ref, standing.ref);

    expect(carried.node).toBe(into.ref);
    expect(carried.content).toEqual(citing(cited, "kaleidoscope, as in"));
    expect(await stackOf(from)).toEqual([stayed.ref]);
    expect(await stackOf(into)).toEqual([standing.ref, travelling.ref]);
    expect((await reread(from)).references).toEqual([]);
    expect((await reread(into)).references).toEqual([cited.ref]);
    expect(await notesFound("kaleidoscope")).toEqual([into.ref]);

    await carry(travelling, from.ref, null);

    expect(await stackOf(into)).toEqual([standing.ref]);
    expect(await stackOf(from)).toEqual([travelling.ref, stayed.ref]);
    expect((await reread(from)).references).toEqual([cited.ref]);
    expect((await reread(into)).references).toEqual([]);
    expect(await notesFound("kaleidoscope")).toEqual([from.ref]);
  });

  // An address is a person's label and nothing keys on it, so it changes
  // nothing about what can be carried where — AI.md § The Genealogy Is the
  // Protocol.
  scenario(
    "carries between an unnumbered note and a numbered one",
    async () => {
      const numbered = await newNode({ title: "The numbered note" });
      const unnumbered = await newNode({
        from: { relation: "free" },
        title: "Written with no address",
      });
      expect(numbered.address).toEqual(expect.any(String));
      expect(unnumbered).not.toHaveProperty("address");

      const section = await write(
        unnumbered.ref,
        prose("Zarf, the word this section is found by."),
      );

      await carry(section, numbered.ref);
      expect(await stackOf(unnumbered)).toEqual([]);
      expect(await stackOf(numbered)).toEqual([section.ref]);
      expect(await notesFound("zarf")).toEqual([numbered.ref]);

      await carry(section, unnumbered.ref);
      expect(await stackOf(numbered)).toEqual([]);
      expect(await stackOf(unnumbered)).toEqual([section.ref]);
      expect(await notesFound("zarf")).toEqual([unnumbered.ref]);
      expect((await reread(numbered)).address).toBe(numbered.address);
    },
  );

  scenario("is refused when the note it is going to is gone", async () => {
    const from = await newNode({ title: "Still here" });
    const gone = await newNode({ title: "Deleted before the carry" });
    const section = await write(from.ref, prose("Stays where it was."));
    expect((await call("DELETE", `/nodes/${at(gone.ref)}`, ada)).status).toBe(
      204,
    );

    const refused = await call("PATCH", `/blocks/${at(section.ref)}`, ada, {
      node: gone.ref,
    });

    expect(refused.status).toBe(400);
    expect(await stackOf(from)).toEqual([section.ref]);
  });

  scenario(
    "is refused when the note it is going to is not theirs",
    async () => {
      const bob = await signIn(`bobc${Date.now().toString(36)}`);
      const theirs = (await ok("POST", "/nodes", bob, {
        title: "Somebody else's note",
      })) as NodeView;
      const from = await newNode({ title: "Ada's own" });
      const section = await write(from.ref, prose("Not going anywhere."));

      const refused = await call("PATCH", `/blocks/${at(section.ref)}`, ada, {
        node: theirs.ref,
      });

      expect(refused.status).toBe(400);
      expect(await stackOf(from)).toEqual([section.ref]);
      expect(
        (
          (await ok(
            "GET",
            `/nodes/${at(theirs.ref)}/blocks`,
            bob,
          )) as BlockView[]
        ).length,
      ).toBe(0);
    },
  );
});
