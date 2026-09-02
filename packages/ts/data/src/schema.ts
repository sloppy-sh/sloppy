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
  DEFINE TABLE IF NOT EXISTS published_picture SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pull SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pulled_node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pulled_block SCHEMALESS;

  DEFINE FIELD IF NOT EXISTS address ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS depth ON node TYPE int ASSERT $value > 0 READONLY;

  DEFINE FIELD IF NOT EXISTS created_by ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON publication TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON published_picture TYPE string READONLY;
  -- On a held copy the owner is the READER, never the author: they are the one
  -- the purge has to reach. docs/ARCHITECTURE.md § "Federating the graph".
  DEFINE FIELD IF NOT EXISTS created_by ON pull TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON pulled_block TYPE string READONLY;

  -- Which foreign row a held row is a copy of, and who wrote it. Immutable for
  -- the reason created_by is: a row that changed either would quietly become a
  -- copy of something else. Which REGIONS hold it is not here at all — that is
  -- derived from the address, § "Federating the graph".
  DEFINE FIELD IF NOT EXISTS source ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source ON pulled_block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source_did ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS depth ON pulled_node TYPE int ASSERT $value > 0 READONLY;

  -- The two halves of a published picture, immutable: a copy that pointed at a
  -- different original would take the wrong bytes public, and one whose public
  -- half changed would strand the address a peer already holds.
  DEFINE FIELD IF NOT EXISTS source_upload ON published_picture TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS public_upload ON published_picture TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS created_at ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON publication TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON published_picture TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pull TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pulled_block TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS updated_at ON node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON block TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON publication TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON published_picture TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pull TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pulled_node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pulled_block TYPE string;

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

  -- One public copy per picture, so a second publish reuses the first copy
  -- rather than sending the same bytes public again under a new address.
  DEFINE INDEX IF NOT EXISTS published_picture_owner_source ON published_picture FIELDS created_by, source_upload UNIQUE;

  -- One held copy of a region per reader, so pulling again refreshes the copy
  -- rather than growing a second one beside it.
  DEFINE INDEX IF NOT EXISTS pull_owner_source_root ON pull FIELDS created_by, source_did, root_address UNIQUE;

  -- What the reader holds of ONE author, sliced the way node_owner_origin_depth
  -- slices their own graph: the leading pair reads it, a trailing
  -- AND depth <= $max bounds it. The author stands where origin does: a held
  -- node is not indexed by region, because no column says which regions cover
  -- one.
  DEFINE INDEX IF NOT EXISTS pulled_node_owner_author_depth ON pulled_node FIELDS created_by, source_did, depth;
  -- One copy per foreign node however many regions cover it.
  DEFINE INDEX IF NOT EXISTS pulled_node_owner_source ON pulled_node FIELDS created_by, source UNIQUE;

  -- A held node's stack, already in order. Leading with created_by rather than
  -- node, unlike block: a held block's node names its AUTHOR, so the reader is
  -- a column here rather than half of the reference. It is also how dropping a
  -- region reaches the blocks of the nodes it takes with it.
  DEFINE INDEX IF NOT EXISTS pulled_block_owner_node_ord ON pulled_block FIELDS created_by, node, ord;
  DEFINE INDEX IF NOT EXISTS pulled_block_owner_source ON pulled_block FIELDS created_by, source UNIQUE;
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
