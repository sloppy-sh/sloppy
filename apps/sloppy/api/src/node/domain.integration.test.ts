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
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `domain_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** A graph big enough that reading all of it is visibly the wrong thing to do. */
const CROWD = 5000;

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
    await app.get(DbService).handle.query(`REMOVE DATABASE ${DATABASE}`);
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
      const addresses = born.map((node) => node.address).sort(compareAddresses);
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
      const addresses = born.map((node) => node.address).sort(compareAddresses);
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
          return written.map((node) => node.address);
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
      const { homeGraphRef } = await import("@sloppy/types");
      const shared = {
        created_by: bram.did,
        graph: homeGraphRef(bram.did),
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
  });

  describe("the run a note continues", () => {
    // AI.md § "The Address Is the Protocol": the run is a function of the two
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
        const { homeGraphRef } = await import("@sloppy/types");
        const listed = (await ok("GET", "/graphs", bram)) as GraphView[];

        expect(listed[0].ref).toBe(homeGraphRef(bram.did));
        expect(listed.every((graph) => graph.ref.startsWith(bram.did))).toBe(
          true,
        );

        await newGraph(bram, "Field notes");
        const after = (await ok("GET", "/graphs", bram)) as GraphView[];
        expect(after[0].ref).toBe(homeGraphRef(bram.did));
        expect(after.map((graph) => graph.title)).toContain("Field notes");
      },
    );

    scenario("renames the one that had no name of its own", async () => {
      // Everybody has that graph before anything is written down about it, so
      // naming it is the first thing that is.
      const { homeGraphRef } = await import("@sloppy/types");
      const home = homeGraphRef(ada.did);
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
      const { homeGraphRef } = await import("@sloppy/types");
      const written = await newNode(ada, { title: "Stays put" });

      const answer = await call(
        "DELETE",
        `/graphs/${at(homeGraphRef(ada.did))}`,
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
      "refuses a branch numbered where a deleted one was, in words",
      async () => {
        const branch = await newNode(ada, {
          from: { relation: "root", address: "8192" },
        });
        await call("DELETE", `/nodes/${at(branch.ref)}`, ada);

        const again = await call("POST", "/nodes", ada, {
          from: { relation: "root", address: "8192" },
        });
        expect(again.status).toBe(400);
        expect(JSON.stringify(again.body)).toContain("since deleted");
      },
    );
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
