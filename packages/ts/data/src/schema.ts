import type { Surreal } from "surrealdb";

/**
 * Sloppy's tables and indexes. Idempotent, so it is safe on every boot, and it
 * runs unchanged against the server and the native app's embedded engine.
 *
 * It runs on every boot because production SurrealDB serves only tables that
 * have been `DEFINE`d and the dev stack does not enforce that — a table nobody
 * declared works locally and 404s in production.
 *
 * One contiguous string on purpose: parallel branches cannot each append to it
 * without conflicting, which is what keeps it in the foundation wave rather
 * than in whichever track happens to add an entity.
 */
export async function defineCoreSchema(db: Surreal): Promise<void> {
  await db.query(SCHEMA);
}

/**
 * Tables stay SCHEMALESS. The only `DEFINE FIELD`s are the invariants the
 * database has to hold itself: `address`, `depth`, `created_by` and
 * `created_at` immutable, `depth` a positive `int`, and the timestamps
 * `TYPE string`. Everything else is a plain column, which is what lets a later
 * track add a field without editing this shared literal.
 *
 * docs/ARCHITECTURE.md § "Data model" says why each of them.
 */
export const SCHEMA = `
  DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS block SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS label_dimension SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS publication SCHEMALESS;

  DEFINE FIELD IF NOT EXISTS address ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS depth ON node TYPE int ASSERT $value > 0 READONLY;

  DEFINE FIELD IF NOT EXISTS created_by ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON label_dimension TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON publication TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS created_at ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON label_dimension TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON publication TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS updated_at ON node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON block TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON label_dimension TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON publication TYPE string;

  -- Every indexed column is a TOP-LEVEL STRING, including the ones that point
  -- at another row: a composite record id is a row's own key and never another
  -- row's column. docs/ARCHITECTURE.md § "Data model" says why.
  --
  -- Most indexes below LEAD with created_by, which is what lets one index serve
  -- both the user-scoped read and the purge; a separate single-column
  -- <table>_owner would index a prefix of one of them and be maintained on
  -- every write for nothing.

  -- UNIQUE is the address protocol, enforced: one address per author, and a
  -- second row claiming a taken address fails at write rather than becoming a
  -- citation that resolves two ways.
  DEFINE INDEX IF NOT EXISTS node_owner_address ON node FIELDS created_by, address UNIQUE;
  -- The children of a node, which is how the graph walks down a branch.
  DEFINE INDEX IF NOT EXISTS node_owner_parent ON node FIELDS created_by, parent;
  -- A region, whole or sliced. The leading pair reads a tree, for a subtree
  -- publish and for a pulled region; a trailing AND depth <= $max bounds it to
  -- the levels around a focus, which is the read the depth column exists for.
  -- One index rather than two, because the pair is this one's prefix.
  DEFINE INDEX IF NOT EXISTS node_owner_origin_depth ON node FIELDS created_by, origin, depth;

  -- A node's stack, already in order. Leading with node rather than created_by
  -- because a reference names its owner: reading a node's blocks binds one
  -- column, not two.
  DEFINE INDEX IF NOT EXISTS block_node_ord ON block FIELDS node, ord;
  -- Which is why block needs a second index for the purge, where node does not.
  DEFINE INDEX IF NOT EXISTS block_owner ON block FIELDS created_by;

  DEFINE INDEX IF NOT EXISTS label_dimension_owner_name ON label_dimension FIELDS created_by, name UNIQUE;

  -- One live publication per subtree root. Unpublishing deletes the row, so
  -- republishing does not collide with a revoked one.
  DEFINE INDEX IF NOT EXISTS publication_owner_root ON publication FIELDS created_by, root UNIQUE;
`;

const DEFINE_TABLE = /DEFINE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/g;

/**
 * Every table `SCHEMA` defines, read out of it. Adding a table is one edit, and
 * the purge's coverage test is over this list, so a table cannot be declared
 * and left unswept.
 */
export const SLOPPY_TABLES: readonly string[] = [
  ...SCHEMA.matchAll(DEFINE_TABLE),
].map(([, table]) => table);
