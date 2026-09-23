// Writing a note from the terminal, through the same client the app writes
// through — docs/ARCHITECTURE.md § "Tooling and the review".

import type { LocalApi } from "@sloppy/local";
import {
  type BlockDocument,
  type BlockView,
  type NodePlacement,
  type NodeView,
  type OwnedRef,
  splitOwnedRef,
  ulid,
  writesAlone,
} from "@sloppy/types";
import { notePath } from "@sloppy/vault";
import { headingOf } from "./writing.js";

/** What one act of writing came to: written outright, or `offered` to whoever
 *  wrote the note. */
export type WriteDone = "written" | "offered";

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
export async function writeOnto(
  api: LocalApi,
  note: NodeView,
  sections: readonly BlockDocument[],
): Promise<WrittenNote> {
  const writer = await api.writer;
  const held = await api.listBlocks(note.ref);
  const written = { title: note.title, file: fileOf(note.ref) };
  if (!writesAlone(note, writer)) {
    await api.proposeAmendment({
      note: note.ref,
      title: note.title,
      tags: [...note.tags],
      blocks: offered(note.ref, held, sections),
    });
    return { ...written, done: "offered" };
  }
  let after = held[held.length - 1]?.ref;
  for (const content of sections) {
    const standing = held.find(
      (block) => sameSection(sections, block.content) === content,
    );
    if (standing) {
      await api.updateBlock(standing.ref, { content });
      continue;
    }
    const block = await api.createBlock({
      node: note.ref,
      content,
      ...(after === undefined ? {} : { after }),
    });
    after = block.ref;
  }
  return { ...written, done: "written" };
}

/** The note's body as the offer would have it, whole: an offer proposes every
 *  section, so one it does not name is one it takes away. */
function offered(
  note: OwnedRef,
  held: readonly BlockView[],
  sections: readonly BlockDocument[],
): { ref: OwnedRef; content: BlockDocument }[] {
  const written = new Set<BlockDocument>();
  const body = held.map((block) => {
    const drafted = sameSection(sections, block.content);
    if (drafted === undefined)
      return { ref: block.ref, content: block.content };
    written.add(drafted);
    return { ref: block.ref, content: drafted };
  });
  const did = splitOwnedRef(note).owner;
  for (const content of sections) {
    if (written.has(content)) continue;
    body.push({ ref: `${did}/${ulid()}`, content });
  }
  return body;
}

/** The drafted section that stands for one the note holds: the one under the
 *  same heading. A section the CLI headed with nothing stands for none. */
function sameSection(
  sections: readonly BlockDocument[],
  held: BlockDocument,
): BlockDocument | undefined {
  const said = headingOf(held);
  return said === undefined
    ? undefined
    : sections.find((content) => headingOf(content) === said);
}
