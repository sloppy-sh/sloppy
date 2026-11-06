// `sloppy organise --review <branch>`: what a draft did to the notes, note by
// note — docs/ARCHITECTURE.md § "Tooling".

import { CONTAINER_DIR } from "@sloppy/local";
import { lookOn, type OwnedRef } from "@sloppy/types";
import {
  decodeText,
  noteAt,
  type Vault,
  type VaultDifference,
  type VaultNote,
  vaultDifference,
  vaultToNote,
} from "@sloppy/vault";
import { filesAt, git } from "./git.js";
import {
  baseOf,
  keptIn,
  NO_BRANCH,
  OrganiseRefused,
} from "./organise-draft.js";

/** A line between two notes, read from the note it was drawn out of. */
export interface LineDrawn {
  note: OwnedRef;
  to: OwnedRef;
  /** **Absent is a line that says nothing.** */
  label?: string;
}

export interface Review {
  branch: string;
  difference: VaultDifference;
  lines: { drawn: LineDrawn[]; taken: LineDrawn[]; relabelled: LineDrawn[] };
  /** Every note either side holds, for naming them. */
  titles: Map<OwnedRef, { title: string; address?: string }>;
}

export async function reviewOf(
  project: string,
  branch: string,
): Promise<Review> {
  const { top, prefix } = await keptIn(project);
  const tip = await git(top, ["rev-parse", "--verify", `refs/heads/${branch}`])
    .then((said) => said.trim())
    .catch(() => {
      throw new OrganiseRefused(NO_BRANCH);
    });
  const base = await baseOf(top, branch);
  const container =
    prefix === "" ? CONTAINER_DIR : `${prefix}/${CONTAINER_DIR}`;
  const before = await filesAt(top, base, container);
  const after = await filesAt(top, tip, container);
  const was = notesOf(before);
  const now = notesOf(after);
  const titles = new Map<OwnedRef, { title: string; address?: string }>();
  for (const note of [...was.values(), ...now.values()]) {
    titles.set(note.ref, {
      title: note.title,
      ...(note.address === undefined ? {} : { address: note.address }),
    });
  }
  return {
    branch,
    difference: vaultDifference(before, after),
    lines: linesBetween(was, now),
    titles,
  };
}

function notesOf(vault: Vault): Map<OwnedRef, VaultNote> {
  const held = new Map<OwnedRef, VaultNote>();
  for (const [path, bytes] of vault) {
    if (noteAt(path) === undefined) continue;
    try {
      const note = vaultToNote({ markdown: decodeText(bytes) });
      held.set(note.ref, note);
    } catch {
      // A file in the folder that is somebody's own, not a note.
    }
  }
  return held;
}

/** The lines either side draws, each once, from the note whose ref sorts
 *  first. */
function linesBetween(
  was: ReadonlyMap<OwnedRef, VaultNote>,
  now: ReadonlyMap<OwnedRef, VaultNote>,
): Review["lines"] {
  const before = lines(was);
  const after = lines(now);
  const drawn: LineDrawn[] = [];
  const taken: LineDrawn[] = [];
  const relabelled: LineDrawn[] = [];
  for (const [pair, line] of after) {
    const held = before.get(pair);
    if (held === undefined) drawn.push(line);
    else if (held.label !== line.label) relabelled.push(line);
  }
  for (const [pair, line] of before) {
    if (!after.has(pair)) taken.push(line);
  }
  return { drawn, taken, relabelled };
}

function lines(
  notes: ReadonlyMap<OwnedRef, VaultNote>,
): Map<string, LineDrawn> {
  const held = new Map<string, LineDrawn>();
  for (const ref of [...notes.keys()].sort()) {
    const note = notes.get(ref);
    if (!note) continue;
    for (const to of [...note.links].sort()) {
      const [a, b] = [ref, to].sort();
      const pair = `${a} ${b}`;
      if (held.has(pair)) continue;
      const label = labelOf(notes, ref, to) ?? labelOf(notes, to, ref);
      held.set(pair, {
        note: ref,
        to,
        ...(label === undefined ? {} : { label }),
      });
    }
  }
  return held;
}

function labelOf(
  notes: ReadonlyMap<OwnedRef, VaultNote>,
  from: OwnedRef,
  to: OwnedRef,
): string | undefined {
  const note = notes.get(from);
  if (!note) return undefined;
  return lookOn({ ref: note.ref, edges: note.edges, updated_at: "" }, to)
    ?.label;
}

/** The review in lines a person reads, one per thing that happened. */
export function reviewLines(review: Review): string[] {
  const named = (ref: OwnedRef): string => {
    const held = review.titles.get(ref);
    if (!held) return "a note no longer here";
    return held.address === undefined
      ? `“${held.title}”`
      : `${held.address} “${held.title}”`;
  };
  const { notes } = review.difference;
  const renumbered = new Map(notes.renumbered.map((one) => [one.ref, one]));
  const said: string[] = [];
  for (const moved of notes.moved) {
    const from =
      moved.from === undefined
        ? "a branch of its own"
        : `under ${named(moved.from)}`;
    const to =
      moved.to === undefined
        ? "a branch of its own"
        : `under ${named(moved.to)}`;
    const number = renumbered.get(moved.ref);
    const was = number?.from === undefined ? "" : `, was ${number.from}`;
    said.push(`Moved ${named(moved.ref)} from ${from} to ${to}${was}.`);
  }
  const moved = new Set(notes.moved.map((one) => one.ref));
  for (const one of notes.renumbered) {
    if (moved.has(one.ref)) continue;
    said.push(
      `Renumbered ${named(one.ref)}${one.from === undefined ? "" : `, was ${one.from}`}.`,
    );
  }
  for (const line of review.lines.drawn) {
    said.push(
      `Linked ${named(line.note)} and ${named(line.to)}${saying(line)}.`,
    );
  }
  for (const line of review.lines.relabelled) {
    said.push(
      `Relabelled the line between ${named(line.note)} and ${named(line.to)}${saying(line)}.`,
    );
  }
  for (const line of review.lines.taken) {
    said.push(
      `Took off the line between ${named(line.note)} and ${named(line.to)}.`,
    );
  }
  for (const ref of notes.added) said.push(`Wrote ${named(ref)}.`);
  for (const ref of notes.removed) said.push(`Took ${named(ref)} out.`);
  for (const one of notes.retitled) {
    said.push(`Retitled “${one.from}” to “${one.to}”.`);
  }
  for (const one of notes.changed) said.push(`Wrote in ${named(one.ref)}.`);
  return said;
}

function saying(line: LineDrawn): string {
  return line.label === undefined ? "" : `: “${line.label}”`;
}
