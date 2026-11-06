// Lines of the project's code quoted into a section, with where they were and
// what they digested to when they were quoted — docs/ARCHITECTURE.md § "Code
// quoted into a note".

import { z } from "zod";
import {
  CODE_SCHEME,
  CODE_SNIPPET_TYPE,
  digestIsSpelled,
  insideProject,
  PROJECT_PATH_MAX,
  parseCodeAnchor,
  snippetAnchorOf,
} from "./code-anchor.js";
import { codeLinesOf } from "./code-run.js";
import type { BlockDocument, DocumentNode } from "./document.js";

/** More lines than one snippet quotes: past this a section is the file. */
export const SNIPPET_LINES_MAX = 200;

/** Where a snippet's lines are: a run of whole lines of one file, from 1. */
export interface SnippetPlace {
  path: string;
  from: number;
  to: number;
}

/**
 * One quoted run of lines. `source` is exactly those lines as they stood,
 * joined with `\n` and with no newline after the last; `digest` is a digest of
 * that text's UTF-8 spelled as `CodeDigestSchema` spells one. **Absent
 * `language` is plain text.**
 */
export interface CodeSnippet extends SnippetPlace {
  digest: string;
  source: string;
  language?: string;
}

/** A word a fence's info string can open with to name the language, which is
 *  what a reader on a forge colours the lines by. */
const LANGUAGE = /^[^\s`]+$/;

/** A path a fence's info string can carry: one word, so a reader on a forge
 *  still reads the first word as the language. */
function spellable(path: string): boolean {
  return insideProject(path) && !/[\s`]/.test(path);
}

/** The lines `place` names in `text`, as a snippet quotes them; absent where
 *  the file has not got all of them. */
export function linesAt(text: string, place: SnippetPlace): string | undefined {
  const lines = codeLinesOf(text);
  if (place.from < 1 || place.to < place.from || place.to > lines.length) {
    return undefined;
  }
  return lines.slice(place.from - 1, place.to).join("\n");
}

/** `path#L<from>-L<to>`, as an answer names a snippet's place. */
export function snippetPlaceSpelled(place: SnippetPlace): string {
  return `${place.path}#L${place.from}-L${place.to}`;
}

/** The language a file's ending names, which is what a snippet quoted from it
 *  is coloured by; absent where it has none. */
export function languageNamedBy(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const ending = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9+#-]{1,16}$/.test(ending) ? ending : undefined;
}

/** What a fence's info string says of a snippet. `digest` absent is a
 *  snippet asked for and not yet quoted. */
export interface SnippetInfo extends SnippetPlace {
  language?: string;
  digest?: string;
}

/**
 * The info string a snippet's fence opens with: the language where it has
 * one, the place as a `code:` reference, and the digest — each one word, so a
 * forge reads the first as the language and the rest as nothing it draws.
 */
export function snippetInfo(info: SnippetInfo): string | undefined {
  if (!spellable(info.path)) return undefined;
  if (info.language !== undefined) {
    if (!LANGUAGE.test(info.language)) return undefined;
    if (info.language.startsWith(CODE_SCHEME)) return undefined;
  }
  if (info.digest !== undefined && !digestIsSpelled(info.digest)) {
    return undefined;
  }
  return [
    ...(info.language === undefined ? [] : [info.language]),
    `${CODE_SCHEME}${snippetPlaceSpelled(info)}`,
    ...(info.digest === undefined ? [] : [info.digest]),
  ].join(" ");
}

/** What an info string says of a snippet, or absent where it says something
 *  else — an ordinary fence, which stays one. */
export function readSnippetInfo(info: string): SnippetInfo | undefined {
  const words = info.split(" ");
  const at = words.findIndex((word) => word.startsWith(CODE_SCHEME));
  if (at !== 0 && at !== 1) return undefined;
  if (words.length > at + 2) return undefined;
  const language = at === 1 ? words[0] : undefined;
  if (language !== undefined && !LANGUAGE.test(language)) return undefined;
  const anchor = parseCodeAnchor(words[at]);
  if (anchor?.fragment?.kind !== "lines" || !spellable(anchor.path)) {
    return undefined;
  }
  const digest = words[at + 1];
  if (digest !== undefined && !digestIsSpelled(digest)) return undefined;
  return {
    path: anchor.path,
    from: anchor.fragment.from,
    to: anchor.fragment.to,
    ...(language === undefined ? {} : { language }),
    ...(digest === undefined ? {} : { digest }),
  };
}

/** The snippet an element holds, or absent where it is not one this build
 *  reads — which is carried untouched all the same. */
export function snippetOf(element: DocumentNode): CodeSnippet | undefined {
  if (element.type !== CODE_SNIPPET_TYPE) return undefined;
  const place = snippetAnchorOf(element);
  if (place?.fragment?.kind !== "lines") return undefined;
  const { digest, source, language } = element.attrs ?? {};
  if (typeof digest !== "string" || !digestIsSpelled(digest)) return undefined;
  if (typeof source !== "string") return undefined;
  if (language != null && typeof language !== "string") return undefined;
  return {
    path: place.path,
    from: place.fragment.from,
    to: place.fragment.to,
    digest,
    source,
    ...(typeof language === "string" && language !== "" ? { language } : {}),
  };
}

/** The element a snippet is. */
export function snippetNode(snippet: CodeSnippet): DocumentNode {
  const { path, from, to, digest, source, language } = snippet;
  return {
    type: CODE_SNIPPET_TYPE,
    attrs: {
      path,
      from,
      to,
      digest,
      source,
      ...(language === undefined ? {} : { language }),
    },
  };
}

/** Every snippet a section quotes, in the order it quotes them. */
export function snippetsOf(content: BlockDocument): CodeSnippet[] {
  const found: CodeSnippet[] = [];
  const walk = (nodes: readonly DocumentNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      const snippet = snippetOf(node);
      if (snippet) found.push(snippet);
      walk(node.content);
    }
  };
  walk(content.content);
  return found;
}

/** The same document with every element `change` answers for replaced by
 *  what it answers, everything else as it was. */
export function withSnippets(
  content: BlockDocument,
  change: (snippet: CodeSnippet) => CodeSnippet,
): BlockDocument {
  const map = (nodes: readonly DocumentNode[]): DocumentNode[] =>
    nodes.map((node) => {
      const snippet = snippetOf(node);
      if (snippet) return snippetNode(change(snippet));
      return node.content ? { ...node, content: map(node.content) } : node;
    });
  return { ...content, content: map(content.content ?? []) };
}

/**
 * Where the code a snippet quotes stands, worked out whenever somebody reads
 * it and never kept. `unchanged` is the same lines at the same place;
 * `moved` is the same text somewhere else, in that file or another;
 * `changed` is the place still there saying something else; `removed` is the
 * file or the lines gone; `unknown` is a digest spelled with an algorithm this
 * build does not take, which is never read as broken.
 */
export const SNIPPET_STATES = [
  "unchanged",
  "moved",
  "changed",
  "removed",
  "unknown",
] as const;
export type SnippetStateKind = (typeof SNIPPET_STATES)[number];

/** Whether a snippet in this state needs its note looked at again. */
export function snippetBroken(state: SnippetStateKind): boolean {
  return state === "moved" || state === "changed" || state === "removed";
}

/** Where the code under a snippet stands now, as `@sloppy/vault`'s
 *  `snippetState` works it out. */
export type SnippetState =
  | { state: "unchanged" | "removed" | "unknown" }
  | { state: "moved"; now: SnippetPlace }
  | { state: "changed"; now: SnippetPlace; says: string };

const SNIPPET_PLACE_MAX = PROJECT_PATH_MAX + 32;

/** Longer than the lines one snippet answers with. */
export const SNIPPET_SAYS_MAX = 16384;

/**
 * What an act reading a note says of one snippet in it. `at` is where it was
 * quoted from; `now` is where its text is found now, for `moved`, and the
 * lines it names, for `changed`; `says` is what those lines say now, for
 * `changed`.
 */
export const SnippetStandingSchema = z.object({
  at: z.string().max(SNIPPET_PLACE_MAX),
  state: z.enum(SNIPPET_STATES),
  now: z.string().max(SNIPPET_PLACE_MAX).optional(),
  says: z.string().max(SNIPPET_SAYS_MAX).optional(),
});
export type SnippetStanding = z.infer<typeof SnippetStandingSchema>;

/** One snippet's state as an answer says it. */
export function snippetStanding(
  snippet: SnippetPlace,
  held: SnippetState,
): SnippetStanding {
  const at = snippetPlaceSpelled(snippet);
  if (held.state === "moved") {
    return { at, state: held.state, now: snippetPlaceSpelled(held.now) };
  }
  if (held.state === "changed") {
    return {
      at,
      state: held.state,
      now: snippetPlaceSpelled(held.now),
      says: held.says.slice(0, SNIPPET_SAYS_MAX),
    };
  }
  return { at, state: held.state };
}
