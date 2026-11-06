// Quoting lines of the project's code into a note, and where the code under a
// quote stands now — docs/ARCHITECTURE.md § "Code quoted into a note". Nothing
// here is stored: a quote is, and this is what a quote is compared to.

import {
  type CodeSnippet,
  codeLinesOf,
  languageNamedBy,
  linesAt,
  type SnippetPlace,
  type SnippetState,
} from "@sloppy/types";
import { digestComparable, digestOf } from "./drift.js";

/** A digest of the text a quote holds, spelled as every reading is. */
export function digestOfText(text: string): Promise<string> {
  return digestOf(new TextEncoder().encode(text));
}

/**
 * The quote of `place` in `text` — the file as it stands — or absent where the
 * file has not got those lines. `language` absent is the one the file's
 * ending names.
 */
export async function quoteOf(
  text: string,
  place: SnippetPlace,
  language: string | undefined = languageNamedBy(place.path),
): Promise<CodeSnippet | undefined> {
  const source = linesAt(text, place);
  if (source === undefined) return undefined;
  return {
    path: place.path,
    from: place.from,
    to: place.to,
    digest: await digestOfText(source),
    source,
    ...(language === undefined ? {} : { language }),
  };
}

/** Where a quote's text stands somewhere other than the file it was quoted
 *  from; absent is nowhere that was looked. */
export type FoundElsewhere = (
  snippet: CodeSnippet,
) => Promise<SnippetPlace | undefined>;

/**
 * Where the code under a quote stands. `text` is the file it was quoted from
 * as it is now, absent where the checkout has not got it; `elsewhere` is asked
 * only once that file has not got the text.
 */
export async function snippetState(
  snippet: CodeSnippet,
  text: string | undefined,
  elsewhere?: FoundElsewhere,
): Promise<SnippetState> {
  if (!digestComparable(snippet.digest)) return { state: "unknown" };
  const lines = text === undefined ? undefined : codeLinesOf(text);
  if (lines !== undefined) {
    const there = linesAt(text as string, snippet);
    if (there !== undefined && (await digestOfText(there)) === snippet.digest) {
      return { state: "unchanged" };
    }
    const moved = await foundIn(lines, snippet);
    if (moved) return { state: "moved", now: moved };
  }
  const away = await elsewhere?.(snippet);
  if (away) return { state: "moved", now: away };
  if (lines === undefined || snippet.from > lines.length) {
    return { state: "removed" };
  }
  const now = {
    path: snippet.path,
    from: snippet.from,
    to: Math.min(snippet.to, lines.length),
  };
  return {
    state: "changed",
    now,
    says: lines.slice(now.from - 1, now.to).join("\n"),
  };
}

/** The run of the file's lines holding the quote's text, nearest the place it
 *  was quoted from — where that text is still what the quote digested. */
async function foundIn(
  lines: readonly string[],
  snippet: CodeSnippet,
): Promise<SnippetPlace | undefined> {
  const length = snippet.to - snippet.from + 1;
  const first = snippet.source.split("\n", 1)[0];
  let nearest: number | undefined;
  for (let at = 0; at + length <= lines.length; at++) {
    if (lines[at] !== first) continue;
    if (lines.slice(at, at + length).join("\n") !== snippet.source) continue;
    const from = at + 1;
    if (
      nearest === undefined ||
      Math.abs(from - snippet.from) < Math.abs(nearest - snippet.from)
    ) {
      nearest = from;
    }
  }
  if (nearest === undefined) return undefined;
  if ((await digestOfText(snippet.source)) !== snippet.digest) return undefined;
  return { path: snippet.path, from: nearest, to: nearest + length - 1 };
}
