// What an assistant is handed of the notes around a task: where the code under
// each anchor stands, a note's gist, its neighbourhood, and a brief. All of it
// is worked out from the files when it is asked for, and none of it is kept —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import {
  ABOUT_MAX,
  anchorsOf,
  type AnchorStanding,
  type AnchorStandingKind,
  type BlockDocument,
  type BlockView,
  type BriefArguments,
  type BriefAsked,
  type CodeAnchor,
  type CodeSnippet,
  type SnippetState,
  snippetPlaceSpelled,
  fragmentSpelled,
  GIST_MAX,
  MOST_NOTES_FOUND,
  type Neighbour,
  type NeighbourRelation,
  type NodeView,
  type NoteRead,
  orderSiblings,
  type QuotedDetail,
  type OwnedRef,
  PROJECT_PATH_MAX,
  parseCodeAnchor,
  citedNotes,
  codePlace,
  isAddress,
  sectionHeading,
  splitOwnedRef,
} from "@sloppy/types";
import {
  type CodeNow,
  digestComparable,
  driftOf,
  emptySidecars,
  toMarkdown,
} from "@sloppy/vault";
import type { LocalApi } from "./api.js";
import { bytesIn, type CodeBytes, digestsIn } from "./code.js";
import type { CodeReader } from "./code-index.js";
import { asListed, type NoteHere, notesHere, reaches } from "./here.js";
import { openingOf, wordsOf } from "./search.js";
import {
  foundElsewhereIn,
  type QuotedCode,
  quotesIn,
  quotesLeftOut,
  quotesSaid,
} from "./snippets.js";

/** The project's files as one act reads them: each file once. */
export interface CodeHere extends QuotedCode {
  bytes: CodeBytes;
  now: CodeNow;
  /** Whether a path that is no file is a folder with something in it. */
  folder: (path: string) => Promise<boolean>;
}

/** The code beside the graph `api` serves, or absent where it is nobody's
 *  project and there is none to read. */
export async function codeHere(
  api: LocalApi,
  code?: CodeReader,
): Promise<CodeHere | undefined> {
  const project = await api.projectFolder().catch(() => undefined);
  if (!project) return undefined;
  const bytes = bytesIn(project);
  const folders = new Map<string, Promise<boolean>>();
  const folder = (path: string): Promise<boolean> => {
    const held = folders.get(path);
    if (held) return held;
    const taking = project
      .list(path)
      .then((under) => under.length > 0)
      .catch(() => false);
    folders.set(path, taking);
    return taking;
  };
  return {
    bytes,
    now: digestsIn(project, bytes),
    folder,
    elsewhere: foundElsewhereIn(project, code),
  };
}

/**
 * Where the code under each anchor a note's writing holds stands now, in the
 * order the writing names them. A reading spelled with an algorithm this build
 * does not take is no reading, by the rule `driftOf` holds.
 */
export async function standingsOf(
  note: Pick<NodeView, "read_against">,
  contents: readonly BlockDocument[],
  code: CodeHere,
): Promise<AnchorStanding[]> {
  const drifted = new Set(await driftOf(note.read_against, code.now));
  const read = new Set(
    (note.read_against ?? [])
      .filter((reading) => digestComparable(reading.digest))
      .map((reading) => reading.path),
  );
  const standingOf = async (
    anchor: CodeAnchor,
  ): Promise<AnchorStandingKind> => {
    const bytes = await code.bytes(anchor.path);
    if (bytes === undefined) {
      return (await code.folder(anchor.path)) ? "unread" : "missing";
    }
    if (drifted.has(anchor.path) || !stillFinds(anchor, bytes)) return "moved";
    return read.has(anchor.path) ? "held" : "unread";
  };
  return Promise.all(
    anchorsIn(contents).map(async (anchor) => {
      const fragment = anchor.fragment && fragmentSpelled(anchor.fragment);
      return {
        path: anchor.path,
        ...(fragment === undefined ? {} : { fragment }),
        standing: await standingOf(anchor),
      };
    }),
  );
}

/** Every anchor across a note's sections, once each, as many as one answer
 *  names. */
function anchorsIn(contents: readonly BlockDocument[]): CodeAnchor[] {
  const found = new Map<string, CodeAnchor>();
  for (const content of contents) {
    for (const anchor of anchorsOf(content)) {
      const fragment = anchor.fragment && fragmentSpelled(anchor.fragment);
      if (anchor.path.length > PROJECT_PATH_MAX) continue;
      if (fragment !== undefined && fragment.length > PROJECT_PATH_MAX)
        continue;
      found.set(JSON.stringify([anchor.path, fragment ?? null]), anchor);
    }
  }
  return [...found.values()].slice(0, ABOUT_MAX);
}

/**
 * The exact lines each anchor a note's sections hold stands for, by
 * `codePlace`, one per anchor in the order {@link standingsOf} gives them: a
 * folder as its path and `/`, and an anchor whose file is not there or whose
 * name it no longer holds as it was written.
 */
export async function codePlacesIn(
  contents: readonly BlockDocument[],
  code: CodeHere,
): Promise<string[]> {
  const placed = await Promise.all(
    anchorsIn(contents).map(async (anchor) => {
      const bytes = await code.bytes(anchor.path);
      if (bytes === undefined) {
        return (await code.folder(anchor.path))
          ? `${anchor.path}/`
          : asWritten(anchor);
      }
      return (
        codePlace(anchor, new TextDecoder().decode(bytes)) ?? asWritten(anchor)
      );
    }),
  );
  return placed;
}

function asWritten(anchor: CodeAnchor): string {
  return anchor.fragment === undefined
    ? anchor.path
    : `${anchor.path}#${fragmentSpelled(anchor.fragment)}`;
}

/** Whether an anchor's fragment still finds something in the file: a name
 *  written in it, or a run of lines it still has. */
function stillFinds(anchor: CodeAnchor, bytes: Uint8Array): boolean {
  const fragment = anchor.fragment;
  if (fragment === undefined) return true;
  const text = new TextDecoder().decode(bytes);
  if (fragment.kind === "symbol") return text.includes(fragment.name);
  return fragment.to <= linesIn(text);
}

function linesIn(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/**
 * What a note says first: the first paragraph of its writing that is not an
 * anchor on its own, cut to {@link GIST_MAX}. A compass is not a paragraph, so
 * it is never a gist. Empty is a note with no such paragraph.
 */
export function gistOf(contents: readonly BlockDocument[]): string {
  for (const content of contents) {
    for (const element of content.content ?? []) {
      if (element.type !== "paragraph" || anchorAlone(element)) continue;
      const said = wordsOf(element);
      if (said !== "") return openingOf(said, GIST_MAX);
    }
  }
  return "";
}

/** Whether every word of a paragraph is the label of a link into code. */
function anchorAlone(paragraph: unknown): boolean {
  let anchored = 0;
  let plain = 0;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const held = node as { type?: unknown; text?: unknown; marks?: unknown };
    if (held.type === "text" && typeof held.text === "string") {
      if (held.text.trim() === "") return;
      const marks = Array.isArray(held.marks) ? held.marks : [];
      const intoCode = marks.some((mark) => {
        const href = (mark as { attrs?: { href?: unknown } })?.attrs?.href;
        return typeof href === "string" && parseCodeAnchor(href) !== undefined;
      });
      if (intoCode) anchored += 1;
      else plain += 1;
      return;
    }
    const inside = (node as { content?: unknown }).content;
    if (Array.isArray(inside)) for (const child of inside) walk(child);
  };
  walk(paragraph);
  return anchored > 0 && plain === 0;
}

/** One note read whole, without the count of what an answer leaves of it.
 *  `code` absent is a graph that is nobody's project; `landOnCode` adds the
 *  exact lines its anchors stand for; `quoted` is which quotes of code carry
 *  their lines. */
export async function noteRead(
  note: NodeView,
  blocks: readonly BlockView[],
  about: readonly string[],
  code: CodeHere | undefined,
  landOnCode = false,
  quoted: QuotedDetail = "broken",
): Promise<Omit<NoteRead, "more">> {
  const aside = emptySidecars(splitOwnedRef(note.ref).localId);
  const contents = blocks.map((block) => block.content);
  const quotes = code === undefined ? [] : await quotesIn(contents, code);
  const written = quoted === "all" ? contents : quotesLeftOut(contents, quotes);
  return {
    ...asListed(note, about),
    ...(note.edges === undefined || note.edges.length === 0
      ? {}
      : { edges: [...note.edges] }),
    sections: blocks.map((block, at) => {
      const id = splitOwnedRef(block.ref).localId;
      // A drawing's files are named after the section it is in, not the note.
      return {
        id,
        markdown: toMarkdown(written[at], { ...aside, block: id }),
      };
    }),
    ...(code === undefined
      ? {}
      : { anchors: await standingsOf(note, contents, code) }),
    ...(quotes.length === 0
      ? {}
      : { quoted: quotesSaid(quotes).slice(0, ABOUT_MAX) }),
    ...(code === undefined || !landOnCode
      ? {}
      : { code: followingMoves(await codePlacesIn(contents, code), quotes) }),
  };
}

/** The places a note points at, a quote whose code moved named where it is now. */
function followingMoves(
  places: readonly string[],
  quotes: readonly { snippet: CodeSnippet; state: SnippetState }[],
): string[] {
  const now = new Map(
    quotes.flatMap(({ snippet, state }) =>
      state.state === "moved"
        ? [[snippetPlaceSpelled(snippet), snippetPlaceSpelled(state.now)]]
        : [],
    ),
  );
  return [...new Set(places.map((place) => now.get(place) ?? place))];
}

/** The notes of one graph, and the ways each is reached from another. */
interface Field {
  byRef: ReadonlyMap<OwnedRef, NoteHere>;
  cites: ReadonlyMap<OwnedRef, OwnedRef[]>;
  citedBy: ReadonlyMap<OwnedRef, OwnedRef[]>;
  children: ReadonlyMap<OwnedRef, OwnedRef[]>;
}

function fieldOf(here: readonly NoteHere[]): Field {
  const byRef = new Map(here.map((held) => [held.note.ref, held]));
  const cites = new Map<OwnedRef, OwnedRef[]>();
  const citing = new Map<OwnedRef, NodeView[]>();
  const under = new Map<OwnedRef, NodeView[]>();
  for (const held of here) {
    const named = [
      ...new Set(held.blocks.flatMap((block) => citedNotes(block.content))),
    ].filter((ref) => ref !== held.note.ref);
    cites.set(held.note.ref, named);
    for (const ref of named) {
      citing.set(ref, [...(citing.get(ref) ?? []), held.note]);
    }
    const parent = held.note.parent;
    if (parent !== undefined) {
      under.set(parent, [...(under.get(parent) ?? []), held.note]);
    }
  }
  const ordered = (by: Map<OwnedRef, NodeView[]>) =>
    new Map(
      [...by].map(([ref, notes]) => [
        ref,
        orderSiblings(notes).map((note) => note.ref),
      ]),
    );
  return { byRef, cites, citedBy: ordered(citing), children: ordered(under) };
}

/** The ways out of one note, in the order a walk takes them. */
function stepsFrom(
  field: Field,
  held: NoteHere,
): [OwnedRef, NeighbourRelation][] {
  const ref = held.note.ref;
  const along = (
    refs: readonly OwnedRef[] | undefined,
    as: NeighbourRelation,
  ) => (refs ?? []).map((to): [OwnedRef, NeighbourRelation] => [to, as]);
  return [
    ...along(
      held.note.parent === undefined ? [] : [held.note.parent],
      "parent",
    ),
    ...along(field.cites.get(ref), "cites"),
    ...along(field.citedBy.get(ref), "cited_by"),
    ...along(field.children.get(ref), "child"),
    ...along(held.note.links, "linked"),
  ];
}

/**
 * The notes `depth` hops out from `from`, breadth first, each once and none of
 * `from` among them, in the order {@link stepsFrom} takes. A note that is not
 * in this graph — a link to somebody else's, or to one in the bin — is not
 * reached.
 */
function walk(
  field: Field,
  from: readonly OwnedRef[],
  depth: number,
): Neighbour[] {
  const seen = new Set(from);
  const reached: Neighbour[] = [];
  let frontier = from.flatMap((ref) => field.byRef.get(ref) ?? []);
  for (let hop = 1; hop <= depth && frontier.length > 0; hop += 1) {
    const next: NoteHere[] = [];
    for (const held of frontier) {
      for (const [to, relation] of stepsFrom(field, held)) {
        const there = field.byRef.get(to);
        if (!there || seen.has(to)) continue;
        seen.add(to);
        next.push(there);
        reached.push(asNeighbour(there, relation, hop));
      }
    }
    frontier = next;
  }
  return reached;
}

function asNeighbour(
  held: NoteHere,
  relation: NeighbourRelation,
  depth: number,
): Neighbour {
  const { note } = held;
  return {
    note: note.ref,
    title: note.title,
    ...(note.address === undefined ? {} : { address: note.address }),
    tags: [...note.tags],
    about: held.about.slice(0, ABOUT_MAX),
    relation,
    depth,
    gist: gistOf(held.blocks.map((block) => block.content)),
  };
}

/** One note whole and the notes `depth` hops around it, or absent where the
 *  note is not here. */
export async function aroundOf(
  api: LocalApi,
  ref: OwnedRef,
  depth: number,
  landOnCode = false,
  code?: CodeReader,
): Promise<
  | { note: NodeView; whole: Omit<NoteRead, "more">; around: Neighbour[] }
  | undefined
> {
  const field = fieldOf(await notesHere(api));
  const held = field.byRef.get(ref);
  if (!held) return undefined;
  return {
    note: held.note,
    whole: await noteRead(
      held.note,
      held.blocks,
      held.about,
      await codeHere(api, code),
      landOnCode,
    ),
    around: walk(field, [ref], depth),
  };
}

/**
 * What a task is briefed with: the notes named, then for each place the note
 * started about it or else every note reaching it, then the notes the words
 * reach — each once, in that order — and the notes one hop around them. A note
 * named that is not here is `missing`.
 *
 * `landOnCode` is the brief that ends the search: the words are read as a task,
 * reaching the few notes that carry the most of them rather than only the ones
 * carrying all, each carried with the section that opens it, the sections the
 * words reach and the exact lines of code those sections point at, or the
 * note's own where they point at none.
 */
export async function briefOf(
  api: LocalApi,
  asked: BriefArguments,
  landOnCode = false,
  reader?: CodeReader,
): Promise<
  | { asked: BriefAsked[]; around: Neighbour[]; here: NoteHere[] }
  | { missing: OwnedRef }
> {
  const here = await notesHere(api);
  const field = fieldOf(here);
  const focal = new Map<OwnedRef, NoteHere>();
  const take = (held: NoteHere) => {
    if (!focal.has(held.note.ref)) focal.set(held.note.ref, held);
  };
  for (const ref of asked.notes ?? []) {
    const held = field.byRef.get(ref);
    if (!held) return { missing: ref };
    take(held);
  }
  for (const path of asked.about ?? []) {
    const started = here.find((held) => held.startedAbout === path);
    if (started) take(started);
    else for (const held of here) if (reaches(held.about, path)) take(held);
  }
  const weights: TaskWeights =
    landOnCode && asked.words !== undefined
      ? taskWeights(here, asked.words)
      : new Map();
  if (asked.words !== undefined) {
    const hits =
      landOnCode && !isAddress(asked.words.trim().toLowerCase())
        ? reachedByTask(here, weights)
        : (await api.searchNotes(asked.words))
            .slice(0, MOST_NOTES_FOUND)
            .flatMap((hit) => field.byRef.get(hit.note) ?? []);
    for (const held of hits) take(held);
  }
  const code = await codeHere(api, reader);
  const notes = [...focal.values()];
  return {
    asked: await Promise.all(
      notes.map((held) => briefed(held, code, landOnCode, weights)),
    ),
    around: walk(field, [...focal.keys()], 1),
    here,
  };
}

async function briefed(
  held: NoteHere,
  code: CodeHere | undefined,
  landOnCode: boolean,
  weights: TaskWeights,
): Promise<BriefAsked> {
  const gist = gistOf(held.blocks.map((block) => block.content));
  const kept =
    weights.size === 0 ? held.blocks : reachedSections(held, weights);
  const whole = await noteRead(held.note, kept, held.about, code, landOnCode);
  if (kept.length === held.blocks.length) return { whole, gist };
  return {
    whole: {
      ...whole,
      headings: headingsOf(held),
      ...(whole.code?.length === 0 && code !== undefined
        ? await placesOfWhole(held, code)
        : {}),
    },
    gist,
    left: held.blocks.length - kept.length,
  };
}

/** Where the code under every anchor in a note stands and the lines each
 *  names, for a note whose sections a brief carries point at none. */
async function placesOfWhole(
  held: NoteHere,
  code: CodeHere,
): Promise<Pick<NoteRead, "anchors" | "code">> {
  const contents = held.blocks.map((block) => block.content);
  return {
    anchors: await standingsOf(held.note, contents, code),
    code: await codePlacesIn(contents, code),
  };
}

function headingsOf(held: NoteHere): string[] {
  const aside = emptySidecars(splitOwnedRef(held.note.ref).localId);
  return held.blocks.flatMap((block) => {
    const heading = sectionHeading(
      toMarkdown(block.content, {
        ...aside,
        block: splitOwnedRef(block.ref).localId,
      }),
    );
    return heading === undefined ? [] : [heading];
  });
}

/** The most notes a task's words reach in a brief that ends the search. */
const MOST_TASK_NOTES = 3;

/** Shorter than a word worth looking for in a task. */
const SHORTEST_TASK_WORD = 3;

/** Words a task is asked in that say nothing about what it is about. */
const SAYS_NOTHING = new Set(
  "about after again also and any are because been before being both but can cannot could did does doing each for from had has have how into its just like make more most much must not now off once only other our out over same should some such than that the their them then there these they this those through too under until very was way were what when where which while who why will with would you your".split(
    " ",
  ),
);

/** Whether a lowercase word says something about what writing is about. */
export function worthLookingFor(word: string): boolean {
  return word.length >= SHORTEST_TASK_WORD && !SAYS_NOTHING.has(word);
}

/** The words of a task worth looking for, each once. */
export function taskWords(task: string): string[] {
  const words = task.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words.filter(worthLookingFor))];
}

/** What each word of a task is worth: more the fewer notes here carry it. */
export type TaskWeights = ReadonlyMap<string, number>;

export function taskWeights(
  here: readonly NoteHere[],
  task: string,
): TaskWeights {
  const texts = here.map(textOf);
  return new Map(
    taskWords(task).map((word) => {
      const carrying = texts.filter((text) => text.includes(word)).length;
      return [
        word,
        carrying === 0 ? 0 : Math.log((here.length + 1) / carrying),
      ];
    }),
  );
}

function textOf(held: NoteHere): string {
  return [labelOf(held), ...held.blocks.map(writingOf)].join(" ");
}

function labelOf(held: NoteHere): string {
  return `${held.note.title} ${held.note.tags.join(" ")}`.toLowerCase();
}

function writingOf(block: BlockView): string {
  return wordsOf(block.content).toLowerCase();
}

/** What the words a piece of writing carries are worth together. */
function worth(weights: TaskWeights, ...texts: string[]): number {
  let sum = 0;
  for (const [word, weight] of weights) {
    if (texts.some((text) => text.includes(word))) sum += weight;
  }
  return sum;
}

/**
 * The notes a task's words reach best, best first: by what the words its
 * title, tags and best section carry together are worth, a word counting for
 * more the fewer notes carry it. A note worth less than three fifths of the
 * best one is not reached.
 */
export function reachedByTask(
  here: readonly NoteHere[],
  weights: TaskWeights,
): NoteHere[] {
  const scored = here.map((held) => {
    const label = labelOf(held);
    return {
      held,
      worth: Math.max(
        worth(weights, label),
        ...held.blocks.map((block) => worth(weights, label, writingOf(block))),
      ),
    };
  });
  const best = Math.max(0, ...scored.map((one) => one.worth));
  if (best === 0) return [];
  return scored
    .filter((one) => one.worth >= best * 0.6)
    .sort(
      (a, b) =>
        b.worth - a.worth || a.held.note.ref.localeCompare(b.held.note.ref),
    )
    .slice(0, MOST_TASK_NOTES)
    .map((one) => one.held);
}

/** The most sections of one note a brief that ends the search carries. */
const MOST_REACHED_SECTIONS = 2;

/**
 * The sections of a note a task's words reach, in the note's order: the one
 * that opens it, and those whose words are worth the most, up to
 * {@link MOST_REACHED_SECTIONS} of them.
 */
function reachedSections(held: NoteHere, weights: TaskWeights): BlockView[] {
  const scored = held.blocks.map((block, at) => ({
    block,
    at,
    worth: worth(weights, writingOf(block)),
  }));
  const best = Math.max(0, ...scored.map((one) => one.worth));
  const reached =
    best === 0
      ? []
      : scored
          .filter((one) => one.worth === best)
          .slice(0, MOST_REACHED_SECTIONS)
          .map((one) => one.block);
  const opening = openingSection(held.blocks);
  return held.blocks.filter(
    (block) => block === opening || reached.includes(block),
  );
}

/** The section a note opens with: its first with writing of its own, else its
 *  first. */
export function openingSection<Block extends BlockView>(
  blocks: readonly Block[],
): Block | undefined {
  return blocks.find(opens) ?? blocks[0];
}

/** Whether a section has writing of its own, not only a link into code. */
function opens(block: BlockView): boolean {
  return writingOf(block).trim() !== "" && !anchorAlone(block.content);
}
