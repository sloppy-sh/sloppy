// Two copies of one graph settled against each other —
// docs/ARCHITECTURE.md § "A graph on disk". The vaults are read elsewhere;
// this is what the difference between them means for the notes a person keeps.

import {
  type Address,
  type BlockDocument,
  compareAddresses,
  type EdgeLook,
  type ImportConflict,
  type ImportResolution,
  type ImportSide,
  type OwnedRef,
} from "@sloppy/types";
import type { VaultDifference, VaultNote, VaultSection } from "@sloppy/vault";

/** How much of a note's writing is quoted for somebody choosing between two
 *  copies of it. */
const QUOTED = 160;

/** The graph as it stands here and as the archive has it, and what a reader of
 *  the two vaults made of the pair. */
export interface TwoCopies {
  mine: ReadonlyMap<OwnedRef, VaultNote>;
  theirs: ReadonlyMap<OwnedRef, VaultNote>;
  difference: VaultDifference;
}

/**
 * What the two copies disagree about, in the order a person reads them: the
 * notes first, by ref, then the numbers.
 *
 * A note both sides hold that differs is one conflict — about its sections
 * where both sides wrote into the same ones, and about the note otherwise.
 */
export function conflictsBetween(copies: TwoCopies): ImportConflict[] {
  const conflicts: ImportConflict[] = [];
  for (const ref of differing(copies)) {
    const mine = copies.mine.get(ref);
    const theirs = copies.theirs.get(ref);
    if (!mine || !theirs) continue;
    const disputed = sectionsBothWrote(copies.difference, ref);
    conflicts.push({
      kind: disputed.length > 0 ? "section" : "note",
      ref,
      sections: disputed.map((ulid) => ({
        section: ulid,
        mine: sectionInWords(sectionOf(mine, ulid)),
        theirs: sectionInWords(sectionOf(theirs, ulid)),
      })),
      mine: noteInWords(mine),
      theirs: noteInWords(theirs),
    });
  }
  const here = numbering(copies.mine);
  const there = numbering(copies.theirs);
  for (const address of [...here.keys()].sort(compareAddresses)) {
    const mine = here.get(address);
    const theirs = there.get(address);
    if (mine === undefined || theirs === undefined || mine === theirs) continue;
    conflicts.push({
      kind: "address",
      ref: mine,
      other: theirs,
      address,
      sections: [],
      mine: noteInWords(copies.mine.get(mine) as VaultNote),
      theirs: noteInWords(copies.theirs.get(theirs) as VaultNote),
    });
  }
  return conflicts;
}

/**
 * The conflicts a settlement does not answer: one nobody chose between, and one
 * whose number is put on a note neither side has there. Nothing is written
 * while any of these stands.
 */
export function unanswered(
  conflicts: readonly ImportConflict[],
  chosen: readonly ImportResolution[],
): ImportConflict[] {
  const given = new Map(chosen.map((one) => [keyOf(one.kind, one.ref), one]));
  return conflicts.filter((conflict) => {
    const answer = given.get(keyOf(conflict.kind, conflict.ref));
    if (answer === undefined) return true;
    return (
      conflict.kind === "address" &&
      answer.numbered !== undefined &&
      answer.numbered !== conflict.ref &&
      answer.numbered !== conflict.other
    );
  });
}

/**
 * Every note the merged graph holds: one only this graph has stays as it is,
 * one only the archive has arrives, and one both sides hold is the side the
 * person kept — section by section where they chose that way, and carrying
 * every address either copy was moved away from. A note nobody was asked about
 * stays as this graph has it.
 */
export function settled(
  copies: TwoCopies,
  conflicts: readonly ImportConflict[],
  chosen: readonly ImportResolution[],
): VaultNote[] {
  const answers = new Map(chosen.map((one) => [keyOf(one.kind, one.ref), one]));
  const notes = new Map<OwnedRef, VaultNote>(copies.mine);
  for (const [ref, theirs] of copies.theirs) {
    const mine = copies.mine.get(ref);
    notes.set(
      ref,
      mine === undefined
        ? theirs
        : between(
            mine,
            theirs,
            answers.get(keyOf("note", ref)) ??
              answers.get(keyOf("section", ref)),
          ),
    );
  }
  for (const conflict of conflicts) {
    if (conflict.kind !== "address" || conflict.address === undefined) continue;
    const answer = answers.get(keyOf("address", conflict.ref));
    if (!answer) continue;
    number(
      notes,
      conflict.address,
      answer.numbered ??
        (answer.keep === "mine" ? conflict.ref : (conflict.other as OwnedRef)),
    );
  }
  return [...notes.values()];
}

/** Which note keeps this number. Every other that was at it is left unnumbered,
 *  carrying it among the numbers it was moved away from. */
function number(
  notes: Map<OwnedRef, VaultNote>,
  address: Address,
  keeping: OwnedRef,
): void {
  for (const [ref, note] of notes) {
    if (ref === keeping || note.address !== address) continue;
    notes.set(ref, {
      ...note,
      address: undefined,
      aliases: led(note, address),
    });
  }
  const note = notes.get(keeping);
  if (!note || note.address === address) return;
  notes.set(keeping, {
    ...note,
    address,
    aliases:
      note.address === undefined ? note.aliases : led(note, note.address),
  });
}

/** One note settled between the two copies of it. Absent `chose` is a note
 *  nobody was asked about, which stays as this graph has it.
 *
 *  What a note was last read against is not one of the things a person chooses
 *  between: the reading comes in with the archive, which is the copy that sits
 *  beside the code, and this graph's stands where the archive carries none —
 *  absent is a note nobody has read rather than a reading of nothing. */
function between(
  mine: VaultNote,
  theirs: VaultNote,
  chose: ImportResolution | undefined,
): VaultNote {
  const keep: ImportSide = chose?.keep ?? "mine";
  const base = keep === "mine" ? mine : theirs;
  const other = keep === "mine" ? theirs : mine;
  const sides = new Map(
    (chose?.sections ?? []).map((one) => [one.section, one.keep]),
  );
  const held = new Map(other.sections.map((one) => [one.ulid, one]));
  const checked = theirs.checked ?? mine.checked;
  return {
    ...base,
    ...(checked === undefined ? {} : { checked }),
    sections: base.sections.map((section) => {
      const side = sides.get(section.ulid);
      const theirSection = held.get(section.ulid);
      return side !== undefined && side !== keep && theirSection
        ? theirSection
        : section;
    }),
    aliases: carried(base, other),
  };
}

/** Every address a note has carried in either copy, beside the one it is at:
 *  an address a note was carried away from belongs to it — AI.md § "The
 *  Genealogy Is the Protocol". */
function carried(base: VaultNote, other: VaultNote): Address[] {
  const addresses = new Set<Address>([...base.aliases, ...other.aliases]);
  if (other.address !== undefined) addresses.add(other.address);
  if (base.address !== undefined) addresses.delete(base.address);
  return [...addresses].sort(compareAddresses);
}

function led(note: VaultNote, address: Address): Address[] {
  return [...new Set([...note.aliases, address])].sort(compareAddresses);
}

/** The notes both sides hold that differ in anything a person settles: what
 *  they are called, what they sprang out of, the number they carry, the tags,
 *  links and line looks on them, or their sections. How the MARK is styled is
 *  not one of these: an import keeps the styling of the copy the person has. */
function differing(copies: TwoCopies): OwnedRef[] {
  const { notes } = copies.difference;
  const refs = new Set<OwnedRef>([
    ...notes.moved.map((one) => one.ref),
    ...notes.retitled.map((one) => one.ref),
    ...notes.renumbered.map((one) => one.ref),
    ...notes.changed.map((one) => one.ref),
  ]);
  for (const [ref, mine] of copies.mine) {
    const theirs = copies.theirs.get(ref);
    if (!theirs) continue;
    if (
      !same(mine.tags, theirs.tags) ||
      !same(mine.links, theirs.links) ||
      !sameLooks(mine.edges, theirs.edges)
    ) {
      refs.add(ref);
    }
  }
  return [...refs].sort();
}

/** Whether two copies of a note draw the same lines the same way. The order
 *  the looks were written in is not one of the channels. */
function sameLooks(
  mine: readonly EdgeLook[] | undefined,
  theirs: readonly EdgeLook[] | undefined,
): boolean {
  const here = new Map((mine ?? []).map((look) => [look.to, look]));
  const there = new Map((theirs ?? []).map((look) => [look.to, look]));
  if (here.size !== there.size) return false;
  for (const [to, look] of here) {
    const other = there.get(to);
    if (
      other === undefined ||
      other.label !== look.label ||
      other.direction !== look.direction ||
      other.stroke !== look.stroke
    ) {
      return false;
    }
  }
  return true;
}

/** Whether two of a note's lists say the same things, in whatever order. */
function same(mine: readonly string[], theirs: readonly string[]): boolean {
  if (mine.length !== theirs.length) return false;
  const here = [...mine].sort();
  const there = [...theirs].sort();
  return here.every((one, at) => one === there[at]);
}

/** The sections of one note that both sides wrote into, which is what a person
 *  chooses between section by section. */
function sectionsBothWrote(
  difference: VaultDifference,
  ref: OwnedRef,
): string[] {
  return (
    difference.notes.changed.find((one) => one.ref === ref)?.sections.changed ??
    []
  );
}

function sectionOf(note: VaultNote, ulid: string): VaultSection | undefined {
  return note.sections.find((one) => one.ulid === ulid);
}

/** Which note each side has at each number. */
function numbering(
  notes: ReadonlyMap<OwnedRef, VaultNote>,
): Map<Address, OwnedRef> {
  const at = new Map<Address, OwnedRef>();
  for (const [ref, note] of notes) {
    if (note.address !== undefined) at.set(note.address, ref);
  }
  return at;
}

function keyOf(kind: string, ref: OwnedRef): string {
  return `${kind} ${ref}`;
}

/** A note as somebody picks it out of two copies: the number it is at, what
 *  they called it, and how it opens. */
export function noteInWords(note: VaultNote): string {
  const opening = note.sections
    .map((section) => wordsOf(section.content))
    .find((words) => words !== "");
  const named = note.address ? `${note.address} ${called(note)}` : called(note);
  return [named, opening].filter((held) => held).join(" — ");
}

/** What one section says, for somebody choosing between two of it. */
export function sectionInWords(section: VaultSection | undefined): string {
  const words = section ? wordsOf(section.content) : "";
  return words === "" ? "This section has no words in it." : words;
}

/** A note named the way its author would recognise it. */
export function called(note: { title: string }): string {
  const title = note.title.trim();
  return title ? `“${title}”` : "a note you have not titled";
}

/** The opening of what a section says, as one line. */
function wordsOf(content: BlockDocument): string {
  const said: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const held of value) walk(held);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const held = value as { type?: unknown; text?: unknown };
    if (held.type === "text" && typeof held.text === "string") {
      said.push(held.text);
    }
    for (const inside of Object.values(value)) walk(inside);
  };
  walk(content);
  const words = said.join(" ").replace(/\s+/g, " ").trim();
  if (words.length <= QUOTED) return words;
  const cut = words.lastIndexOf(" ", QUOTED);
  return `${words.slice(0, cut > QUOTED / 2 ? cut : QUOTED).trimEnd()}…`;
}
