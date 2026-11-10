// The window a harness puts in front of a model: the note that best answers an
// ask, the chain it sprang from, the notes beside it in its tags, the code it
// points at and the line saying where the reasons are, cut to a budget from the
// outside in. Composed per ask and never kept — note 1e12a.

import {
  type AnchorStanding,
  anchorRun,
  codeLinesOf,
  type NodeView,
  orderSiblings,
  type OwnedRef,
  parseCodeAnchor,
  runOpening,
  sectionHeading,
  type Window,
  type WindowAsk,
  type WindowCut,
  type WindowPart,
  type WindowPartKind,
} from "@sloppy/types";
import { AGENT_FILE, AGENT_MD } from "./agent-md.js";
import type { LocalApi } from "./api.js";
import {
  type CodeHere,
  codeHere,
  gistOf,
  noteRead,
  reachedByTask,
  standingsOf,
  taskWeights,
} from "./brief.js";
import type { CodeReader } from "./code-index.js";
import { CONTAINER_DIR } from "./container.js";
import { type NoteHere, notesHere } from "./here.js";

/** How many tokens a text takes for the model that will read it, whole. */
export type TokenCounter = (text: string) => number;

/** For a model whose tokenizer is not to hand: a token is about four
 *  characters. */
export const charsOver4: TokenCounter = (text) => Math.ceil(text.length / 4);

const INSTRUCTIONS_PATH = `${CONTAINER_DIR}/${AGENT_FILE}`;
/** The instructions file's opening paragraph, the one saying what the notes hold. */
const INSTRUCTIONS_LINE = AGENT_MD.split("\n\n")[1].replaceAll("\n", " ");

/** The kinds in the order the budget cuts them; the best note goes last. */
const CUT_ORDER: readonly WindowPartKind[] = [
  "code",
  "sibling",
  "ancestor",
  "instructions",
  "note",
];

export async function composeWindow(
  api: LocalApi,
  ask: WindowAsk,
  counter: TokenCounter,
  reader?: CodeReader,
): Promise<Window> {
  const here = await notesHere(api);
  const code = await codeHere(api, reader);
  const best = reachedByTask(here, taskWeights(here, ask.ask))[0];
  const part = <P extends Omit<WindowPart, "tokens">>(held: P) =>
    ({ ...held, tokens: counter(held.text) }) as P & { tokens: number };

  const parts: WindowPart[] = [];
  let shortNote: WindowPart | undefined;
  if (best !== undefined) {
    const byRef = new Map(here.map((held) => [held.note.ref, held]));
    const chain = chainOf(best, byRef, ask.depth);
    const beside = besideInTags(best, chain, here);
    const ref = best.note.ref;
    parts.push(part({ kind: "note", ref, text: await wholeOf(best) }));
    shortNote = part({ kind: "note", ref, text: await shortOf(best) });
    for (const held of chain) {
      parts.push(
        part({
          kind: "ancestor",
          ref: held.note.ref,
          text: await shortOf(held),
        }),
      );
    }
    for (const note of beside) {
      parts.push(part({ kind: "sibling", ref: note.ref, text: labelOf(note) }));
    }
    if (code !== undefined) {
      for (const standing of await standingsOf(
        best.note,
        best.blocks.map((block) => block.content),
        code,
      )) {
        parts.push(
          part({
            ...standing,
            kind: "code",
            text: await linesOf(standing, code),
          }),
        );
      }
    }
  }
  if (code !== undefined) {
    parts.push(
      part({
        kind: "instructions",
        path: INSTRUCTIONS_PATH,
        text: INSTRUCTIONS_LINE,
      }),
    );
  }
  return { ...cutToBudget(parts, ask.budget, shortNote), budget: ask.budget };
}

/** The notes `best` sprang from, its parent first, at most `depth` of them, as
 *  far as the chain stays in this graph. */
function chainOf(
  best: NoteHere,
  byRef: ReadonlyMap<OwnedRef, NoteHere>,
  depth: number,
): NoteHere[] {
  const chain: NoteHere[] = [];
  const seen = new Set<OwnedRef>([best.note.ref]);
  let parent = best.note.parent;
  while (parent !== undefined && chain.length < depth && !seen.has(parent)) {
    const held = byRef.get(parent);
    if (held === undefined) break;
    chain.push(held);
    seen.add(parent);
    parent = held.note.parent;
  }
  return chain;
}

/** Every other note carrying one of `best`'s tags, that is not already in the
 *  window as its chain, in the order a run reads. */
function besideInTags(
  best: NoteHere,
  chain: readonly NoteHere[],
  here: readonly NoteHere[],
): NodeView[] {
  const tags = new Set(best.note.tags);
  const taken = new Set([best.note.ref, ...chain.map((held) => held.note.ref)]);
  return orderSiblings(
    here
      .map((held) => held.note)
      .filter(
        (note) =>
          !taken.has(note.ref) && note.tags.some((tag) => tags.has(tag)),
      ),
  );
}

function labelOf(note: Pick<NodeView, "address" | "title">): string {
  return note.address === undefined
    ? note.title
    : `${note.address} ${note.title}`;
}

async function sectionsOf(held: NoteHere): Promise<string[]> {
  const read = await noteRead(held.note, held.blocks, held.about, undefined);
  return read.sections.map((section) => section.markdown);
}

async function wholeOf(held: NoteHere): Promise<string> {
  return [`# ${labelOf(held.note)}`, ...(await sectionsOf(held))].join("\n\n");
}

/** A note as its opening and its headings. */
async function shortOf(held: NoteHere): Promise<string> {
  const opening = gistOf(held.blocks.map((block) => block.content));
  const headings = (await sectionsOf(held)).flatMap(
    (markdown) => sectionHeading(markdown) ?? [],
  );
  return [
    `# ${labelOf(held.note)}`,
    ...(opening === "" ? [] : [opening]),
    ...(headings.length === 0
      ? []
      : [headings.map((h) => `- ${h}`).join("\n")]),
  ].join("\n\n");
}

/** The anchor as written and its standing, then the lines it stands for where
 *  the file still has them. */
async function linesOf(
  standing: AnchorStanding,
  code: CodeHere,
): Promise<string> {
  const place =
    standing.fragment === undefined
      ? standing.path
      : `${standing.path}#${standing.fragment}`;
  const said = `${place} (${standing.standing})`;
  const anchor = parseCodeAnchor(`code:${place}`);
  const bytes = await code.bytes(standing.path);
  if (anchor === undefined || bytes === undefined) return said;
  const lines = codeLinesOf(new TextDecoder().decode(bytes));
  const run = anchorRun(lines, anchor);
  if (run.kind === "missing") return said;
  if (run.kind === "whole") return `${said}\n${lines.join("\n")}`;
  const from =
    anchor.fragment?.kind === "symbol" ? runOpening(run.from) : run.from;
  return `${said}\n${lines.slice(from - 1, run.to).join("\n")}`;
}

const tokensOf = (parts: readonly WindowPart[]) =>
  parts.reduce((sum, part) => sum + part.tokens, 0);

/**
 * Takes parts out, kind by kind in {@link CUT_ORDER} and the last of a kind
 * first, until what is left fits `budget`. The best note is shortened to
 * `shortNote` before it is dropped.
 */
function cutToBudget(
  composed: readonly WindowPart[],
  budget: number,
  shortNote: WindowPart | undefined,
): Pick<Window, "parts" | "cut"> {
  const parts = [...composed];
  const cut: WindowCut[] = [];
  const record = (part: WindowPart, saved: number) => {
    const { text: _, ...source } = part;
    cut.push({ ...source, tokens: saved } as WindowCut);
  };
  for (const kind of CUT_ORDER) {
    for (let at = parts.length - 1; at >= 0; at -= 1) {
      if (tokensOf(parts) <= budget) return { parts, cut };
      const part = parts[at];
      if (part.kind !== kind) continue;
      if (
        kind === "note" &&
        shortNote !== undefined &&
        shortNote.tokens < part.tokens
      ) {
        parts[at] = shortNote;
        record(part, part.tokens - shortNote.tokens);
        if (tokensOf(parts) <= budget) return { parts, cut };
      }
      record(parts[at], parts[at].tokens);
      parts.splice(at, 1);
    }
  }
  return { parts, cut };
}
