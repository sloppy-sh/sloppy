// Whether the code a note points at has moved since somebody read the note
// against it — docs/ARCHITECTURE.md § "A project's container". Nothing here is
// stored: a reading is, and this is what a reading is compared to.

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

/** What the code has done under one note since somebody read it. */
export interface CodeDrift {
  /** Paths the note points at that have changed since it was read against
   *  them, or that the project has not got any more. In path order. */
  drifted: string[];
  /** Paths the note points at that nobody has read it against. In path
   *  order. */
  unread: string[];
}

/**
 * One note's anchored paths, told apart by the readings it carries. A path
 * whose reading this build cannot reproduce — one spelled with an algorithm it
 * does not take — is unread rather than drifted, which is the rule throughout:
 * nothing says a file has moved unless it has been compared.
 *
 * A note with no readings has nothing drifted under it, however far the code
 * has moved: unread is not stale.
 */
export async function driftOf(
  anchored: readonly string[],
  readings: readonly CodeReading[] | undefined,
  now: CodeNow,
): Promise<CodeDrift> {
  const read = new Map(
    (readings ?? []).map((reading) => [reading.path, reading.digest]),
  );
  const asked = inOrder(anchored).map((path) => {
    const was = read.get(path);
    return {
      path,
      was: was !== undefined && comparable(was) ? was : undefined,
    };
  });
  const digests = await Promise.all(
    asked.map(({ path, was }) => (was === undefined ? undefined : now(path))),
  );
  const drifted: string[] = [];
  const unread: string[] = [];
  asked.forEach(({ path, was }, at) => {
    if (was === undefined) unread.push(path);
    else if (digests[at] !== was) drifted.push(path);
  });
  return { drifted, unread };
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
