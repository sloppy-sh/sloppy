// What a person did between two states of a graph —
// docs/ARCHITECTURE.md § "The vault's history".

import type { Address, OwnedRef } from "@sloppy/types";
import {
  decodeText,
  inkAt,
  noteAt,
  PICTURES_FILE,
  type PictureSize,
  readPicturesFile,
  uploadAt,
  type Vault,
} from "./layout.js";
import { type VaultNote, vaultToNote } from "./note.js";

/** Absent on either side is no parent at all — a branch, or an independent
 *  note. */
export interface NoteMoved {
  ref: OwnedRef;
  from?: OwnedRef;
  to?: OwnedRef;
}

export interface NoteRetitled {
  ref: OwnedRef;
  from: string;
  to: string;
}

/** Absent on either side is a note with no address, which is an ordinary
 *  note. */
export interface NoteRenumbered {
  ref: OwnedRef;
  from?: Address;
  to?: Address;
}

/** The sections of one note, by their own ULIDs. `reordered` is the sections
 *  both states hold standing in a different order, which is a person moving a
 *  section rather than writing in one. */
export interface SectionsChanged {
  added: string[];
  removed: string[];
  changed: string[];
  reordered: boolean;
}

export interface NoteChanged {
  ref: OwnedRef;
  sections: SectionsChanged;
}

/**
 * What changed, keyed by ref and never by address. Every list is in a settled
 * order — refs and ULIDs sorted — so reading one pair twice is one answer.
 *
 * A note appears in as many of these as it has to: one moved under another
 * parent and written into is in `moved` and in `changed` both. What is NOT
 * here is what nothing in the enumeration names — a note whose tags, links or
 * look alone changed is not in any of these lists.
 */
export interface VaultDifference {
  notes: {
    added: OwnedRef[];
    removed: OwnedRef[];
    moved: NoteMoved[];
    retitled: NoteRetitled[];
    renumbered: NoteRenumbered[];
    changed: NoteChanged[];
  };
  /** The pictures the vault holds, by upload id. */
  media: { added: string[]; removed: string[] };
}

/**
 * What `b` has that `a` does not, note by note and section by section, read
 * out of the two vaults themselves — never out of a text diff, because a line
 * of a note's file is not a thing anybody wrote.
 *
 * A file under `notes/` that is not a note is left alone on both sides, the way
 * a folder somebody keeps their own files in is.
 */
export function vaultDifference(a: Vault, b: Vault): VaultDifference {
  const before = notesOf(a);
  const after = notesOf(b);
  const both = [...before.keys()].filter((ref) => after.has(ref)).sort();
  const moved: NoteMoved[] = [];
  const retitled: NoteRetitled[] = [];
  const renumbered: NoteRenumbered[] = [];
  const changed: NoteChanged[] = [];
  for (const ref of both) {
    const was = before.get(ref);
    const now = after.get(ref);
    if (!was || !now) continue;
    if (was.parent !== now.parent) {
      moved.push({
        ref,
        ...(was.parent === undefined ? {} : { from: was.parent }),
        ...(now.parent === undefined ? {} : { to: now.parent }),
      });
    }
    if (was.title !== now.title) {
      retitled.push({ ref, from: was.title, to: now.title });
    }
    if (was.address !== now.address) {
      renumbered.push({
        ref,
        ...(was.address === undefined ? {} : { from: was.address }),
        ...(now.address === undefined ? {} : { to: now.address }),
      });
    }
    const sections = sectionsBetween(was, now);
    if (
      sections.added.length > 0 ||
      sections.removed.length > 0 ||
      sections.changed.length > 0 ||
      sections.reordered
    ) {
      changed.push({ ref, sections });
    }
  }
  const heldBefore = uploadsOf(a);
  const heldAfter = uploadsOf(b);
  return {
    notes: {
      added: missingFrom(after, before),
      removed: missingFrom(before, after),
      moved,
      retitled,
      renumbered,
      changed,
    },
    media: {
      added: [...heldAfter].filter((one) => !heldBefore.has(one)).sort(),
      removed: [...heldBefore].filter((one) => !heldAfter.has(one)).sort(),
    },
  };
}

function missingFrom(
  held: ReadonlyMap<OwnedRef, VaultNote>,
  other: ReadonlyMap<OwnedRef, VaultNote>,
): OwnedRef[] {
  return [...held.keys()].filter((ref) => !other.has(ref)).sort();
}

function sectionsBetween(was: VaultNote, now: VaultNote): SectionsChanged {
  const before = new Map(was.sections.map((one) => [one.ulid, one.content]));
  const after = new Map(now.sections.map((one) => [one.ulid, one.content]));
  const changed: string[] = [];
  for (const [ulid, content] of before) {
    const held = after.get(ulid);
    if (held !== undefined && !same(content, held)) changed.push(ulid);
  }
  const kept = (
    note: VaultNote,
    other: ReadonlyMap<string, unknown>,
  ): string[] =>
    note.sections.map((one) => one.ulid).filter((ulid) => other.has(ulid));
  return {
    added: [...after.keys()].filter((ulid) => !before.has(ulid)).sort(),
    removed: [...before.keys()].filter((ulid) => !after.has(ulid)).sort(),
    changed: changed.sort(),
    reordered: !same(kept(was, after), kept(now, before)),
  };
}

function notesOf(vault: Vault): Map<OwnedRef, VaultNote> {
  const pictures = picturesOf(vault);
  const ink = inkOf(vault);
  const notes = new Map<OwnedRef, VaultNote>();
  for (const [path, bytes] of vault) {
    if (noteAt(path) === undefined) continue;
    try {
      const note = vaultToNote({ markdown: decodeText(bytes), ink, pictures });
      notes.set(note.ref, note);
    } catch {
      // Somebody else's file, in a folder that is theirs.
    }
  }
  return notes;
}

function picturesOf(vault: Vault): ReadonlyMap<string, PictureSize> {
  const bytes = vault.get(PICTURES_FILE);
  return bytes ? readPicturesFile(bytes) : new Map();
}

function inkOf(vault: Vault): ReadonlyMap<string, Record<string, unknown>> {
  const held = new Map<string, Record<string, unknown>>();
  for (const [path, bytes] of vault) {
    const stem = inkAt(path);
    if (stem === undefined || !path.endsWith(".ink.json")) continue;
    try {
      const attrs: unknown = JSON.parse(decodeText(bytes));
      if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
        held.set(stem, attrs as Record<string, unknown>);
      }
    } catch {
      // A drawing nobody can read is one the note draws without.
    }
  }
  return held;
}

function uploadsOf(vault: Vault): Set<string> {
  const held = new Set<string>();
  for (const path of vault.keys()) {
    const upload = uploadAt(path);
    if (upload !== undefined) held.add(upload);
  }
  return held;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((held, at) => same(held, b[at]));
  }
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const held = a as Record<string, unknown>;
  const other = b as Record<string, unknown>;
  const keys = Object.keys(held);
  if (keys.length !== Object.keys(other).length) return false;
  return keys.every((key) => key in other && same(held[key], other[key]));
}
