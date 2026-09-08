import {
  type Address,
  isAncestorAddress,
  nextChildAddress,
  rebaseAddress,
} from "@sloppy/types";

/**
 * Where a moved note and everything beneath it land: the address each one is at
 * now, mapped to the address it takes. `parent` and `siblings` are the run it
 * joins, read exactly as {@link nextChildAddress} reads one — the moved note's
 * own address among the siblings where it is already in that run, which is what
 * sends it to the end rather than back to where it was.
 *
 * A note beneath whose label its author wrote from outside the moved note's run
 * is absent from the answer: it is that person's label on that note, and a move
 * of the note above it is not them changing it.
 */
export function movedSubtree(
  parent: Address | null,
  siblings: readonly Address[],
  moved: Address,
  beneath: readonly Address[],
): Map<Address, Address> {
  const now = nextChildAddress(parent, siblings);
  const landing = new Map<Address, Address>([[moved, now]]);
  for (const address of beneath) {
    if (!isAncestorAddress(moved, address)) continue;
    landing.set(address, rebaseAddress(moved, now, address));
  }
  return landing;
}
