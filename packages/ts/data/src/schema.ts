import { HOME_GRAPH_ULID } from "@sloppy/types";
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
 * Widening the address scope from the author to one of their graphs, on a store
 * that already holds notes.
 *
 * **A UNIQUE index does not constrain a row whose indexed column is absent** —
 * measured on 3.1.3, two rows with no `graph` and one address are both accepted
 * — so leaving the home graph to be read as the absence of the column would
 * take the address rule off every note written before this. The column is
 * therefore filled in, once, and the note keeps the address, the ref and the
 * timestamps it already had.
 *
 * It is gated on the index it replaces rather than on the rows, so a store that
 * has already migrated does not scan the table on every boot, and a store
 * created after this never scans it at all. The fill runs BEFORE the field is
 * defined READONLY below, which is the only order in which it is allowed to.
 */
const MIGRATIONS = `
  LET $node_indexes = (INFO FOR TABLE node).indexes;
  IF $node_indexes.node_owner_address != NONE {
    UPDATE node SET graph = string::concat(created_by, "/${HOME_GRAPH_ULID}")
      WHERE graph = NONE;
    REMOVE INDEX node_owner_address ON node;
  };

  LET $held_indexes = (INFO FOR TABLE pulled_node).indexes;
  IF $held_indexes.pulled_node_owner_author_address != NONE {
    UPDATE pulled_node
      SET source_graph = string::concat(source_did, "/${HOME_GRAPH_ULID}")
      WHERE source_graph = NONE;
    REMOVE INDEX pulled_node_owner_author_address ON pulled_node;
  };
`;

/**
 * Tables stay SCHEMALESS; a `DEFINE FIELD` below is an invariant the database
 * has to hold itself rather than trust the application for, and everything else
 * is a plain column. docs/ARCHITECTURE.md § "Data model" says why each qualifies.
 */
export const SCHEMA = `
  DEFINE TABLE IF NOT EXISTS graph SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS block SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS publication SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS publication_version SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS snapshot_node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS snapshot_block SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS snapshot_asset SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pull SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pull_member SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pulled_node SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS pulled_block SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS comment_pointer SCHEMALESS;

${MIGRATIONS}
  DEFINE FIELD IF NOT EXISTS address ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS depth ON node TYPE int ASSERT $value > 0 READONLY;
  -- Which of its author's graphs a note is in, and so the context its address
  -- is read in. Immutable for the reason the address is: a note that moved
  -- graph would land in one where its address may already be taken, and a
  -- citation there would resolve two ways.
  DEFINE FIELD IF NOT EXISTS graph ON node TYPE option<string> READONLY;
  DEFINE FIELD IF NOT EXISTS source_graph ON pulled_node TYPE option<string> READONLY;
  DEFINE FIELD IF NOT EXISTS graph ON publication TYPE option<string> READONLY;

  DEFINE FIELD IF NOT EXISTS created_by ON graph TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON publication TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON publication_version TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON snapshot_block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON snapshot_asset TYPE string READONLY;
  -- On a held copy the owner is the READER, never the author: they are the one
  -- the purge has to reach. docs/ARCHITECTURE.md § "Federating the graph".
  DEFINE FIELD IF NOT EXISTS created_by ON pull TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON pull_member TYPE string READONLY;
  -- On a pointer the owner is the note's AUTHOR: it was left for them, and they
  -- are the one whose purge has to reach it. Whoever wrote the comment owns the
  -- comment, in their own store, and nothing here.
  DEFINE FIELD IF NOT EXISTS created_by ON comment_pointer TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS note ON comment_pointer TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS voice ON comment_pointer TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS comment_id ON comment_pointer TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_by ON pulled_block TYPE string READONLY;

  -- Which foreign row a held row is a copy of, who wrote it, and where they
  -- addressed it. Immutable for the reason created_by is: a row that changed
  -- any of them would quietly become a copy of something else.
  DEFINE FIELD IF NOT EXISTS source ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source ON pulled_block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source_did ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS address ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS depth ON pulled_node TYPE int ASSERT $value > 0 READONLY;

  -- Which region served which note. Both immutable: this row IS the pairing,
  -- so a changed half is a different pairing and a new row.
  DEFINE FIELD IF NOT EXISTS pull ON pull_member TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source ON pull_member TYPE string READONLY;

  -- What a publication is of, and which version each copy belongs to. All
  -- immutable: a publication that changed its root, or a copy that changed its
  -- version, would silently become a snapshot of something else — and a peer is
  -- reading it.
  DEFINE FIELD IF NOT EXISTS root ON publication TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS root_address ON publication TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS publication ON publication_version TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS sequence ON publication_version TYPE int ASSERT $value > 0 READONLY;
  DEFINE FIELD IF NOT EXISTS version ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS address ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS version ON snapshot_block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source ON snapshot_block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS node ON snapshot_block TYPE string READONLY;

  -- The two halves of a copied asset, immutable: a copy that pointed at a
  -- different original would take the wrong bytes public, and one whose public
  -- half changed would strand the address a peer already holds.
  DEFINE FIELD IF NOT EXISTS publication ON snapshot_asset TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS source_upload ON snapshot_asset TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS public_upload ON snapshot_asset TYPE string READONLY;

  -- Which publication a held copy is of. Immutable for the reason a held note's
  -- source is: a row that changed it would be a copy of something else.
  DEFINE FIELD IF NOT EXISTS publication ON pull TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS created_at ON graph TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON publication TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON publication_version TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON snapshot_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON snapshot_block TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON snapshot_asset TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pull TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pull_member TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pulled_node TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON pulled_block TYPE string READONLY;

  DEFINE FIELD IF NOT EXISTS updated_at ON graph TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON block TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON publication TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON publication_version TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON snapshot_node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON snapshot_block TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON snapshot_asset TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pull TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pull_member TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pulled_node TYPE string;
  DEFINE FIELD IF NOT EXISTS updated_at ON pulled_block TYPE string;

  -- Every indexed column is a TOP-LEVEL STRING or an array of them, including
  -- the ones that point at another row: a composite record id is a row's own key
  -- and never another row's column. docs/ARCHITECTURE.md § "Data model" says
  -- why, and why most of these lead with created_by.

  REMOVE INDEX IF EXISTS node_owner_parent ON node;

  -- UNIQUE is the address protocol, enforced: one address per graph, so a
  -- second row claiming a taken address fails at write rather than becoming a
  -- citation that resolves two ways INSIDE the graph it is read in. Across two
  -- graphs an address is two labels, and what tells those apart is the ref.
  DEFINE INDEX IF NOT EXISTS node_owner_graph_address ON node FIELDS created_by, graph, address UNIQUE;
  -- The children of a node, and — bound to NONE — the branches one graph opens.
  DEFINE INDEX IF NOT EXISTS node_owner_graph_parent ON node FIELDS created_by, graph, parent;
  -- Somebody's graphs, which is also the purge's reach.
  DEFINE INDEX IF NOT EXISTS graph_owner ON graph FIELDS created_by;
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

  -- One publication per subtree root. Publishing that root again writes another
  -- version of this one rather than a second chain beside it.
  DEFINE INDEX IF NOT EXISTS publication_owner_root ON publication FIELDS created_by, root UNIQUE;

  -- A publication's chain, in order, and one number per version: two published
  -- in the same moment cannot share a place in the history.
  DEFINE INDEX IF NOT EXISTS publication_version_owner_publication_sequence ON publication_version FIELDS created_by, publication, sequence UNIQUE;

  -- The address protocol inside one version: one note per address, which is
  -- also the order a version is served and paged in, parents before children.
  DEFINE INDEX IF NOT EXISTS snapshot_node_owner_version_address ON snapshot_node FIELDS created_by, version, address UNIQUE;
  -- One copy of a note per version, and the seek a difference between two
  -- versions makes over and over.
  DEFINE INDEX IF NOT EXISTS snapshot_node_owner_version_source ON snapshot_node FIELDS created_by, version, source UNIQUE;
  -- Every version carrying one note, which is what a note's published mark is
  -- maintained from when a publication goes. Read it PINNED —
  -- FROM snapshot_node WITH INDEX snapshot_node_owner_source — because an
  -- ORDER BY over the versions sends the planner to the index above, which
  -- matches the ordering and then filters across everything its owner has ever
  -- published. Wrong only in cost, unlike node_tags, and the cost grows with
  -- the graph.
  DEFINE INDEX IF NOT EXISTS snapshot_node_owner_source ON snapshot_node FIELDS created_by, source;

  -- A note's stack inside one version, already in order. The leading pair also
  -- reaches everything a version takes with it when it goes.
  DEFINE INDEX IF NOT EXISTS snapshot_block_owner_version_node_ord ON snapshot_block FIELDS created_by, version, node, ord;
  DEFINE INDEX IF NOT EXISTS snapshot_block_owner_version_source ON snapshot_block FIELDS created_by, version, source UNIQUE;

  -- One copy per asset per publication, so a second version citing the same
  -- picture reuses the copy rather than sending the same bytes public again
  -- under a new address. The leading pair is also the cascade when the
  -- publication is deleted.
  DEFINE INDEX IF NOT EXISTS snapshot_asset_owner_publication_source ON snapshot_asset FIELDS created_by, publication, source_upload UNIQUE;

  -- One held copy of a publication per reader, so pulling again refreshes the
  -- copy rather than growing a second one beside it.
  DEFINE INDEX IF NOT EXISTS pull_owner_publication ON pull FIELDS created_by, publication UNIQUE;

  -- What the reader holds of ONE author, sliced the way node_owner_origin_depth
  -- slices their own graph: the leading pair reads it, a trailing
  -- AND depth <= $max bounds it. The author stands where origin does, because a
  -- region is not a column here — pull_member below is which regions served a
  -- note.
  DEFINE INDEX IF NOT EXISTS pulled_node_owner_author_depth ON pulled_node FIELDS created_by, source_did, depth;
  -- One copy per foreign node however many regions serve it.
  DEFINE INDEX IF NOT EXISTS pulled_node_owner_source ON pulled_node FIELDS created_by, source UNIQUE;
  -- Leaving the same pointer twice is the same pointer, so a repeat deposit is
  -- idempotent rather than a second row.
  DEFINE INDEX IF NOT EXISTS comment_pointer_owner_voice_comment ON comment_pointer FIELDS created_by, voice, comment_id UNIQUE;
  -- What a note's author reads, and what the per-voice bound is counted over.
  DEFINE INDEX IF NOT EXISTS comment_pointer_owner_note_voice ON comment_pointer FIELDS created_by, note, voice;
  -- The address protocol on rows a peer handed us, at the scope it now has: one
  -- address per author's GRAPH, so a reader may hold the 1a of each notebook a
  -- person keeps and still resolve a citation into one of them. It is also how
  -- a held note is reached by the address a reader cites.
  DEFINE INDEX IF NOT EXISTS pulled_node_owner_author_graph_address ON pulled_node FIELDS created_by, source_did, source_graph, address UNIQUE;

  -- Which notes a region served, and which regions still serve a note: the
  -- first is how a refresh finds what to drop, the second is what stops a drop
  -- taking a note another region shares.
  DEFINE INDEX IF NOT EXISTS pull_member_owner_pull_source ON pull_member FIELDS created_by, pull, source UNIQUE;
  DEFINE INDEX IF NOT EXISTS pull_member_owner_source ON pull_member FIELDS created_by, source;

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
