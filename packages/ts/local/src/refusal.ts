// How a graph on this device refuses. The surfaces read a refusal the way they
// read a server's — `serverMessage` in `@sloppy/app-core` — so the words a
// person sees are the ones written here.

import { SloppyApiError } from "@sloppy/client";
import { VaultFormatError } from "@sloppy/vault";

function said(status: number, words: string): SloppyApiError {
  return new SloppyApiError(status, words, { detail: words });
}

/** Something asked for that this graph will not do. */
export function refuse(words: string): SloppyApiError {
  return said(400, words);
}

/** Something asked for that is not here. */
export function absent(words: string): SloppyApiError {
  return said(404, words);
}

/** Something written somewhere else since the writer last read it. The status
 *  is what `saveFailure` reads to tell a writing surface to reopen the note. */
export function contested(words: string): SloppyApiError {
  return said(409, words);
}

/** A section the note no longer holds, told apart from a note that is not here
 *  so a writing surface can offer its writing back rather than refuse it. */
export function sectionGone(words: string): SloppyApiError {
  return said(410, words);
}

/**
 * A request read through the schema that states what it may say, so a graph on
 * this device refuses a shape in the same words a hosted one refuses it in.
 */
export function checked<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    const issues = (err as { issues?: { message?: string }[] }).issues;
    throw refuse(
      issues?.[0]?.message ?? "Sloppy is out of date. Update it and try again.",
    );
  }
}

/** A framework's phrase, never words a person can act on. */
const UNWRITTEN = "Internal server error";

/**
 * The words a refusal carries for a person, where it carries any: this store's
 * own, a server's, or what a folder this build cannot read says about itself.
 * Anything else is the inside of an error and is said to nobody.
 */
export function refusalWords(err: unknown): string | undefined {
  const said =
    typeof err === "string"
      ? err
      : err instanceof VaultFormatError
        ? err.message
        : err instanceof SloppyApiError &&
            !(err.status >= 500 && err.detail === UNWRITTEN)
          ? err.detail
          : undefined;
  return said?.trim() || undefined;
}
