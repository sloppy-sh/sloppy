// What the writing did between two versions of one publication, computed where
// the versions are. docs/ARCHITECTURE.md § "Federating the graph".

import type {
  PublishedBlock,
  PublishedNode,
  PublishedNoteChange,
  PublishedSectionChange,
} from "@sloppy/types";

/** One note as one version has it, with the stack that version froze and the
 *  place that version gives it. */
export interface SnapshotSide {
  ord: string;
  note: PublishedNode;
  sections: PublishedBlock[];
}

/** One change with the place a page cuts it at: the later version's, or the
 *  earlier one's for a note that is gone. */
export interface OrderedChange {
  ord: string;
  change: PublishedNoteChange;
}

/**
 * What became of each note between two runs of one publication, in the order
 * the versions themselves are read in. Each side covers the same range of that
 * order, so a note missing from one of them is a note that version does not
 * carry rather than one further on — except for a note whose place has moved,
 * whose two rows can be a page apart and which the caller hands to this side by
 * side.
 *
 * A place holding a different note in each version is one note gone and another
 * arrived, and the reader is told both.
 */
export function noteChanges(
  from: readonly SnapshotSide[],
  to: readonly SnapshotSide[],
): OrderedChange[] {
  const earlier = new Map(from.map((side) => [side.note.ref, side]));
  const later = new Map(to.map((side) => [side.note.ref, side]));
  const changes: OrderedChange[] = [];
  for (const side of from) {
    if (!later.has(side.note.ref)) {
      changes.push({
        ord: side.ord,
        change: { change: "removed", note: side.note },
      });
    }
  }
  for (const side of to) {
    const before = earlier.get(side.note.ref);
    if (before === undefined) {
      changes.push({ ord: side.ord, change: arrived(side) });
      continue;
    }
    const sections = sectionChanges(before.sections, side.sections);
    if (sections.length === 0 && sameNote(before.note, side.note)) continue;
    changes.push({
      ord: side.ord,
      change: {
        change: "changed",
        note: side.note,
        before: before.note,
        sections,
      },
    });
  }
  // Stable, so the note gone from a place the other version reuses stays ahead
  // of the one that arrived there.
  return changes.sort((a, b) => compare(a.ord, b.ord));
}

/** Where the order stops being decidable: past the lower of two windows a
 *  note's counterpart may still be unread, so nothing beyond it is compared.
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
 * Every field of the note a reader is handed, except `updated_at`, which is a
 * record of a change rather than one. What a person set on the MARK is not
 * published, so recolouring a note reports nothing.
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
    sameList(a.aliases ?? [], b.aliases ?? []) &&
    same(a.edges ?? [], b.edges ?? [])
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

/** As a string, which is the order a version's own pages are served in. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
