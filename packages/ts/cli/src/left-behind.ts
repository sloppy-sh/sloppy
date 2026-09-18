// `sloppy review`: what the code has left behind, as lines in a terminal —
// DESIGN.md § "What the code left behind" is the same answer with a graph
// behind it. The signals themselves are `review()` in `@sloppy/vault`, which
// is what stops the app and the CLI saying different things.

import { relative } from "node:path";
import type { Files } from "@sloppy/local";
import type { CompassDirection, OwnedRef } from "@sloppy/types";
import { review, type ReviewSignal } from "@sloppy/vault";
import { type HeldNote, notesIn } from "./folder.js";
import { movedSince } from "./moved.js";
import { projectParts } from "./tree.js";

/** One signal, and where somebody goes to answer it. */
export interface LeftBehindRow {
  signal: ReviewSignal;
  /** The file to open: a note's, or the code nothing is written about. */
  where: string;
  /** What the note is called, for a signal about one. */
  title?: string;
  said: string;
}

/** What an empty slot asks, the same question the note itself shows under it —
 *  DESIGN.md § "The compass card". */
const SLOT: Record<CompassDirection, string> = {
  north: "What larger pattern is this part of?",
  south: "What is this made of?",
  east: "What else works like this?",
  west: "What was chosen instead?",
};

export interface LeftBehindAsked {
  container: Files;
  /** Absent is a graph that is nobody's project: nothing has moved under it,
   *  and there is no code it has not been written about. */
  project?: Files;
  /** The folder somebody is standing in, which every path is said from.
   *  Absent says them from the container and the project instead. */
  standing?: string;
}

export async function leftBehind(
  asked: LeftBehindAsked,
): Promise<LeftBehindRow[]> {
  const notes = await notesIn(asked.container);
  const parts = asked.project ? await projectParts(asked.project) : [];
  const signals = await review({
    notes: notes.map((held) => held.note),
    projectTop: parts.map((part) => part.path),
    changed: asked.project ? movedSince(asked.project.root) : async () => [],
  });
  const at = new Map(notes.map((held) => [held.note.ref, held]));
  const notesAt = from(asked.standing, asked.container.root);
  const codeAt = from(asked.standing, asked.project?.root);
  return signals.map((signal) => row(signal, at, { notesAt, codeAt }));
}

/** A folder said from where somebody is standing, ready to put a path after. */
function from(
  standing: string | undefined,
  folder: string | undefined,
): string {
  if (standing === undefined || folder === undefined) return "";
  const said = relative(standing, folder).split("\\").join("/");
  return said === "" ? "" : `${said}/`;
}

function row(
  signal: ReviewSignal,
  notes: ReadonlyMap<OwnedRef, HeldNote>,
  at: { notesAt: string; codeAt: string },
): LeftBehindRow {
  const said = saying(signal);
  if (signal.note === undefined) {
    return {
      signal,
      where: signal.path === undefined ? "" : `${at.codeAt}${signal.path}`,
      said,
    };
  }
  const held = notes.get(signal.note);
  return {
    signal,
    where: held ? `${at.notesAt}${held.file}` : signal.note,
    ...(held?.note.title ? { title: held.note.title } : {}),
    said,
  };
}

function saying(signal: ReviewSignal): string {
  switch (signal.kind) {
    case "anchor-changed":
      return `The code it points at has changed since this was read: ${signal.path}`;
    case "code-without-note":
      return "No note is about this yet.";
    case "compass-gap":
      return signal.direction === undefined
        ? "A slot on this one is empty."
        : SLOT[signal.direction];
    case "decision-without-why":
      return "Nothing says why.";
  }
}
