// `find_note` — the notes a description fits, best first, from the words:
// docs/ARCHITECTURE.md § "An assistant outside the app".

import {
  type FittingNote,
  isAddress,
  MOST_NOTES_FITTING,
  type NotesFitting,
} from "@sloppy/types";
import type { LocalApi } from "./api.js";
import { notesListed } from "./here.js";
import { wordsOf } from "./search.js";

/** The most notes a description is ranked among before the best are kept. */
export const SHORTLIST_MOST = 40;

/** One note as the shortlist reads it. */
export interface FindIndexed {
  note: string;
  title: string;
  address?: string;
  /** The addresses it was at before. */
  aliases: readonly string[];
  tags: readonly string[];
  /** All of its writing, as one run. */
  writing: string;
  updated_at: string;
}

/** A note the description reaches and the words of it the note carries. */
export interface Shortlisted {
  note: string;
  title: string;
  address?: string;
  matched: string[];
  /** Whether the description names its address, or one it was at. */
  cited: boolean;
}

/** The notes of `api`'s graph that `said` fits. */
export async function notesFitting(
  api: LocalApi,
  said: string,
): Promise<NotesFitting> {
  return answeredByWords(said, shortlist(said, await indexOf(api)));
}

/** Every note that is there in `api`'s graph. */
async function indexOf(api: LocalApi): Promise<FindIndexed[]> {
  const notes = await notesListed(api);
  return Promise.all(
    notes.map(async (note) => ({
      note: note.ref,
      title: note.title,
      ...(note.address === undefined ? {} : { address: note.address }),
      aliases: note.aliases ?? [],
      tags: note.tags,
      writing: (await api.listBlocks(note.ref))
        .map((block) => wordsOf(block.content))
        .filter((run) => run !== "")
        .join(" "),
      updated_at: note.updated_at,
    })),
  );
}

/**
 * The notes `said` reaches, best first and no more than
 * {@link SHORTLIST_MOST}: a note at an address it names first, then by how
 * many of its words each carries in its title, tags, address and writing, then
 * by how many of those are in its title and tags, then by how often its writing
 * carries them — the measure `search_notes` ranks by.
 */
export function shortlist(
  said: string,
  index: readonly FindIndexed[],
): Shortlisted[] {
  const wanted = wordsWanted(said);
  const cites = new Set(words(said).filter((word) => isAddress(word)));
  return index
    .map((one) => ({ one, ...scored(one, wanted, cites) }))
    .filter((held) => held.cited || held.matched.length > 0)
    .sort(
      (a, b) =>
        Number(b.cited) - Number(a.cited) ||
        b.matched.length - a.matched.length ||
        b.labelled - a.labelled ||
        b.often - a.often ||
        newestFirst(a.one, b.one),
    )
    .slice(0, SHORTLIST_MOST)
    .map(({ one, matched, cited }) => ({ ...named(one), matched, cited }));
}

/** The notes that carry any of the words, and the first as `best` where it is
 *  cited or carries at least half of them. */
export function answeredByWords(
  said: string,
  listed: readonly Shortlisted[],
): NotesFitting {
  const found = listed.slice(0, MOST_NOTES_FITTING).map((one) => ({
    ...named(one),
    why: one.cited ? citedWhy(one) : `Mentions ${spoken(one.matched)}.`,
  }));
  const top = listed[0];
  const wanted = wordsWanted(said).length;
  const fits =
    top !== undefined && (top.cited || top.matched.length * 2 >= wanted);
  return fits ? { found, best: top.note } : { found };
}

function citedWhy(one: Shortlisted): string {
  return one.address === undefined
    ? "It used to be at the address you said."
    : `It is at ${one.address}.`;
}

function scored(
  one: FindIndexed,
  wanted: readonly string[],
  cites: ReadonlySet<string>,
): { matched: string[]; cited: boolean; labelled: number; often: number } {
  const label = `${one.title} ${one.tags.join(" ")}`.toLowerCase();
  const writing = one.writing.toLowerCase();
  const whole = `${label} ${one.address ?? ""} ${writing}`;
  const matched = wanted.filter((word) => whole.includes(word));
  return {
    matched,
    cited:
      (one.address !== undefined && cites.has(one.address)) ||
      one.aliases.some((alias) => cites.has(alias)),
    labelled: matched.filter((word) => label.includes(word)).length,
    often: matched.reduce((all, word) => all + timesIn(writing, word), 0),
  };
}

function timesIn(text: string, word: string): number {
  let times = 0;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    times++;
  }
  return times;
}

function newestFirst(a: FindIndexed, b: FindIndexed): number {
  return (
    b.updated_at.localeCompare(a.updated_at) || a.note.localeCompare(b.note)
  );
}

function named(one: Omit<FittingNote, "why">): Omit<FittingNote, "why"> {
  return {
    note: one.note,
    title: one.title,
    ...(one.address === undefined ? {} : { address: one.address }),
  };
}

function words(said: string): string[] {
  return said.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The words of a description that say what it is about: every one, less the
 *  ones any description is made of — unless that is all it is made of. */
function wordsWanted(said: string): string[] {
  const all = [...new Set(words(said))];
  const telling = all.filter((word) => word.length > 1 && !COMMON.has(word));
  return telling.length > 0 ? telling : all;
}

function spoken(matched: readonly string[]): string {
  if (matched.length <= 1) return matched.join("");
  return `${matched.slice(0, -1).join(", ")} and ${matched[matched.length - 1]}`;
}

const COMMON = new Set(
  (
    "a about above after again all also am an and any are as at be because been " +
    "before being below between both but by can could did do does doing down during " +
    "each few find for from further get had has have having he her here hers him his " +
    "how i if in into is it its itself just me more most my no nor not note notes now " +
    "of off on once one only or other our ours out over own please same she should " +
    "show so some something such take than that the their theirs them then there " +
    "these they thing this those through to too under until up very was we were what " +
    "when where which while who whom why will with would you your yours"
  ).split(" "),
);
