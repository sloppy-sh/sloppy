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
 * Tables stay SCHEMALESS, and `DEFINE FIELD` is spent only where the database
 * has to enforce something the application cannot be trusted to. Three things
 * qualify:
 *
 *   - `address` — the protocol claim. A peer somewhere is holding it, so an
 *     UPDATE that rewrites one is not a data change, it is a broken citation in
 *     somebody else's graph. `VALUE $before OR $value` keeps the value the row
 *     was created with; on create `$before` is NONE, so the new value lands.
 *   - `created_by` — the purge deletes by this column, so a row that could
 *     change owner could walk out of its owner's deletion.
 *   - `created_at` / `updated_at` — `TYPE string` is what leaves the ISO-8601
 *     of `TimestampSchema` as the only encoding a timestamp can have here: a
 *     branch that reaches for `time::now()` fails on its own first write rather
 *     than on somebody else's first read. `created_at` is immutable too, being
 *     a field of the signed node payload.
 *
 * Everything else is a plain column, which is what lets a later track add a
 * field without editing this shared literal.
 */
export const SCHEMA = `
  DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS block SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS label_dimension SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS publication SCHEMALESS;

  DEFINE FIELD IF NOT EXISTS address ON node TYPE string VALUE $before OR $value;

  DEFINE FIELD IF NOT EXISTS created_by ON node TYPE string VALUE $before OR $value;
  DEFINE FIELD IF NOT EXISTS created_by ON block TYPE string VALUE $before OR $value;
  DEFINE FIELD IF NOT EXISTS created_by ON label_dimension TYPE string VALUE $before OR $value;
  DEFINE FIELD IF NOT EXISTS created_by ON publication TYPE string VALUE $before OR $value;

  DEFINE FIELD IF NOT EXISTS created_at ON node TYPE string VALUE $before OR $value;
  DEFINE FIELD IF NOT EXISTS created_at ON block TYPE string VALUE $before OR $value;
  DEFINE FIELD IF NOT EXISTS created_at ON label_dimension TYPE string VALUE $before OR $value;
  DEFINE FIELD IF NOT EXISTS created_at ON publication TYPE string VALUE $before OR $value;

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
  -- A whole tree at once, for a subtree publish and for a pulled region.
  DEFINE INDEX IF NOT EXISTS node_owner_origin ON node FIELDS created_by, origin;

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
