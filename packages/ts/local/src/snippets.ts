// Quotes of the project's code in a note: taken from the files as they are when
// somebody writes one, and read against the files whenever the note is read —
// docs/ARCHITECTURE.md § "Code quoted into a note".

import {
  type BlockDocument,
  CODE_SNIPPET_TYPE,
  type CodeSnippet,
  type DocumentNode,
  readSnippetInfo,
  SNIPPET_LINES_MAX,
  type SnippetPlace,
  type SnippetState,
  type SnippetStanding,
  snippetNode,
  snippetOf,
  snippetPlaceSpelled,
  snippetStanding,
  snippetsOf,
  withSnippets,
} from "@sloppy/types";
import { type FoundElsewhere, quoteOf, snippetState } from "@sloppy/vault";
import type { CodeBytes } from "./code.js";
import {
  type CodeFile,
  type CodeIndex,
  type CodeReader,
  codeFound,
} from "./code-index.js";
import { symbolsIn } from "./code-symbols.js";
import type { Files } from "./files.js";

/** The most other files one quote's text is looked for in. */
const MOST_LOOKED_IN = 16;

/**
 * Where a quote's text stands in another file of `project`: the files the
 * project's code index names for what the quote defines and the names it
 * spells, each read and compared line for line. Absent `code` is a surface
 * with no index, where nothing outside the quoted file is looked in.
 */
export function foundElsewhereIn(
  project: Files,
  code?: CodeReader,
): FoundElsewhere {
  if (code === undefined) return async () => undefined;
  let index: Promise<CodeIndex | undefined> | undefined;
  return async (snippet) => {
    index ??= code(project.root).catch(() => undefined);
    const held = await index;
    if (held === undefined) return undefined;
    for (const path of filesNamedFor(held, snippet)) {
      const text = await textIn(project, path);
      if (text === undefined) continue;
      const there = await snippetState({ ...snippet, path }, text);
      if (there.state === "unchanged") {
        return { path, from: snippet.from, to: snippet.to };
      }
      if (there.state === "moved") return there.now;
    }
    return undefined;
  };
}

/** The files other than the quoted one that may hold its text: those defining
 *  a name the quote defines, then those its names reach. */
function filesNamedFor(index: CodeIndex, snippet: CodeSnippet): string[] {
  const paths = new Set<string>();
  for (const { name } of symbolsIn(snippet.path, snippet.source)) {
    for (const doc of index.named.get(name.toLowerCase()) ?? []) {
      paths.add((index.files[index.file[doc] as number] as CodeFile).path);
    }
  }
  const names = [
    ...new Set(snippet.source.match(/[A-Za-z_$][\w$]{2,}/g) ?? []),
  ].join(" ");
  for (const hit of codeFound(index, names, MOST_LOOKED_IN))
    paths.add(hit.path);
  paths.delete(snippet.path);
  return [...paths].slice(0, MOST_LOOKED_IN);
}

async function textIn(
  project: Files,
  path: string,
): Promise<string | undefined> {
  const bytes = await project.read(path).catch(() => undefined);
  return bytes === undefined || bytes.includes(0)
    ? undefined
    : AS_TEXT.decode(bytes);
}

const AS_TEXT = new TextDecoder();

/** What a file says, read through `bytes`; absent where the checkout has not
 *  got it or what is there is not text. */
export async function textThrough(
  bytes: CodeBytes,
  path: string,
): Promise<string | undefined> {
  const held = await bytes(path);
  return held === undefined || held.includes(0)
    ? undefined
    : AS_TEXT.decode(held);
}

/** The code a quote is read against: each file's text, and where else to look
 *  for a quote's text once its own file has not got it. */
export interface QuotedCode {
  bytes: CodeBytes;
  elsewhere: FoundElsewhere;
}

/** Every quote a note's sections hold, in order, with where the code under it
 *  stands now. */
export async function quotesIn(
  contents: readonly BlockDocument[],
  code: QuotedCode,
): Promise<{ snippet: CodeSnippet; state: SnippetState }[]> {
  return Promise.all(
    contents.flatMap(snippetsOf).map(async (snippet) => ({
      snippet,
      state: await snippetState(
        snippet,
        await textThrough(code.bytes, snippet.path),
        code.elsewhere,
      ),
    })),
  );
}

/** Each quote as an answer says where it stands. */
export function quotesSaid(
  quotes: readonly { snippet: CodeSnippet; state: SnippetState }[],
): SnippetStanding[] {
  return quotes.map(({ snippet, state }) => snippetStanding(snippet, state));
}

/**
 * The sections with the lines left out of every quote whose code still says
 * what it quoted — unchanged where it was, or moved whole — so an answer
 * carries the lines only of the quotes somebody has to look at again.
 */
export function quotesLeftOut(
  contents: readonly BlockDocument[],
  quotes: readonly { snippet: CodeSnippet; state: SnippetState }[],
): BlockDocument[] {
  const still = new Set(
    quotes
      .filter(
        ({ state }) => state.state === "unchanged" || state.state === "moved",
      )
      .map(({ snippet }) => sameQuote(snippet)),
  );
  return contents.map((content) =>
    withSnippets(content, (snippet) =>
      still.has(sameQuote(snippet)) ? { ...snippet, source: "" } : snippet,
    ),
  );
}

function sameQuote(snippet: CodeSnippet): string {
  return JSON.stringify([
    snippet.path,
    snippet.from,
    snippet.to,
    snippet.digest,
  ]);
}

/** Why a quote asked for could not be taken, in words for whoever asked. */
export class QuoteRefused extends Error {}

/**
 * The sections an agent wrote, with every quote in them taken from the files:
 * a quote the note already holds — the same place and digest — keeps the
 * lines it holds, and every other one, and every fence that names a place and
 * no digest, is quoted from the file as it is now. So nothing an agent writes
 * puts lines in a quote that the code did not say.
 *
 * Throws {@link QuoteRefused} where a quote names lines the project has not
 * got, or the graph has no code beside it to quote from.
 */
export async function quotesTaken(
  sections: readonly BlockDocument[],
  held: readonly BlockDocument[],
  project: Files | undefined,
): Promise<BlockDocument[]> {
  const kept = new Map(
    held.flatMap(snippetsOf).map((snippet) => [sameQuote(snippet), snippet]),
  );
  const quote = async (
    place: SnippetPlace,
    language: string | undefined,
  ): Promise<CodeSnippet> => {
    const lines = place.to - place.from + 1;
    if (lines > SNIPPET_LINES_MAX) {
      throw new QuoteRefused(
        `A quote is at most ${SNIPPET_LINES_MAX} lines; ${snippetPlaceSpelled(place)} is ${lines}. Quote less of it, or point at the file with a code: link.`,
      );
    }
    if (project === undefined) {
      throw new QuoteRefused(
        "This graph has no code beside it to quote from. Point at the code with a code: link instead.",
      );
    }
    const text = await textIn(project, place.path);
    const quoted =
      text === undefined ? undefined : await quoteOf(text, place, language);
    if (!quoted) {
      throw new QuoteRefused(
        `The project has no lines ${place.from}-${place.to} in ${place.path} now. Read the file and quote lines it has.`,
      );
    }
    return quoted;
  };
  const taken = async (node: DocumentNode): Promise<DocumentNode> => {
    const snippet = snippetOf(node);
    if (snippet) {
      return snippetNode(
        kept.get(sameQuote(snippet)) ??
          (await quote(snippet, snippet.language)),
      );
    }
    const asked =
      node.type === "codeBlock" && typeof node.attrs?.language === "string"
        ? readSnippetInfo(node.attrs.language)
        : undefined;
    if (asked) return snippetNode(await quote(asked, asked.language));
    if (node.type === CODE_SNIPPET_TYPE || !node.content) return node;
    return { ...node, content: await Promise.all(node.content.map(taken)) };
  };
  return Promise.all(
    sections.map(async (section) => ({
      ...section,
      content: await Promise.all((section.content ?? []).map(taken)),
    })),
  );
}
