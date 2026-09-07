import {
  type Address,
  childAddress,
  compareAddresses,
  parentAddress,
  rebaseAddress,
  siblingAddress,
} from "@sloppy/types";

/**
 * The address a new child of `parent` takes, given every address its siblings
 * already hold. `null` names a new root.
 *
 * Pure and total over its arguments, which is what makes assignment
 * reproducible on another peer — AI.md § "The Address Is the Protocol".
 *
 * The next sibling follows the GREATEST address in the run rather than the
 * first gap in it, so removing a node from the middle does not hand its address
 * to a later one.
 *
 * `siblings` may carry addresses from another run: the rows an address is spent
 * on are read by the parent it hung under, and a move gives that parent a
 * different address. Those are dropped rather than followed — they are spent
 * under an address no note is at, and nothing will be written there again.
 */
export function nextChildAddress(
  parent: Address | null,
  siblings: readonly Address[],
): Address {
  const run = siblings.filter((address) => parentAddress(address) === parent);
  if (run.length === 0) return childAddress(parent);
  const greatest = run.reduce((a, b) => (compareAddresses(a, b) >= 0 ? a : b));
  return siblingAddress(greatest);
}

/**
 * Where a moved note and everything beneath it land: the address each one is at
 * now, mapped to the address it takes. `parent` and `siblings` are the run it
 * joins, read exactly as {@link nextChildAddress} reads one — the moved note's
 * own address among the siblings where it is already in that run, which is what
 * sends it to the end rather than back to where it was.
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
    landing.set(address, rebaseAddress(moved, now, address));
  }
  return landing;
}
