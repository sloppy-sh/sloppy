// What the writing did between two versions of one publication, computed where
// the versions are. docs/ARCHITECTURE.md § "Federating the graph".

import type {
  PublishedBlock,
  PublishedNode,
  PublishedNoteChange,
  PublishedSectionChange,
} from "@sloppy/types";

/** One note as one version has it, with the stack that version froze. */
export interface SnapshotSide {
  note: PublishedNode;
  sections: PublishedBlock[];
}

/**
 * Both sides of one run of the address order, in that order. Each side is
 * sorted by address and covers the same range, so a note missing from one of
 * them is a note that version does not carry rather than one further on.
 *
 * A note whose address holds a different note in each version is one note gone
 * and another arrived, and the reader is told both.
 */
export function noteChanges(
  from: readonly SnapshotSide[],
  to: readonly SnapshotSide[],
): PublishedNoteChange[] {
  const changes: PublishedNoteChange[] = [];
  let before = 0;
  let after = 0;
  while (before < from.length || after < to.length) {
    const earlier = from[before];
    const later = to[after];
    const side =
      earlier === undefined
        ? 1
        : later === undefined
          ? -1
          : compare(earlier.note.address, later.note.address);
    if (side < 0) {
      changes.push({ change: "removed", note: earlier.note });
      before += 1;
    } else if (side > 0) {
      changes.push(arrived(later));
      after += 1;
    } else {
      changes.push(...atOneAddress(earlier, later));
      before += 1;
      after += 1;
    }
  }
  return changes;
}

/** Where the address order stops being decidable: past the lower of two windows
 *  a note's counterpart may still be unread, so nothing beyond it is compared.
 *  `undefined` where both sides are exhausted and the run is complete. */
export function comparableTo(
  from: { last?: string; more: boolean },
  to: { last?: string; more: boolean },
): string | undefined {
  if (!from.more && !to.more) return undefined;
  if (!from.more) return to.last;
  if (!to.more) return from.last;
  if (from.last === undefined || to.last === undefined) return undefined;
  return compare(from.last, to.last) <= 0 ? from.last : to.last;
}

function atOneAddress(
  earlier: SnapshotSide,
  later: SnapshotSide,
): PublishedNoteChange[] {
  if (earlier.note.ref !== later.note.ref) {
    return [{ change: "removed", note: earlier.note }, arrived(later)];
  }
  const sections = sectionChanges(earlier.sections, later.sections);
  if (sections.length === 0 && sameNote(earlier.note, later.note)) return [];
  return [
    {
      change: "changed",
      note: later.note,
      before: earlier.note,
      sections,
    },
  ];
}

/** A note that arrived carries its whole stack, every section of it added, so
 *  one render path draws it and a note that changed. */
function arrived(later: SnapshotSide): PublishedNoteChange {
  return {
    change: "added",
    note: later.note,
    sections: later.sections.map((section) => ({ change: "added", section })),
  };
}

function sectionChanges(
  from: readonly PublishedBlock[],
  to: readonly PublishedBlock[],
): PublishedSectionChange[] {
  const earlier = new Map(from.map((section) => [section.ref, section]));
  const changes: PublishedSectionChange[] = [];
  for (const section of to) {
    const before = earlier.get(section.ref);
    if (before === undefined) changes.push({ change: "added", section });
    else if (!sameSection(before, section)) {
      changes.push({ change: "changed", section, before });
    }
    earlier.delete(section.ref);
  }
  for (const section of from) {
    if (earlier.has(section.ref)) changes.push({ change: "removed", section });
  }
  return changes;
}

/**
 * Every field of the note a reader is handed, except `updated_at`: it is a
 * record of a change rather than one, and a note's look is not published at all,
 * so recolouring one would otherwise report a difference with nothing in it.
 */
function sameNote(a: PublishedNode, b: PublishedNode): boolean {
  return (
    a.address === b.address &&
    a.parent === b.parent &&
    a.origin === b.origin &&
    a.title === b.title &&
    a.created_at === b.created_at &&
    a.content_signature === b.content_signature &&
    a.signed_payload_json === b.signed_payload_json &&
    a.signing_device_public_key === b.signing_device_public_key &&
    sameList(a.tags, b.tags) &&
    sameList(a.links, b.links) &&
    sameList(a.aliases ?? [], b.aliases ?? [])
  );
}

function sameSection(a: PublishedBlock, b: PublishedBlock): boolean {
  return a.node === b.node && a.ord === b.ord && same(a.content, b.content);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((held, at) => held === b[at]);
}

/** A section's document is the editor's own, so it is compared by shape rather
 *  than by a serialization whose key order is the store's to choose. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((held, at) => same(held, b[at]));
  }
  const held = a as Record<string, unknown>;
  const against = b as Record<string, unknown>;
  const keys = Object.keys(held);
  return (
    keys.length === Object.keys(against).length &&
    keys.every((key) => key in against && same(held[key], against[key]))
  );
}

/** Lexicographic, which is the order a version's own pages are served in. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
