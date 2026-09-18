// Which of a note's anchors the code has moved under since it was read —
// docs/ARCHITECTURE.md § "Tooling and the review". The app asks its shell's
// `History.changedSince`; a terminal asks the history the project is kept in.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ran = promisify(execFile);

/** What a diff of a whole tree may come back as before this stops reading it. */
const MOST_BYTES = 16 * 1024 * 1024;

/** A commit as git writes one down. A note's front matter is the project
 *  author's writing rather than the runner's, and git reads a word beginning
 *  with `-` in this position as an option of its own, so anything that is not
 *  an object name is not handed to it at all. */
const A_COMMIT = /^[0-9a-f]{4,64}$/i;

/** A project whose history cannot be read — no git here, no repository there,
 *  a commit it has never heard of — has moved nothing, which is the same
 *  answer a project that is not a repository at all gives. */
export function movedSince(
  project: string,
): (checked: string, paths: readonly string[]) => Promise<string[]> {
  return async (checked, paths) => {
    if (paths.length === 0 || !A_COMMIT.test(checked)) return [];
    let out: string;
    try {
      const done = await ran(
        "git",
        ["diff", "--name-only", "--relative", checked, "--", ...paths],
        { cwd: project, maxBuffer: MOST_BYTES },
      );
      out = done.stdout;
    } catch {
      return [];
    }
    const touched = out.split("\n").filter((line) => line !== "");
    return paths.filter((path) =>
      touched.some((held) => held === path || held.startsWith(`${path}/`)),
    );
  };
}
