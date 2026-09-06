// Runs `SCHEMA` and `STATEMENTS` against a real SurrealDB, because everything
// they claim is a claim about a server: an index the planner honours, a column
// the engine refuses to overwrite, a type it refuses to coerce. None of it is
// observable from the string literal.
//
// It is also the compatibility check on the pairing in `pnpm-workspace.yaml`
// (the `surrealdb` client) and `docker-compose.yml` (the server image). Bump
// either half against the other and this file is where it shows.
//
// Skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection } from "node:net";
import {
  DidSyrSchema,
  homeGraphRef,
  OwnedRefSchema,
  UlidSchema,
} from "@sloppy/types";
import { RecordId, Surreal, Table } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATEMENTS } from "./purge.js";
import { defineCoreSchema, SLOPPY_TABLES } from "./schema.js";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const USER = process.env.SURREALDB_USER ?? "root";
const PASS = process.env.SURREALDB_PASS ?? "sloppy-dev-password";

const NAMESPACE = "sloppy_test";
const DATABASE = `schema_${Date.now()}`;

// Other packages will copy these fixtures into code paths that parse, so every
// identifier here is minted through the schema that will parse it there.
const AVA = DidSyrSchema.parse("did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva");
const BOB = DidSyrSchema.parse("did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob");
const CAI = DidSyrSchema.parse("did:syr:z6MkCaiCaiCaiCaiCaiCaiCaiCaiCaiCai");

/** A graph AVA opened beside the one she started with. */
const SECOND_GRAPH = OwnedRefSchema.parse(`${AVA}/01JGRAPH2ND000000000000000`);

type NodeRow = ReturnType<typeof nodeRow>;

function nodeId(did: string, localId: string): RecordId {
  return new RecordId("node", {
    created_by: did,
    id: UlidSchema.parse(localId),
  });
}

// `depth` and `origin` are passed rather than derived from `address`, because
// deriving them here would re-implement the two things the row is meant to be
// checked against. @sloppy/types owns that derivation and tests it.
function nodeRow(
  did: string,
  address: string,
  localId: string,
  depth = 1,
  origin = `${did}/${localId}`,
  graph = homeGraphRef(did),
) {
  return {
    id: nodeId(did, localId),
    created_by: did,
    graph,
    address,
    depth,
    origin: OwnedRefSchema.parse(origin),
    title: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

// A row AVA owns. On a held copy of BOB's graph that makes her the READER, and
// the author is only ever the DID half of `source`.
function avaId(table: string, localId: string): RecordId {
  return new RecordId(table, {
    created_by: AVA,
    id: UlidSchema.parse(localId),
  });
}

const REGION = "01JPEERREGN000000000000000";
const OTHER_REGION = "01JPEERREGN200000000000000";
const PUBLICATION = OwnedRefSchema.parse(`${BOB}/01JPEERPBCA000000000000000`);
const OTHER_PUBLICATION = OwnedRefSchema.parse(
  `${BOB}/01JPEERPBCB000000000000000`,
);

function pullRow(localId: string, publication: string, rootAddress: string) {
  return {
    id: avaId("pull", localId),
    created_by: AVA,
    publication,
    version: {
      ref: OwnedRefSchema.parse(`${BOB}/01JPEERVRSN000000000000000`),
      sequence: 1,
      published_at: "2026-01-01T00:00:00.000Z",
    },
    root_address: rootAddress,
    comments: "anyone",
    source_url: "https://peer.example",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };
}

function heldNodeRow(localId: string, address: string, depth: number) {
  return {
    id: avaId("pulled_node", localId),
    created_by: AVA,
    source: OwnedRefSchema.parse(`${BOB}/${localId}`),
    source_did: BOB,
    source_graph: homeGraphRef(BOB),
    address,
    depth,
    node: {
      address,
      origin: OwnedRefSchema.parse(`${BOB}/01JPEERBASE000000000000000`),
      title: "",
      tags: [],
      links: [],
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    },
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };
}

/**
 * Whether anything is listening — a TCP probe and nothing more, so the only
 * thing that can skip this suite is an absent server. Everything past the
 * socket, the client's own version gate included, is the pairing under test and
 * has to fail the run rather than quietly excuse it. The client cannot answer
 * this itself: `connect()` to a refused port never settles.
 */
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

describe.skipIf(!listening)(`the schema against ${ENDPOINT.href}`, () => {
  let db: Surreal;

  async function read(id: RecordId): Promise<NodeRow> {
    const row = await db.select<NodeRow>(id);
    if (!row) throw new Error(`nothing stored at ${id.toString()}`);
    return row;
  }

  beforeAll(async () => {
    db = new Surreal();
    await db.connect(ENDPOINT.href);
    await db.signin({ username: USER, password: PASS });
    await db.use({ namespace: NAMESPACE, database: DATABASE });
    await defineCoreSchema(db);
    // Twice, because it runs on every boot and a second run must be a no-op
    // rather than an error the caller has to know to swallow.
    await defineCoreSchema(db);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
    await db.close();
  });

  it("declares every table it says it does", async () => {
    const [info] =
      await db.query<[{ tables: Record<string, string> }]>("INFO FOR DB;");
    expect(Object.keys(info.tables).sort()).toEqual([...SLOPPY_TABLES].sort());
  });

  it("round-trips a row through the client's typed writes", async () => {
    // The pairing check. A client that cannot speak the server's protocol
    // reports success and stores a bare id, so the assertion is on the readback
    // and not on what the write returned.
    const row = nodeRow(AVA, "1", "01JREADBACK000000000000000");
    await db.create(row.id).content(row);

    const stored = await read(row.id);
    expect(stored.address).toBe("1");
    expect(stored.created_by).toBe(AVA);
    expect(stored.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("holds address, depth, created_by and created_at through every write shape", async () => {
    const row = nodeRow(BOB, "2a", "01JNEVERCHANGES00000000000", 2);
    await db.create(row.id).content(row);

    for (const reassignment of [
      { address: "9" },
      { depth: 7 },
      { created_by: AVA },
      { created_at: "2030-01-01T00:00:00.000Z" },
    ]) {
      await expect(db.update(row.id).merge(reassignment)).rejects.toThrow();
    }

    // CONTENT replaces the whole document, so it has two shapes MERGE does not:
    // a changed value, and an absent column.
    await expect(
      db
        .update(row.id)
        .content({ ...row, address: "9", depth: 7, created_by: AVA }),
    ).rejects.toThrow();
    await db.update(row.id).content({
      title: "written without them",
      updated_at: "2026-06-01T00:00:00.000Z",
    });

    const stored = await read(row.id);
    expect(stored.title).toBe("written without them");
    expect(stored.origin).toBeUndefined();
    expect(stored.address).toBe("2a");
    expect(stored.depth).toBe(2);
    expect(stored.created_by).toBe(BOB);
    expect(stored.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("takes a whole-row rewrite that leaves the immutable columns alone", async () => {
    // What a repository save looks like: the full document, immutable columns
    // and all, with one field different. Re-sending a value is not a change.
    const row = nodeRow(BOB, "2b", "01JRESAVE00000000000000000", 2);
    await db.create(row.id).content(row);

    await db.update(row.id).content({
      ...row,
      title: "rewritten",
      updated_at: "2026-06-01T00:00:00.000Z",
    });

    const stored = await read(row.id);
    expect(stored.title).toBe("rewritten");
    expect(stored.updated_at).toBe("2026-06-01T00:00:00.000Z");
    expect(stored.address).toBe("2b");
  });

  it("holds a column immutable whatever it already holds, empty included", async () => {
    const row = nodeRow(BOB, "", "01JEMPTYADDRESS00000000000", 1);
    await db.create(row.id).content(row);

    await expect(db.update(row.id).merge({ address: "8" })).rejects.toThrow();
    expect((await read(row.id)).address).toBe("");
  });

  it("refuses a depth no address could produce", async () => {
    const row = nodeRow(AVA, "5", "01JBADDEPTH000000000000000", 0);
    await expect(db.create(row.id).content(row)).rejects.toThrow();
  });

  it("refuses a second node at an address its graph already holds", async () => {
    const first = nodeRow(AVA, "3", "01JADDRESSTAKEN00000000000");
    await db.create(first.id).content(first);

    const clash = nodeRow(AVA, "3", "01JADDRESSRETAKE0000000000");
    await expect(db.create(clash.id).content(clash)).rejects.toThrow();

    // Another author holding the same address is the normal federated case.
    const peer = nodeRow(BOB, "3", "01JADDRESSPEER000000000000");
    await expect(db.create(peer.id).content(peer)).resolves.toBeDefined();

    // And so, now, is another graph of the SAME author holding it: an address
    // is a label read inside one graph, and the two `3`s are different notes.
    const beside = nodeRow(
      AVA,
      "3",
      "01JADDRBESDE00000000000000",
      1,
      `${AVA}/01JADDRBESDE00000000000000`,
      SECOND_GRAPH,
    );
    await expect(db.create(beside.id).content(beside)).resolves.toBeDefined();

    const again = nodeRow(
      AVA,
      "3",
      "01JADDRBESDE20000000000000",
      1,
      `${AVA}/01JADDRBESDE20000000000000`,
      SECOND_GRAPH,
    );
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    // A note cannot be moved into a graph where its address is already taken,
    // which is what makes the rule above hold for as long as the row exists.
    await expect(
      db.update(beside.id).merge({ graph: homeGraphRef(AVA) }),
    ).rejects.toThrow();

    // And all of it rests on the column being there. A UNIQUE index does not
    // constrain a row whose indexed column is absent, so a note with no graph
    // would be a third `3` the database accepts — it is refused at the column
    // instead, which is what leaves the index rather than the writer holding
    // the rule.
    const { graph: _absent, ...graphless } = nodeRow(
      AVA,
      "3",
      "01JADDRNGRAPH0000000000000",
    );
    await expect(db.create(graphless.id).content(graphless)).rejects.toThrow();
  });

  it("reads one graph's branches through the index that ends at the parent", async () => {
    // Without the graph in the middle this read is "every note the person has
    // written, filtered to the ones with no parent" — the whole graph scanned
    // to answer a question about its handful of branches.
    const BRANCHES = `SELECT address FROM node
       WHERE created_by = $did AND graph = $graph AND parent = NONE`;
    const bound = { did: AVA, graph: SECOND_GRAPH };

    const [plan] = await db.query(`${BRANCHES} EXPLAIN;`, bound);
    const explained = JSON.stringify(plan);
    expect(explained).toContain('"index":"node_owner_graph_parent"');
    expect(explained).toContain(SECOND_GRAPH);
    expect(explained).not.toContain('"operator":"Filter"');

    const [branches] = await db.query<[{ address: string }[]]>(
      `${BRANCHES};`,
      bound,
    );
    expect(branches.map((row) => row.address)).toEqual(["3"]);
  });

  it("refuses a timestamp that is not a string", async () => {
    // The whole point of TYPE string: `time::now()` is the natural thing to
    // reach for, and the client decodes what it stores to a class that fails
    // `TimestampSchema` on the way back out.
    await expect(
      db.query(
        `CREATE $id CONTENT { created_by: $did, address: "4", depth: 1,
           created_at: time::now(), updated_at: time::now() };`,
        { id: nodeId(AVA, "01JDATETYPE000000000000000"), did: AVA },
      ),
    ).rejects.toThrow();
  });

  it("reads a region bounded by depth, from the index", async () => {
    // The read that buys `node.depth`; docs/ARCHITECTURE.md § "Data model"
    // carries the ruling and the conditions it is held to.
    const origin = `${AVA}/01JBRANCHBASE0000000000000`;
    const branch: [address: string, localId: string][] = [
      ["6", "01JBRANCHBASE0000000000000"],
      ["6a", "01JBRANCH10000000000000000"],
      ["6a1", "01JBRANCH20000000000000000"],
      ["6a1a", "01JBRANCH30000000000000000"],
      ["6a1a1", "01JBRANCH40000000000000000"],
    ];
    for (const [index, [address, localId]] of branch.entries()) {
      const row = nodeRow(AVA, address, localId, index + 1, origin);
      await db.create(row.id).content(row);
    }
    // A second region of the same author's, at a depth the slice covers, so a
    // read that ignored `origin` would have to come back wrong.
    const peer = nodeRow(AVA, "7", "01JBRANCHPEER0000000000000", 1);
    await db.create(peer.id).content(peer);

    const SLICE = `SELECT depth FROM node
       WHERE created_by = $did AND origin = $origin AND depth <= $max
       ORDER BY depth`;
    const bound = { did: AVA, origin, max: 3 };

    // The rows alone would come back right from an index that stopped at the
    // leading pair — the server would just read the whole region and drop what
    // the viewport never asked for, which is the one outcome the third column
    // exists to avoid. So the claim is about the plan: the bound has to be part
    // of the index access, and a Filter carrying it would mean it is not.
    const [plan] = await db.query(`${SLICE} EXPLAIN;`, bound);
    const explained = JSON.stringify(plan);
    expect(explained).toContain('"index":"node_owner_origin_depth"');
    expect(explained).toContain("LessThanEqual");
    expect(explained).not.toContain('"operator":"Filter"');

    const [sliced] = await db.query<[{ depth: number }[]]>(`${SLICE};`, bound);
    expect(sliced.map((row) => row.depth)).toEqual([1, 2, 3]);
  });

  it("seeks a tag through its index, and counts an owner's tags", async () => {
    // `tags = $tag` is membership only while `node_tags` answers it, so the
    // claim is about the plan as much as the rows: an unpinned read the planner
    // hands elsewhere is not slower, it is empty.
    const tagged: [address: string, localId: string, tags: string[]][] = [
      ["8", "01JTAGGEDA0000000000000000", ["biology", "seed"]],
      ["8a", "01JTAGGEDB0000000000000000", ["biology"]],
      ["8b", "01JTAGGEDC0000000000000000", ["music"]],
    ];
    for (const [address, localId, tags] of tagged) {
      const row = nodeRow(AVA, address, localId, address.length);
      await db.create(row.id).content({ ...row, tags });
    }
    const his = nodeRow(BOB, "8", "01JTAGGEDP0000000000000000");
    await db.create(his.id).content({ ...his, tags: ["biology"] });

    const CARRIERS = `SELECT address FROM node WITH INDEX node_tags
       WHERE tags = $tag AND created_by = $did
       ORDER BY address`;
    const bound = { did: AVA, tag: "biology" };

    const [plan] = await db.query(`${CARRIERS} EXPLAIN;`, bound);
    expect(JSON.stringify(plan)).toContain('"index":"node_tags"');

    const [carriers] = await db.query<[{ address: string }[]]>(
      `${CARRIERS};`,
      bound,
    );
    expect(carriers.map((row) => row.address)).toEqual(["8", "8a"]);

    // The trap the pin exists for, forced rather than waited for: the planner
    // decides which index answers a read, and everywhere but `node_tags` the
    // same equality is plain array comparison — no rows, no error.
    const [elsewhere] = await db.query<[{ address: string }[]]>(
      `SELECT address FROM node WITH NOINDEX
         WHERE tags = $tag AND created_by = $did ORDER BY address;`,
      bound,
    );
    expect(elsewhere).toEqual([]);

    const [counts] = await db.query<[{ tag: string; notes: number }[]]>(
      `SELECT tags AS tag, count() AS notes
         FROM (SELECT tags FROM node
                 WHERE created_by = $did AND array::len(tags ?? []) > 0
                 SPLIT tags)
         GROUP BY tag ORDER BY notes DESC, tag ASC;`,
      { did: AVA },
    );
    expect(counts).toEqual([
      { tag: "biology", notes: 2 },
      { tag: "music", notes: 1 },
      { tag: "seed", notes: 1 },
    ]);
  });

  it("refuses a second copy of a publication the reader already holds", async () => {
    // Pulling again refreshes this row, so the uniqueness is what stops a
    // reader ending up with two copies of one region that drift apart. It keys
    // on the publication rather than on the address, because an address is a
    // label inside somebody's graph and the ref is what identifies the thing
    // being read.
    const first = pullRow(REGION, PUBLICATION, "1");
    await db.create(first.id).content(first);

    const again = pullRow("01JPEERREGN300000000000000", PUBLICATION, "1");
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    const other = pullRow(OTHER_REGION, OTHER_PUBLICATION, "2");
    await expect(db.create(other.id).content(other)).resolves.toBeDefined();

    await expect(
      db.update(first.id).merge({ publication: OTHER_PUBLICATION }),
    ).rejects.toThrow();
  });

  it("reads what it holds of one author, bounded by depth, from its index", async () => {
    const branch: [localId: string, address: string][] = [
      ["01JPEERMARKA00000000000000", "1"],
      ["01JPEERMARKB00000000000000", "1a"],
      ["01JPEERMARKC00000000000000", "1a1"],
      ["01JPEERMARKD00000000000000", "1a1a"],
    ];
    for (const [index, [localId, address]] of branch.entries()) {
      const row = heldNodeRow(localId, address, index + 1);
      await db.create(row.id).content(row);
    }
    // A third author's note at a depth the slice covers, so a read that ignored
    // whose it is would have to come back wrong.
    const elsewhere = {
      ...heldNodeRow("01JPEERMARKE00000000000000", "2", 1),
      source: OwnedRefSchema.parse(`${CAI}/01JPEERMARKE00000000000000`),
      source_did: CAI,
    };
    await db.create(elsewhere.id).content(elsewhere);

    const section = {
      id: avaId("pulled_block", "01JPEERSECTN00000000000000"),
      created_by: AVA,
      source: `${BOB}/01JPEERSECTN00000000000000`,
      node: `${BOB}/01JPEERMARKB00000000000000`,
      ord: "a0",
      content: { type: "doc", content: [] },
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    await db.create(section.id).content(section);

    const SLICE = `SELECT depth FROM pulled_node
       WHERE created_by = $did AND source_did = $author AND depth <= $max
       ORDER BY depth`;
    const bound = { did: AVA, author: BOB, max: 3 };

    // The claim is about the plan, not only the rows: an index that stopped at
    // the leading pair would read everything held of that author and drop the
    // rest, which is the one outcome the third column exists to avoid.
    const [plan] = await db.query(`${SLICE} EXPLAIN;`, bound);
    const explained = JSON.stringify(plan);
    expect(explained).toContain('"index":"pulled_node_owner_author_depth"');
    expect(explained).toContain("LessThanEqual");
    expect(explained).not.toContain('"operator":"Filter"');

    const [sliced] = await db.query<[{ depth: number }[]]>(`${SLICE};`, bound);
    expect(sliced.map((row) => row.depth)).toEqual([1, 2, 3]);
  });

  it("holds one copy of a node two overlapping regions both cover", async () => {
    // "I read a branch, now I want the trail it came from": a region at `1`
    // arriving on top of one at `1a`. The rows they share are refreshed, and
    // the second copy the reader must never end up with is refused.
    const inner = pullRow(
      "01JPEERREGN400000000000000",
      `${BOB}/01JPEERPBCC000000000000000`,
      "3a",
    );
    await db.create(inner.id).content(inner);
    const held = heldNodeRow("01JPEERSHARE00000000000000", "3a", 2);
    await db.create(held.id).content(held);

    const outer = pullRow(
      "01JPEERREGN500000000000000",
      `${BOB}/01JPEERPBCD000000000000000`,
      "3",
    );
    await expect(db.create(outer.id).content(outer)).resolves.toBeDefined();

    const second = {
      ...heldNodeRow("01JPEERSHARE20000000000000", "3a", 2),
      source: held.source,
    };
    await expect(db.create(second.id).content(second)).rejects.toThrow();

    // The refresh the wider pull writes instead, over the row already there.
    await db.update(held.id).content({
      ...held,
      node: { ...held.node, title: "as the wider pull answered" },
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    const stored = await db.select<{ node: { title: string } }>(held.id);
    expect(stored?.node.title).toBe("as the wider pull answered");

    const [shared] = await db.query<[{ source: string }[]]>(
      `SELECT source FROM pulled_node WHERE created_by = $did AND source = $source;`,
      { did: AVA, source: held.source },
    );
    expect(shared).toHaveLength(1);
  });

  it("refuses a second held note at an address it already holds of one graph", async () => {
    // `node_owner_graph_address UNIQUE` on rows a peer handed us: a citation of
    // that author's `4a` has to resolve one way in the reader's copy too, and
    // "one way" is now one way inside the graph the region came from.
    const first = heldNodeRow("01JPEERADDRA00000000000000", "4a", 2);
    await db.create(first.id).content(first);

    const clash = heldNodeRow("01JPEERADDRB00000000000000", "4a", 2);
    await expect(db.create(clash.id).content(clash)).rejects.toThrow();

    // Two authors at one address is the ordinary federated case: the reader
    // holds both, and each resolves under its own author.
    const elsewhere = {
      ...heldNodeRow("01JPEERADDRC00000000000000", "4a", 2),
      source: OwnedRefSchema.parse(`${CAI}/01JPEERADDRC00000000000000`),
      source_did: CAI,
      source_graph: homeGraphRef(CAI),
    };
    await expect(
      db.create(elsewhere.id).content(elsewhere),
    ).resolves.toBeDefined();

    // And two notebooks of ONE author is the case this scope exists for: a
    // reader who pulls a region from each holds both `4a`s.
    const otherNotebook = {
      ...heldNodeRow("01JPEERADDRD00000000000000", "4a", 2),
      source_graph: OwnedRefSchema.parse(`${BOB}/01JGRAPHBRAM2N000000000000`),
    };
    await expect(
      db.create(otherNotebook.id).content(otherNotebook),
    ).resolves.toBeDefined();

    for (const reassignment of [
      { address: "4b" },
      { source_graph: `${BOB}/01JGRAPHBRAM2N000000000000` },
    ]) {
      await expect(db.update(first.id).merge(reassignment)).rejects.toThrow();
    }

    // A held copy with no graph on it is one the unique index above cannot
    // constrain at all, so the column is required here for the reason
    // `node.graph` is.
    const { source_graph: _absent, ...graphless } = heldNodeRow(
      "01JPEERADDRE00000000000000",
      "4a",
      2,
    );
    await expect(db.create(graphless.id).content(graphless)).rejects.toThrow();
  });

  it("records which region served a note, and reads it both ways", async () => {
    // What a refresh and a drop each need: the notes one region served, and
    // whether any surviving region still serves a note.
    const shared = OwnedRefSchema.parse(`${BOB}/01JPEERSHARE00000000000000`);
    const inner = `${AVA}/01JPEERREGN400000000000000`;
    const outer = `${AVA}/01JPEERREGN500000000000000`;
    for (const [localId, pull, source] of [
      ["01JPEERMEMBA00000000000000", inner, shared],
      ["01JPEERMEMBB00000000000000", outer, shared],
      [
        "01JPEERMEMBC00000000000000",
        outer,
        `${BOB}/01JPEERMARKA00000000000000`,
      ],
    ] as const) {
      const row = {
        id: avaId("pull_member", localId),
        created_by: AVA,
        pull,
        source: OwnedRefSchema.parse(source),
        created_at: "2026-02-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      };
      await db.create(row.id).content(row);
    }

    const again = {
      id: avaId("pull_member", "01JPEERMEMBD00000000000000"),
      created_by: AVA,
      pull: inner,
      source: shared,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    const SERVED = `SELECT source FROM pull_member
       WHERE created_by = $did AND pull = $pull ORDER BY source`;
    const bound = { did: AVA, pull: outer };
    const [plan] = await db.query(`${SERVED} EXPLAIN;`, bound);
    expect(JSON.stringify(plan)).toContain(
      '"index":"pull_member_owner_pull_source"',
    );
    const [served] = await db.query<[{ source: string }[]]>(
      `${SERVED};`,
      bound,
    );
    expect(served).toHaveLength(2);

    const [holders] = await db.query<[{ pull: string }[]]>(
      `SELECT pull FROM pull_member
         WHERE created_by = $did AND source = $source ORDER BY pull;`,
      { did: AVA, source: shared },
    );
    expect(holders.map((row) => row.pull)).toEqual([inner, outer]);
  });

  it("takes a refresh of a held node and refuses to let it become another", async () => {
    const row = heldNodeRow("01JPEERMARKF00000000000000", "1b", 2);
    await db.create(row.id).content(row);

    // What a refresh is: the whole row again, carrying the author's own edits
    // inside `node` and re-sending every immutable column unchanged.
    await db.update(row.id).content({
      ...row,
      node: { ...row.node, title: "the author renamed it" },
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    const refreshed = await db.select<{ node: { title: string } }>(row.id);
    expect(refreshed?.node.title).toBe("the author renamed it");

    for (const reassignment of [
      { created_by: BOB },
      { source_did: CAI },
      { source: `${BOB}/01JPEERMARKZ00000000000000` },
      { depth: 9 },
    ]) {
      await expect(db.update(row.id).merge(reassignment)).rejects.toThrow();
    }
  });

  it("numbers a publication's versions once each", async () => {
    const chain = `${AVA}/01JPXPUB0000000000000000AA`;
    const version = (localId: string, sequence: number) => ({
      id: avaId("publication_version", localId),
      created_by: AVA,
      publication: chain,
      sequence,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });

    const first = version("01JPXVERA000000000000000AA", 1);
    await db.create(first.id).content(first);
    const second = version("01JPXVERB000000000000000AA", 2);
    await db.create(second.id).content(second);

    // Two publishes in one moment would otherwise share a place in the history
    // a reader cites versions by.
    const collision = version("01JPXVERC000000000000000AA", 2);
    await expect(db.create(collision.id).content(collision)).rejects.toThrow();

    // A version is what a peer is reading, so it cannot be moved to another
    // chain or renumbered underneath them.
    for (const reassignment of [{ publication: `${AVA}/x` }, { sequence: 9 }]) {
      await expect(db.update(first.id).merge(reassignment)).rejects.toThrow();
    }
  });

  it("holds one copy of a note per version, and the same note in two", async () => {
    // A version is a snapshot: the note is copied into each one, so the address
    // protocol holds inside a version and says nothing across two.
    const version = (n: number) => `${AVA}/01JPXVER${n}00000000000000AA`;
    const note = `${AVA}/01JPXNOTE000000000000000AA`;
    const copy = (
      localId: string,
      at: string,
      address: string,
      source = note,
    ) => ({
      id: avaId("snapshot_node", localId),
      created_by: AVA,
      version: at,
      source,
      address,
      node: {
        address,
        origin: note,
        title: "As it stood",
        tags: [],
        links: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });

    const inFirst = copy("01JPXSNAPA00000000000000AA", version(1), "1a");
    await db.create(inFirst.id).content(inFirst);
    const inSecond = copy("01JPXSNAPB00000000000000AA", version(2), "1a");
    await expect(
      db.create(inSecond.id).content(inSecond),
    ).resolves.toBeDefined();

    const twice = copy(
      "01JPXSNAPC00000000000000AA",
      version(1),
      "1a",
      `${AVA}/other`,
    );
    await expect(db.create(twice.id).content(twice)).rejects.toThrow();

    const again = copy("01JPXSNAPD00000000000000AA", version(1), "1b");
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    // Every version carrying one note, which is what `node.published` is
    // maintained from when a publication goes.
    const CARRYING = `SELECT version FROM snapshot_node
       WITH INDEX snapshot_node_owner_source
       WHERE created_by = $did AND source = $source ORDER BY version`;
    const bound = { did: AVA, source: note };
    const [plan] = await db.query(`${CARRYING} EXPLAIN;`, bound);
    expect(JSON.stringify(plan)).toContain(
      '"index":"snapshot_node_owner_source"',
    );
    const [carrying] = await db.query<[{ version: string }[]]>(
      `${CARRYING};`,
      bound,
    );
    expect(carrying.map((row) => row.version)).toEqual([
      version(1),
      version(2),
    ]);

    // How a version is served: in address order, which is parents before
    // children, and resumable from wherever the last page stopped.
    const PAGE = `SELECT address FROM snapshot_node
       WHERE created_by = $did AND version = $version AND address > $after
       ORDER BY address LIMIT 1`;
    const paging = { did: AVA, version: version(1), after: "" };
    const [paged] = await db.query(`${PAGE} EXPLAIN;`, paging);
    expect(JSON.stringify(paged)).toContain(
      '"index":"snapshot_node_owner_version_address"',
    );
    const [page] = await db.query<[{ address: string }[]]>(`${PAGE};`, paging);
    expect(page.map((row) => row.address)).toEqual(["1a"]);
  });

  it("mints one public copy of an asset per publication, and holds both halves still", async () => {
    // A published section cites the copy, so this row is what stops a second
    // version sending the same bytes public again under a new address — and
    // what the copy is deleted with is the publication, not one version.
    const row = {
      id: avaId("snapshot_asset", "01JPXRA0000000000000000000"),
      created_by: AVA,
      publication: `${AVA}/01JPXPUB0000000000000000AA`,
      source_upload: `${AVA}/01JPXA00000000000000000000`,
      public_upload: `${AVA}/01JPXB00000000000000000000`,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    await db.create(row.id).content(row);

    const again = {
      ...row,
      id: avaId("snapshot_asset", "01JPXRB0000000000000000000"),
      public_upload: `${AVA}/01JPXC00000000000000000000`,
    };
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    for (const reassignment of [
      { publication: `${AVA}/01JPXPUB0000000000000000AB` },
      { source_upload: `${AVA}/01JPXD00000000000000000000` },
      { public_upload: `${AVA}/01JPXE00000000000000000000` },
    ]) {
      await expect(db.update(row.id).merge(reassignment)).rejects.toThrow();
    }
  });

  it("keeps an address a note spent, and reads a run of them from its index", async () => {
    // The address protocol after the note is gone: the row is the whole of the
    // fact that the number is spent, so every column of it is immutable.
    const HOME = homeGraphRef(AVA);
    const under = {
      id: avaId("retired_address", "01JPXRET000000000000000000"),
      created_by: AVA,
      graph: HOME,
      parent: OwnedRefSchema.parse(`${AVA}/01JREADBACK000000000000000`),
      address: "1a",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    };
    const branch = {
      id: avaId("retired_address", "01JPXRET100000000000000000"),
      created_by: AVA,
      graph: HOME,
      address: "9",
      created_at: under.created_at,
      updated_at: under.updated_at,
    };
    await db.create(under.id).content(under);
    await db.create(branch.id).content(branch);

    for (const reassignment of [
      { graph: SECOND_GRAPH },
      { parent: `${AVA}/01JREADBACK000000000000001` },
      { address: "1b" },
      { created_by: BOB },
    ]) {
      await expect(db.update(under.id).merge(reassignment)).rejects.toThrow();
    }

    // A branch's number retires with no parent above it, the way the note it
    // outlives had none — which is how one index answers both shapes.
    const SPENT = `SELECT VALUE address FROM retired_address
       WHERE created_by = $did AND graph = $graph AND parent = NONE`;
    const bound = { did: AVA, graph: HOME };
    const [plan] = await db.query(`${SPENT} EXPLAIN;`, bound);
    expect(JSON.stringify(plan)).toContain(
      '"index":"retired_address_owner_graph_parent"',
    );
    const [spent] = await db.query<[string[]]>(`${SPENT};`, bound);
    expect(spent).toEqual(["9"]);
  });

  it("finds a phrase somebody wrote, in their own writing and in what they hold", async () => {
    const OWN = OwnedRefSchema.parse(`${AVA}/01JWRDSN000000000000000000`);
    const THEIRS = OwnedRefSchema.parse(`${BOB}/01JWRDSD000000000000000000`);
    const section = (
      table: string,
      owner: string,
      localId: string,
      text: string,
    ) => ({
      id: new RecordId(table, {
        created_by: owner,
        id: UlidSchema.parse(localId),
      }),
      created_by: owner,
      node: table === "block" ? OWN : THEIRS,
      ...(table === "block" ? {} : { source: THEIRS }),
      ord: "a0",
      content: { type: "doc", content: [] },
      text,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });

    for (const row of [
      section(
        "block",
        AVA,
        "01JWRDSA000000000000000000",
        "seeds and mushrooms",
      ),
      section("block", BOB, "01JWRDSB000000000000000000", "mushrooms, again"),
      section(
        "pulled_block",
        AVA,
        "01JWRDSC000000000000000000",
        "a mushroom somebody else wrote about",
      ),
    ]) {
      await db.create(row.id).content(row);
    }

    // Stemmed: the singular a person types answers the plural they wrote.
    const [own, held] = await db.query<[string[], string[]]>(
      `SELECT VALUE text FROM block
         WHERE text @1@ $words AND created_by = $did;
       SELECT VALUE text FROM pulled_block
         WHERE text @1@ $words AND created_by = $did;`,
      { did: AVA, words: "mushroom" },
    );
    expect(own).toEqual(["seeds and mushrooms"]);
    expect(held).toEqual(["a mushroom somebody else wrote about"]);

    for (const table of ["block", "pulled_block"]) {
      const [info] = await db.query<[{ indexes: Record<string, string> }]>(
        `INFO FOR TABLE ${table};`,
      );
      expect(info.indexes[`${table}_text`]).toContain("FULLTEXT");
    }
  });

  it("purges one author and leaves the other whole", async () => {
    const before = await db.select<NodeRow>(new Table("node"));
    expect(before.some((row) => row.created_by === BOB)).toBe(true);
    expect(await db.select(new Table("pulled_node"))).not.toHaveLength(0);

    await db.query(STATEMENTS.join("\n"), { did: AVA });

    const after = await db.select<NodeRow>(new Table("node"));
    expect(after.some((row) => row.created_by === AVA)).toBe(false);
    expect(after.some((row) => row.created_by === BOB)).toBe(true);

    // The held copy is the READER's row even though BOB wrote what is in it,
    // which is what makes erasing the reader take it.
    for (const table of [
      "pull",
      "pull_member",
      "pulled_node",
      "pulled_block",
      "publication_version",
      "snapshot_node",
      "snapshot_asset",
      "retired_address",
    ]) {
      expect(await db.select(new Table(table))).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The store somebody already has.
//
// Every note written before a person could keep more than one graph is in the
// graph they started with, and none of them may lose the address rule on the
// way — a person with seven thousand notes is holding seven thousand addresses
// that have to keep resolving one way each.
// ---------------------------------------------------------------------------

/** The `node` and `pulled_node` shape as it stood before graphs, enough of it
 *  to hold rows and to enforce the address rule the old way. */
const BEFORE_GRAPHS = `
  DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pulled_node SCHEMALESS;
  DEFINE FIELD IF NOT EXISTS created_by ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS address ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source_did ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS address ON pulled_node TYPE string READONLY;
  DEFINE INDEX IF NOT EXISTS node_owner_address ON node FIELDS created_by, address UNIQUE;
  DEFINE INDEX IF NOT EXISTS pulled_node_owner_author_address ON pulled_node FIELDS created_by, source_did, address UNIQUE;
`;

describe.skipIf(!listening)("a store written before graphs existed", () => {
  const DATABASE_BEFORE = `before_graphs_${Date.now()}`;
  let db: Surreal;

  beforeAll(async () => {
    db = new Surreal();
    await db.connect(ENDPOINT.href);
    await db.signin({ username: USER, password: PASS });
    await db.use({ namespace: NAMESPACE, database: DATABASE_BEFORE });
    await db.query(BEFORE_GRAPHS);
    for (const [address, localId] of [
      ["1", "01JPREGRAPHA00000000000000"],
      ["1a", "01JPREGRAPHB00000000000000"],
      ["2", "01JPREGRAPHC00000000000000"],
    ] as const) {
      const { graph: _graph, ...before } = nodeRow(AVA, address, localId);
      await db.create(before.id).content(before);
    }
    const { source_graph: _source, ...held } = heldNodeRow(
      "01JPREGRAPHD00000000000000",
      "1",
      1,
    );
    await db.create(held.id).content(held);

    await defineCoreSchema(db);
    // Twice, because the fill is part of a script that runs on every boot.
    await defineCoreSchema(db);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`REMOVE DATABASE IF EXISTS ${DATABASE_BEFORE};`);
    await db.close();
  });

  it("files every note it already held in the graph its author started with", async () => {
    const [rows] = await db.query<[{ address: string; graph: string }[]]>(
      "SELECT address, graph FROM node ORDER BY address;",
    );
    expect(rows).toEqual([
      { address: "1", graph: homeGraphRef(AVA) },
      { address: "1a", graph: homeGraphRef(AVA) },
      { address: "2", graph: homeGraphRef(AVA) },
    ]);

    const [held] = await db.query<[{ source_graph: string }[]]>(
      "SELECT source_graph FROM pulled_node;",
    );
    expect(held).toEqual([{ source_graph: homeGraphRef(BOB) }]);
  });

  it("keeps every address resolving one way inside that graph", async () => {
    // The rule the old index held, still held — and the whole reason the column
    // is filled rather than its absence read as the home graph: a UNIQUE index
    // does not constrain a row whose indexed column is absent.
    const clash = nodeRow(AVA, "1", "01JPREGRAPHRETAKE000000000");
    await expect(db.create(clash.id).content(clash)).rejects.toThrow();

    const beside = nodeRow(
      AVA,
      "1",
      "01JPREGRAPHBESDE0000000000",
      1,
      `${AVA}/01JPREGRAPHBESDE0000000000`,
      SECOND_GRAPH,
    );
    await expect(db.create(beside.id).content(beside)).resolves.toBeDefined();
  });

  it("leaves the notes themselves alone", async () => {
    const stored = await db.select<NodeRow>(
      nodeId(AVA, "01JPREGRAPHA00000000000000"),
    );
    expect(stored?.address).toBe("1");
    expect(stored?.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(stored?.updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(stored?.origin).toBe(`${AVA}/01JPREGRAPHA00000000000000`);
  });

  it("has taken the index it replaced off the store", async () => {
    const [info] = await db.query<[{ indexes: Record<string, string> }]>(
      "INFO FOR TABLE node;",
    );
    expect(Object.keys(info.indexes)).not.toContain("node_owner_address");
    expect(Object.keys(info.indexes)).toContain("node_owner_graph_address");
  });
});
