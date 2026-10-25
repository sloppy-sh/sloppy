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
  fragmentSpelled,
  GIST_MAX,
  MOST_NOTES_FOUND,
  type Neighbour,
  type NeighbourRelation,
  type NodeView,
  type NoteRead,
  orderSiblings,
  type OwnedRef,
  PROJECT_PATH_MAX,
  parseCodeAnchor,
  citedNotes,
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
import { asListed, type NoteHere, notesHere, reaches } from "./here.js";
import { openingOf, wordsOf } from "./search.js";

/** The project's files as one act reads them: each file once. */
export interface CodeHere {
  bytes: CodeBytes;
  now: CodeNow;
  /** Whether a path that is no file is a folder with something in it. */
  folder: (path: string) => Promise<boolean>;
}

/** The code beside the graph `api` serves, or absent where it is nobody's
 *  project and there is none to read. */
export async function codeHere(api: LocalApi): Promise<CodeHere | undefined> {
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
  return { bytes, now: digestsIn(project, bytes), folder };
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
 *  `code` absent is a graph that is nobody's project. */
export async function noteRead(
  note: NodeView,
  blocks: readonly BlockView[],
  about: readonly string[],
  code: CodeHere | undefined,
): Promise<Omit<NoteRead, "more">> {
  const aside = emptySidecars(splitOwnedRef(note.ref).localId);
  const contents = blocks.map((block) => block.content);
  return {
    ...asListed(note, about),
    ...(note.edges === undefined || note.edges.length === 0
      ? {}
      : { edges: [...note.edges] }),
    sections: blocks.map((block) => {
      const id = splitOwnedRef(block.ref).localId;
      // A drawing's files are named after the section it is in, not the note.
      return {
        id,
        markdown: toMarkdown(block.content, { ...aside, block: id }),
      };
    }),
    ...(code === undefined
      ? {}
      : { anchors: await standingsOf(note, contents, code) }),
  };
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
      await codeHere(api),
    ),
    around: walk(field, [ref], depth),
  };
}

/**
 * What a task is briefed with: the notes named, then for each place the note
 * started about it or else every note reaching it, then the notes the words
 * reach — each once, in that order — and the notes one hop around them. A note
 * named that is not here is `missing`.
 */
export async function briefOf(
  api: LocalApi,
  asked: BriefArguments,
): Promise<
  { asked: BriefAsked[]; around: Neighbour[] } | { missing: OwnedRef }
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
  if (asked.words !== undefined) {
    const hits = (await api.searchNotes(asked.words)).slice(
      0,
      MOST_NOTES_FOUND,
    );
    for (const hit of hits) {
      const held = field.byRef.get(hit.note);
      if (held) take(held);
    }
  }
  const code = await codeHere(api);
  const notes = [...focal.values()];
  return {
    asked: await Promise.all(
      notes.map(async (held) => ({
        whole: await noteRead(held.note, held.blocks, held.about, code),
        gist: gistOf(held.blocks.map((block) => block.content)),
      })),
    ),
    around: walk(field, [...focal.keys()], 1),
  };
}
