// The project's own files, as the drift reader asks about them —
// docs/ARCHITECTURE.md § "A project's container".

import { type CodeNow, digestOf } from "@sloppy/vault";
import type { Files } from "./files.js";

/** What a file in the project holds. `undefined` is a path this checkout has
 *  not got. */
export type CodeBytes = (path: string) => Promise<Uint8Array | undefined>;

/**
 * What each file in `project` holds, read once however often it is asked.
 * Take a new one where the folder may have changed: this one answers what it
 * read the first time it was asked.
 */
export function bytesIn(project: Files): CodeBytes {
  const read = new Map<string, Promise<Uint8Array | undefined>>();
  return (path) => {
    const held = read.get(path);
    if (held) return held;
    const taking = project.read(path).catch(() => undefined);
    read.set(path, taking);
    return taking;
  };
}

/**
 * What each file in `project` says now, for {@link CodeNow}. One file is read
 * once however many notes point at it, so asking a graph's worth of notes
 * costs one pass over the code rather than one per note — which is also what
 * makes the answer the same for every note in that pass. Hand it the
 * {@link bytesIn} a caller reading the files' text already holds, so a file is
 * read once for both.
 *
 * Take a new one where the folder may have changed: this one answers what it
 * read the first time it was asked.
 */
export function digestsIn(
  project: Files,
  bytes: CodeBytes = bytesIn(project),
): CodeNow {
  const read = new Map<string, Promise<string | undefined>>();
  return (path) => {
    const held = read.get(path);
    if (held) return held;
    const taking = bytes(path).then((found) =>
      found === undefined ? undefined : digestOf(found),
    );
    read.set(path, taking);
    return taking;
  };
}
