// Writing a note from the terminal, through the same client the app writes
// through — docs/ARCHITECTURE.md § "Tooling and the review".

import { type LocalApi, writeOnto as writeOntoNote } from "@sloppy/local";
import {
  type BlockDocument,
  type BlockView,
  type NodePlacement,
  type NodeView,
  type OwnedRef,
  splitOwnedRef,
  ulid,
  type WriteDone,
  writesAlone,
} from "@sloppy/types";
import { notePath } from "@sloppy/vault";
import { headingOf } from "./writing.js";

export type { WriteDone };

export interface WrittenNote {
  title: string;
  /** The note's file, from the container. */
  file: string;
  done: WriteDone;
}

export function fileOf(ref: OwnedRef): string {
  return notePath(splitOwnedRef(ref).localId);
}

/** A note written outright, with its sections in the order they are given. */
export async function writeNote(
  api: LocalApi,
  asked: {
    from?: NodePlacement;
    title: string;
    sections: readonly BlockDocument[];
  },
): Promise<NodeView> {
  const note = await api.createNode({
    ...(asked.from === undefined ? {} : { from: asked.from }),
    title: asked.title,
    tags: [],
  });
  let after: OwnedRef | undefined;
  for (const content of asked.sections) {
    const block = await api.createBlock({
      node: note.ref,
      content,
      ...(after === undefined ? {} : { after }),
    });
    after = block.ref;
  }
  return note;
}

/**
 * The CLI's sections written onto a note that is already there: each one over
 * the section the CLI wrote under that heading before, and the rest after
 * whatever the note holds. So a second run leaves one copy rather than two.
 *
 * Whose WRITING the note carries decides how, never whose note it is: a note
 * nobody but the CLI has written in is written straight onto, and a note a
 * person has written in is offered an amendment, standing until they take it
 * in.
 */
/** A note written onto, through the one rule a machine writer is held to —
 *  {@link writeOnto} in `@sloppy/local`. The file is this package's to name. */
export async function writeOnto(
  api: LocalApi,
  note: NodeView,
  sections: readonly BlockDocument[],
): Promise<WrittenNote> {
  const done = await writeOntoNote(api, note, sections);
  return { ...done, file: fileOf(note.ref) };
}
