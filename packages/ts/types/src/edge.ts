// The lines drawn between two notes. DESIGN.md § Edges is the doc of record for
// how each one is drawn and what it says.

/**
 * Every kind of line, strongest first — the order is the ruling: a pair several
 * of these are true of draws one line, and it is the earliest of them here.
 * `genealogy` and `run` fall out of the addresses; `reference` is a note's own
 * writing naming another, and `link` is one somebody drew by hand.
 */
export const EDGE_KINDS = ["reference", "link", "run", "genealogy"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** The one line a pair draws where both of these are true of it. */
export function strongestEdge(a: EdgeKind, b: EdgeKind): EdgeKind {
  return EDGE_KINDS.indexOf(a) <= EDGE_KINDS.indexOf(b) ? a : b;
}

/** A line somebody made on purpose, either way of making one. It is the kind
 *  that takes a pair's line without taking the distance the addresses set it
 *  at — DESIGN.md § Edges. */
export function isConnection(kind: EdgeKind): boolean {
  return kind === "reference" || kind === "link";
}
