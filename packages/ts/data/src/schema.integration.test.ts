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
import { DidSyrSchema, OwnedRefSchema, UlidSchema } from "@sloppy/types";
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
) {
  return {
    id: nodeId(did, localId),
    created_by: did,
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

function pullRow(localId: string, rootAddress: string) {
  return {
    id: avaId("pull", localId),
    created_by: AVA,
    source_did: BOB,
    root_address: rootAddress,
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

  it("refuses a second node at an address its owner already used", async () => {
    const first = nodeRow(AVA, "3", "01JADDRESSTAKEN00000000000");
    await db.create(first.id).content(first);

    const clash = nodeRow(AVA, "3", "01JADDRESSRETAKE0000000000");
    await expect(db.create(clash.id).content(clash)).rejects.toThrow();

    // Another author holding the same address is the normal federated case.
    const peer = nodeRow(BOB, "3", "01JADDRESSPEER000000000000");
    await expect(db.create(peer.id).content(peer)).resolves.toBeDefined();
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

    // The trap the pin exists for, held against the server so that the day it
    // stops being true is a failing test rather than a silent one.
    const [unpinned] = await db.query<[{ address: string }[]]>(
      `SELECT address FROM node
         WHERE tags = $tag AND created_by = $did ORDER BY address;`,
      bound,
    );
    expect(unpinned).toEqual([]);

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

  it("refuses a second copy of a region the reader already holds", async () => {
    // Pulling again refreshes this row, so the uniqueness is what stops a
    // reader ending up with two copies of one subtree that drift apart.
    const first = pullRow(REGION, "1");
    await db.create(first.id).content(first);

    const again = pullRow("01JPEERREGN300000000000000", "1");
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    // Another root of the same author's is an ordinary second region.
    const other = pullRow(OTHER_REGION, "2");
    await expect(db.create(other.id).content(other)).resolves.toBeDefined();
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
    const inner = pullRow("01JPEERREGN400000000000000", "3a");
    await db.create(inner.id).content(inner);
    const held = heldNodeRow("01JPEERSHARE00000000000000", "3a", 2);
    await db.create(held.id).content(held);

    const outer = pullRow("01JPEERREGN500000000000000", "3");
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

  it("mints one public copy of a picture, and holds both halves still", async () => {
    // Publishing copies the bytes rather than widening the original, so this
    // row is what stops a second publish minting a second copy.
    const row = {
      id: avaId("published_picture", "01JPXRA0000000000000000000"),
      created_by: AVA,
      source_upload: `${AVA}/01JPXA00000000000000000000`,
      public_upload: `${AVA}/01JPXB00000000000000000000`,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };
    await db.create(row.id).content(row);

    const again = {
      ...row,
      id: avaId("published_picture", "01JPXRB0000000000000000000"),
      public_upload: `${AVA}/01JPXC00000000000000000000`,
    };
    await expect(db.create(again.id).content(again)).rejects.toThrow();

    for (const reassignment of [
      { source_upload: `${AVA}/01JPXD00000000000000000000` },
      { public_upload: `${AVA}/01JPXE00000000000000000000` },
    ]) {
      await expect(db.update(row.id).merge(reassignment)).rejects.toThrow();
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
      "pulled_node",
      "pulled_block",
      "published_picture",
    ]) {
      expect(await db.select(new Table(table))).toHaveLength(0);
    }
  });
});
