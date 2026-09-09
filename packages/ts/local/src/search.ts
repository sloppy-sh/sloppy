// Reaching a note again by words somebody remembers writing, read off the index
// a vault is opened into — docs/ARCHITECTURE.md § "Local-only mode".

import {
  type SearchHit,
  MAX_SEARCH_HITS,
  isAddress,
  orderSiblings,
} from "@sloppy/types";
import type { LocalGraph, StoredNote } from "./graph.js";

/** How much writing a hit shows around what matched, and how much of that comes
 *  before it. */
const SNIPPET_CHARS = 160;
const BEFORE_MATCH = 48;

/** The keys a run of writing sits under, wherever in a document it sits: `text`
 *  for writing, `description` and `alt` for what somebody said a drawing or a
 *  picture is. */
const SAYS = new Set(["text", "description", "alt"]);

/**
 * The notes `asked` reaches across every graph given, best match first: the one
 * it addresses ahead of the ones whose writing carries it. An address carried
 * away from answers alongside the one a note is at, so a citation written down
 * before a move still leads where it meant to. Ranked and bounded over the
 * whole answer, so a second graph never pushes a better hit off the end.
 */
export function search(
  graphs: readonly LocalGraph[],
  asked: string,
): SearchHit[] {
  const cited = graphs.flatMap((graph) => addressed(graph, asked));
  const wanted = words(asked);
  if (wanted.length === 0) return cited.slice(0, MAX_SEARCH_HITS);
  const already = new Set(cited.map((hit) => hit.note));
  const found = graphs
    .flatMap((graph) =>
      graph.live().flatMap((note) => {
        const hit = matched(graph, note, wanted);
        return hit && !already.has(note.ref) ? [hit] : [];
      }),
    )
    .sort(bestFirst);
  return [...cited, ...found.map((one) => one.hit)].slice(0, MAX_SEARCH_HITS);
}

/** The notes written last, newest first. */
export function recent(graph: LocalGraph, limit: number): StoredNote[] {
  return graph
    .live()
    .sort(
      (a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.ref.localeCompare(a.ref),
    )
    .slice(0, limit);
}

/** The words a search asks for. Anything that is not a letter or a number is
 *  dropped, so a phrase typed with the question mark still on the end finds
 *  what was written without one. */
function words(asked: string): string[] {
  return (asked.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => word !== "",
  );
}

/** Every run of writing a section's document holds, in the order it holds them,
 *  with runs of whitespace collapsed. Read as a convention across elements
 *  rather than a list of them, so a kind this build has no renderer for still
 *  gives up its words. */
function wordsOf(content: unknown): string {
  const written: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, held] of Object.entries(value)) {
      if (SAYS.has(key) && typeof held === "string") written.push(held);
      else walk(held);
    }
  };
  walk(content);
  return written.join(" ").replace(/\s+/gu, " ").trim();
}

interface Ranked {
  hit: SearchHit;
  matches: number;
}

function addressed(graph: LocalGraph, asked: string): SearchHit[] {
  const address = asked.trim().toLowerCase();
  if (!isAddress(address)) return [];
  const reached = graph
    .live()
    .filter(
      (note) => note.address === address || note.aliases.includes(address),
    );
  return orderSiblings(reached).map((note) => ({
    note: note.ref,
    ...(note.address === undefined ? {} : { address: note.address }),
    graph: graph.ref,
    title: note.title,
    snippet: "",
    created_at: note.created_at,
    ...(note.address === address ? {} : { wasAt: address }),
    held: false,
  }));
}

/** A note whose title, tags or writing carry every word asked for. */
function matched(
  graph: LocalGraph,
  note: StoredNote,
  wanted: readonly string[],
): Ranked | null {
  const label = `${note.title} ${note.tags.join(" ")}`.toLowerCase();
  const sections = note.sections.map((section) => wordsOf(section.content));
  const whole = `${label} ${sections.join(" ")}`.toLowerCase();
  if (!wanted.every((word) => whole.includes(word))) return null;
  const best = sections
    .map((text) => ({ text, at: places(text.toLowerCase(), wanted) }))
    .sort((a, b) => b.at.length - a.at.length)[0];
  const at = best?.at[0];
  return {
    matches: sections.reduce(
      (all, text) => all + places(text.toLowerCase(), wanted).length,
      0,
    ),
    hit: {
      note: note.ref,
      ...(note.address === undefined ? {} : { address: note.address }),
      graph: graph.ref,
      title: note.title,
      snippet: at === undefined || !best ? "" : snippetAround(best.text, at),
      created_at: note.created_at,
      held: false,
    },
  };
}

/** Where each word asked for starts in this writing, counted in characters. */
function places(text: string, wanted: readonly string[]): number[] {
  const at: number[] = [];
  for (const word of wanted) {
    for (let from = text.indexOf(word); from >= 0; ) {
      at.push(from);
      from = text.indexOf(word, from + word.length);
    }
  }
  return at.sort((a, b) => a - b);
}

/** Best first: the note whose writing carries the words most often, ties
 *  settled the way a run reads — so one search answers the same way twice. */
function bestFirst(a: Ranked, b: Ranked): number {
  if (b.matches !== a.matches) return b.matches - a.matches;
  const [first] = orderSiblings([member(a.hit), member(b.hit)]);
  return first.ref === a.hit.note ? -1 : 1;
}

function member(hit: SearchHit) {
  return {
    ref: hit.note,
    ...(hit.address === undefined ? {} : { address: hit.address }),
    created_at: hit.created_at ?? "",
  };
}

/** The writing around one match, cut to what a list can show. Whole where the
 *  section is short enough to be shown whole. */
function snippetAround(text: string, at: number): string {
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
