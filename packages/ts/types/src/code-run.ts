// Which lines of a file an anchor into code stands for, read the same way by
// the app's code sheet and by an assistant handed the place — DESIGN.md § "An
// anchor into code".

import type { CodeAnchor } from "./code-anchor.js";

/** How much of the file a name found in it stands for. */
export const RUN_LINES = 40;
/** How much of the run stands above the line the name is on. */
const LEAD = 2;

/** The file's lines, with the newline every file ends with left off the end so
 *  the count is the one an editor shows. */
export function codeLinesOf(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Which line a name is on, from 1; absent where the file no longer holds it.
 *  Nothing parses the file, so two things of one name resolve to the first. */
export function lineNamed(
  lines: readonly string[],
  name: string,
): number | undefined {
  const word = new RegExp(
    `(?:^|[^A-Za-z0-9_$])${escaped(name)}(?![A-Za-z0-9_$])`,
  );
  const alone = lines.findIndex((line) => word.test(line));
  if (alone !== -1) return alone + 1;
  const anywhere = lines.findIndex((line) => line.includes(name));
  return anywhere === -1 ? undefined : anywhere + 1;
}

function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Which lines of the file as it is now an anchor marks: a run of lines, the
 *  stretch from a name to the end of the run shown around it, the whole file,
 *  or a name the file no longer holds. */
export type AnchorRun =
  | { kind: "lines"; from: number; to: number }
  | { kind: "whole" }
  | { kind: "missing" };

export function anchorRun(
  lines: readonly string[],
  anchor: CodeAnchor,
): AnchorRun {
  const total = lines.length;
  const held = anchor.fragment;
  if (held === undefined) return { kind: "whole" };
  if (held.kind === "lines") {
    const from = Math.min(Math.max(held.from, 1), total);
    return {
      kind: "lines",
      from,
      to: Math.max(from, Math.min(held.to, total)),
    };
  }
  const named = lineNamed(lines, held.name);
  if (named === undefined) return { kind: "missing" };
  return {
    kind: "lines",
    from: named,
    to: Math.min(total, runOpening(named) + RUN_LINES - 1),
  };
}

/** The first line shown of a run that starts at a name on `line`. */
export function runOpening(line: number): number {
  return Math.max(1, line - LEAD);
}

/**
 * The lines an anchor stands for in the file as `text` holds it, spelled
 * `path#L<from>-L<to>` the way an editor opens them: a run of lines, the
 * stretch a name opens, or every line of the file. **Absent is a name the file
 * no longer holds.**
 */
export function codePlace(
  anchor: CodeAnchor,
  text: string,
): string | undefined {
  const lines = codeLinesOf(text);
  const run = anchorRun(lines, anchor);
  if (run.kind === "missing") return undefined;
  if (run.kind === "whole") return `${anchor.path}#L1-L${lines.length}`;
  const from =
    anchor.fragment?.kind === "symbol" ? runOpening(run.from) : run.from;
  return `${anchor.path}#L${from}-L${run.to}`;
}
