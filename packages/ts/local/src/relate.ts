// Where a note belongs and what it relates to, read off an index of the notes
// that is worked out from them and never stored — docs/ARCHITECTURE.md
// § "Asking a tool to write the notes" is the rule and its weights.

import {
  anchorsOf,
  type BlockDocument,
  citedNotes,
  type NodeView,
  type OwnedRef,
  RELATED_REASON_MAX,
  MOST_RELATED_REASONS,
  type RelatedNote,
  type Tag,
} from "@sloppy/types";
import { worthLookingFor } from "./brief.js";
import type { NoteHere } from "./here.js";
import { wordsOf } from "./search.js";

/** How much more a word counts in a title, and in a tag, than in a section. */
const TITLE_WEIGHT = 3;
const TAG_WEIGHT = 2;

/** BM25's saturation and length normalisation. */
const K1 = 1.2;
const B = 0.75;

/** What each signal is worth in the one score. They sum to 1. */
export const SIGNAL_WEIGHTS = { words: 0.5, code: 0.3, lines: 0.2 } as const;

/** How much of the best score among what already springs out of a note is
 *  added to its score as somewhere to spring out of. */
export const FAMILY_WEIGHT = 0.25;

/** The least a candidate parent must score for a new note to be placed under
 *  it with nothing else said. */
export const PLACE_THRESHOLD = 0.5;

/** Less than this a signal is not named as a reason. */
const LEAST_REASON = 0.02;

/** How many shared words a reason names. */
const WORDS_NAMED = 3;

/** Roots an index is kept for at once. */
const MOST_INDEXES = 4;

/** What one note, or a note about to be written, is to the index. */
export interface Subject {
  /** **Absent is a note about to be written.** */
  ref?: OwnedRef;
  terms: Map<string, number>;
  length: number;
  paths: string[];
  /** The notes a line joins it to, hand-drawn or cited, either way round. */
  near: Set<OwnedRef>;
}

interface Indexed extends Subject {
  ref: OwnedRef;
  note: NodeView;
}

export interface RelateIndex {
  notes: Map<OwnedRef, Indexed>;
  /** How many notes carry each term. */
  carrying: Map<string, number>;
  averageLength: number;
  children: Map<OwnedRef, OwnedRef[]>;
}

/** What a draft is, as a note about to be written. */
export interface Draft {
  title?: string;
  sections: readonly BlockDocument[];
  about?: string;
  tags: readonly Tag[];
}

/** One candidate and what each signal said of it. */
interface Scored {
  note: Indexed;
  score: number;
  reasons: { worth: number; said: string }[];
}

export interface Relations {
  parents: RelatedNote[];
  links: RelatedNote[];
}

/** The words of some writing, each folded to the form the index keeps. */
function termsIn(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter(worthLookingFor)
    .map(folded);
}

/** A plural folded onto its singular, so "notes" and "note" are one term. */
function folded(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

function weighed(
  title: string,
  tags: readonly string[],
  sections: readonly BlockDocument[],
): { terms: Map<string, number>; length: number } {
  const terms = new Map<string, number>();
  let length = 0;
  const add = (text: string, weight: number) => {
    for (const term of termsIn(text)) {
      terms.set(term, (terms.get(term) ?? 0) + weight);
      length += weight;
    }
  };
  add(title, TITLE_WEIGHT);
  add(tags.join(" "), TAG_WEIGHT);
  for (const content of sections) add(wordsOf(content), 1);
  return { terms, length };
}

function trimmed(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export function indexOf(here: readonly NoteHere[]): RelateIndex {
  const notes = new Map<OwnedRef, Indexed>();
  const carrying = new Map<string, number>();
  const children = new Map<OwnedRef, OwnedRef[]>();
  let total = 0;
  for (const held of here) {
    const contents = held.blocks.map((block) => block.content);
    const { terms, length } = weighed(
      held.note.title,
      held.note.tags,
      contents,
    );
    for (const term of terms.keys()) {
      carrying.set(term, (carrying.get(term) ?? 0) + 1);
    }
    total += length;
    notes.set(held.note.ref, {
      ref: held.note.ref,
      note: held.note,
      terms,
      length,
      paths: held.about.map(trimmed),
      near: new Set([...held.note.links, ...contents.flatMap(citedNotes)]),
    });
    const parent = held.note.parent;
    if (parent !== undefined) {
      children.set(parent, [...(children.get(parent) ?? []), held.note.ref]);
    }
  }
  for (const indexed of notes.values()) {
    indexed.near.delete(indexed.ref);
    for (const other of indexed.near) notes.get(other)?.near.add(indexed.ref);
  }
  for (const indexed of notes.values()) {
    for (const other of [...indexed.near]) {
      if (!notes.has(other)) indexed.near.delete(other);
    }
  }
  return {
    notes,
    carrying,
    averageLength: notes.size === 0 ? 0 : total / notes.size,
    children,
  };
}

/** One index per root, kept while the notes it was built from stand as they
 *  were. */
const indexes = new Map<string, { key: string; index: RelateIndex }>();

/** The index over `here`, built again only where a note or a section changed
 *  since it was last built for `root`. */
export function indexFor(root: string, here: readonly NoteHere[]): RelateIndex {
  const key = standingOf(here);
  const kept = indexes.get(root);
  if (kept && kept.key === key) return kept.index;
  const index = indexOf(here);
  indexes.delete(root);
  indexes.set(root, { key, index });
  while (indexes.size > MOST_INDEXES) {
    const [oldest] = indexes.keys();
    indexes.delete(oldest);
  }
  return index;
}

/** The index for `root` is built again on its next use. */
export function forgetIndex(root: string): void {
  indexes.delete(root);
}

function standingOf(here: readonly NoteHere[]): string {
  return here
    .map(
      (held) =>
        `${held.note.ref}@${held.note.updated_at}:${held.blocks
          .map((block) => `${block.ref}@${block.updated_at}`)
          .join(",")}`,
    )
    .join(";");
}

export function subjectOfNote(
  index: RelateIndex,
  ref: OwnedRef,
): Subject | undefined {
  return index.notes.get(ref);
}

export function subjectOfDraft(index: RelateIndex, draft: Draft): Subject {
  const { terms, length } = weighed(
    draft.title ?? "",
    draft.tags,
    draft.sections,
  );
  const paths = new Set(
    draft.sections.flatMap((content) =>
      anchorsOf(content).map((anchor) => trimmed(anchor.path)),
    ),
  );
  if (draft.about !== undefined) paths.add(trimmed(draft.about));
  const near = new Set(
    draft.sections.flatMap(citedNotes).filter((ref) => index.notes.has(ref)),
  );
  return { terms, length, paths: [...paths], near };
}

function idf(index: RelateIndex, term: string): number {
  const n = index.carrying.get(term) ?? 0;
  const all = index.notes.size;
  return Math.log(1 + (all - n + 0.5) / (n + 0.5));
}

/** What each of the subject's terms is worth against one note's, BM25. */
function wordsAgainst(
  index: RelateIndex,
  subject: Subject,
  terms: Map<string, number>,
  length: number,
): Map<string, number> {
  const average = index.averageLength || 1;
  const worth = new Map<string, number>();
  for (const [term, asked] of subject.terms) {
    const tf = terms.get(term) ?? 0;
    if (tf === 0) continue;
    const saturated =
      (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / average));
    worth.set(term, (1 + Math.log(asked)) * idf(index, term) * saturated);
  }
  return worth;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** The words signal, as a share of what the subject scores against itself. */
function wordsSignal(
  index: RelateIndex,
  subject: Subject,
  other: Indexed,
  own: number,
): { worth: number; said?: string } {
  if (own === 0) return { worth: 0 };
  const shared = wordsAgainst(index, subject, other.terms, other.length);
  const worth = Math.min(1, sum(shared.values()) / own);
  const named = [...shared]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, WORDS_NAMED)
    .map(([term]) => `“${term}”`);
  return named.length === 0
    ? { worth }
    : { worth, said: `shares the words ${listed(named)}` };
}

function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

/** How near two places in the code are, and how a person would say so. */
function placesNear(
  mine: string,
  theirs: string,
): { worth: number; said?: string } {
  if (mine === theirs) return { worth: 1, said: `both point at ${mine}` };
  if (mine.startsWith(`${theirs}/`)) {
    return {
      worth: folderOf(mine) === theirs ? 0.8 : 0.6,
      said: `points at ${theirs}, which holds ${mine}`,
    };
  }
  if (theirs.startsWith(`${mine}/`)) {
    return { worth: 0.4, said: `points into ${mine}` };
  }
  const folder = folderOf(mine);
  if (folder !== "" && folder === folderOf(theirs)) {
    return { worth: 0.5, said: `both point into ${folder}/` };
  }
  const a = mine.split("/");
  const b = theirs.split("/");
  let common = 0;
  while (
    common < a.length - 1 &&
    common < b.length - 1 &&
    a[common] === b[common]
  ) {
    common += 1;
  }
  if (common === 0) return { worth: 0 };
  const depth = Math.max(a.length, b.length) - 1;
  return {
    worth: (0.3 * common) / depth,
    said: `both point into ${a.slice(0, common).join("/")}/`,
  };
}

function codeSignal(
  subject: Subject,
  other: Indexed,
): { worth: number; said?: string } {
  let best: { worth: number; said?: string } = { worth: 0 };
  for (const mine of [...subject.paths].sort()) {
    for (const theirs of [...other.paths].sort()) {
      const near = placesNear(mine, theirs);
      if (near.worth > best.worth) best = near;
    }
  }
  return best;
}

function linesSignal(
  index: RelateIndex,
  subject: Subject,
  other: Indexed,
): { worth: number; said?: string } {
  if (subject.near.has(other.ref)) {
    return { worth: 1, said: "a line already joins them" };
  }
  let worth = 0;
  let best: { worth: number; title: string; ref: OwnedRef } | undefined;
  for (const ref of [...subject.near].sort()) {
    if (ref === other.ref || !other.near.has(ref)) continue;
    const shared = index.notes.get(ref);
    if (!shared) continue;
    const one = 1 / Math.log2(2 + shared.near.size);
    worth += one;
    if (best === undefined || one > best.worth) {
      best = { worth: one, title: shared.note.title, ref };
    }
  }
  return best === undefined
    ? { worth: 0 }
    : {
        worth: Math.min(1, worth),
        said: `both are linked with “${best.title}”`,
      };
}

function scoredAgainst(
  index: RelateIndex,
  subject: Subject,
  other: Indexed,
  own: number,
): Scored {
  const words = wordsSignal(index, subject, other, own);
  const code = codeSignal(subject, other);
  const lines = linesSignal(index, subject, other);
  const parts = [
    { worth: SIGNAL_WEIGHTS.words * words.worth, said: words.said },
    { worth: SIGNAL_WEIGHTS.code * code.worth, said: code.said },
    { worth: SIGNAL_WEIGHTS.lines * lines.worth, said: lines.said },
  ];
  return {
    note: other,
    score: sum(parts.map((part) => part.worth)),
    reasons: parts.flatMap((part) =>
      part.said !== undefined && part.worth >= LEAST_REASON
        ? [{ worth: part.worth, said: part.said }]
        : [],
    ),
  };
}

/** Every note beneath `ref`, which a note cannot spring out of. */
function beneath(index: RelateIndex, ref: OwnedRef): Set<OwnedRef> {
  const found = new Set<OwnedRef>();
  const walk = (of: OwnedRef) => {
    for (const child of index.children.get(of) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      walk(child);
    }
  };
  walk(ref);
  return found;
}

/**
 * The notes `subject` would best spring out of and best be linked to, best
 * first and at most `limit` of each. The same notes answer the same way every
 * time: ties go to the ref that sorts first.
 */
export function relationsOf(
  index: RelateIndex,
  subject: Subject,
  limit: number,
): Relations {
  const own = sum(
    wordsAgainst(index, subject, subject.terms, subject.length).values(),
  );
  const scored = new Map<OwnedRef, Scored>();
  for (const other of index.notes.values()) {
    if (other.ref === subject.ref) continue;
    scored.set(other.ref, scoredAgainst(index, subject, other, own));
  }
  const below =
    subject.ref === undefined
      ? new Set<OwnedRef>()
      : beneath(index, subject.ref);
  const parents: Scored[] = [];
  for (const one of scored.values()) {
    if (below.has(one.note.ref)) continue;
    parents.push(withFamily(index, scored, one, subject.ref));
  }
  const held =
    subject.ref === undefined ? undefined : index.notes.get(subject.ref);
  const joined = new Set<OwnedRef>([
    ...subject.near,
    ...(held?.note.parent === undefined ? [] : [held.note.parent]),
    ...(subject.ref === undefined
      ? []
      : (index.children.get(subject.ref) ?? [])),
  ]);
  const links = [...scored.values()].filter((one) => !joined.has(one.note.ref));
  return {
    parents: ranked(parents, limit),
    links: ranked(links, limit),
  };
}

/** A candidate parent, scored as well by the best of what already springs out
 *  of it. */
function withFamily(
  index: RelateIndex,
  scored: Map<OwnedRef, Scored>,
  one: Scored,
  self: OwnedRef | undefined,
): Scored {
  let best: Scored | undefined;
  for (const child of index.children.get(one.note.ref) ?? []) {
    if (child === self) continue;
    const it = scored.get(child);
    if (it && (best === undefined || it.score > best.score)) best = it;
  }
  if (best === undefined || best.score === 0) return one;
  const worth = FAMILY_WEIGHT * best.score;
  return {
    ...one,
    score: one.score + worth,
    reasons:
      worth >= LEAST_REASON
        ? [
            ...one.reasons,
            {
              worth,
              said: `notes like it spring out of it, such as “${best.note.note.title}”`,
            },
          ]
        : one.reasons,
  };
}

function ranked(scored: readonly Scored[], limit: number): RelatedNote[] {
  return scored
    .filter((one) => one.score > 0 && one.reasons.length > 0)
    .sort((a, b) => b.score - a.score || a.note.ref.localeCompare(b.note.ref))
    .slice(0, limit)
    .map((one) => ({
      note: one.note.ref,
      title: one.note.note.title,
      ...(one.note.note.address === undefined
        ? {}
        : { address: one.note.note.address }),
      score: Math.round(one.score * 1000) / 1000,
      reasons: [...one.reasons]
        .sort((a, b) => b.worth - a.worth)
        .slice(0, MOST_RELATED_REASONS)
        .map((reason) => cut(reason.said)),
    }));
}

function cut(said: string): string {
  return said.length <= RELATED_REASON_MAX
    ? said
    : `${said.slice(0, RELATED_REASON_MAX - 1)}…`;
}

function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
