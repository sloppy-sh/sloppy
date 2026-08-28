import type { Surreal } from "surrealdb";

/**
 * Sloppy's tables and indexes. Idempotent, so it is safe on every boot, and it
 * runs unchanged against the server and the native app's embedded engine.
 * AI.md § "The foundation wave" is why it is one literal, run every boot.
 */
export async function defineCoreSchema(db: Surreal): Promise<void> {
  await db.query(SCHEMA);
}

/**
 * Tables stay SCHEMALESS; a `DEFINE FIELD` below is an invariant the database
 * has to hold itself rather than trust the application for, and everything else
 * is a plain column. docs/ARCHITECTURE.md § "Data model" says why each qualifies.
 */
export const SCHEMA = `
  DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS block SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS publication SCHEMALESS;

  DEFINE FIELD IF NOT EXISTS address ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS depth ON node TYPE int ASSERT $value > 0 READONLY;

  DEFINE FIELD IF NOT EXISTS created_by ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON publication TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS created_at ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON publication TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS updated_at ON node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON block TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON publication TYPE string;

  -- Every indexed column is a TOP-LEVEL STRING or an array of them, including
  -- the ones that point at another row: a composite record id is a row's own key
  -- and never another row's column. docs/ARCHITECTURE.md § "Data model" says
  -- why, and why most of these lead with created_by.

  -- UNIQUE is the address protocol, enforced: one address per author, so a
  -- second row claiming a taken address fails at write rather than becoming a
  -- citation that resolves two ways.
  DEFINE INDEX IF NOT EXISTS node_owner_address ON node FIELDS created_by, address UNIQUE;
  -- The children of a node, which is how the graph walks down a branch.
  DEFINE INDEX IF NOT EXISTS node_owner_parent ON node FIELDS created_by, parent;
  -- A region, whole or sliced: the leading pair reads a tree, and a trailing
  -- AND depth <= $max bounds it to the levels around a focus. One index rather
  -- than two, because the pair is this one's prefix.
  DEFINE INDEX IF NOT EXISTS node_owner_origin_depth ON node FIELDS created_by, origin, depth;

  -- A node's stack, already in order. Leading with node rather than created_by
  -- because a reference names its owner: reading a node's blocks binds one
  -- column, not two.
  DEFINE INDEX IF NOT EXISTS block_node_ord ON block FIELDS node, ord;
  -- Which is why block needs a second index for the purge, where node does not.
  DEFINE INDEX IF NOT EXISTS block_owner ON block FIELDS created_by;

  -- Every note carrying a tag. One entry per element, so an equality on tags
  -- is a membership seek rather than a scan of everything the owner has
  -- written.
  --
  -- Read it PINNED: FROM node WITH INDEX node_tags WHERE tags = $tag AND
  -- created_by = $did. Measured on 3.1.3, that equality is membership only
  -- while this index answers it and plain array equality otherwise, so an
  -- unpinned read the planner hands to another index (an ORDER BY is enough)
  -- returns ZERO rows and no error. Two columns over an array column fail the
  -- same silent way, which is why created_by does not lead here.
  DEFINE INDEX IF NOT EXISTS node_tags ON node FIELDS tags;

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
