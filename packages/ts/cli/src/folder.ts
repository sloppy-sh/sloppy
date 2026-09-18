// The folder a command works in: the notes in it, the code beside them, and
// which note is about which file. docs/ARCHITECTURE.md § "A project's
// container".

import { containerOf, type Files, projectRootOf } from "@sloppy/local";
import { anchorsOf, type OwnedRef } from "@sloppy/types";
import {
  decodeText,
  GRAPH_FILE,
  noteAt,
  NOTES_DIR,
  readGraphFile,
  VaultFormatError,
  type VaultGraph,
  type VaultNote,
  vaultToNote,
} from "@sloppy/vault";

/** A container, and where the code it is about is. */
export interface HeldFolder {
  container: Files;
  graph: VaultGraph;
  /** Absent is a graph that is nobody's project, which has no code to read. */
  project?: Files;
}

/** One note as it is on disk, and the file a person opens to change it. */
export interface HeldNote {
  /** From the container. */
  file: string;
  note: VaultNote;
  /** Every place in the code it points at, without repeats. */
  anchors: string[];
}

/** The container a command works in: the one inside the folder named, or that
 *  folder itself where it is already a vault. */
export async function containerAt(root: Files): Promise<Files | undefined> {
  const inside = await containerOf(root);
  if (inside) return inside;
  return (await root.exists(GRAPH_FILE)) ? root : undefined;
}

/** Throws {@link VaultFormatError} where the folder holds no graph this build
 *  can read. */
export async function heldAt(container: Files): Promise<HeldFolder> {
  const bytes = await container.read(GRAPH_FILE);
  if (!bytes) throw new VaultFormatError("There is no graph in that folder.");
  const graph = readGraphFile(bytes);
  const project = projectRootOf(container, graph);
  return { container, graph, ...(project ? { project } : {}) };
}

/** Every note in the container, in file order. A file in `notes/` that does
 *  not read as a note is `check`'s to say, and is passed over here. */
export async function notesIn(container: Files): Promise<HeldNote[]> {
  const held: HeldNote[] = [];
  for (const file of (await container.list(NOTES_DIR)).sort()) {
    if (noteAt(file) === undefined) continue;
    const bytes = await container.read(file);
    if (!bytes) continue;
    let note: VaultNote;
    try {
      note = vaultToNote({ markdown: decodeText(bytes) });
    } catch {
      continue;
    }
    const anchors = new Set<string>();
    for (const section of note.sections) {
      for (const anchor of anchorsOf(section.content)) anchors.add(anchor.path);
    }
    held.push({ file, note, anchors: [...anchors] });
  }
  return held;
}

/** The first note pointing at this path, at something under it, or at the
 *  folder it is in — the note a part of the project already has. */
export function noteReaching(
  notes: readonly HeldNote[],
  path: string,
): HeldNote | undefined {
  return notes.find((held) =>
    held.anchors.some(
      (at) =>
        at === path || at.startsWith(`${path}/`) || path.startsWith(`${at}/`),
    ),
  );
}

/** What `init` asks before writing a note about a part of the project. */
export function reaches(notes: readonly HeldNote[], path: string): boolean {
  return noteReaching(notes, path) !== undefined;
}

/** The note a graph's own writing about the project itself is on, which every
 *  note the CLI writes points north at. */
export function noteForProject(
  notes: readonly HeldNote[],
  tag: string,
): OwnedRef | undefined {
  return notes.find(
    (held) => held.note.parent === undefined && held.note.tags.includes(tag),
  )?.note.ref;
}
