// What a note's own writing names, derived from its stack.
// docs/ARCHITECTURE.md § "Data model".

import {
  type Block,
  type BlockDocument,
  citedNotes,
  type OwnedRef,
} from "@sloppy/types";

/**
 * The notes a stack names, in `ord` order and without repeats — so re-deriving
 * an unchanged note produces the array it already holds. The note itself is
 * left out: a line from a mark back to itself says nothing a reader can use.
 */
export function referencesOf(
  node: OwnedRef,
  stack: readonly Block[],
): OwnedRef[] {
  const named = new Set<OwnedRef>();
  for (const block of stack) {
    for (const cited of citedNotes(block.content)) {
      if (cited !== node) named.add(cited);
    }
  }
  return [...named];
}

/**
 * Whether writing `after` where `before` stood could have moved the NOTE's
 * references; `null` is a section that was not there. A section naming the same
 * notes in the same order cannot have, and asking here is what spares an
 * ordinary save a read of the whole stack — every drawing in it included.
 */
export function citationsMoved(
  before: BlockDocument | null,
  after: BlockDocument | null,
): boolean {
  const named = (of: BlockDocument | null) =>
    of === null ? [] : citedNotes(of);
  return !sameRefs(named(before), named(after));
}

/** Whether a row already holds this derivation. Absent is a note nothing has
 *  derived them for, which is not the same row as one derived to none. */
export function alreadyDerived(
  held: readonly OwnedRef[] | undefined,
  derived: readonly OwnedRef[],
): boolean {
  return held !== undefined && sameRefs(held, derived);
}

function sameRefs(a: readonly OwnedRef[], b: readonly OwnedRef[]): boolean {
  return a.length === b.length && a.every((ref, at) => ref === b[at]);
}
