// The notes a project's container holds, as the acts read them —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import {
  anchorsOf,
  type BlockDocument,
  type BlockView,
  type ListedNote,
  type NodeView,
  type OwnedRef,
  parseCodeAnchor,
} from "@sloppy/types";
import type { LocalApi } from "./api.js";

/** One note in the container and the places in the code it reaches. */
export interface NoteHere {
  note: NodeView;
  about: string[];
  /** Its sections, in order. */
  blocks: BlockView[];
  /** The place its first section opens with an anchor to, which is the place
   *  it was started about. Absent where it opens with anything else. */
  startedAbout?: string;
}

export async function notesHere(api: LocalApi): Promise<NoteHere[]> {
  const held = new Map<OwnedRef, NoteHere>();
  for (const branch of await api.listNodes({})) {
    for (const note of await api.listNodes({ origin: branch.ref })) {
      if (held.has(note.ref)) continue;
      const blocks = await api.listBlocks(note.ref);
      const startedAbout =
        blocks[0] === undefined ? undefined : openingAnchor(blocks[0].content);
      held.set(note.ref, {
        note,
        about: pathsIn(blocks.map((block) => block.content)),
        blocks,
        ...(startedAbout === undefined ? {} : { startedAbout }),
      });
    }
  }
  return [...held.values()];
}

/** Whether a note about `about` reaches `path`: an anchor at it, inside it, or
 *  at a folder it is in. */
export function reaches(about: readonly string[], path: string): boolean {
  return about.some(
    (at) =>
      at === path || at.startsWith(`${path}/`) || path.startsWith(`${at}/`),
  );
}

export function asListed(note: NodeView, about: readonly string[]): ListedNote {
  return {
    note: note.ref,
    title: note.title,
    ...(note.address === undefined ? {} : { address: note.address }),
    ...(note.parent === undefined ? {} : { parent: note.parent }),
    tags: [...note.tags],
    about: [...about],
    ...(note.links.length === 0 ? {} : { links: [...note.links] }),
  };
}

export function pathsIn(contents: readonly BlockDocument[]): string[] {
  const paths = new Set<string>();
  for (const content of contents) {
    for (const anchor of anchorsOf(content)) paths.add(anchor.path);
  }
  return [...paths];
}

/** The path the first words of a section link to, where they link to code. */
function openingAnchor(content: BlockDocument): string | undefined {
  let node: unknown = content;
  while (node !== null && typeof node === "object") {
    const held = node as {
      type?: unknown;
      marks?: unknown;
      content?: unknown;
    };
    if (held.type === "text") {
      const marks = Array.isArray(held.marks) ? held.marks : [];
      for (const mark of marks) {
        const href = (mark as { attrs?: { href?: unknown } })?.attrs?.href;
        if (typeof href !== "string") continue;
        const anchor = parseCodeAnchor(href);
        if (anchor) return anchor.path;
      }
      return undefined;
    }
    node = Array.isArray(held.content) ? held.content[0] : undefined;
  }
  return undefined;
}
