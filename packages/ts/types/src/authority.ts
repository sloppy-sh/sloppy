// What a write by one identity on one note in one graph does — the one
// function every surface asks, and the one place a graph's policy meets the
// note's own gate. docs/ARCHITECTURE.md § "Who may write where".

import type { Principal } from "./common.js";
import type { Graph } from "./graph.js";
import { type Node, authorsOf, writeOutcome } from "./node.js";
import {
  DEFAULT_PERMISSIONS,
  Permissions,
  hasPermission,
} from "./permission.js";
import type { VouchState } from "./vouch.js";

/**
 * What a write comes to. `lands` and `offered` are the note's own rule;
 * `refused` is a graph that does not take this write at all, and is reachable
 * only where somebody has written a policy on the graph or asked its writers to
 * be vouched.
 */
export type WriteVerdict = "lands" | "offered" | "refused";

export interface WriteDecision {
  readonly verdict: WriteVerdict;
  /** Whether this write appends the writer to the note's `authors`. False on
   *  any verdict but `lands`. */
  readonly coAuthors: boolean;
}

/**
 * What one act of writing came to, as the writer reports it: onto the note, or
 * standing as an offer on it. It is the verdict above once the write has
 * happened — `lands` says a write may, `written` says one did, and a note
 * nobody had written in yet is `written` rather than landed on.
 */
export const WRITE_DONE = ["written", "offered"] as const;
export type WriteDone = (typeof WRITE_DONE)[number];

export interface WriteDecisionInput {
  readonly note: Pick<Node, "created_by" | "owner" | "authors">;
  readonly writer: Principal;
  /** The graph the note is in. */
  readonly graph: Pick<Graph, "created_by" | "vouching">;
  /**
   * What the cascade folded for this writer at this note, and
   * {@link DEFAULT_PERMISSIONS} for a graph with no policy written on it —
   * which is what folding no roles and no overrides comes to.
   */
  readonly permissions: bigint;
  /** What resolving the writer answered, and `unknown` where nobody asked. */
  readonly vouch: VouchState;
}

const REFUSED: WriteDecision = { verdict: "refused", coAuthors: false };
const OFFERED: WriteDecision = { verdict: "offered", coAuthors: false };

/** Whether this note already carries this identity's writing. */
function carries(
  note: Pick<Node, "created_by" | "owner" | "authors">,
  writer: Principal,
): boolean {
  return note.owner === writer || authorsOf(note).includes(writer);
}

/** What a write by `writer` on `note` comes to, given what its graph says. */
export function writeDecision(input: WriteDecisionInput): WriteDecision {
  const { note, writer, graph, permissions, vouch } = input;

  const offers = hasPermission(permissions, Permissions.OFFER_CHANGE);

  // A graph's own owner is never held to its vouching: an identity minted on a
  // device is anonymous, and asking to be vouched must not shut its author out
  // of the graph they are asking it for.
  if (graph.vouching === "required" && graph.created_by !== writer) {
    if (vouch === "anonymous") return REFUSED;
    // Nothing answered, so nothing is taken from a writer this note already
    // carries and nothing is given to anybody else.
    if (vouch === "unknown" && !carries(note, writer)) {
      return offers ? OFFERED : REFUSED;
    }
  }

  if (writeOutcome(note, writer) === "offered") {
    return offers ? OFFERED : REFUSED;
  }

  // An owned note's authorship is its owner's, so a landed write on one adds
  // nobody — `withAuthor` is the rule, and this is what it comes to.
  const coAuthors =
    note.owner === undefined && !authorsOf(note).includes(writer);
  const writes =
    hasPermission(permissions, Permissions.WRITE_NOTES) &&
    (!coAuthors || hasPermission(permissions, Permissions.CO_AUTHOR));
  if (!writes) return offers ? OFFERED : REFUSED;

  return { verdict: "lands", coAuthors };
}
