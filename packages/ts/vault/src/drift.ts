// Whether the code a note was read against has moved since — docs/ARCHITECTURE.md
// § "A project's container". Nothing here is stored: a reading is, and this is
// what a reading is compared to.

import {
  CODE_DIGEST_ALGORITHM,
  type CodeReading,
  readingsRead,
} from "@sloppy/types";

/**
 * What a file in the project says NOW, as a digest spelled the way a reading
 * is. `undefined` is a path this checkout has not got.
 *
 * A caller with no project has no such function, and then nothing is worked
 * out: where the code cannot be read, a note is neither out of date nor up to
 * date — docs/ARCHITECTURE.md § "A project's container".
 */
export type CodeNow = (path: string) => Promise<string | undefined>;

/** A digest of these bytes, spelled with the algorithm that produced it. The
 *  one place Sloppy takes one. */
export async function digestOf(bytes: Uint8Array): Promise<string> {
  const digested = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  const hex = Array.from(new Uint8Array(digested))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${CODE_DIGEST_ALGORITHM}:${hex}`;
}

/**
 * The files a note was READ against that say something else now, or that this
 * checkout has not got, in path order. The readings are the whole of the
 * question, so a caller holding nothing but them — a canvas drawing a mark off
 * the note's row — asks exactly what a caller holding the note's writing asks.
 *
 * A path no reading covers is not asked about, which is how unread stays out of
 * stale: a note with no readings has nothing drifted under it, however far the
 * code has gone. So is a reading this build cannot reproduce — one spelled with
 * an algorithm it does not take — because nothing says a file has moved unless
 * it has been compared.
 */
export async function driftOf(
  readings: readonly CodeReading[] | undefined,
  now: CodeNow,
): Promise<string[]> {
  const read = new Map(
    (readings ?? [])
      .filter((reading) => comparable(reading.digest))
      .map((reading) => [reading.path, reading.digest]),
  );
  const paths = inOrder([...read.keys()]);
  const digests = await Promise.all(paths.map((path) => now(path)));
  return paths.filter((path, at) => digests[at] !== read.get(path));
}

/**
 * The readings a note takes when somebody says its reasoning still holds: one
 * per anchored path the project has, and none for a path it has not got —
 * there is nothing there to have read the note against.
 */
export async function readingsNow(
  anchored: readonly string[],
  now: CodeNow,
): Promise<CodeReading[]> {
  const paths = inOrder(anchored);
  const digests = await Promise.all(paths.map((path) => now(path)));
  return readingsRead(
    paths.flatMap((path, at) => {
      const digest = digests[at];
      return digest === undefined ? [] : [{ path, digest }];
    }),
  );
}

/** Whether this build can reproduce a digest spelled that way, which is the
 *  one algorithm {@link digestOf} writes. */
function comparable(digest: string): boolean {
  return digest.startsWith(`${CODE_DIGEST_ALGORITHM}:`);
}

/** Codepoint order, never a locale's, and without repeats. */
function inOrder(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
