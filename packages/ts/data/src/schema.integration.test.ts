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

  it("purges one author and leaves the other whole", async () => {
    const before = await db.select<NodeRow>(new Table("node"));
    expect(before.some((row) => row.created_by === BOB)).toBe(true);

    await db.query(STATEMENTS.join("\n"), { did: AVA });

    const after = await db.select<NodeRow>(new Table("node"));
    expect(after.some((row) => row.created_by === AVA)).toBe(false);
    expect(after.some((row) => row.created_by === BOB)).toBe(true);
  });
});
