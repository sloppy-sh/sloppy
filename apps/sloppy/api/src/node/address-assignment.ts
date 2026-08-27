import {
  type Address,
  childAddress,
  compareAddresses,
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
 */
export function nextChildAddress(
  parent: Address | null,
  siblings: readonly Address[],
): Address {
  if (siblings.length === 0) return childAddress(parent);
  const greatest = siblings.reduce((a, b) =>
    compareAddresses(a, b) >= 0 ? a : b,
  );
  return siblingAddress(greatest);
}
