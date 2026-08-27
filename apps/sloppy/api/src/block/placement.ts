import type { OwnedRef } from "@sloppy/types";
import { orderKeyBetween } from "./fractional-index";

/** A block's place in a stack, as much of it as placing another one needs. */
export interface Placed {
  ref: OwnedRef;
  ord: string;
}

export class UnknownNeighbourError extends Error {
  constructor(ref: OwnedRef) {
    super(`No block ${ref} in this stack`);
    this.name = "UnknownNeighbourError";
  }
}

/**
 * The `ord` for a block landing after `after`, or at the top when it is `null`.
 * `stack` is the node's blocks in order, WITHOUT the block being placed — a
 * move reads its own destination from the stack it is leaving.
 */
export function ordAfter(
  stack: readonly Placed[],
  after: OwnedRef | null,
): string {
  if (after === null) return orderKeyBetween(null, stack[0]?.ord ?? null);
  const at = stack.findIndex((block) => block.ref === after);
  if (at < 0) throw new UnknownNeighbourError(after);
  return orderKeyBetween(stack[at].ord, stack[at + 1]?.ord ?? null);
}
