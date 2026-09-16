// Runs `SCHEMA` and `STATEMENTS` against a real SurrealDB, because everything
// they claim is a claim about a server: an index the planner honours, a column
// the engine refuses to overwrite, a type it refuses to coerce. None of it is
// observable from the string literal.
//
// It is also the compatibility check on the pairing in `pnpm-workspace.yaml`
// (the `surrealdb` client) and `docker-compose.yml` (the server image). Bump
// either half against the other and this file is where it shows.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `integration-target.ts` is the gate.

import {
  DidSyrSchema,
  OwnedRefSchema,
  UlidSchema,
  unnamedGraphRef,
} from "@sloppy/types";
import { RecordId, Surreal, Table } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationTarget } from "./integration-target.js";
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

/** The graph somebody started with. Minted like any other — a home graph's
 *  ulid is its own — so a fixture spells one rather than deriving it. */
function notebook(did: string) {
  return OwnedRefSchema.parse(`${did}/01JSTARTED0000000000000000`);
}

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
  graph = notebook(did),
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
    source_graph: notebook(BOB),
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

// Everything past the socket, the client's own version gate included, is the
// pairing under test and has to fail the run rather than quietly excuse it.
const runs = await integrationTarget(ENDPOINT);

describe.skipIf(!runs)(`the schema against ${ENDPOINT.href}`, () => {
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

  it("holds created_by, created_at and the graph through every write shape", async () => {
    const row = nodeRow(BOB, "2a", "01JNEVERCHANGES00000000000", 2);
    await db.create(row.id).content(row);

    for (const reassignment of [
      { created_by: AVA },
      { created_at: "2030-01-01T00:00:00.000Z" },
      { graph: `${BOB}/01JGRAPHXX0000000000000000` },
    ]) {
      await expect(db.update(row.id).merge(reassignment)).rejects.toThrow();
    }

    // CONTENT replaces the whole document, so it has two shapes MERGE does not:
    // a changed value, and an absent column.
    await expect(
      db.update(row.id).content({ ...row, created_by: AVA }),
    ).rejects.toThrow();
    await expect(
      db.update(row.id).content({
        title: "written without them",
        updated_at: "2026-06-01T00:00:00.000Z",
      }),
    ).rejects.toThrow();

    const stored = await read(row.id);
    expect(stored.address).toBe("2a");
    expect(stored.created_by).toBe(BOB);
    expect(stored.created_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("lets a move re-address a note, and refuses a depth its address could not have", async () => {
    const row = nodeRow(BOB, "2c", "01JMVEDNTE0000000000000000", 2);
    await db.create(row.id).content(row);

    await db.update(row.id).merge({ address: "5a1", depth: 3 });
    const stored = await read(row.id);
    expect(stored.address).toBe("5a1");
    expect(stored.depth).toBe(3);

    await expect(db.update(row.id).merge({ depth: 0 })).rejects.toThrow();
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
    const row = nodeRow(
      BOB,
      "8",
      "01JEMPTYGRAPH0000000000000",
      1,
      `${BOB}/01JEMPTYGRAPH0000000000000`,
      "",
    );
    await db.create(row.id).content(row);

    await expect(
      db.update(row.id).merge({ graph: notebook(BOB) }),
    ).rejects.toThrow();
    expect((await read(row.id)).graph).toBe("");
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
      db.update(beside.id).merge({ graph: notebook(AVA) }),
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

  it("holds any number of notes with no address in one graph", async () => {
    // What makes an address a label rather than a key: absence is not a value
    // in `node_owner_graph_address`, so the index that refuses a second `3`
    // never sees these rows. The index is untouched by that rule — this is what
    // says so, against the server rather than from the definition.
    const unlabelled = (localId: string) => {
      const { address: _none, ...row } = nodeRow(AVA, "1", localId);
      return row;
    };

    const first = unlabelled("01JNADDRESSA00000000000000");
    const second = unlabelled("01JNADDRESSB00000000000000");
    await expect(db.create(first.id).content(first)).resolves.toBeDefined();
    await expect(db.create(second.id).content(second)).resolves.toBeDefined();
    expect((await read(first.id)).address).toBeUndefined();

    // And a labelled note gives its label up by a write that omits the column.
    // NULL is not the spelling: `option<string>` refuses it, which is what
    // keeps a row from carrying an address nothing can compare.
    const labelled = nodeRow(AVA, "9", "01JDRPADDRESS0000000000000");
    await db.create(labelled.id).content(labelled);
    await expect(
      db.update(labelled.id).merge({ address: null }),
    ).rejects.toThrow();
    await db.query("UPDATE $id UNSET address;", { id: labelled.id });
    expect((await read(labelled.id)).address).toBeUndefined();

    // The label lookup is still an index seek, which is the whole reason the
    // index is left leading with the address rather than a derived key.
    const [plan] = await db.query(
      `SELECT id FROM node
         WHERE created_by = $did AND graph = $graph AND address = $address
         EXPLAIN;`,
      { did: AVA, graph: notebook(AVA), address: "3" },
    );
    expect(JSON.stringify(plan)).toContain(
      '"index":"node_owner_graph_address"',
    );
  });

  it("holds one graph flagged as the one its owner started with", async () => {
    // The rule is the store's rather than whichever process asked first, so a
    // second mint racing the first is refused here — docs/ARCHITECTURE.md
    // § "The genealogy and the address".
    const row = (localId: string, home?: true) => ({
      id: avaId("graph", localId),
      created_by: AVA,
      title: localId,
      ...(home ? { home } : {}),
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const started = row("01JGSTART00000000000000000", true);
    const second = row("01JGSTARTB0000000000000000", true);

    await expect(db.create(started.id).content(started)).resolves.toBeDefined();
    await expect(db.create(second.id).content(second)).rejects.toThrow(
      /graph_owner_home/,
    );

    // And a graph that is not it leaves the column out, so any number of them
    // sit beside it.
    for (const beside of [
      "01JGNEXTA00000000000000000",
      "01JGNEXTB00000000000000000",
    ]) {
      const one = row(beside);
      await expect(db.create(one.id).content(one)).resolves.toBeDefined();
    }
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
      source_graph: notebook(CAI),
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

    // And a region may carry notes its author gave no label. They are outside
    // the index above the way an unlabelled note of the reader's own is, so the
    // reader holds every one of them.
    const unlabelled = (localId: string) => {
      const { address: _none, node, ...row } = heldNodeRow(localId, "4a", 2);
      const { address: _also, ...published } = node;
      return {
        ...row,
        source: OwnedRefSchema.parse(`${CAI}/${localId}`),
        source_did: CAI,
        source_graph: notebook(CAI),
        node: published,
      };
    };

    const bare = unlabelled("01JPEERNADDRA0000000000000");
    const alsoBare = unlabelled("01JPEERNADDRB0000000000000");
    await expect(db.create(bare.id).content(bare)).resolves.toBeDefined();
    await expect(
      db.create(alsoBare.id).content(alsoBare),
    ).resolves.toBeDefined();
    expect(
      (await db.select<{ address?: string }>(bare.id))?.address,
    ).toBeUndefined();
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

  // What a listing pages on. An address alone stopped being a cursor when a
  // person could publish two branches they never numbered, so the pair the
  // listing orders by is the pair it resumes after — and NONE sorting below
  // every string is what the two halves of that WHERE rest on.
  it("pages an owner's publications by label and by the note under it", async () => {
    const rooted = (localId: string, root: string, address?: string) => ({
      id: avaId("publication", localId),
      created_by: AVA,
      root: OwnedRefSchema.parse(`${AVA}/${root}`),
      ...(address === undefined ? {} : { root_address: address }),
      comments: "anyone",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const rows = [
      rooted("01JPGPBCA000000000000000AA", "01JPGRTA0000000000000000AA", "2"),
      rooted("01JPGPBCB000000000000000AA", "01JPGRTB0000000000000000AA"),
      rooted("01JPGPBCC000000000000000AA", "01JPGRTC0000000000000000AA", "1"),
      rooted("01JPGPBCD000000000000000AA", "01JPGRTD0000000000000000AA"),
    ];
    for (const row of rows) await db.create(row.id).content(row);

    const PAGE = (from: string) =>
      `SELECT root, root_address FROM publication
         WHERE created_by = $did${from}
         ORDER BY root_address, root LIMIT 1`;
    type Row = { root: string; root_address?: string };
    const one = async (from: string, vars: Record<string, unknown> = {}) => {
      const [answer] = await db.query<[Row[]]>(PAGE(from), {
        did: AVA,
        ...vars,
      });
      return answer[0];
    };

    const walked: Row[] = [];
    let at = await one("");
    while (at !== undefined) {
      walked.push(at);
      at =
        at.root_address === undefined
          ? await one(" AND (root_address != NONE OR root > $afterRoot)", {
              afterRoot: at.root,
            })
          : await one(
              " AND (root_address > $after OR (root_address = $after AND root > $afterRoot))",
              { after: at.root_address, afterRoot: at.root },
            );
    }

    // The ones nobody numbered first, in their own order, then the labelled
    // ones by label: one page each, and every row once.
    expect(walked.map((row) => row.root_address)).toEqual([
      undefined,
      undefined,
      "1",
      "2",
    ]);
    expect(new Set(walked.map((row) => row.root)).size).toBe(4);
  });

  it("holds one copy of a note per version, and the same note in two", async () => {
    // A version is a snapshot: the note is copied into each one, so the address
    // protocol holds inside a version and says nothing across two.
    const version = (n: number) => `${AVA}/01JPXVER${n}00000000000000AA`;
    const note = `${AVA}/01JPXNOTE000000000000000AA`;
    const copy = (
      localId: string,
      at: string,
      ord: string,
      address: string | undefined,
      source = note,
    ) => ({
      id: avaId("snapshot_node", localId),
      created_by: AVA,
      version: at,
      source,
      ord,
      ...(address === undefined ? {} : { address }),
      node: {
        ...(address === undefined ? {} : { address }),
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

    const inFirst = copy(
      "01JPXSNAPA00000000000000AA",
      version(1),
      "00000000",
      "1a",
    );
    await db.create(inFirst.id).content(inFirst);
    const inSecond = copy(
      "01JPXSNAPB00000000000000AA",
      version(2),
      "00000000",
      "1a",
    );
    await expect(
      db.create(inSecond.id).content(inSecond),
    ).resolves.toBeDefined();

    // A version reads in one order, so two notes cannot share a place in it.
    const twice = copy(
      "01JPXSNAPC00000000000000AA",
      version(1),
      "00000000",
      "1b",
      `${AVA}/other`,
    );
    await expect(db.create(twice.id).content(twice)).rejects.toThrow();

    const again = copy(
      "01JPXSNAPD00000000000000AA",
      version(1),
      "00000001",
      "1b",
    );
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    // A note its author gave no number is copied into a version like any other.
    const unnumbered = copy(
      "01JPXSNAPE00000000000000AA",
      version(1),
      "00000001",
      undefined,
      `${AVA}/01JPXNOTEB00000000000000AA`,
    );
    await expect(
      db.create(unnumbered.id).content(unnumbered),
    ).resolves.toBeDefined();

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

    // How a version is served: in the walk it was written down in, which is
    // parents before children, and resumable from wherever the last page
    // stopped.
    const PAGE = `SELECT ord FROM snapshot_node
       WHERE created_by = $did AND version = $version AND ord > $after
       ORDER BY ord LIMIT 2`;
    const paging = { did: AVA, version: version(1), after: "" };
    const [paged] = await db.query(`${PAGE} EXPLAIN;`, paging);
    expect(JSON.stringify(paged)).toContain(
      '"index":"snapshot_node_owner_version_ord"',
    );
    const [page] = await db.query<[{ ord: string }[]]>(`${PAGE};`, paging);
    expect(page.map((row) => row.ord)).toEqual(["00000000", "00000001"]);
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
    const HOME = notebook(AVA);
    const under = {
      id: avaId("retired_address", "01JPXRET000000000000000000"),
      created_by: AVA,
      graph: HOME,
      parent: OwnedRefSchema.parse(`${AVA}/01JREADBACK000000000000000`),
      address: "1a",
      note: OwnedRefSchema.parse(`${AVA}/01JSPENTBY0000000000000000`),
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
      { note: `${AVA}/01JSPENTBY0000000000000001` },
    ]) {
      await expect(db.update(under.id).merge(reassignment)).rejects.toThrow();
    }

    // A row written before the column names nobody, and its number is refused
    // to everyone — AI.md § "The Genealogy Is the Protocol".
    const [[nobody]] = await db.query<[{ note?: string }[]]>(
      "SELECT note FROM retired_address WHERE id = $id;",
      { id: branch.id },
    );
    expect(nobody?.note).toBeUndefined();

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

  it("keeps an address a note was moved from leading to that note", async () => {
    const HOME = notebook(AVA);
    const NOTE = OwnedRefSchema.parse(`${AVA}/01JMVEDAWAY000000000000000`);
    const PARENT = OwnedRefSchema.parse(`${AVA}/01JREADBACK000000000000000`);
    const under = {
      id: avaId("node_alias", "01JPXMVA000000000000000000"),
      created_by: AVA,
      graph: HOME,
      parent: PARENT,
      address: "1c",
      note: NOTE,
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    };
    const { parent: _hung, ...withoutParent } = under;
    const branch = {
      ...withoutParent,
      id: avaId("node_alias", "01JPXMVB000000000000000000"),
      address: "8",
    };
    await db.create(under.id).content(under);
    await db.create(branch.id).content(branch);

    for (const reassignment of [
      { graph: SECOND_GRAPH },
      { parent: `${AVA}/01JREADBACK000000000000001` },
      { address: "1d" },
      { note: `${AVA}/01JMVEDAWAY000000000000001` },
      { created_by: BOB },
    ]) {
      await expect(db.update(under.id).merge(reassignment)).rejects.toThrow();
    }

    // One alias per address inside a graph, for the reason there is one note
    // per address: a citation that resolved two ways is not a citation.
    const twice = {
      ...under,
      id: avaId("node_alias", "01JPXMVC000000000000000000"),
      note: OwnedRefSchema.parse(`${AVA}/01JMVEDAWAY000000000000002`),
    };
    await expect(db.create(twice.id).content(twice)).rejects.toThrow();

    // The same address in another of AVA's graphs is another label, exactly as
    // it is on a note.
    const beside = {
      ...under,
      id: avaId("node_alias", "01JPXMVD000000000000000000"),
      graph: SECOND_GRAPH,
    };
    await expect(db.create(beside.id).content(beside)).resolves.toBeDefined();

    const RUN = `SELECT VALUE address FROM node_alias
       WHERE created_by = $did AND graph = $graph AND parent = $parent`;
    const bound = { did: AVA, graph: HOME, parent: PARENT };
    const [plan] = await db.query(`${RUN} EXPLAIN;`, bound);
    expect(JSON.stringify(plan)).toContain(
      '"index":"node_alias_owner_graph_parent"',
    );
    const [run] = await db.query<[string[]]>(`${RUN};`, bound);
    expect(run).toEqual(["1c"]);

    // A branch's number is aliased with no parent above it, the way the note it
    // names had none — which is how one index answers both shapes.
    const [branches] = await db.query<[string[]]>(
      `SELECT VALUE address FROM node_alias
         WHERE created_by = $did AND graph = $graph AND parent = NONE;`,
      { did: AVA, graph: HOME },
    );
    expect(branches).toEqual(["8"]);

    const NOTES = `SELECT VALUE address FROM node_alias
       WHERE created_by = $did AND graph = $graph AND note = $note`;
    const [notePlan] = await db.query(`${NOTES} EXPLAIN;`, {
      did: AVA,
      graph: HOME,
      note: NOTE,
    });
    expect(JSON.stringify(notePlan)).toContain(
      '"index":"node_alias_owner_graph_note"',
    );
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

  it("reads who one person refuses, blanket and per note, from its index", async () => {
    const NOTE = OwnedRefSchema.parse(`${AVA}/01JREFNTE00000000000000000`);
    const refusals: [localId: string, voice: string, note?: string][] = [
      ["01JRFSDA000000000000000000", BOB],
      ["01JRFSDB000000000000000000", BOB, NOTE],
      ["01JRFSDC000000000000000000", CAI],
    ];
    for (const [localId, voice, note] of refusals) {
      await db.create(avaId("refused_voice", localId)).content({
        id: avaId("refused_voice", localId),
        created_by: AVA,
        voice,
        ...(note === undefined ? {} : { note }),
        created_at: "2026-02-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      });
    }
    // BOB refuses somebody too; a refusal is one person's own reading and
    // reaches nobody else's.
    await db
      .create(
        new RecordId("refused_voice", {
          created_by: BOB,
          id: "01JRFSDD000000000000000000",
        }),
      )
      .content({
        id: new RecordId("refused_voice", {
          created_by: BOB,
          id: "01JRFSDD000000000000000000",
        }),
        created_by: BOB,
        voice: AVA,
        created_at: "2026-02-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      });

    const REFUSED = `SELECT voice, note FROM refused_voice
       WHERE created_by = $did ORDER BY voice, note`;

    const [plan] = await db.query(`${REFUSED} EXPLAIN;`, { did: AVA });
    expect(JSON.stringify(plan)).toContain(
      '"index":"refused_voice_owner_voice"',
    );

    const [held] = await db.query<[{ voice: string; note?: string }[]]>(
      `${REFUSED};`,
      { did: AVA },
    );
    expect(held).toEqual([
      { voice: BOB },
      { voice: BOB, note: NOTE },
      { voice: CAI },
    ]);

    // The blanket refusal and the per-note one are two rows, so the note is
    // what tells them apart and neither may overwrite the other.
    await expect(
      db
        .update(avaId("refused_voice", "01JRFSDA000000000000000000"))
        .merge({ note: NOTE }),
    ).rejects.toThrow();
  });

  it("holds one offer per person on a note, and reads a note's offers from its index", async () => {
    const NOTE = OwnedRefSchema.parse(`${AVA}/01JOFFERNTA000000000000000`);
    const offer = (localId: string, note: string, by: string, at: string) => ({
      id: avaId("amendment", localId),
      created_by: AVA,
      note,
      by,
      at,
      title: "As I would have it",
      tags: ["seed"],
      created_at: at,
      updated_at: at,
    });
    const OTHER = OwnedRefSchema.parse(`${AVA}/01JOFFERNTB000000000000000`);
    // CAI offered first, and BOB sorts first by DID, so the order below is the
    // rows' age and could not be the column order.
    for (const row of [
      offer(
        "01JOFFERA00000000000000000",
        NOTE,
        BOB,
        "2026-02-02T00:00:00.000Z",
      ),
      offer(
        "01JOFFERB00000000000000000",
        NOTE,
        CAI,
        "2026-02-01T00:00:00.000Z",
      ),
      offer(
        "01JOFFERC00000000000000000",
        OTHER,
        BOB,
        "2026-02-01T00:00:00.000Z",
      ),
    ]) {
      await db.create(row.id).content(row);
    }

    // A second offer by the same person on the same note is the one they
    // already have, not a queue.
    await expect(
      db
        .create(avaId("amendment", "01JOFFERD00000000000000000"))
        .content(
          offer(
            "01JOFFERD00000000000000000",
            NOTE,
            BOB,
            "2026-02-03T00:00:00.000Z",
          ),
        ),
    ).rejects.toThrow();

    // The note and who offered it are what this row IS.
    await expect(
      db
        .update(avaId("amendment", "01JOFFERA00000000000000000"))
        .merge({ by: CAI }),
    ).rejects.toThrow();

    const OFFERS = `SELECT by FROM amendment
       WHERE created_by = $did AND note = $note ORDER BY created_at`;
    const [plan] = await db.query(`${OFFERS} EXPLAIN;`, {
      did: AVA,
      note: NOTE,
    });
    expect(JSON.stringify(plan)).toContain('"index":"amendment_owner_note_by"');

    const [held] = await db.query<[{ by: string }[]]>(`${OFFERS};`, {
      did: AVA,
      note: NOTE,
    });
    expect(held.map((row) => row.by)).toEqual([CAI, BOB]);
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
      "node_alias",
      "amendment",
    ]) {
      expect(await db.select(new Table(table))).toHaveLength(0);
    }
    const refusals = await db.select<{ created_by: string }>(
      new Table("refused_voice"),
    );
    expect(refusals.map((row) => row.created_by)).toEqual([BOB]);
  });
});

// ---------------------------------------------------------------------------
// The graph everybody started with, given a ulid of its own.
//
// Every identity's first graph was at one reserved ulid, so no two could be
// told apart and nobody could bring an archive of theirs home. The crossing
// mints one per identity and carries every row that named the old ref over —
// docs/ARCHITECTURE.md § "The genealogy and the address".
// ---------------------------------------------------------------------------

describe.skipIf(!runs)("a store whose graphs all shared one ulid", () => {
  const DATABASE_SHARED = `shared_home_${Date.now()}`;
  let db: Surreal;
  let home: string;

  beforeAll(async () => {
    db = new Surreal();
    await db.connect(ENDPOINT.href);
    await db.signin({ username: USER, password: PASS });
    await db.use({ namespace: NAMESPACE, database: DATABASE_SHARED });
    const was = unnamedGraphRef(AVA);
    await db.query(
      `DEFINE TABLE IF NOT EXISTS graph SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS node_alias SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS retired_address SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS publication SCHEMALESS;
       CREATE $graph CONTENT $graphRow;
       CREATE $node CONTENT $nodeRow;
       CREATE $alias CONTENT $aliasRow;
       CREATE $retired CONTENT $retiredRow;
       CREATE $published CONTENT $publishedRow;
       CREATE $older CONTENT $olderRow;`,
      {
        graph: new RecordId("graph", {
          created_by: AVA,
          id: "00000000000000000000000000",
        }),
        graphRow: {
          created_by: AVA,
          title: "Everything",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        node: nodeId(AVA, "01JSHAREDN0000000000000000"),
        nodeRow: {
          created_by: AVA,
          graph: was,
          address: "1",
          depth: 1,
          origin: `${AVA}/01JSHAREDN0000000000000000`,
          title: "Root",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        alias: avaId("node_alias", "01JSHAREDA0000000000000000"),
        aliasRow: {
          created_by: AVA,
          graph: was,
          address: "2",
          note: `${AVA}/01JSHAREDN0000000000000000`,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        retired: avaId("retired_address", "01JSHAREDR0000000000000000"),
        retiredRow: {
          created_by: AVA,
          graph: was,
          address: "3",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        published: avaId("publication", "01JSHAREDP0000000000000000"),
        publishedRow: {
          created_by: AVA,
          root: `${AVA}/01JSHAREDN0000000000000000`,
          root_address: "1",
          graph: was,
          comments: "anyone",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        // Published before the column existed, so it names no graph at all.
        older: avaId("publication", "01JSHAREDQ0000000000000000"),
        olderRow: {
          created_by: AVA,
          root: `${AVA}/01JSHAREDN0000000000000001`,
          root_address: "1",
          comments: "anyone",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      },
    );

    await defineCoreSchema(db);
    // Twice, because it is part of a script that runs on every boot.
    await defineCoreSchema(db);
    const [[found]] = await db.query<[string[]]>(
      "SELECT VALUE graph FROM node LIMIT 1;",
    );
    home = found;
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`REMOVE DATABASE IF EXISTS ${DATABASE_SHARED};`);
    await db.close();
  });

  it("mints the graph they started with and keeps what they called it", async () => {
    const [rows] = await db.query<[{ id: RecordId; title: string }[]]>(
      "SELECT id, title FROM graph WHERE created_by = $did;",
      { did: AVA },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Everything");
    expect(home).not.toBe(unnamedGraphRef(AVA));
    expect(home).toBe(`${AVA}/${String((rows[0].id.id as { id: string }).id)}`);
  });

  it("carries every row that named the old graph over with it", async () => {
    const [aliases, retired, published] = await db.query<
      [string[], string[], string[]]
    >(
      `SELECT VALUE graph FROM node_alias;
       SELECT VALUE graph FROM retired_address;
       SELECT VALUE graph FROM publication ORDER BY id;`,
    );
    expect(aliases).toEqual([home]);
    expect(retired).toEqual([home]);
    // The second names no graph at all, and is given the one its author
    // started with rather than left naming none.
    expect(published).toEqual([home, home]);
  });

  it("leaves it alone the next time it runs", async () => {
    await defineCoreSchema(db);
    const [[still]] = await db.query<[string[]]>(
      "SELECT VALUE graph FROM node LIMIT 1;",
    );
    expect(still).toBe(home);
    const [graphs] = await db.query<[unknown[]]>("SELECT * FROM graph;");
    expect(graphs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The crossing that stopped part way.
//
// The statements commit one at a time, so a process that dies mid-crossing
// leaves one identity minted and its rows still naming the old ref. The next
// run has to finish that identity rather than pass over it, or the addresses
// its retired rows are holding are offered again.
// ---------------------------------------------------------------------------

describe.skipIf(!runs)("a crossing that stopped after the mint", () => {
  const DATABASE_HALF = `half_home_${Date.now()}`;
  const MINTED = "01JMNTED0000000000000000AB";
  let db: Surreal;

  beforeAll(async () => {
    db = new Surreal();
    await db.connect(ENDPOINT.href);
    await db.signin({ username: USER, password: PASS });
    await db.use({ namespace: NAMESPACE, database: DATABASE_HALF });
    const was = unnamedGraphRef(AVA);
    await db.query(
      `DEFINE TABLE IF NOT EXISTS graph SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS node_alias SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS retired_address SCHEMALESS;
       DEFINE TABLE IF NOT EXISTS publication SCHEMALESS;
       CREATE $shared CONTENT $sharedRow;
       CREATE $minted CONTENT $mintedRow;
       CREATE $node CONTENT $nodeRow;
       CREATE $retired CONTENT $retiredRow;`,
      {
        shared: new RecordId("graph", {
          created_by: AVA,
          id: "00000000000000000000000000",
        }),
        sharedRow: {
          created_by: AVA,
          title: "Everything",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        minted: new RecordId("graph", { created_by: AVA, id: MINTED }),
        mintedRow: {
          created_by: AVA,
          title: "Everything",
          home: true,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-02-01T00:00:00.000Z",
        },
        node: nodeId(AVA, "01JSTPN00000000000000000AB"),
        nodeRow: {
          created_by: AVA,
          graph: was,
          address: "1",
          depth: 1,
          origin: `${AVA}/01JSTPN00000000000000000AB`,
          title: "Root",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        retired: avaId("retired_address", "01JSTPR00000000000000000AB"),
        retiredRow: {
          created_by: AVA,
          graph: was,
          address: "3",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      },
    );

    await defineCoreSchema(db);
    await defineCoreSchema(db);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`REMOVE DATABASE IF EXISTS ${DATABASE_HALF};`);
    await db.close();
  });

  it("carries the rows left behind to the home graph already minted", async () => {
    const [nodes, retired] = await db.query<[string[], string[]]>(
      `SELECT VALUE graph FROM node;
       SELECT VALUE graph FROM retired_address;`,
    );
    expect(nodes).toEqual([`${AVA}/${MINTED}`]);
    expect(retired).toEqual([`${AVA}/${MINTED}`]);
  });

  it("leaves one graph, and not the one everybody shared", async () => {
    const [rows] = await db.query<[{ id: RecordId; home?: boolean }[]]>(
      "SELECT id, home FROM graph WHERE created_by = $did;",
      { did: AVA },
    );
    expect(rows).toHaveLength(1);
    expect(String((rows[0].id.id as { id: string }).id)).toBe(MINTED);
    expect(rows[0].home).toBe(true);
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

describe.skipIf(!runs)("a store written before graphs existed", () => {
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
    const [homes] = await db.query<[{ id: RecordId; title: string }[]]>(
      "SELECT id, title FROM graph WHERE created_by = $did AND home = true;",
      { did: AVA },
    );
    expect(homes).toHaveLength(1);
    const home = `${AVA}/${String((homes[0].id.id as { id: string }).id)}`;
    expect(home).not.toBe(unnamedGraphRef(AVA));

    const [rows] = await db.query<[{ address: string; graph: string }[]]>(
      "SELECT address, graph FROM node ORDER BY address;",
    );
    expect(rows).toEqual([
      { address: "1", graph: home },
      { address: "1a", graph: home },
      { address: "2", graph: home },
    ]);

    // The author of a held copy is somebody else's identity, whose own home
    // graph nothing here can mint: the copy stays at the graph they never
    // named.
    const [held] = await db.query<[{ source_graph: string }[]]>(
      "SELECT source_graph FROM pulled_node;",
    );
    expect(held).toEqual([{ source_graph: unnamedGraphRef(BOB) }]);
  });

  it("keeps every address resolving one way inside that graph", async () => {
    // The rule the old index held, still held — and the whole reason the column
    // is filled rather than left absent: a UNIQUE index does not constrain a
    // row whose indexed column is absent.
    const [[home]] = await db.query<[string[]]>(
      "SELECT VALUE graph FROM node LIMIT 1;",
    );
    const clash = nodeRow(
      AVA,
      "1",
      "01JPREGRAPHRETAKE000000000",
      1,
      `${AVA}/01JPREGRAPHRETAKE000000000`,
      OwnedRefSchema.parse(home),
    );
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

// ---------------------------------------------------------------------------
// A store holding versions published while every note in one had to carry an
// address. A peer is reading those a page at a time, so each has to go on
// paging in exactly the order it was already paging in.
// ---------------------------------------------------------------------------

/** The `snapshot_node` shape as it stood before a published note could go
 *  unnumbered: enough of it to hold rows and to page them the old way. */
const BEFORE_UNNUMBERED = `
  DEFINE TABLE IF NOT EXISTS snapshot_node SCHEMALESS;
  DEFINE FIELD IF NOT EXISTS created_by ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS version ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS address ON snapshot_node TYPE string READONLY;
  DEFINE INDEX IF NOT EXISTS snapshot_node_owner_version_address ON snapshot_node FIELDS created_by, version, address UNIQUE;
`;

describe.skipIf(!runs)(
  "a version published before a note could go unnumbered",
  () => {
    const DATABASE_BEFORE = `before_unnumbered_${Date.now()}`;
    const VERSION = OwnedRefSchema.parse(`${AVA}/01JPFRZNVER000000000000000`);
    /** The order the store was already serving this version in. */
    const SERVED = ["1", "1a", "1a1", "2"];
    const snapshotId = (at: number) =>
      avaId("snapshot_node", `01JPFRZNSNP${String(at).padStart(15, "0")}`);
    let db: Surreal;

    beforeAll(async () => {
      db = new Surreal();
      await db.connect(ENDPOINT.href);
      await db.signin({ username: USER, password: PASS });
      await db.use({ namespace: NAMESPACE, database: DATABASE_BEFORE });
      await db.query(BEFORE_UNNUMBERED);
      for (const [at, address] of SERVED.entries()) {
        const row = {
          id: snapshotId(at),
          created_by: AVA,
          version: VERSION,
          source: OwnedRefSchema.parse(
            `${AVA}/01JPFRZNNTE${String(at).padStart(15, "0")}`,
          ),
          address,
          node: {
            address,
            origin: OwnedRefSchema.parse(`${AVA}/01JPFRZNNTE000000000000000`),
            title: "As it stood",
            tags: [],
            links: [],
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          created_at: "2026-02-01T00:00:00.000Z",
          updated_at: "2026-02-01T00:00:00.000Z",
        };
        await db.create(row.id).content(row);
      }

      await defineCoreSchema(db);
      // Twice, because the fill is part of a script that runs on every boot.
      await defineCoreSchema(db);
    });

    afterAll(async () => {
      if (!db) return;
      await db.query(`REMOVE DATABASE IF EXISTS ${DATABASE_BEFORE};`);
      await db.close();
    });

    it("pages the version it was already serving, in the same order", async () => {
      const PAGE = `SELECT address, ord FROM snapshot_node
         WHERE created_by = $did AND version = $version AND ord > $after
         ORDER BY ord`;
      const paging = { did: AVA, version: VERSION, after: "" };
      const [paged] = await db.query(`${PAGE} EXPLAIN;`, paging);
      expect(JSON.stringify(paged)).toContain(
        '"index":"snapshot_node_owner_version_ord"',
      );
      const [rows] = await db.query<[{ address: string; ord: string }[]]>(
        `${PAGE};`,
        paging,
      );
      expect(rows.map((row) => row.address)).toEqual(SERVED);
      expect(rows.map((row) => row.ord)).toEqual(SERVED);
    });

    it("leaves the copies themselves alone", async () => {
      const held = await db.select<{ address: string; created_at: string }>(
        snapshotId(0),
      );
      expect(held?.address).toBe("1");
      expect(held?.created_at).toBe("2026-02-01T00:00:00.000Z");
    });

    it("has taken the index it replaced off the store", async () => {
      const [info] = await db.query<[{ indexes: Record<string, string> }]>(
        "INFO FOR TABLE snapshot_node;",
      );
      expect(Object.keys(info.indexes)).not.toContain(
        "snapshot_node_owner_version_address",
      );
      expect(Object.keys(info.indexes)).toContain(
        "snapshot_node_owner_version_ord",
      );
    });

    it("takes a note with no address into a version beside them", async () => {
      const row = {
        id: avaId("snapshot_node", "01JPFRZNSNPNEW000000000000"),
        created_by: AVA,
        version: VERSION,
        source: OwnedRefSchema.parse(`${AVA}/01JPFRZNNTENEW000000000000`),
        ord: "3",
        node: {
          origin: OwnedRefSchema.parse(`${AVA}/01JPFRZNNTE000000000000000`),
          title: "Nobody numbered it",
          tags: [],
          links: [],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        created_at: "2026-02-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      };
      await expect(db.create(row.id).content(row)).resolves.toBeDefined();
    });
  },
);
