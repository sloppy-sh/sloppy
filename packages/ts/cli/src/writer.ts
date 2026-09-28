// Writing a note from the terminal, through the same client the app writes
// through — docs/ARCHITECTURE.md § "Tooling".

import { type LocalApi, writeOnto as writeOntoNote } from "@sloppy/local";
import {
  type BlockDocument,
  type NodePlacement,
  type NodeView,
  type OwnedRef,
  splitOwnedRef,
  type Tag,
  type WriteDone,
} from "@sloppy/types";
import { notePath } from "@sloppy/vault";

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
    tags?: readonly Tag[];
  },
): Promise<NodeView> {
  const note = await api.createNode({
    ...(asked.from === undefined ? {} : { from: asked.from }),
    title: asked.title,
    tags: [...(asked.tags ?? [])],
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

/** A note written onto, through the one rule a machine writer is held to —
 *  {@link writeOnto} in `@sloppy/local`. The file is this package's to name. */
export async function writeOnto(
  api: LocalApi,
  note: NodeView,
  sections: readonly BlockDocument[],
  tags: readonly Tag[] = [],
): Promise<WrittenNote> {
  const done = await writeOntoNote(api, note, sections, tags);
  return { ...done, file: fileOf(note.ref) };
}
