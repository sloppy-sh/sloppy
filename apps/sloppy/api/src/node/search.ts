// Reaching a note again by words somebody remembers writing: what the store is
// asked, and what a hit shows of the answer.
// docs/ARCHITECTURE.md § "Data model".

import { compareAddresses, type OwnedRef, type SearchHit } from "@sloppy/types";

/** One section whose writing carries the words asked for. `at` is where each
 *  match starts, counted in characters of `text`. */
export interface SectionMatch {
  note: OwnedRef;
  text: string;
  at: readonly number[];
}

/** A note as the sections that matched leave it. */
export interface Match {
  /** How often its writing carries the words. */
  matches: number;
  snippet: string;
}

/** How much writing a hit shows around what matched, and how much of that comes
 *  before it. */
const SNIPPET_CHARS = 160;
const BEFORE_MATCH = 48;

/**
 * The words a search asks the store for. Anything that is not a letter or a
 * number is dropped: the store answers only a section carrying EVERY word it is
 * given, and nobody wrote a lone "?" — so a phrase typed with the question mark
 * still on the end would otherwise find nothing.
 */
export function searchWords(asked: string): string {
  return (asked.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

/** The notes these sections belong to, each with the writing around the match
 *  in whichever of its sections carries the words most often. */
export function notesAmong(
  sections: readonly SectionMatch[],
): Map<OwnedRef, Match> {
  const stacks = new Map<OwnedRef, SectionMatch[]>();
  for (const section of sections) {
    const held = stacks.get(section.note);
    if (held) held.push(section);
    else stacks.set(section.note, [section]);
  }
  return new Map(
    [...stacks].map(([note, carried]) => {
      const most = carried.reduce((best, section) =>
        section.at.length > best.at.length ? section : best,
      );
      const first = most.at[0];
      return [
        note,
        {
          matches: carried.reduce((all, one) => all + one.at.length, 0),
          snippet: first === undefined ? "" : snippetAround(most.text, first),
        },
      ];
    }),
  );
}

/** One hit, and what it is ranked among the others by. */
export interface Ranked {
  hit: SearchHit;
  matches: number;
}

/** Best first: the note whose writing carries the words most often, ties
 *  settled by address and then by ref, so one search answers the same way
 *  twice. */
export function bestFirst(a: Ranked, b: Ranked): number {
  return (
    b.matches - a.matches ||
    compareAddresses(a.hit.address, b.hit.address) ||
    a.hit.note.localeCompare(b.hit.note)
  );
}

/** The writing around one match, cut to what a list can show. Whole where the
 *  section is short enough to be shown whole. */
export function snippetAround(text: string, at: number): string {
  const chars = [...text];
  if (chars.length <= SNIPPET_CHARS) return text;
  const from = Math.min(
    Math.max(at - BEFORE_MATCH, 0),
    chars.length - SNIPPET_CHARS,
  );
  const to = from + SNIPPET_CHARS;
  const cut = chars.slice(from, to).join("");
  const started = from > 0 ? afterFirstSpace(cut) : cut;
  const shown = to < chars.length ? beforeLastSpace(started) : started;
  return `${from > 0 ? "…" : ""}${shown}${to < chars.length ? "…" : ""}`;
}

function afterFirstSpace(cut: string): string {
  const space = cut.indexOf(" ");
  return space === -1 ? cut : cut.slice(space + 1);
}

function beforeLastSpace(cut: string): string {
  const space = cut.lastIndexOf(" ");
  return space <= 0 ? cut : cut.slice(0, space);
}
