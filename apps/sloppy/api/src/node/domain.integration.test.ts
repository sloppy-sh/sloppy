// The domain routes against a real server: addresses assigned by the API,
// regions read through the index that exists for them, block stacks ordered by
// a fractional index, and the tags the notes carry.
//
// Everything here is a claim about a running system — that a unique index
// refuses a second writer, that a bounded read touches a slice rather than a
// graph, that a session cannot reach somebody else's notes. None of it is
// observable from the source.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type Address,
  addressDepth,
  type BlockView,
  compareAddresses,
  type DeletedBranch,
  type GraphView,
  MAX_DOCUMENT_NESTING,
  MAX_NOTES_PER_BULK_ACT,
  type NodeBulkResult,
  type NodeView,
  type OwnedRef,
  type SearchHit,
  siblingAddress,
  type TagCount,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `domain_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** A graph big enough that reading all of it is visibly the wrong thing to do. */
const CROWD = 5000;

/** The addresses these notes were written at. Every note a creation answers
 *  with carries one; this is where that is stated rather than assumed. */
function numbered(notes: readonly NodeView[]): Address[] {
  return notes.map((note) => {
    if (note.address === undefined) {
      throw new Error(`${note.ref} was written without an address`);
    }
    return note.address;
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

describe("the domain routes", () => {
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

  async function call(
    method: string,
    path: string,
    person: Person | null,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(person ? { cookie: person.cookie } : {}),
      },
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

  const newNode = (
    person: Person,
    request: Record<string, unknown>,
  ): Promise<NodeView> =>
    ok("POST", "/nodes", person, request) as Promise<NodeView>;

  const springsFrom = (note: NodeView) => ({
    relation: "under",
    note: note.ref,
  });
  const follows = (note: NodeView) => ({ relation: "after", note: note.ref });

  const newGraph = (person: Person, title: string): Promise<GraphView> =>
    ok("POST", "/graphs", person, { title }) as Promise<GraphView>;

  /** The graph this person started with. Its ulid is its own, so it is read
   *  rather than spelled — docs/ARCHITECTURE.md § "The genealogy and the
   *  address". */
  const homeOf = async (person: Person): Promise<OwnedRef> => {
    const listed = (await ok("GET", "/graphs", person)) as GraphView[];
    const home = listed.find((graph) => graph.home);
    if (!home) throw new Error("That person has no graph of their own.");
    return home.ref;
  };

  const branchesOf = (person: Person, graph?: OwnedRef): Promise<NodeView[]> =>
    ok(
      "GET",
      graph ? `/nodes?graph=${encodeURIComponent(graph)}` : "/nodes",
      person,
    ) as Promise<NodeView[]>;

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

    // The API listens before the store is open; these routes need it open.
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

  describe("the address, which the server alone assigns", () => {
    scenario(
      "numbers roots, letters their children, and alternates down",
      async () => {
        const root = await newNode(ada, { title: "A city remembers" });
        expect(root.address).toBe("1");
        expect(root.depth).toBe(1);
        expect(root.origin).toBe(root.ref);
        expect(root.parent).toBeUndefined();

        const first = await newNode(ada, {
          from: springsFrom(root),
          title: "First",
        });
        const second = await newNode(ada, {
          from: springsFrom(root),
          title: "Second",
        });
        const deeper = await newNode(ada, {
          from: springsFrom(first),
          title: "Under",
        });

        expect([first.address, second.address, deeper.address]).toEqual([
          "1a",
          "1b",
          "1a1",
        ]);
        expect(deeper.depth).toBe(3);
        expect(deeper.origin).toBe(root.ref);
        expect(deeper.parent).toBe(first.ref);
      },
    );

    scenario("continues a run rather than deepening it", async () => {
      const root = await newNode(ada, { title: "A run of thought" });
      const under = await newNode(ada, { from: springsFrom(root) });
      const alongside = await newNode(ada, { from: follows(under) });
      const nextBranch = await newNode(ada, { from: follows(root) });

      expect(alongside.address).toBe(`${root.address}b`);
      expect(alongside.parent).toBe(root.ref);
      expect(alongside.origin).toBe(root.ref);

      // A root's next note is a branch of its own, so it is its own origin.
      expect(addressDepth(nextBranch.address as Address)).toBe(1);
      expect(nextBranch.parent).toBeUndefined();
      expect(nextBranch.origin).toBe(nextBranch.ref);
    });

    scenario("writes a note with no number, and keeps numbering", async () => {
      const alone = await newGraph(ada, "Notes with no numbers");

      const first = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "A thought on its own",
      });
      const second = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "Another",
      });

      expect(first.address).toBeUndefined();
      expect(second.address).toBeUndefined();
      expect(first.depth).toBe(1);
      expect(first.parent).toBeUndefined();
      expect(first.origin).toBe(first.ref);

      // The run reads them without an address between them, and a branch
      // opened afterwards still takes the first number the graph has free.
      const branch = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
        title: "Numbered",
      });
      expect(branch.address).toBe("1");

      const under = await newNode(ada, {
        from: springsFrom(first),
        title: "What it led to",
      });
      expect(under.address).toBeUndefined();
      expect(under.parent).toBe(first.ref);
      expect(under.depth).toBe(2);

      const branches = await branchesOf(ada, alone.ref);
      expect(branches.map((one) => one.ref).sort()).toEqual(
        [first.ref, second.ref, branch.ref].sort(),
      );
    });

    scenario("opens a branch at the number its author picked", async () => {
      const picked = await newNode(ada, {
        from: { relation: "root", address: "4096" },
        title: "Numbered by hand",
      });
      expect(picked.address).toBe("4096");
      expect(picked.depth).toBe(1);
      expect(picked.parent).toBeUndefined();
      expect(picked.origin).toBe(picked.ref);

      const again = await call("POST", "/nodes", ada, {
        from: { relation: "root", address: "4096" },
      });
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toContain("4096");

      // Somebody else's graph is a different set of numbers entirely.
      const bramsOwn = await newNode(bram, {
        from: { relation: "root", address: "4096" },
      });
      expect(bramsOwn.address).toBe("4096");
    });

    scenario(
      "gives each graph a person keeps its own number line",
      async () => {
        // The whole of the ruling, end to end: `1a` is a label read inside one
        // graph, so two of a person's own graphs each hold one and they are
        // different notes.
        const beside = await newGraph(ada, "Beside the first");

        const root = await ok("POST", "/nodes", ada, {
          from: { relation: "branch", graph: beside.ref },
          title: "A second notebook",
        });
        const opened = root as NodeView;
        expect(opened.address).toBe("1");
        expect(opened.graph).toBe(beside.ref);

        const under = await newNode(ada, {
          from: springsFrom(opened),
          title: "Under it",
        });
        expect(under.address).toBe("1a");
        // A note placed against another is in that note's graph; nothing said so.
        expect(under.graph).toBe(beside.ref);

        // The home graph already holds a `1`, and it is somewhere else entirely.
        const home = await branchesOf(ada);
        const hers = await branchesOf(ada, beside.ref);
        expect(home.map((note) => note.address)).toContain("1");
        expect(hers.map((note) => note.address)).toEqual(["1"]);
        expect(home.map((note) => note.ref)).not.toContain(opened.ref);

        // A note that follows a BRANCH has no parent to read a graph off, and
        // takes it off the note it follows: a run continued in the second
        // notebook stays in the second notebook, and takes the next number on
        // that notebook's line rather than on the home one's.
        const next = await newNode(ada, { from: follows(opened) });
        expect(next.graph).toBe(beside.ref);
        expect(next.parent).toBeUndefined();
        expect(next.address).toBe("2");

        // A number this person already used, taken again in the other graph.
        const numbered = await newNode(ada, {
          from: { relation: "root", address: "4096", graph: beside.ref },
        });
        expect(numbered.address).toBe("4096");
        expect(numbered.graph).toBe(beside.ref);

        expect(
          (await branchesOf(ada, beside.ref)).map((note) => note.address),
        ).toEqual(["1", "2", "4096"]);
      },
    );

    scenario("refuses a note in a graph that is not the caller's", async () => {
      const bramsOwn = await newGraph(bram, "Not hers");
      for (const graph of [
        bramsOwn.ref,
        `${ada.did}/01JGRAPHNTHERE000000000000`,
      ]) {
        const answer = await call("POST", "/nodes", ada, {
          from: { relation: "branch", graph },
        });
        expect(answer.status, `${graph} was accepted`).toBe(400);
      }
    });

    scenario("refuses a number that is not a branch's to hold", async () => {
      for (const address of ["1a", "0", "-3", "", "1.5"]) {
        const answer = await call("POST", "/nodes", ada, {
          from: { relation: "root", address },
        });
        expect(answer.status, `${JSON.stringify(address)} was accepted`).toBe(
          400,
        );
      }
    });

    scenario("refuses a body that names a place of its own", async () => {
      const parent = await newNode(ada, { title: "Names its own children" });
      for (const named of [
        { address: "9999", depth: 42 },
        { origin: "did:syr:z6MkNot/00000000000000000000000000" },
      ]) {
        const answer = await call("POST", "/nodes", ada, {
          from: springsFrom(parent),
          title: "Not yours to name",
          ...named,
        });
        expect(answer.status, `${JSON.stringify(named)} was accepted`).toBe(
          400,
        );
      }

      const minted = await newNode(ada, { from: springsFrom(parent) });
      expect(minted.address).toBe(`${parent.address}a`);
      expect(minted.depth).toBe(addressDepth(minted.address as Address));
      expect(minted.origin).toBe(parent.ref);
    });

    scenario("refuses the shape that used to place a note", async () => {
      const parent = await newNode(ada, { title: "Still asked for by name" });
      // A client on the old shape asked for a note under that one; the branch
      // it would silently open instead keeps its address forever.
      const answer = await call("POST", "/nodes", ada, {
        parent: parent.ref,
        title: "Under this, once",
      });
      expect(answer.status).toBe(400);
      expect(JSON.stringify(answer.body)).toContain("out of date");
    });

    scenario("refuses a note that is not there to place against", async () => {
      const nowhere = `${ada.did}/00000000000000000000000000`;
      for (const relation of ["under", "after"]) {
        const answer = await call("POST", "/nodes", ada, {
          from: { relation, note: nowhere },
          title: "Orphan",
        });
        expect(answer.status, `${relation} was accepted`).toBe(400);
      }
    });

    scenario("gives 24 racing creations 24 different addresses", async () => {
      const parent = await newNode(ada, { title: "A crowded parent" });
      const racers = Array.from({ length: 24 }, (_, i) =>
        newNode(ada, { from: springsFrom(parent), title: `Racer ${i}` }),
      );
      const born = await Promise.all(racers);
      const addresses = numbered(born).sort(compareAddresses);
      expect(new Set(addresses).size).toBe(24);
      expect(addresses[0]).toBe(`${parent.address}a`);
      expect(addresses[23]).toBe(`${parent.address}x`);
      for (const node of born) {
        expect(node.depth).toBe(addressDepth(node.address as Address));
        expect(node.origin).toBe(parent.ref);
      }
    });

    // Two services are two API processes: their in-process queues cannot see
    // each other, so the unique index is the only thing left between them.
    scenario("survives two writers with no queue in common", async () => {
      const { NodeService } = await import("./node.service");
      const { NodeRepository } = await import("./node.repository");
      const { FindRepository } = await import("./find.repository");
      const { GraphService } = await import("./graph.service");
      const { MediaService } = await import("../media/media.service");
      const { PublicationService } = await import(
        "../publication/publication.service"
      );
      const repository = app.get(NodeRepository);
      const finds = app.get(FindRepository);
      const graphs = app.get(GraphService);
      const media = app.get(MediaService);
      const publications = app.get(PublicationService);
      const one = new NodeService(
        repository,
        finds,
        graphs,
        media,
        publications,
      );
      const other = new NodeService(
        repository,
        finds,
        graphs,
        media,
        publications,
      );

      const parent = await newNode(ada, { title: "Two writers" });
      const born = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 === 0 ? one : other).create(ada.did, {
            from: { relation: "under", note: parent.ref },
            title: `Writer ${i}`,
            tags: [],
          }),
        ),
      );
      const addresses = numbered(born).sort(compareAddresses);
      expect(new Set(addresses).size).toBe(20);
      expect(addresses[19]).toBe(`${parent.address}t`);
    });

    // Two identities, ~16 sequential round trips each. AI.md makes this the proof
    // that address assignment is deterministic, so it must not go red merely
    // because the suite around it is busy — a protocol test nobody trusts is one
    // everybody reads past.
    scenario(
      "assigns the same addresses to two identities applying the same sequence",
      async () => {
        const run = async (person: Person): Promise<string[]> => {
          const written: NodeView[] = [];
          const root = await newNode(person, { title: "Same sequence" });
          written.push(root);
          for (const step of [0, 0, 1, 0, 2, 3, 1]) {
            written.push(
              await newNode(person, {
                from: springsFrom(written[step]),
                title: `Step ${step}`,
              }),
            );
          }
          return numbered(written);
        };
        // Two identities that have written nothing yet, so each sequence starts
        // from the same empty graph and only the sequence decides the addresses.
        const first = await signIn(`peera${Date.now().toString(36)}`);
        const second = await signIn(`peerb${Date.now().toString(36)}`);
        expect(await run(first)).toEqual(await run(second));
      },
      30_000,
    );
  });

  // AI.md § "The Genealogy Is the Protocol": a person who writes a number that
  // says their note springs from another one may carry it there, and the note
  // keeps leading by every number it has held.
  describe("carrying a note to the number a person named", () => {
    let notebook: GraphView;
    let two: NodeView;
    let alongside: NodeView;
    let moving: NodeView;
    let beneath: NodeView;
    let three: NodeView;
    let landing: NodeView;

    const rooted = (address: string) => ({
      relation: "root",
      address,
      graph: notebook.ref,
    });

    const carry = (
      note: NodeView,
      to: Record<string, unknown>,
      address?: string,
    ) =>
      call("POST", `/nodes/${at(note.ref)}/move`, ada, {
        to,
        ...(address === undefined ? {} : { address }),
      });

    const said = (body: unknown) => (body as { message: string }).message;

    beforeAll(async () => {
      if (!runs) return;
      notebook = await newGraph(ada, "Nesting");
      two = await newNode(ada, { from: rooted("2"), title: "Two" });
      await newNode(ada, { from: springsFrom(two) });
      alongside = await newNode(ada, { from: springsFrom(two) });
      moving = await newNode(ada, { from: springsFrom(two), title: "Cells" });
      beneath = await newNode(ada, { from: springsFrom(moving) });
      three = await newNode(ada, { from: rooted("3"), title: "Three" });
      landing = await newNode(ada, { from: springsFrom(three) });
      expect([alongside.address, moving.address, beneath.address]).toEqual([
        "2b",
        "2c",
        "2c1",
      ]);
      expect(landing.address).toBe("3a");
    });

    scenario("takes it, with everything under it, in one act", async () => {
      const answer = await carry(moving, springsFrom(landing), "3a1");
      expect(answer.status, JSON.stringify(answer.body)).toBeLessThan(300);
      const subtree = answer.body as NodeView[];

      expect(subtree.map((one) => [one.address, one.depth])).toEqual([
        ["3a1", 3],
        ["3a1a", 4],
      ]);
      expect(subtree[0].parent).toBe(landing.ref);
      expect(subtree[1].parent).toBe(moving.ref);
      expect(subtree.map((one) => one.aliases)).toEqual([["2c"], ["2c1"]]);
    });

    scenario("keeps every number it has held leading to it", async () => {
      for (const address of ["2c", "3a1"]) {
        const hits = (await ok(
          "GET",
          `/nodes/search?q=${address}&graph=${encodeURIComponent(notebook.ref)}`,
          ada,
        )) as SearchHit[];
        expect(hits[0]?.note, address).toBe(moving.ref);
      }
      const hits = (await ok(
        "GET",
        `/nodes/search?q=2c1&graph=${encodeURIComponent(notebook.ref)}`,
        ada,
      )) as SearchHit[];
      expect(hits[0]?.note).toBe(beneath.ref);
    });

    scenario("refuses one that springs from somewhere else", async () => {
      const answer = await carry(alongside, springsFrom(landing), "3b1");
      expect(answer.status).toBe(400);
      expect(said(answer.body)).toMatch(/3b1 does not spring from 3a/);
    });

    scenario("refuses one another note is already at", async () => {
      const answer = await carry(alongside, springsFrom(landing), "3a1");
      expect(answer.status).toBe(400);
      expect(said(answer.body)).toMatch(/3a1 already leads to “Cells”/);
    });

    scenario("refuses one a note was carried away from", async () => {
      const answer = await carry(alongside, springsFrom(two), "2c");
      expect(answer.status).toBe(400);
      expect(said(answer.body)).toMatch(/2c still leads to “Cells”/);
    });

    scenario(
      "refuses one a note it carries was carried away from",
      async () => {
        const stem = await newNode(ada, { from: rooted("6"), title: "Stem" });
        const leaf = await newNode(ada, {
          from: springsFrom(stem),
          title: "Leaf",
        });
        const tip = await newNode(ada, {
          from: springsFrom(leaf),
          title: "Tip",
        });
        expect([leaf.address, tip.address]).toEqual(["6a", "6a1"]);
        const seven = await newNode(ada, { from: rooted("7"), title: "Seven" });
        const under = await newNode(ada, { from: springsFrom(seven) });
        expect(under.address).toBe("7a");
        for (const address of ["7a1", "6a1"]) {
          await ok("PUT", `/nodes/${at(tip.ref)}/address`, ada, { address });
        }

        const answer = await carry(leaf, springsFrom(under), "7a1");
        expect(answer.status).toBe(400);
        expect(said(answer.body)).toMatch(/7a1 still leads to “Tip”/);
      },
    );

    scenario("refuses a number no branch could hold", async () => {
      const answer = await carry(alongside, follows(three), "3a1");
      expect(answer.status).toBe(400);
      expect(said(answer.body)).toMatch(/whole number/);
    });

    scenario("leaves the landing to the rule where none is named", async () => {
      const answer = await carry(alongside, springsFrom(landing));
      expect(answer.status, JSON.stringify(answer.body)).toBeLessThan(300);
      expect((answer.body as NodeView[])[0].address).toBe("3a2");
    });

    scenario(
      "takes a number it left back, and is not left leading to it twice",
      async () => {
        const answer = await carry(moving, springsFrom(two), "2c");
        expect(answer.status, JSON.stringify(answer.body)).toBeLessThan(300);

        expect(
          (answer.body as NodeView[]).map((one) => [one.address, one.aliases]),
        ).toEqual([
          ["2c", ["3a1"]],
          ["2c1", ["3a1a"]],
        ]);
      },
    );
  });

  // AI.md § "The Genealogy Is the Protocol": where nothing carries the number a
  // person's own springs from, they may write that note and carry theirs under
  // it, and both halves are one person's own labels.
  describe("writing the note a number springs from", () => {
    let notebook: GraphView;
    let three: NodeView;
    let moving: NodeView;
    let beneath: NodeView;

    beforeAll(async () => {
      if (!runs) return;
      notebook = await newGraph(ada, "Missing");
      const two = await newNode(ada, {
        from: { relation: "root", address: "2", graph: notebook.ref },
        title: "Two",
      });
      await newNode(ada, { from: springsFrom(two) });
      await newNode(ada, { from: springsFrom(two) });
      moving = await newNode(ada, { from: springsFrom(two), title: "Cells" });
      beneath = await newNode(ada, { from: springsFrom(moving) });
      three = await newNode(ada, {
        from: { relation: "root", address: "3", graph: notebook.ref },
        title: "Three",
      });
      expect([moving.address, beneath.address]).toEqual(["2c", "2c1"]);
    });

    scenario("writes it, and carries the note under it", async () => {
      const written = await newNode(ada, {
        from: springsFrom(three),
        address: "3a",
      });
      expect([written.address, written.parent, written.title]).toEqual([
        "3a",
        three.ref,
        "",
      ]);

      const answer = await call("POST", `/nodes/${at(moving.ref)}/move`, ada, {
        to: springsFrom(written),
        address: "3a1",
      });
      expect(answer.status, JSON.stringify(answer.body)).toBeLessThan(300);
      expect(
        (answer.body as NodeView[]).map((one) => [one.address, one.aliases]),
      ).toEqual([
        ["3a1", ["2c"]],
        ["3a1a", ["2c1"]],
      ]);
      expect((answer.body as NodeView[])[0].parent).toBe(written.ref);
    });
  });

  describe("reading a region", () => {
    let origin: OwnedRef;

    const seedCrowd = async (): Promise<void> => {
      const { DbService } = await import("../db/db.service");
      const { createOwnedRecordId, ownedRefFrom } = await import(
        "@sloppy/types"
      );
      const rootId = createOwnedRecordId("node", bram.did);
      origin = ownedRefFrom(rootId);

      const rows: unknown[] = [];
      const now = "2026-01-01T00:00:00.000Z";
      const shared = {
        created_by: bram.did,
        graph: await homeOf(bram),
        origin,
        created_at: now,
        updated_at: now,
      };
      rows.push({
        id: rootId,
        address: "9",
        depth: 1,
        title: "Crowd",
        ...shared,
      });

      // Every row carries its parent, because that is what tells a root from a
      // note that sprang from one: the roots read binds `parent = NONE`.
      const letters = "abcdefghijklmnopqrstuvwxyz";
      let made = 1;
      const plant = (address: string, depth: number, parent: OwnedRef) => {
        const id = createOwnedRecordId("node", bram.did);
        rows.push({ id, address, depth, parent, title: address, ...shared });
        made++;
        return ownedRefFrom(id);
      };

      const level2: { address: string; ref: OwnedRef }[] = [];
      for (let i = 0; i < 20 && made < CROWD; i++) {
        const address = `9${letters[i]}`;
        level2.push({ address, ref: plant(address, 2, origin) });
      }
      const level3: { address: string; ref: OwnedRef }[] = [];
      for (const parent of level2) {
        for (let i = 1; i <= 12 && made < CROWD; i++) {
          const address = `${parent.address}${i}`;
          level3.push({ address, ref: plant(address, 3, parent.ref) });
        }
      }
      for (const parent of level3) {
        for (let i = 0; i < 20 && made < CROWD; i++) {
          plant(`${parent.address}${letters[i]}`, 4, parent.ref);
        }
      }

      const db = app.get(DbService).handle;
      for (let i = 0; i < rows.length; i += 500) {
        await db.query("INSERT INTO node $rows", {
          rows: rows.slice(i, i + 500),
        });
      }
    };

    scenario(
      "touches a slice of a five-thousand-note graph, not the graph",
      async () => {
        await seedCrowd();
        const { DbService } = await import("../db/db.service");
        const db = app.get(DbService).handle;

        const [plan] = await db.query<[unknown[]]>(
          `SELECT * FROM node
           WHERE created_by = $did AND origin = $origin AND depth <= $max EXPLAIN;`,
          { did: bram.did, origin, max: 2 },
        );
        const explained = JSON.stringify(plan);
        expect(explained).toContain("node_owner_origin_depth");
        expect(explained).toContain("IndexScan");
        // A Filter would mean the bound is being applied after the rows are read.
        expect(explained).not.toContain('"operator":"Filter"');

        const whole = (await ok(
          "GET",
          `/nodes?origin=${encodeURIComponent(origin)}`,
          bram,
        )) as NodeView[];
        expect(whole.length).toBeGreaterThanOrEqual(CROWD);

        const timings: Record<string, string> = {};
        for (const levels of [1, 2, 3]) {
          const started = process.hrtime.bigint();
          const slice = (await ok(
            "GET",
            `/nodes?origin=${encodeURIComponent(origin)}&max_depth=${levels}`,
            bram,
          )) as NodeView[];
          timings[`depth <= ${levels}`] =
            `${slice.length} notes in ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1)}ms`;
          expect(slice.every((node) => node.depth <= levels)).toBe(true);
          expect(slice.length).toBeLessThan(whole.length);
        }
        const started = process.hrtime.bigint();
        await ok("GET", `/nodes?origin=${encodeURIComponent(origin)}`, bram);
        timings.unbounded = `${whole.length} notes in ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1)}ms`;
        console.log("bounded region reads:", timings);
      },
      120_000,
    );

    scenario("answers roots without their descendants", async () => {
      const roots = (await ok("GET", "/nodes", bram)) as NodeView[];
      expect(roots.every((node) => node.depth === 1)).toBe(true);
      expect(roots.length).toBeLessThan(CROWD);
    });
  });

  describe("a note's interior", () => {
    let node: NodeView;

    const stack = async (): Promise<BlockView[]> =>
      (await ok("GET", `/nodes/${at(node.ref)}/blocks`, ada)) as BlockView[];

    /** A section of plain prose, one paragraph per line. */
    const prose = (...lines: string[]) => ({
      type: "doc",
      content: lines.map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
    });

    scenario("stacks blocks in the order they were placed", async () => {
      node = await newNode(ada, { title: "A note with an interior" });
      const first = (await ok("POST", "/blocks", ada, {
        node: node.ref,
        content: prose("The first thing."),
      })) as BlockView;
      const second = (await ok("POST", "/blocks", ada, {
        node: node.ref,
        after: first.ref,
        content: prose("Then a second thought."),
      })) as BlockView;
      const third = (await ok("POST", "/blocks", ada, {
        node: node.ref,
        after: second.ref,
        content: prose("And a third."),
      })) as BlockView;

      expect((await stack()).map((block) => block.ref)).toEqual([
        first.ref,
        second.ref,
        third.ref,
      ]);

      const wedged = (await ok("POST", "/blocks", ada, {
        node: node.ref,
        after: first.ref,
        content: prose("Wedged in."),
      })) as BlockView;
      expect((await stack()).map((block) => block.ref)).toEqual([
        first.ref,
        wedged.ref,
        second.ref,
        third.ref,
      ]);
      // Nothing but the new block was written.
      expect((await stack())[0].ord).toBe(first.ord);
      expect((await stack())[2].ord).toBe(second.ord);
    });

    scenario("moves a block without renumbering its neighbours", async () => {
      const before = await stack();
      const last = before[before.length - 1];
      const ords = before.slice(0, -1).map((block) => block.ord);

      await ok("PATCH", `/blocks/${at(last.ref)}`, ada, { after: null });
      const after = await stack();
      expect(after[0].ref).toBe(last.ref);
      expect(after.slice(1).map((block) => block.ord)).toEqual(ords);
    });

    scenario("edits and removes a block", async () => {
      const blocks = await stack();
      const rewritten = prose("Rewritten.", "At more length than before.");
      const edited = (await ok("PATCH", `/blocks/${at(blocks[1].ref)}`, ada, {
        content: rewritten,
      })) as BlockView;
      expect(edited.content).toEqual(rewritten);

      expect(
        (await call("DELETE", `/blocks/${at(blocks[0].ref)}`, ada)).status,
      ).toBe(204);
      expect((await stack()).map((block) => block.ref)).not.toContain(
        blocks[0].ref,
      );
    });

    // A section is many elements, drawings included, and the store keeps the
    // whole document rather than the part it can name.
    scenario("keeps everything written into one section", async () => {
      const drawn = await newNode(ada, { title: "A note with ink" });
      const section = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Where the line goes" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Two paragraphs and a drawing." }],
          },
          { type: "paragraph", content: [{ type: "text", text: "This one." }] },
          {
            type: "ink",
            attrs: {
              strokes: [
                { points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }], width: 2 },
              ],
              width: 320,
              height: 240,
              raster_upload_id: null,
            },
          },
        ],
      };
      const written = (await ok("POST", "/blocks", ada, {
        node: drawn.ref,
        content: section,
      })) as BlockView;
      expect(written.content).toEqual(section);

      const [read] = (await ok(
        "GET",
        `/nodes/${at(drawn.ref)}/blocks`,
        ada,
      )) as BlockView[];
      expect(read.content).toEqual(section);
    });

    scenario("starts a section with nothing in it", async () => {
      const empty = await newNode(ada, { title: "Nothing written yet" });
      const block = (await ok("POST", "/blocks", ada, {
        node: empty.ref,
      })) as BlockView;
      expect(block.content).toEqual({ type: "doc", content: [] });
    });

    // Nested this far the store stops answering at all, so without a refusal
    // the route never replies and the surface saves forever. Only a running
    // server tells a refusal from a silence.
    scenario("refuses a section nested past what it can hold", async () => {
      const note = await newNode(ada, { title: "Indented past the bound" });
      let attrs: Record<string, unknown> = {};
      for (let level = 4; level <= MAX_DOCUMENT_NESTING * 3; level += 1) {
        attrs = { held: attrs };
      }
      const answer = await call("POST", "/blocks", ada, {
        node: note.ref,
        content: { type: "doc", content: [{ type: "paragraph", attrs }] },
      });
      expect(answer.status).toBe(400);
      expect((answer.body as { message: string }).message).toMatch(
        /nested too deeply/,
      );
    });

    scenario("refuses a neighbour from another note", async () => {
      const elsewhere = await newNode(ada, { title: "Elsewhere" });
      const stray = (await ok("POST", "/blocks", ada, {
        node: elsewhere.ref,
        content: prose("Stray."),
      })) as BlockView;
      const answer = await call("POST", "/blocks", ada, {
        node: node.ref,
        after: stray.ref,
        content: prose("Nowhere to go."),
      });
      expect(answer.status).toBe(400);
    });

    scenario("keeps a section written on two devices at once", async () => {
      const note = await newNode(ada, { title: "Open in two places" });
      const opened = (await ok("POST", "/blocks", ada, {
        node: note.ref,
        content: prose("What both of them opened."),
      })) as BlockView;
      const held = async () =>
        (
          (await ok("GET", `/nodes/${at(note.ref)}/blocks`, ada)) as BlockView[]
        )[0];

      const phone = (await ok("PATCH", `/blocks/${at(opened.ref)}`, ada, {
        content: prose("What the phone wrote."),
        expects: opened.updated_at,
      })) as BlockView;

      const tablet = await call("PATCH", `/blocks/${at(opened.ref)}`, ada, {
        content: prose("What the tablet would have put over it."),
        expects: opened.updated_at,
      });
      expect(tablet.status).toBe(409);
      expect((tablet.body as { message: string }).message).toMatch(
        /written somewhere else/,
      );
      expect((await held()).content).toEqual(prose("What the phone wrote."));

      const reread = prose("What the tablet wrote after reading again.");
      await ok("PATCH", `/blocks/${at(opened.ref)}`, ada, {
        content: reread,
        expects: phone.updated_at,
      });
      expect((await held()).content).toEqual(reread);
    });
  });

  describe("the tag axis", () => {
    scenario("normalizes a tag into the set the store holds", async () => {
      const note = await newNode(ada, {
        title: "Tagged",
        // The last two are the same word: one keyboard composes the accent and
        // another sends the letter with a combining mark after it.
        tags: ["Biology", " biology ", "r\u00e9veil", "re\u0301veil"],
      });
      expect(note.tags).toEqual(["biology", "r\u00e9veil"]);

      // A tag holds spaces, and a run of them is the one space it was meant to be.
      const spaced = await newNode(ada, {
        title: "Spaced",
        tags: ["machine  learning"],
      });
      expect(spaced.tags).toEqual(["machine learning"]);

      expect(
        (await call("POST", "/nodes", ada, { tags: ["   "] })).status,
      ).toBe(400);
    });

    // Rendered verbatim by the field, so it says what is wrong AND where — a
    // person cannot fix a form they cannot locate, and the wire's own `tags.0`
    // names an index nobody typed.
    scenario("refuses a tag in words a person can act on", async () => {
      const refused = await call("POST", "/nodes", ada, {
        tags: ["bio\u200blogy"],
      });
      expect(refused.status).toBe(400);
      expect((refused.body as { message: string }).message).toBe(
        "Tags — A tag cannot hold hidden characters.",
      );
    });

    // The same helper refuses every domain route, so a bad field on one of them
    // must not read as a whole request the server could not make sense of.
    scenario(
      "names the field on every route that shares the refusal",
      async () => {
        const note = await newNode(ada, { title: "Somewhere to put a block" });
        const badContent = await call("POST", "/blocks", ada, {
          node: note.ref,
          content: "# Not a document",
        });
        expect(badContent.status).toBe(400);
        expect((badContent.body as { message: string }).message).toMatch(
          /^Content — /,
        );

        const longTitle = await call("POST", "/nodes", ada, {
          title: "x".repeat(513),
        });
        expect(longTitle.status).toBe(400);
        expect((longTitle.body as { message: string }).message).toMatch(
          /^Title — /,
        );
      },
    );

    scenario("takes the tags a note is given for its whole set", async () => {
      const note = await newNode(ada, {
        title: "Two tags",
        tags: ["biology", "question"],
      });

      const retagged = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        tags: ["music"],
      })) as NodeView;
      expect(retagged.tags).toEqual(["music"]);

      await ok("PATCH", `/nodes/${at(note.ref)}`, ada, { tags: [] });
      expect(
        ((await ok("GET", `/nodes/${at(note.ref)}`, ada)) as NodeView).tags,
      ).toEqual([]);
    });

    scenario("leaves the tags alone when a patch says nothing", async () => {
      const note = await newNode(ada, {
        title: "Renamed only",
        tags: ["biology"],
      });
      const retitled = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        title: "Retitled",
      })) as NodeView;
      expect(retitled.title).toBe("Retitled");
      expect(retitled.tags).toEqual(["biology"]);
    });

    scenario("counts the tags one person used, most-used first", async () => {
      for (const title of ["Counted one", "Counted two", "Counted three"]) {
        await newNode(ada, { title, tags: ["counted"] });
      }
      await newNode(ada, {
        title: "Counted once",
        tags: ["counted", "scarce"],
      });
      await newNode(bram, { title: "Not hers", tags: ["counted", "his-own"] });

      const counts = (await ok("GET", "/nodes/tags", ada)) as TagCount[];
      const byTag = new Map(counts.map((count) => [count.tag, count.notes]));
      expect(byTag.get("counted")).toBe(4);
      expect(byTag.get("scarce")).toBe(1);
      expect(byTag.has("his-own")).toBe(false);
      expect(counts.map((count) => count.notes)).toEqual(
        [...counts.map((count) => count.notes)].sort((a, b) => b - a),
      );
      const tied = counts.filter((count) => count.notes === 1);
      expect(tied.map((count) => count.tag)).toEqual(
        [...tied.map((count) => count.tag)].sort(),
      );
    });
  });

  describe("a note read against the code it is about", () => {
    const COMMIT = "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708";
    const LATER = "a78dc8213b4c5d6e7f8091a2b3c4d5e6f7089abc";

    scenario("is unconfirmed until its author says otherwise", async () => {
      const note = await newNode(ada, {
        title: "Nobody has read it",
        tags: [],
      });
      expect(note.checked).toBeUndefined();
    });

    scenario("keeps the commit it was last read against", async () => {
      const note = await newNode(ada, {
        title: "Why the parser forks",
        tags: [],
      });

      const confirmed = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        checked: COMMIT,
      })) as NodeView;
      expect(confirmed.checked).toBe(COMMIT);

      const read = (await ok("GET", `/nodes/${at(note.ref)}`, ada)) as NodeView;
      expect(read.checked).toBe(COMMIT);
    });

    scenario("changes nothing else about the note", async () => {
      const note = await newNode(ada, {
        title: "Still the same words",
        tags: ["biology"],
      });
      await ok("PATCH", `/nodes/${at(note.ref)}`, ada, { checked: COMMIT });

      const again = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        checked: LATER,
      })) as NodeView;
      expect(again.checked).toBe(LATER);
      expect(again.title).toBe("Still the same words");
      expect(again.tags).toEqual(["biology"]);
      expect(again.address).toBe(note.address);
    });

    scenario("keeps it when a later write says nothing about it", async () => {
      const note = await newNode(ada, { title: "Confirmed once", tags: [] });
      await ok("PATCH", `/nodes/${at(note.ref)}`, ada, { checked: COMMIT });

      const retitled = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        title: "Confirmed once, renamed twice",
      })) as NodeView;
      expect(retitled.checked).toBe(COMMIT);
    });

    scenario("leaves the note itself untouched by the reading", async () => {
      const note = await newNode(ada, { title: "Read, not written", tags: [] });

      const confirmed = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        checked: COMMIT,
      })) as NodeView;
      expect(confirmed.updated_at).toBe(note.updated_at);

      const written = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
        title: "Read, and written",
        checked: LATER,
      })) as NodeView;
      expect(written.updated_at > note.updated_at).toBe(true);
    });

    scenario("refuses a commit that names nothing", async () => {
      const note = await newNode(ada, { title: "Never confirmed", tags: [] });

      const answered = await call("PATCH", `/nodes/${at(note.ref)}`, ada, {
        checked: "",
      });
      expect(answered.status).toBe(400);
      expect(
        ((await ok("GET", `/nodes/${at(note.ref)}`, ada)) as NodeView).checked,
      ).toBeUndefined();
    });
  });

  describe("finding a note again", () => {
    /** A section of plain prose, one paragraph per line. */
    const prose = (...lines: string[]) => ({
      type: "doc",
      content: lines.map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      })),
    });

    const write = (person: Person, note: NodeView, ...lines: string[]) =>
      ok("POST", "/blocks", person, {
        node: note.ref,
        content: prose(...lines),
      }) as Promise<BlockView>;

    const searching = (person: Person, asked: string, graph?: OwnedRef) =>
      ok(
        "GET",
        `/nodes/search?q=${encodeURIComponent(asked)}${
          graph ? `&graph=${encodeURIComponent(graph)}` : ""
        }`,
        person,
      ) as Promise<SearchHit[]>;

    const written = (person: Person, query = "") =>
      ok("GET", `/nodes/recent${query}`, person) as Promise<NodeView[]>;

    scenario("answers with a note by a phrase written inside it", async () => {
      const note = await newNode(ada, { title: "Where the spores went" });
      await write(
        ada,
        note,
        "The chanterelles came back after a fortnight of rain.",
      );

      const hit = (await searching(ada, "chanterelle")).find(
        (one) => one.note === note.ref,
      );

      expect(hit).toBeDefined();
      expect(hit?.title).toBe("Where the spores went");
      expect(hit?.address).toBe(note.address);
      expect(hit?.held).toBe(false);
      expect(hit?.snippet).toContain("chanterelles");
    });

    scenario("keeps one person's writing out of another's", async () => {
      const theirs = await newNode(bram, { title: "His own" });
      await write(bram, theirs, "A word only he wrote down: syzygy.");

      expect(await searching(ada, "syzygy")).toEqual([]);
      expect((await searching(bram, "syzygy")).map((one) => one.note)).toEqual([
        theirs.ref,
      ]);
    });

    scenario("follows the writing when it is written over", async () => {
      const note = await newNode(ada, { title: "Rewritten" });
      const section = await write(ada, note, "About the quagga.");

      await ok("PATCH", `/blocks/${at(section.ref)}`, ada, {
        content: prose("About the axolotl instead."),
      });

      expect(await searching(ada, "quagga")).toEqual([]);
      expect((await searching(ada, "axolotl")).map((one) => one.note)).toEqual([
        note.ref,
      ]);
    });

    scenario("stops answering with a note that has been deleted", async () => {
      const note = await newNode(ada, { title: "Going" });
      await write(ada, note, "It smelled of petrichor all afternoon.");
      expect(
        (await searching(ada, "petrichor")).map((one) => one.note),
      ).toEqual([note.ref]);

      expect((await call("DELETE", `/nodes/${at(note.ref)}`, ada)).status).toBe(
        204,
      );

      expect(await searching(ada, "petrichor")).toEqual([]);
    });

    scenario("narrows to the graph somebody names", async () => {
      const elsewhere = await newGraph(ada, "The kitchen");
      const here = await newNode(ada, { title: "In the home graph" });
      const there = await newNode(ada, {
        from: { relation: "branch", graph: elsewhere.ref },
        title: "In the other one",
      });
      await write(ada, here, "A note on sourdough.");
      await write(ada, there, "Another note on sourdough.");

      expect(
        (await searching(ada, "sourdough")).map((one) => one.note).sort(),
      ).toEqual([here.ref, there.ref].sort());
      expect(
        (await searching(ada, "sourdough", elsewhere.ref)).map(
          (one) => one.note,
        ),
      ).toEqual([there.ref]);
    });

    scenario("answers nothing when nothing was asked", async () => {
      expect(await searching(ada, "   ")).toEqual([]);
    });

    scenario("puts what was last written into first", async () => {
      const older = await newNode(ada, { title: "Written into first" });
      await write(ada, older, "The first thing written.");
      const newer = await newNode(ada, { title: "Written into second" });
      await write(ada, newer, "The second thing written.");

      const order = (notes: NodeView[]) =>
        notes.findIndex((one) => one.ref === newer.ref) <
        notes.findIndex((one) => one.ref === older.ref);
      expect(order(await written(ada))).toBe(true);

      // A title is not writing, so it does not move a note up the list.
      await ok("PATCH", `/nodes/${at(older.ref)}`, ada, { title: "Renamed" });
      expect(order(await written(ada))).toBe(true);

      await write(ada, older, "And now something written into it.");
      expect((await written(ada))[0].ref).toBe(older.ref);
    });

    scenario("answers with as many as it was asked for", async () => {
      expect((await written(ada, "?limit=1")).length).toBe(1);
      expect((await call("GET", "/nodes/recent?limit=0", ada)).status).toBe(
        400,
      );
    });

    scenario("names only the notes in the graph it was given", async () => {
      const elsewhere = await newGraph(ada, "The greenhouse");
      const there = await newNode(ada, {
        from: { relation: "branch", graph: elsewhere.ref },
        title: "Under glass",
      });
      await write(ada, there, "Tomatoes in February.");

      const listed = await written(
        ada,
        `?graph=${encodeURIComponent(elsewhere.ref)}`,
      );

      expect(listed.map((one) => one.ref)).toEqual([there.ref]);
    });

    scenario("reaches writing stored before anything read it", async () => {
      const note = await newNode(ada, { title: "Written long ago" });
      await write(ada, note, "A word from before all this: hoopoe.");

      const { DbService } = await import("../db/db.service");
      await app
        .get(DbService)
        .handle.query("UPDATE block SET text = NONE WHERE created_by = $did", {
          did: ada.did,
        });
      expect(await searching(ada, "hoopoe")).toEqual([]);

      const { TextBackfill } = await import("../block/text-backfill");
      expect(await app.get(TextBackfill).run()).toBeGreaterThan(0);

      expect((await searching(ada, "hoopoe")).map((one) => one.note)).toEqual([
        note.ref,
      ]);
    });

    scenario("answers with the note an address leads to", async () => {
      const note = await newNode(ada, { title: "Cited by its number" });

      const hit = (await searching(ada, note.address as Address)).find(
        (one) => one.note === note.ref,
      );

      expect(hit?.address).toBe(note.address);
      expect(hit?.title).toBe("Cited by its number");
    });

    scenario(
      "answers with the note an address it was carried away from leads to",
      async () => {
        const root = await newNode(ada, { title: "A run to leave" });
        const other = await newNode(ada, { title: "A run to join" });
        const carried = await newNode(ada, {
          title: "Spores",
          from: { relation: "under", note: root.ref },
        });
        const was = carried.address;

        const [landed] = (await ok(
          "POST",
          `/nodes/${at(carried.ref)}/move`,
          ada,
          { to: { relation: "under", note: other.ref } },
        )) as NodeView[];
        expect(landed.address).not.toBe(was);

        const hit = (await searching(ada, was as Address)).find(
          (one) => one.note === carried.ref,
        );

        expect(hit?.address).toBe(landed.address);
      },
    );
  });

  describe("the run a note continues", () => {
    // AI.md § "The Genealogy Is the Protocol": the run is a function of the two
    // addresses, so no placement writes one down. `links` stays what a person
    // drew by hand, and stays empty until they draw one.
    scenario("is in the addresses, and nowhere else", async () => {
      const first = await newNode(ada, { title: "One" });
      const second = await newNode(ada, { from: follows(first), title: "Two" });
      const under = await newNode(ada, {
        from: springsFrom(first),
        title: "Under",
      });
      const opened = await newNode(ada, { title: "Another branch" });

      expect(second.address).toBe(siblingAddress(first.address as Address));

      const read = async (note: NodeView) =>
        (await ok("GET", `/nodes/${at(note.ref)}`, ada)) as NodeView;
      for (const note of [first, second, under, opened]) {
        expect((await read(note)).links).toEqual([]);
      }
    });
  });

  describe("the graphs a person keeps", () => {
    scenario(
      "lists the one they started with first, and their own only",
      async () => {
        const home = await homeOf(bram);
        const listed = (await ok("GET", "/graphs", bram)) as GraphView[];

        expect(listed[0].ref).toBe(home);
        expect(listed.every((graph) => graph.ref.startsWith(bram.did))).toBe(
          true,
        );

        await newGraph(bram, "Field notes");
        const after = (await ok("GET", "/graphs", bram)) as GraphView[];
        expect(after[0].ref).toBe(home);
        expect(after.map((graph) => graph.title)).toContain("Field notes");
      },
    );

    scenario("renames the one that had no name of its own", async () => {
      // Everybody has that graph before anything is written down about it, so
      // naming it is the first thing that is.
      const home = await homeOf(ada);
      const renamed = (await ok("PATCH", `/graphs/${at(home)}`, ada, {
        title: "Everything so far",
      })) as GraphView;

      expect(renamed.ref).toBe(home);
      expect(renamed.title).toBe("Everything so far");

      const listed = (await ok("GET", "/graphs", ada)) as GraphView[];
      expect(listed[0].title).toBe("Everything so far");
    });

    scenario("closes one, and the notes it held go with it", async () => {
      const closing = await newGraph(ada, "An experiment");
      const root = await newNode(ada, {
        from: { relation: "branch", graph: closing.ref },
        title: "The premise",
      });
      const kept = await newNode(ada, { title: "In the graph she started in" });
      await newNode(ada, { from: springsFrom(root), title: "What followed" });
      await ok("DELETE", `/nodes/${at(kept.ref)}`, ada);

      expect(
        (await call("DELETE", `/graphs/${at(closing.ref)}`, ada)).status,
      ).toBe(204);

      expect(
        ((await ok("GET", "/graphs", ada)) as GraphView[]).map(
          (one) => one.ref,
        ),
      ).not.toContain(closing.ref);
      expect(await branchesOf(ada, closing.ref)).toEqual([]);
      const under = (await ok(
        "GET",
        `/nodes?origin=${encodeURIComponent(root.ref)}`,
        ada,
      )) as NodeView[];
      expect(under).toEqual([]);

      const listed = (await ok(
        "GET",
        "/nodes/deleted",
        ada,
      )) as DeletedBranch[];
      expect(listed.map((one) => one.ref)).toContain(kept.ref);
      expect(listed.map((one) => one.ref)).not.toContain(root.ref);

      expect(
        (await call("POST", `/nodes/${at(root.ref)}/restore`, ada)).status,
      ).toBe(404);
    });

    scenario("refuses to close the graph somebody started with", async () => {
      const written = await newNode(ada, { title: "Stays put" });

      const answer = await call(
        "DELETE",
        `/graphs/${at(await homeOf(ada))}`,
        ada,
      );

      expect(answer.status).toBe(400);
      expect((answer.body as { message: string }).message).toMatch(/stays/);
      expect(
        ((await ok("GET", `/nodes/${at(written.ref)}`, ada)) as NodeView).ref,
      ).toBe(written.ref);
    });

    scenario("refuses to close somebody else's graph", async () => {
      const his = await newGraph(bram, "Not hers to close");

      expect((await call("DELETE", `/graphs/${at(his.ref)}`, ada)).status).toBe(
        400,
      );
      expect(
        ((await ok("GET", "/graphs", bram)) as GraphView[]).map(
          (one) => one.ref,
        ),
      ).toContain(his.ref);
    });

    scenario(
      "gates the notes written in it from the moment it says so",
      async () => {
        const shared = await newGraph(ada, "The commons");
        const open = (await newNode(ada, {
          from: { relation: "free", graph: shared.ref },
          title: "Anybody's",
        })) as NodeView;
        expect(open.owner).toBeUndefined();

        const gating = (await ok("PATCH", `/graphs/${at(shared.ref)}`, ada, {
          title: "The commons",
          ownership: "owned",
        })) as GraphView;
        expect(gating.ownership).toBe("owned");

        const gated = await newNode(ada, {
          from: { relation: "free", graph: shared.ref },
          title: "Hers",
        });
        expect(gated.owner).toBe(ada.did);

        // What was written before it said so is left where it was.
        const held = (await ok(
          "GET",
          `/nodes/${at(open.ref)}`,
          ada,
        )) as NodeView;
        expect(held.owner).toBeUndefined();
      },
    );

    scenario("hands a note's gate on, and takes it back off", async () => {
      const held = await newNode(ada, { title: "Mine to say" });

      const handed = (await ok("PATCH", `/nodes/${at(held.ref)}`, ada, {
        owner: bram.did,
      })) as NodeView;
      expect(handed.owner).toBe(bram.did);

      const back = (await ok("PATCH", `/nodes/${at(held.ref)}`, ada, {
        owner: null,
      })) as NodeView;
      expect(back.owner).toBeUndefined();
    });

    scenario("refuses to name one, or to rename somebody else's", async () => {
      expect((await call("POST", "/graphs", ada, { title: "" })).status).toBe(
        400,
      );
      const bramsOwn = await newGraph(bram, "His");
      expect(
        (
          await call("PATCH", `/graphs/${at(bramsOwn.ref)}`, ada, {
            title: "Hers now",
          })
        ).status,
      ).toBe(400);
      expect(
        ((await ok("GET", "/graphs", bram)) as GraphView[]).map((g) => g.title),
      ).toContain("His");
    });
  });

  describe("what one person may reach", () => {
    let hers: NodeView;

    scenario("keeps a note out of everybody else's reads", async () => {
      hers = await newNode(ada, { title: "Ada's own" });
      expect(await call("GET", `/nodes/${at(hers.ref)}`, bram)).toEqual({
        status: 200,
        body: null,
      });
      expect(
        (await call("PATCH", `/nodes/${at(hers.ref)}`, bram, { title: "Mine" }))
          .status,
      ).toBe(404);
      expect(
        (await call("DELETE", `/nodes/${at(hers.ref)}`, bram)).status,
      ).toBe(204);
      expect(
        ((await ok("GET", `/nodes/${at(hers.ref)}`, ada)) as NodeView).title,
      ).toBe("Ada's own");
    });

    scenario("refuses every route without a session", async () => {
      for (const [method, path] of [
        ["GET", "/nodes"],
        ["POST", "/nodes"],
        ["GET", `/nodes/${at(hers.ref)}`],
        ["PATCH", `/nodes/${at(hers.ref)}`],
        ["DELETE", `/nodes/${at(hers.ref)}`],
        ["POST", "/blocks"],
        ["GET", `/nodes/${at(hers.ref)}/blocks`],
        ["GET", "/nodes/tags"],
      ] as const) {
        expect(
          (await call(method, path, null, {})).status,
          `${method} ${path}`,
        ).toBe(401);
      }
    });
  });

  describe("removing a note", () => {
    scenario(
      "takes its branch and every interior with it, and gives them back",
      async () => {
        const root = await newNode(ada, { title: "Doomed" });
        const kept = await newNode(ada, {
          from: springsFrom(root),
          title: "Kept",
        });
        const doomed = await newNode(ada, {
          from: springsFrom(root),
          title: "Branch",
        });
        const under = await newNode(ada, {
          from: springsFrom(doomed),
          title: "Under",
        });
        const block = (await ok("POST", "/blocks", ada, {
          node: under.ref,
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Goes with it." }],
              },
            ],
          },
        })) as BlockView;

        expect(
          (await call("DELETE", `/nodes/${at(doomed.ref)}`, ada)).status,
        ).toBe(204);

        const left = (await ok(
          "GET",
          `/nodes?origin=${encodeURIComponent(root.ref)}`,
          ada,
        )) as NodeView[];
        expect(left.map((node) => node.ref).sort()).toEqual(
          [root.ref, kept.ref].sort(),
        );
        expect(
          (await call("GET", `/nodes/${at(under.ref)}/blocks`, ada)).status,
        ).toBe(404);

        const listed = (await ok(
          "GET",
          "/nodes/deleted",
          ada,
        )) as DeletedBranch[];
        const branch = listed.find((one) => one.ref === doomed.ref);
        expect(branch).toMatchObject({ address: doomed.address, notes: 2 });

        const back = (await ok(
          "POST",
          `/nodes/${at(doomed.ref)}/restore`,
          ada,
        )) as NodeView;
        expect(back.address).toBe(doomed.address);

        const again = (await ok(
          "GET",
          `/nodes?origin=${encodeURIComponent(root.ref)}`,
          ada,
        )) as NodeView[];
        expect(again.map((node) => node.ref).sort()).toEqual(
          [root.ref, kept.ref, doomed.ref, under.ref].sort(),
        );
        const writing = (await ok(
          "GET",
          `/nodes/${at(under.ref)}/blocks`,
          ada,
        )) as BlockView[];
        expect(writing.map((one) => one.ref)).toEqual([block.ref]);
      },
    );

    // A note that is waiting to come back takes no writing, from a surface
    // still open on it or from anywhere else.
    scenario("takes no writing while it is waiting to come back", async () => {
      const doc = (text: string) => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      const going = await newNode(ada, { title: "Still open" });
      const section = (await ok("POST", "/blocks", ada, {
        node: going.ref,
        content: doc("Written before it went."),
      })) as BlockView;
      await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

      const written = await call("PATCH", `/blocks/${at(section.ref)}`, ada, {
        content: doc("Written after it went."),
      });
      expect(written.status).toBe(404);
      const added = await call("POST", "/blocks", ada, {
        node: going.ref,
        content: doc("A whole new section."),
      });
      expect(added.status).toBe(400);

      await ok("POST", `/nodes/${at(going.ref)}/restore`, ada);
      const back = (await ok(
        "GET",
        `/nodes/${at(going.ref)}/blocks`,
        ada,
      )) as BlockView[];
      expect(back.map((one) => one.ref)).toEqual([section.ref]);
      expect(back[0].content).toEqual(section.content);
    });

    scenario("leaves what was deleted before it alone", async () => {
      const root = await newNode(ada, { title: "Two acts" });
      const branch = await newNode(ada, { from: springsFrom(root) });
      const under = await newNode(ada, { from: springsFrom(branch) });

      await ok("DELETE", `/nodes/${at(under.ref)}`, ada);
      await ok("DELETE", `/nodes/${at(branch.ref)}`, ada);

      const early = await call("POST", `/nodes/${at(under.ref)}/restore`, ada);
      expect(early.status).toBe(400);
      expect(JSON.stringify(early.body)).toContain("above this one back first");

      await ok("POST", `/nodes/${at(branch.ref)}/restore`, ada);

      const left = (await ok(
        "GET",
        `/nodes?origin=${encodeURIComponent(root.ref)}`,
        ada,
      )) as NodeView[];
      expect(left.map((node) => node.ref).sort()).toEqual(
        [root.ref, branch.ref].sort(),
      );

      const listed = (await ok(
        "GET",
        "/nodes/deleted",
        ada,
      )) as DeletedBranch[];
      expect(listed.map((one) => one.ref)).toContain(under.ref);
    });

    scenario("does not reuse an address taken out of the middle", async () => {
      const root = await newNode(ada, { title: "No reuse" });
      const first = await newNode(ada, {
        from: springsFrom(root),
        title: "First",
      });
      const second = await newNode(ada, {
        from: springsFrom(root),
        title: "Second",
      });
      expect([first.address, second.address]).toEqual([
        `${root.address}a`,
        `${root.address}b`,
      ]);

      await call("DELETE", `/nodes/${at(first.ref)}`, ada);
      const next = await newNode(ada, {
        from: springsFrom(root),
        title: "Next",
      });
      expect(next.address).toBe(`${root.address}c`);
    });

    scenario("does not hand back the last address in a run", async () => {
      const root = await newNode(ada, { title: "The end of a run" });
      const first = await newNode(ada, { from: springsFrom(root) });
      const last = await newNode(ada, { from: springsFrom(root) });
      expect(last.address).toBe(`${root.address}b`);

      await call("DELETE", `/nodes/${at(last.ref)}`, ada);
      const next = await newNode(ada, { from: springsFrom(root) });
      expect(next.address).toBe(`${root.address}c`);
      expect(first.address).toBe(`${root.address}a`);
    });

    scenario("does not hand back the address of an only child", async () => {
      const root = await newNode(ada, { title: "An only child" });
      const only = await newNode(ada, { from: springsFrom(root) });

      await call("DELETE", `/nodes/${at(only.ref)}`, ada);
      const next = await newNode(ada, { from: springsFrom(root) });
      expect(next.address).toBe(`${root.address}b`);
    });

    scenario("keeps every address a branch took with it", async () => {
      // The whole subtree's numbers go with it: a peer holding a citation of
      // any one of them must never be sent to a thought written afterwards.
      const root = await newNode(ada, { title: "A branch that goes" });
      const going = await newNode(ada, { from: springsFrom(root) });
      const under = await newNode(ada, { from: springsFrom(going) });
      const deeper = await newNode(ada, { from: springsFrom(under) });
      expect([going.address, under.address, deeper.address]).toEqual([
        `${root.address}a`,
        `${root.address}a1`,
        `${root.address}a1a`,
      ]);

      await call("DELETE", `/nodes/${at(going.ref)}`, ada);
      const again = await newNode(ada, { from: springsFrom(root) });
      expect(again.address).toBe(`${root.address}b`);

      const beneath = await newNode(ada, { from: springsFrom(again) });
      const beneathThat = await newNode(ada, { from: springsFrom(beneath) });
      for (const written of [again, beneath, beneathThat]) {
        expect([going.address, under.address, deeper.address]).not.toContain(
          written.address,
        );
      }
    });

    scenario(
      "opens a branch at the number a deleted one is holding",
      async () => {
        const branch = await newNode(ada, {
          from: { relation: "root", address: "8192" },
        });
        await call("DELETE", `/nodes/${at(branch.ref)}`, ada);

        const again = (await ok("POST", "/nodes", ada, {
          from: { relation: "root", address: "8192" },
        })) as NodeView;
        expect(again.address).toBe("8192");

        const back = (await ok(
          "POST",
          `/nodes/${at(branch.ref)}/restore`,
          ada,
        )) as NodeView;
        expect(back.address).toBeUndefined();
        expect(back.aliases).toEqual(["8192"]);
      },
    );

    scenario("keeps an address a purged note was moved away from", async () => {
      // A note that has moved is reached by two addresses, and the row that
      // carries the older one goes when the note is finally taken. Both numbers
      // stay spent: a citation of either must never open a later thought.
      const { createOwnedRecordId, nowIso } = await import("@sloppy/types");
      const { DbService } = await import("../db/db.service");
      const { NodeRepository } = await import("./node.repository");

      const root = await newNode(ada, { title: "Moved, then purged" });
      const going = await newNode(ada, { from: springsFrom(root) });
      const left = `${root.address}z` as Address;
      const stamp = nowIso();
      const db = app.get(DbService).handle;
      await db.query("INSERT INTO node_alias $row;", {
        row: {
          id: createOwnedRecordId("node_alias", ada.did),
          created_by: ada.did,
          graph: await homeOf(ada),
          parent: root.ref,
          address: left,
          note: going.ref,
          created_at: stamp,
          updated_at: stamp,
        },
      });

      await call("DELETE", `/nodes/${at(going.ref)}`, ada);
      await app.get(NodeRepository).purgeExpired(ada.did, nowIso());

      const [aliases] = await db.query<[unknown[]]>(
        "SELECT * FROM node_alias WHERE created_by = $did AND note = $note;",
        { did: ada.did, note: going.ref },
      );
      expect(aliases).toEqual([]);

      const [retired] = await db.query<
        [{ address: string; parent: string; note?: string }[]]
      >(
        "SELECT address, parent, note FROM retired_address WHERE created_by = $did AND parent = $parent;",
        { did: ada.did, parent: root.ref },
      );
      expect(retired.map((row) => row.address).sort()).toEqual(
        [going.address, left].sort(),
      );
      // Both numbers are the purged note's, and stay its own to take back —
      // AI.md § "The Genealogy Is the Protocol".
      expect(new Set(retired.map((row) => row.note))).toEqual(
        new Set([going.ref]),
      );

      const next = await newNode(ada, { from: springsFrom(root) });
      expect(next.address).toBe(`${root.address}aa`);
    });
  });

  describe("carrying a note somewhere else", () => {
    const carry = (
      note: NodeView,
      to: { relation: "under" | "after"; note: OwnedRef },
    ): Promise<NodeView[]> =>
      ok("POST", `/nodes/${at(note.ref)}/move`, ada, { to }) as Promise<
        NodeView[]
      >;

    const readNote = (ref: OwnedRef): Promise<NodeView> =>
      ok("GET", `/nodes/${at(ref)}`, ada) as Promise<NodeView>;

    scenario(
      "springs a branch out of another note, keeping what is under it in place",
      async () => {
        const root = await newNode(ada, { title: "Where it began" });
        const under = await newNode(ada, { from: springsFrom(root) });
        const deeper = await newNode(ada, { from: springsFrom(under) });
        const other = await newNode(ada, { title: "Where it belongs" });
        await newNode(ada, { from: springsFrom(other) });

        const moved = await carry(under, {
          relation: "under",
          note: other.ref,
        });

        expect(moved.map((one) => [one.ref, one.address])).toEqual([
          [under.ref, `${other.address}b`],
          [deeper.ref, `${other.address}b1`],
        ]);
        expect(moved.map((one) => one.origin)).toEqual([other.ref, other.ref]);
        expect(moved[0].parent).toBe(other.ref);
        expect(moved[1].parent).toBe(under.ref);
        expect(moved.map((one) => one.depth)).toEqual([2, 3]);
        expect((await readNote(deeper.ref)).address).toBe(`${other.address}b1`);
        // The note it sprang from is where it was: a move renumbers nothing
        // around it.
        expect((await readNote(root.ref)).address).toBe(root.address);
      },
    );

    scenario("goes to the end of a run it is already in", async () => {
      const root = await newNode(ada, { title: "One run of thought" });
      const first = await newNode(ada, { from: springsFrom(root) });
      const second = await newNode(ada, { from: springsFrom(root) });

      const moved = await carry(first, { relation: "after", note: second.ref });

      expect(moved.map((one) => one.address)).toEqual([`${root.address}c`]);
      expect((await readNote(second.ref)).address).toBe(`${root.address}b`);
    });

    scenario(
      "leaves the address it was at leading to it, and spends it forever",
      async () => {
        const root = await newNode(ada, { title: "Cited before the move" });
        const under = await newNode(ada, { from: springsFrom(root) });
        const other = await newNode(ada, { title: "Its new home" });

        const [moved] = await carry(under, {
          relation: "under",
          note: other.ref,
        });
        expect(moved.aliases).toEqual([under.address]);
        expect((await readNote(under.ref)).aliases).toEqual([under.address]);

        // The run it left keeps the number: the note after it in that run is
        // the next one, never the one it gave up.
        const next = await newNode(ada, { from: springsFrom(root) });
        expect(next.address).toBe(`${root.address}b`);
      },
    );

    scenario("never hands a branch number back after a move", async () => {
      const first = await newNode(ada, {
        from: { relation: "root", address: "65536" },
      });
      const other = await newNode(ada, { title: "A branch to hang it under" });

      const [moved] = await carry(first, {
        relation: "under",
        note: other.ref,
      });
      expect(moved.address).toBe(`${other.address}a`);

      const again = await call("POST", "/nodes", ada, {
        from: { relation: "root", address: "65536" },
      });
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body)).toContain("65536 still leads to");
    });

    scenario(
      "carries a note its author deleted, so putting it back puts it back under the branch",
      async () => {
        const root = await newNode(ada, { title: "Deleted, then carried" });
        const under = await newNode(ada, { from: springsFrom(root) });
        const deeper = await newNode(ada, { from: springsFrom(under) });
        const other = await newNode(ada, { title: "Its new home" });

        await ok("DELETE", `/nodes/${at(deeper.ref)}`, ada);
        const [moved] = await carry(under, {
          relation: "under",
          note: other.ref,
        });
        expect(moved.address).toBe(`${other.address}a`);

        const back = (await ok(
          "POST",
          `/nodes/${at(deeper.ref)}/restore`,
          ada,
        )) as NodeView;
        expect(back.address).toBe(`${other.address}a1`);
        expect(back.origin).toBe(other.ref);
        expect(back.parent).toBe(under.ref);
      },
    );

    scenario(
      "refuses what would leave a note hanging under itself",
      async () => {
        const root = await newNode(ada, { title: "Nowhere to go" });
        const under = await newNode(ada, { from: springsFrom(root) });
        const deeper = await newNode(ada, { from: springsFrom(under) });
        const elsewhere = await newGraph(ada, "Another notebook");
        const abroad = await newNode(ada, {
          from: { relation: "branch", graph: elsewhere.ref },
        });

        for (const to of [
          { relation: "under" as const, note: under.ref },
          { relation: "after" as const, note: under.ref },
          { relation: "under" as const, note: deeper.ref },
          { relation: "under" as const, note: abroad.ref },
        ]) {
          const refused = await call(
            "POST",
            `/nodes/${at(under.ref)}/move`,
            ada,
            { to },
          );
          expect(refused.status).toBe(400);
        }
        // Nothing moved, and nothing was renumbered on the way to refusing.
        expect((await readNote(under.ref)).address).toBe(under.address);
        expect((await readNote(deeper.ref)).address).toBe(deeper.address);
      },
    );

    scenario("reaches nobody else's note", async () => {
      const mine = await newNode(ada, { title: "Ada's" });
      const under = await newNode(ada, { from: springsFrom(mine) });
      const theirs = await newNode(bram, { title: "Bram's" });

      expect(
        (
          await call("POST", `/nodes/${at(under.ref)}/move`, bram, {
            to: { relation: "under", note: theirs.ref },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call("POST", `/nodes/${at(under.ref)}/move`, ada, {
            to: { relation: "under", note: theirs.ref },
          })
        ).status,
      ).toBe(400);
      expect((await readNote(under.ref)).address).toBe(under.address);
    });

    scenario(
      "gives two graphs told the same story the same addresses",
      async () => {
        /** One sequence of writes and moves, and everything the addressing rule
         *  decided along the way: where each move landed a note, the addresses
         *  it left leading to one, and where every note ended up. */
        const told = async (graph: OwnedRef): Promise<string[]> => {
          const branch = () =>
            newNode(ada, { from: { relation: "branch", graph } });
          const first = await branch();
          const under = await newNode(ada, { from: springsFrom(first) });
          const alongside = await newNode(ada, { from: springsFrom(first) });
          const deeper = await newNode(ada, { from: springsFrom(under) });
          const second = await branch();

          const written = [first, under, alongside, deeper, second];
          const place = new Map(written.map((one, index) => [one.ref, index]));
          const said = (one: NodeView) =>
            `${place.get(one.ref)} -> ${one.address} [${(one.aliases ?? []).join(",")}]`;

          const moves = [
            await carry(under, { relation: "under", note: second.ref }),
            await carry(alongside, { relation: "after", note: under.ref }),
            await carry(second, { relation: "after", note: first.ref }),
          ];
          const ended = await Promise.all(
            written.map((one) => readNote(one.ref)),
          );
          return [
            ...moves.flatMap((subtree) => subtree.map(said)),
            ...ended.map((one, index) => `${index} @ ${one.address}`),
          ];
        };

        const one = await newGraph(ada, "Told once");
        const other = await newGraph(ada, "Told again");

        expect((await told(other.ref)).join("\n")).toBe(
          (await told(one.ref)).join("\n"),
        );
      },
      30_000,
    );
  });

  describe("the label a person writes on a note", () => {
    const label = (note: NodeView, address: string | null) =>
      call("PUT", `/nodes/${at(note.ref)}/address`, ada, { address });

    const labelled = (
      note: NodeView,
      address: string | null,
    ): Promise<NodeView> =>
      ok("PUT", `/nodes/${at(note.ref)}/address`, ada, {
        address,
      }) as Promise<NodeView>;

    const readNote = (ref: OwnedRef): Promise<NodeView> =>
      ok("GET", `/nodes/${at(ref)}`, ada) as Promise<NodeView>;

    const searchIn = (graph: OwnedRef, q: string): Promise<SearchHit[]> =>
      ok(
        "GET",
        `/nodes/search?q=${q}&graph=${encodeURIComponent(graph)}`,
        ada,
      ) as Promise<SearchHit[]>;

    scenario("writes one on a note that carried none", async () => {
      const alone = await newGraph(ada, "Labelled later");
      const note = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "A thought on its own",
      });
      const under = await newNode(ada, {
        from: springsFrom(note),
        title: "What it led to",
      });

      const written = await labelled(note, "1");

      expect(written.address).toBe("1");
      expect(written.depth).toBe(1);
      // The genealogy is untouched: what sprang from it still has no label,
      // and still springs from it.
      const beneath = await readNote(under.ref);
      expect(beneath.address).toBeUndefined();
      expect(beneath.parent).toBe(note.ref);
      expect(beneath.depth).toBe(2);
    });

    scenario("takes one off, and it still leads to the note", async () => {
      const alone = await newGraph(ada, "Unlabelled again");
      const note = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
        title: "Numbered for a while",
      });
      expect(note.address).toBe("1");

      const bare = await labelled(note, null);
      expect(bare.address).toBeUndefined();
      expect(bare.aliases).toEqual(["1"]);

      expect(
        (await searchIn(alone.ref, "1")).map((hit) => [hit.note, hit.wasAt]),
      ).toEqual([[note.ref, "1"]]);
    });

    scenario("refuses one that leads somewhere else already", async () => {
      const alone = await newGraph(ada, "Two labels, one number");
      const held = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
        title: "Mycelium",
      });
      const note = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "Mushrooms",
      });

      const refused = await label(note, held.address as string);

      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain("Mycelium");
      expect((await readNote(note.ref)).address).toBeUndefined();
    });

    scenario(
      "is passed over by the next note written into its run",
      async () => {
        const alone = await newGraph(ada, "Numbered ahead of the run");
        const branch = await newNode(ada, {
          from: { relation: "branch", graph: alone.ref },
        });
        const aside = await newNode(ada, {
          from: { relation: "free", graph: alone.ref },
          title: "Numbered by hand",
        });
        await labelled(aside, `${branch.address}a`);

        const written = await newNode(ada, { from: springsFrom(branch) });

        expect(written.address).toBe(`${branch.address}b`);
        expect((await readNote(aside.ref)).address).toBe(`${branch.address}a`);
      },
    );

    scenario("moves a subtree along rather than under it", async () => {
      const alone = await newGraph(ada, "Numbered in a move's way");
      const first = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const under = await newNode(ada, { from: springsFrom(first) });
      const second = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const aside = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "Numbered by hand",
      });
      await labelled(aside, `${second.address}a1`);

      const carried = (await ok("POST", `/nodes/${at(first.ref)}/move`, ada, {
        to: { relation: "under", note: second.ref },
      })) as NodeView[];

      expect(carried.map((one) => [one.ref, one.address])).toEqual([
        [first.ref, `${second.address}b`],
        [under.ref, `${second.address}b1`],
      ]);
      expect((await readNote(aside.ref)).address).toBe(`${second.address}a1`);
    });

    scenario(
      "is passed over by that note too once it has been taken off",
      async () => {
        const alone = await newGraph(ada, "Numbered and unnumbered again");
        const branch = await newNode(ada, {
          from: { relation: "branch", graph: alone.ref },
        });
        const aside = await newNode(ada, {
          from: { relation: "free", graph: alone.ref },
          title: "Numbered by hand",
        });
        await labelled(aside, `${branch.address}a`);
        await labelled(aside, null);

        const written = await newNode(ada, { from: springsFrom(branch) });

        expect(written.address).toBe(`${branch.address}b`);
        expect(
          (await searchIn(alone.ref, `${branch.address}a`)).map((hit) => [
            hit.note,
            hit.wasAt,
          ]),
        ).toEqual([[aside.ref, `${branch.address}a`]]);
      },
    );

    scenario("moves a subtree along past one taken off too", async () => {
      const alone = await newGraph(ada, "Carried past a number taken off");
      const first = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const under = await newNode(ada, { from: springsFrom(first) });
      const second = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const aside = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "Numbered by hand",
      });
      await labelled(aside, `${second.address}a`);
      await labelled(aside, null);

      const carried = (await ok("POST", `/nodes/${at(first.ref)}/move`, ada, {
        to: { relation: "under", note: second.ref },
      })) as NodeView[];

      expect(carried.map((one) => [one.ref, one.address])).toEqual([
        [first.ref, `${second.address}b`],
        [under.ref, `${second.address}b1`],
      ]);
      expect(
        (await searchIn(alone.ref, `${second.address}a`)).map((hit) => [
          hit.note,
          hit.wasAt,
        ]),
      ).toEqual([[aside.ref, `${second.address}a`]]);
    });

    scenario("hands a note back a number it carried before", async () => {
      const alone = await newGraph(ada, "Carried and labelled back");
      const first = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const second = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      await ok("POST", `/nodes/${at(second.ref)}/move`, ada, {
        to: { relation: "under", note: first.ref },
      });

      const back = await labelled(second, "2");

      expect(back.address).toBe("2");
      expect(back.aliases).toEqual(["1a"]);
      // The number is this note's own, so nothing else in the graph may take it.
      const other = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
      });
      expect((await label(other, "2")).status).toBe(400);
    });

    // AI.md § "The Genealogy Is the Protocol": a note in the bin holds its
    // address only until a person asks for it.
    scenario("hands over a number a note in the bin is holding", async () => {
      const alone = await newGraph(ada, "A number out of the bin");
      const first = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
        title: "Spores",
      });
      const going = await newNode(ada, {
        from: springsFrom(first),
        title: "The one that goes",
      });
      expect(going.address).toBe("1a");
      await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

      const asking = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "Mushrooms",
      });
      expect((await labelled(asking, "1a")).address).toBe("1a");

      // The note at the number is what it resolves to.
      expect((await searchIn(alone.ref, "1a")).map((hit) => hit.note)).toEqual([
        asking.ref,
      ]);

      const back = (await ok(
        "POST",
        `/nodes/${at(going.ref)}/restore`,
        ada,
      )) as NodeView;
      expect(back.address).toBeUndefined();
      expect(back.aliases).toEqual(["1a"]);
      expect(
        (await searchIn(alone.ref, "1a")).map((hit) => [hit.note, hit.wasAt]),
      ).toEqual([
        [asking.ref, undefined],
        [going.ref, "1a"],
      ]);

      // And nobody else may take it now that a note that is there holds it,
      // through the address it is at or the one it still leads by.
      const other = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
      });
      expect((await label(other, "1a")).status).toBe(400);
    });

    scenario(
      "keeps the number as its own when the note that gave it up is purged",
      async () => {
        const { nowIso } = await import("@sloppy/types");
        const { NodeRepository } = await import("./node.repository");

        const alone = await newGraph(ada, "Purged after giving it up");
        const first = await newNode(ada, {
          from: { relation: "branch", graph: alone.ref },
        });
        const going = await newNode(ada, { from: springsFrom(first) });
        expect(going.address).toBe("1a");
        await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

        const asking = await newNode(ada, {
          from: { relation: "free", graph: alone.ref },
        });
        expect((await labelled(asking, "1a")).address).toBe("1a");

        await app.get(NodeRepository).purgeExpired(ada.did, nowIso());

        const still = await readNote(asking.ref);
        expect(still.address).toBe("1a");
        expect(
          (await searchIn(alone.ref, "1a")).map((hit) => hit.note),
        ).toEqual([asking.ref]);

        await labelled(still, null);
        expect((await labelled(still, "1a")).address).toBe("1a");
      },
    );

    scenario(
      "lets the note that took the number off the bin take it off again",
      async () => {
        const alone = await newGraph(ada, "A number handed on and let go");
        const first = await newNode(ada, {
          from: { relation: "branch", graph: alone.ref },
        });
        const going = await newNode(ada, { from: springsFrom(first) });
        expect(going.address).toBe("1a");
        await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

        const asking = await newNode(ada, {
          from: { relation: "free", graph: alone.ref },
        });
        expect((await labelled(asking, "1a")).address).toBe("1a");

        const off = await labelled(asking, null);
        expect(off.address).toBeUndefined();
        expect(off.aliases).toBeUndefined();

        const back = (await ok(
          "POST",
          `/nodes/${at(going.ref)}/restore`,
          ada,
        )) as NodeView;
        expect(back.aliases).toEqual(["1a"]);
      },
    );

    scenario("carries the note that took it out of the run", async () => {
      const alone = await newGraph(ada, "A number handed on and carried");
      const first = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const going = await newNode(ada, { from: springsFrom(first) });
      expect(going.address).toBe("1a");
      await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

      const asking = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
      });
      expect((await labelled(asking, "1a")).address).toBe("1a");

      const carried = (await ok("POST", `/nodes/${at(asking.ref)}/move`, ada, {
        to: { relation: "under", note: first.ref },
      })) as NodeView[];
      expect(carried[0].address).toBe("1b");
      expect(carried[0].aliases).toBeUndefined();
    });

    scenario(
      "keeps the number for the note in the bin that is at it",
      async () => {
        const { nowIso } = await import("@sloppy/types");
        const { NodeRepository } = await import("./node.repository");

        const alone = await newGraph(ada, "Purged around a note in the bin");
        const first = await newNode(ada, {
          from: { relation: "branch", graph: alone.ref },
        });
        const going = await newNode(ada, { from: springsFrom(first) });
        expect(going.address).toBe("1a");
        await ok("DELETE", `/nodes/${at(going.ref)}`, ada);

        const asking = await newNode(ada, {
          from: { relation: "free", graph: alone.ref },
        });
        expect((await labelled(asking, "1a")).address).toBe("1a");

        const between = nowIso();
        await ok("DELETE", `/nodes/${at(asking.ref)}`, ada);
        await app.get(NodeRepository).purgeExpired(ada.did, between);

        const back = (await ok(
          "POST",
          `/nodes/${at(asking.ref)}/restore`,
          ada,
        )) as NodeView;
        expect(back.address).toBe("1a");

        await labelled(back, null);
        expect((await labelled(back, "1a")).address).toBe("1a");
      },
    );
  });

  describe("carrying a note nobody numbered", () => {
    const carry = (
      note: NodeView,
      to: { relation: "under" | "after"; note: OwnedRef },
    ): Promise<NodeView[]> =>
      ok("POST", `/nodes/${at(note.ref)}/move`, ada, { to }) as Promise<
        NodeView[]
      >;

    const readNote = (ref: OwnedRef): Promise<NodeView> =>
      ok("GET", `/nodes/${at(ref)}`, ada) as Promise<NodeView>;

    scenario("leaves it with none under a numbered note", async () => {
      const alone = await newGraph(ada, "Bare and carried");
      const note = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "A thought on its own",
      });
      const branch = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });

      const moved = await carry(note, { relation: "under", note: branch.ref });

      expect(moved.map((one) => [one.ref, one.address])).toEqual([
        [note.ref, undefined],
      ]);
      expect(moved[0].parent).toBe(branch.ref);
      expect(moved[0].depth).toBe(2);
      expect(moved[0].aliases).toBeUndefined();
      // The run it joined is unmoved, and the next note written into it takes
      // the number the bare one never held.
      const next = await newNode(ada, { from: springsFrom(branch) });
      expect(next.address).toBe(`${branch.address}a`);
    });

    scenario("takes the number off one carried under a bare note", async () => {
      const alone = await newGraph(ada, "Numbered under bare");
      const bare = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "A thought on its own",
      });
      const branch = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });
      const under = await newNode(ada, { from: springsFrom(branch) });

      const moved = await carry(branch, { relation: "under", note: bare.ref });

      // The run it joins numbers nothing, so it takes no number, and the one it
      // left keeps leading to it. The answer reads as a run does — the notes
      // carrying a number first — so what it sprang from comes after it.
      expect(moved.map((one) => [one.ref, one.address])).toEqual([
        [under.ref, "1a"],
        [branch.ref, undefined],
      ]);
      expect(moved[1].aliases).toEqual(["1"]);
      expect(moved.map((one) => one.depth)).toEqual([3, 2]);
      expect((await readNote(under.ref)).parent).toBe(branch.ref);
    });

    scenario("links it to a note somebody did number", async () => {
      const alone = await newGraph(ada, "Linked without a number");
      const bare = await newNode(ada, {
        from: { relation: "free", graph: alone.ref },
        title: "A thought on its own",
      });
      const branch = await newNode(ada, {
        from: { relation: "branch", graph: alone.ref },
      });

      await ok("PATCH", `/nodes/${at(branch.ref)}`, ada, {
        links: [bare.ref],
      });

      expect((await readNote(branch.ref)).links).toEqual([bare.ref]);
    });
  });

  describe("a note's look", () => {
    scenario(
      "is stored as its author set it, and taken back off whole",
      async () => {
        const note = await newNode(ada, { title: "Styled" });
        const look = { ring_weight: "heavy", ring_style: "dashed" };

        const styled = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
          appearance: look,
        })) as NodeView;
        expect(styled.appearance).toEqual(look);

        const renamed = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
          title: "Still styled",
        })) as NodeView;
        expect(renamed.appearance).toEqual(look);

        const bare = (await ok("PATCH", `/nodes/${at(note.ref)}`, ada, {
          appearance: null,
        })) as NodeView;
        expect(bare.appearance).toBeUndefined();
        expect(
          (await ok("GET", `/nodes/${at(note.ref)}`, ada)) as NodeView,
        ).toHaveProperty("title", "Still styled");
      },
    );

    scenario(
      "survives a round trip through a build that cannot draw it",
      async () => {
        const note = await newNode(ada, { title: "From a newer Sloppy" });
        const later = { ring_weight: "gossamer", mark_radius: "enormous" };

        await ok("PATCH", `/nodes/${at(note.ref)}`, ada, { appearance: later });
        const read = (await ok(
          "GET",
          `/nodes/${at(note.ref)}`,
          ada,
        )) as NodeView;
        expect(read.appearance).toEqual(later);
      },
    );

    scenario("refuses a picture the person does not have", async () => {
      const note = await newNode(ada, { title: "Borrowed" });
      const asked = await call("PATCH", `/nodes/${at(note.ref)}`, ada, {
        appearance: { preview: `${bram.did}/not-theirs` },
      });
      expect(asked.status).toBe(404);
    });
  });

  describe("one act over a selection", () => {
    const bulk = (person: Person, notes: OwnedRef[], act: unknown) =>
      ok("POST", "/nodes/bulk", person, {
        notes,
        act,
      }) as Promise<NodeBulkResult>;

    scenario("adds and takes off tags without touching the rest", async () => {
      const one = await newNode(ada, { title: "One", tags: ["biology"] });
      const two = await newNode(ada, { title: "Two", tags: ["seed"] });
      const chosen = [one.ref, two.ref];

      const tagged = await bulk(ada, chosen, {
        act: "tag",
        tags: ["question"],
      });
      expect(tagged).toMatchObject({ reached: 2, missed: 0 });
      expect(tagged.notes.map((note) => note.tags)).toEqual([
        ["biology", "question"],
        ["question", "seed"],
      ]);

      const untagged = await bulk(ada, chosen, {
        act: "untag",
        tags: ["question", "biology"],
      });
      expect(untagged.notes.map((note) => note.tags)).toEqual([[], ["seed"]]);
    });

    scenario("sets one look across every note it reaches", async () => {
      const one = await newNode(ada, { title: "One" });
      const two = await newNode(ada, { title: "Two" });
      const look = { mark_radius: "large" };

      const styled = await bulk(ada, [one.ref, two.ref], {
        act: "set_appearance",
        appearance: look,
      });
      expect(styled.notes.map((note) => note.appearance)).toEqual([look, look]);

      const bare = await bulk(ada, [one.ref, two.ref], {
        act: "set_appearance",
        appearance: null,
      });
      expect(bare.notes.map((note) => note.appearance)).toEqual([
        undefined,
        undefined,
      ]);
    });

    scenario(
      "takes each chosen note with its branch and its sections",
      async () => {
        const root = await newNode(ada, { title: "Root" });
        const doomed = await newNode(ada, { from: springsFrom(root) });
        const under = await newNode(ada, { from: springsFrom(doomed) });
        const alsoDoomed = await newNode(ada, { from: springsFrom(root) });
        const block = (await ok("POST", "/blocks", ada, {
          node: under.ref,
          content: { type: "doc", content: [] },
        })) as BlockView;

        const gone = await bulk(ada, [doomed.ref, alsoDoomed.ref], {
          act: "delete",
        });
        expect(gone).toEqual({ reached: 2, missed: 0, notes: [] });

        const left = (await ok(
          "GET",
          `/nodes?origin=${encodeURIComponent(root.ref)}`,
          ada,
        )) as NodeView[];
        expect(left.map((node) => node.ref)).toEqual([root.ref]);
        expect(
          (await call("GET", `/nodes/${at(under.ref)}/blocks`, ada)).status,
        ).toBe(404);

        const listed = (await ok(
          "GET",
          "/nodes/deleted",
          ada,
        )) as DeletedBranch[];
        expect(
          listed
            .filter((one) => [doomed.ref, alsoDoomed.ref].includes(one.ref))
            .map((one) => one.notes),
        ).toEqual([2, 1]);

        await ok("POST", `/nodes/${at(doomed.ref)}/restore`, ada);
        const writing = (await ok(
          "GET",
          `/nodes/${at(under.ref)}/blocks`,
          ada,
        )) as BlockView[];
        expect(writing.map((one) => one.ref)).toEqual([block.ref]);
      },
    );

    scenario("reaches only the caller's own notes", async () => {
      const mine = await newNode(ada, { title: "Ada's" });
      const theirs = await newNode(bram, { title: "Bram's" });

      const acted = await bulk(ada, [mine.ref, theirs.ref], {
        act: "tag",
        tags: ["mine"],
      });
      expect(acted).toMatchObject({ reached: 1, missed: 1 });
      expect(acted.notes[0].ref).toBe(mine.ref);
      expect(
        ((await ok("GET", `/nodes/${at(theirs.ref)}`, bram)) as NodeView).tags,
      ).toEqual([]);
    });

    scenario("is refused when it reaches nothing, in words", async () => {
      const theirs = await newNode(bram, { title: "Bram's alone" });
      const refused = await call("POST", "/nodes/bulk", ada, {
        notes: [theirs.ref],
        act: { act: "delete" },
      });

      expect(refused.status).toBe(404);
      expect(JSON.stringify(refused.body)).toMatch(/Reload your graph/);
      expect(
        ((await ok("GET", `/nodes/${at(theirs.ref)}`, bram)) as NodeView).title,
      ).toBe("Bram's alone");
    });

    scenario(
      "refuses a selection with nothing in it, and one too large",
      async () => {
        const note = await newNode(ada, { title: "One" });
        const act = { act: "untag", tags: ["nothing"] };

        expect(
          (await call("POST", "/nodes/bulk", ada, { notes: [], act })).status,
        ).toBe(400);
        expect(
          (
            await call("POST", "/nodes/bulk", ada, {
              notes: Array.from(
                { length: MAX_NOTES_PER_BULK_ACT + 1 },
                () => note.ref,
              ),
              act,
            })
          ).status,
        ).toBe(400);
        expect(
          (await call("POST", "/nodes/bulk", ada, { notes: [note.ref] }))
            .status,
        ).toBe(400);
        expect(
          (await call("POST", "/nodes/bulk", null, { notes: [note.ref], act }))
            .status,
        ).toBe(401);
      },
    );
  });
});
