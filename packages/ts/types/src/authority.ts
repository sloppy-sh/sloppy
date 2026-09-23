// What a write by one identity on one note in one graph does — the one
// function every surface asks, and the one place a graph's policy meets the
// note's own gate. docs/ARCHITECTURE.md § "Who may write where".

import type { DidSyr } from "./common.js";
import type { Graph } from "./graph.js";
import { type Node, authorsOf, writeOutcome } from "./node.js";
import { Permissions, hasPermission } from "./permission.js";
import type { VouchState } from "./vouch.js";

/**
 * What a write comes to. `lands` and `offered` are the note's own rule;
 * `refused` is a graph that does not take this write at all, and is reachable
 * only where somebody has written a policy on the graph.
 */
export type WriteVerdict = "lands" | "offered" | "refused";

export interface WriteDecision {
  readonly verdict: WriteVerdict;
  /** Whether this write appends the writer to the note's `authors`. False on
   *  any verdict but `lands`. */
  readonly coAuthors: boolean;
}

export interface WriteDecisionInput {
  readonly note: Pick<Node, "created_by" | "owner" | "authors">;
  readonly writer: DidSyr;
  /** The graph the note is in. **Absent asks nobody to be vouched**, which is
   *  every graph written before a graph could ask. */
  readonly graph?: Pick<Graph, "created_by" | "vouching">;
  /**
   * What the cascade folded for this writer at this note.
   *
   * **Absent is a graph with no policy written on it** — no roles and no
   * overrides — and no bit is read: the note's own gate decides alone, exactly
   * as it did before roles existed. `hasPolicy` in `permission.ts` is what a
   * caller asks before folding.
   */
  readonly permissions?: bigint;
  /** Whether anybody stands behind the writer. **Absent reads as `unknown`**:
   *  nobody asked, and nobody is told they lost anything for it. */
  readonly vouch?: VouchState;
}

const REFUSED: WriteDecision = { verdict: "refused", coAuthors: false };
const OFFERED: WriteDecision = { verdict: "offered", coAuthors: false };

function may(permissions: bigint | undefined, flag: bigint): boolean {
  return permissions === undefined || hasPermission(permissions, flag);
}

/** What a write by `writer` on `note` comes to, given what its graph says. */
export function writeDecision(input: WriteDecisionInput): WriteDecision {
  const { note, writer, graph, permissions, vouch } = input;

  // A graph's own owner is never held to its vouching: an identity minted on a
  // device is anonymous, and asking to be vouched must not shut its author out
  // of the graph they are asking it for.
  const asksVouching =
    graph?.vouching === "required" && graph.created_by !== writer;
  if (asksVouching && vouch === "anonymous") return REFUSED;

  const offers = may(permissions, Permissions.OFFER_CHANGE);

  if (writeOutcome(note, writer) === "offered") {
    return offers ? OFFERED : REFUSED;
  }

  // An owned note's authorship is its owner's, so a landed write on one adds
  // nobody — `withAuthor` is the rule, and this is what it comes to.
  const coAuthors =
    note.owner === undefined && !authorsOf(note).includes(writer);
  const writes =
    may(permissions, Permissions.WRITE_NOTES) &&
    (!coAuthors || may(permissions, Permissions.CO_AUTHOR));
  if (!writes) return offers ? OFFERED : REFUSED;

  return { verdict: "lands", coAuthors };
}
