/**
 * Erasing one person's graph. Every statement binds `$did`, their syr DID, and
 * deletes BY `created_by` rather than by walking down from a parent row;
 * docs/ARCHITECTURE.md § "Data model" says why that is the only safe sweep. The
 * one column that is not `created_by` is `amendment.by`, and the statement that
 * reads it says why.
 *
 * Caller-owned and deliberately NOT here:
 *
 *   - Blobs. Block images and ink rasters live in syr, which erases them with
 *     the identity; Sloppy holds only the ids.
 *   - Links other people's nodes hold into this one's. They are cross-owner, so
 *     purging them would edit rows this person does not own. Resolving a link
 *     must therefore tolerate a missing target — a dangling link is a normal
 *     state of the graph, not corruption.
 */

const OWNED = `created_by = $did`;

export const STATEMENTS: readonly string[] = [
  // Interiors first, then what points at a node, then the nodes, so nothing
  // referencing a row outlives it even if a statement fails partway.
  `DELETE block WHERE ${OWNED};`,
  `DELETE snapshot_block WHERE ${OWNED};`,
  `DELETE snapshot_node WHERE ${OWNED};`,
  `DELETE snapshot_asset WHERE ${OWNED};`,
  `DELETE publication_version WHERE ${OWNED};`,
  `DELETE publication WHERE ${OWNED};`,
  // Left ON this person's notes by other people, and theirs for the same reason
  // the notes are: they are the one it was left for.
  `DELETE comment_pointer WHERE ${OWNED};`,
  // Written by this person about somebody else's voice, so it goes with them
  // and reaches nothing of the voice's own.
  `DELETE refused_voice WHERE ${OWNED};`,
  // Offered ON this person's notes by other people, and theirs for the reason
  // the pointers above are: the notes are in their graph.
  `DELETE amendment WHERE ${OWNED};`,
  // And what this person offered on somebody ELSE's notes, which is the one
  // sweep here that does not go by the owner of the rows: an offer is writing,
  // so it goes with the person who wrote it rather than standing on a note
  // after the identity behind it is gone.
  `DELETE amendment WHERE by = $did;`,
  `DELETE node WHERE ${OWNED};`,
  // The addresses those notes spent, and the ones a move left resolving to
  // them. They outlive the notes and nothing else: there is no graph left for
  // one to be read in.
  `DELETE retired_address WHERE ${OWNED};`,
  `DELETE node_alias WHERE ${OWNED};`,
  // After the notes, because a graph is what they name.
  `DELETE graph WHERE ${OWNED};`,
  // A held copy of somebody else's region is the reader's row, so it goes with
  // the reader — the author erasing their own identity elsewhere never reaches
  // it, which is the same fact the product states about unpublishing.
  `DELETE pull_member WHERE ${OWNED};`,
  `DELETE pulled_block WHERE ${OWNED};`,
  `DELETE pulled_node WHERE ${OWNED};`,
  `DELETE pull WHERE ${OWNED};`,
];

/** The `$did`-parameterized statements, ready to join into one `query()`. */
export function userPurgeStatements(): string[] {
  return [...STATEMENTS];
}

/**
 * Every table the statements above touch. A caller that registers tables of its
 * own reads this to find the ones still needing a sweep — a table absent from
 * here is a table nobody deletes.
 */
export const USER_PURGE_TABLES: ReadonlySet<string> = new Set([
  "block",
  "snapshot_block",
  "snapshot_node",
  "snapshot_asset",
  "publication_version",
  "publication",
  "node",
  "retired_address",
  "node_alias",
  "graph",
  "comment_pointer",
  "refused_voice",
  "amendment",
  "pull_member",
  "pulled_block",
  "pulled_node",
  "pull",
]);
