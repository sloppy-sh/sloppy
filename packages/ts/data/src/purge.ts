/**
 * Erasing one person's graph. Every statement binds `$did`, their syr DID, and
 * deletes BY `created_by` rather than by walking down from a parent row;
 * docs/ARCHITECTURE.md § "Data model" says why that is the only safe sweep.
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
  `DELETE publication WHERE ${OWNED};`,
  `DELETE node WHERE ${OWNED};`,
  `DELETE label_dimension WHERE ${OWNED};`,
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
  "publication",
  "node",
  "label_dimension",
]);
