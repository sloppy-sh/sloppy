// `sloppy organise`: where the notes already here would be better placed and
// linked, read off how related they are and proposed, never written —
// docs/ARCHITECTURE.md § "Tooling" and § "Asking a tool to write the notes".

import {
  indexOf,
  type NoteHere,
  PLACE_THRESHOLD,
  type RelateIndex,
  relationsOf,
  subjectOfNote,
} from "@sloppy/local";
import {
  type Address,
  EDGE_LABEL_MAX,
  type OwnedRef,
  type Principal,
  type RelatedNote,
  writesAlone,
} from "@sloppy/types";

/** The least a better parent must score for a move to be proposed. */
export const MOVE_FLOOR = 0.3;

/** How much more than where it hangs now a better parent must score. */
export const MOVE_MARGIN = 0.1;

/** The least a line between two notes must score to be proposed. */
export const LINK_FLOOR = 0.5;

/** The most lines proposed out of one note. */
const LINKS_PER_NOTE = 2;

/** A note as a proposal names it. */
export interface NoteNamed {
  note: OwnedRef;
  title: string;
  /** **Absent is a note with no address.** */
  address?: Address;
}

export interface MoveProposal extends NoteNamed {
  /** Whether anybody but the project's own tools has written in it. */
  byPerson: boolean;
  /** Where it hangs now, and how related it is to that note. */
  from: NoteNamed & { score: number };
  to: NoteNamed & { score: number; reasons: string[] };
}

export interface LinkProposal extends NoteNamed {
  to: NoteNamed;
  score: number;
  reasons: string[];
  /** What the line might say, from the strongest reason. */
  label: string;
}

export interface Proposals {
  moves: MoveProposal[];
  links: LinkProposal[];
}

export interface OrganiseAsked {
  /** Absent is every note. */
  only?: ReadonlySet<OwnedRef>;
  /** Only notes hung straight under a branch's first note, or under a note
   *  they relate to less than {@link PLACE_THRESHOLD}. */
  loose?: boolean;
  /** Who the project's own tools write as; absent counts every note as a
   *  person's. */
  writer?: Principal;
}

/**
 * The same notes give the same proposals: notes are taken in ref order, and
 * `relationsOf` settles its own ties by ref. A note with no parent is a branch
 * or an independent note, and where it stands is left alone.
 */
export function proposalsFor(
  here: readonly NoteHere[],
  asked: OrganiseAsked = {},
): Proposals {
  const index = indexOf(here);
  const named = (ref: OwnedRef): NoteNamed => {
    const note = index.notes.get(ref)?.note;
    return {
      note: ref,
      title: note?.title ?? "",
      ...(note?.address === undefined ? {} : { address: note.address }),
    };
  };
  const asking: { ref: OwnedRef; links: readonly RelatedNote[] }[] = [];
  const wanted: MoveProposal[] = [];
  for (const ref of [...index.notes.keys()].sort()) {
    const held = index.notes.get(ref);
    const subject = subjectOfNote(index, ref);
    if (!held || !subject || (asked.only && !asked.only.has(ref))) continue;
    const parent = held.note.parent;
    const related = relationsOf(index, subject, index.notes.size);
    const now = scoreOf(related.parents, parent);
    if (asked.loose) {
      const hungLoose =
        parent !== undefined &&
        (index.notes.get(parent)?.note.parent === undefined ||
          now < PLACE_THRESHOLD);
      if (!hungLoose) continue;
    }
    asking.push({ ref, links: related.links });
    const best = related.parents[0];
    if (
      parent !== undefined &&
      !index.children.has(ref) &&
      best !== undefined &&
      best.note !== parent &&
      best.score >= MOVE_FLOOR &&
      best.score - now >= MOVE_MARGIN
    ) {
      wanted.push({
        ...named(ref),
        byPerson:
          asked.writer === undefined || !writesAlone(held.note, asked.writer),
        from: { ...named(parent), score: now },
        to: { ...named(best.note), score: best.score, reasons: best.reasons },
      });
    }
  }
  const moves = together(index, wanted);
  const landing = new Map(moves.map((one) => [one.note, one.to.note]));
  const links: LinkProposal[] = [];
  const linked = new Set<string>();
  for (const { ref, links: related } of asking) {
    let drawn = 0;
    for (const one of related) {
      if (drawn === LINKS_PER_NOTE || one.score < LINK_FLOOR) break;
      if (landing.get(ref) === one.note || landing.get(one.note) === ref) {
        continue;
      }
      const pair = [ref, one.note].sort().join(" ");
      if (linked.has(pair)) continue;
      linked.add(pair);
      drawn += 1;
      links.push({
        ...named(ref),
        to: named(one.note),
        score: one.score,
        reasons: one.reasons,
        label: labelFrom(one.reasons, (word) => rare(index, word)),
      });
    }
  }
  return { moves, links };
}

/** The moves that can all be made, the most gained first: one that would
 *  carry a note beneath itself, by way of another move, is passed over. They
 *  are answered in ref order. */
function together(
  index: RelateIndex,
  wanted: readonly MoveProposal[],
): MoveProposal[] {
  const parentOf = new Map<OwnedRef, OwnedRef | undefined>();
  for (const [ref, held] of index.notes) parentOf.set(ref, held.note.parent);
  const gain = (one: MoveProposal) => one.to.score - one.from.score;
  const kept: MoveProposal[] = [];
  for (const one of [...wanted].sort(
    (a, b) => gain(b) - gain(a) || byRef(a.note, b.note),
  )) {
    let above: OwnedRef | undefined = one.to.note;
    while (above !== undefined && above !== one.note) {
      above = parentOf.get(above);
    }
    if (above === one.note) continue;
    parentOf.set(one.note, one.to.note);
    kept.push(one);
  }
  return kept.sort((a, b) => byRef(a.note, b.note));
}

function byRef(a: OwnedRef, b: OwnedRef): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function scoreOf(
  ranked: readonly RelatedNote[],
  ref: OwnedRef | undefined,
): number {
  return ranked.find((one) => one.note === ref)?.score ?? 0;
}

/** A word carried by more than this share of the notes says nothing about
 *  why two of them are joined. */
const RARE_SHARE = 0.25;

function rare(index: RelateIndex, word: string): boolean {
  return (index.carrying.get(word) ?? 0) <= RARE_SHARE * index.notes.size;
}

/** What a line between two notes might say, from the first of the reasons
 *  `relationsOf` gave that names something particular to them. */
export function labelFrom(
  reasons: readonly string[],
  particular: (word: string) => boolean = () => true,
): string {
  for (const reason of reasons) {
    const said = labelled(reason, particular);
    if (said === undefined) continue;
    return said.length <= EDGE_LABEL_MAX
      ? said
      : `${said.slice(0, EDGE_LABEL_MAX - 1)}…`;
  }
  return "related";
}

function labelled(
  reason: string,
  particular: (word: string) => boolean,
): string | undefined {
  const quoted = [...reason.matchAll(/“([^”]+)”/g)].map((found) => found[1]);
  if (reason.startsWith("shares the words")) {
    const words = quoted.filter(particular).slice(0, 2);
    return words.length === 0 ? undefined : `both on ${words.join(" and ")}`;
  }
  if (reason.startsWith("both are linked with")) {
    return `both linked with ${quoted[0]}`;
  }
  const code = CODE_REASON.exec(reason);
  return code ? `both about ${code[1].replace(/\/$/, "")}` : undefined;
}

const CODE_REASON =
  /^(?:both point at|points at|points into|both point into) ([^,]+)/;
