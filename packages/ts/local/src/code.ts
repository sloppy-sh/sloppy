// The project's own files, as the drift reader asks about them —
// docs/ARCHITECTURE.md § "A project's container".

import { type CodeNow, digestOf } from "@sloppy/vault";
import type { Files } from "./files.js";

/**
 * What each file in `project` says now, for {@link CodeNow}. One file is read
 * once however many notes point at it, so asking a graph's worth of notes
 * costs one pass over the code rather than one per note — which is also what
 * makes the answer the same for every note in that pass.
 *
 * Take a new one where the folder may have changed: this one answers what it
 * read the first time it was asked.
 */
export function digestsIn(project: Files): CodeNow {
  const read = new Map<string, Promise<string | undefined>>();
  return (path) => {
    const held = read.get(path);
    if (held) return held;
    const taking = project
      .read(path)
      .catch(() => undefined)
      .then((bytes) => (bytes === undefined ? undefined : digestOf(bytes)));
    read.set(path, taking);
    return taking;
  };
}
