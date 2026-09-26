// A machine writer, held to the one rule that makes its writing an offer
// rather than an overwrite — docs/ARCHITECTURE.md § "Tooling and the review".

import {
  type BlockDocument,
  type BlockView,
  type NodeView,
  type OwnedRef,
  splitOwnedRef,
  type Tag,
  TagsSchema,
  ulid,
  type WriteDone,
  writesAlone,
} from "@sloppy/types";
import type { LocalApi } from "./api.js";

export type { WriteDone };

/** What one note came to, for a caller reporting what it did. */
export interface WrittenOnto {
  title: string;
  done: WriteDone;
}

/** The words a section opens with, which is how a machine writer finds the
 *  section it wrote before and writes that one again rather than a second copy. */
export function headingOf(content: BlockDocument): string | undefined {
  const opener = (content.content ?? [])[0];
  if (!opener || opener.type !== "heading") return undefined;
  const said = (opener.content ?? []).map((held) => held.text ?? "").join("");
  return said === "" ? undefined : said;
}

/**
 * `tags` go ON the note alongside the ones it carries. A machine writer names
 * a scope it found; taking one off is the note's author's, so nothing here
 * removes a tag, and a tag already there is left where it is.
 */
export async function writeOnto(
  api: LocalApi,
  note: NodeView,
  sections: readonly BlockDocument[],
  tags: readonly Tag[] = [],
): Promise<WrittenOnto> {
  const writer = await api.writer;
  const held = await api.listBlocks(note.ref);
  const written = { title: note.title };
  const carries = TagsSchema.parse([...note.tags, ...tags]);
  if (!writesAlone(note, writer)) {
    await api.proposeAmendment({
      note: note.ref,
      title: note.title,
      tags: carries,
      blocks: offered(note.ref, held, sections),
    });
    return { ...written, done: "offered" };
  }
  // Both are sets and one holds the other, so a longer union is a tag gained.
  if (carries.length !== note.tags.length) {
    await api.updateNode(note.ref, { tags: carries });
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
 *  same heading. A section headed with nothing stands for none. */
function sameSection(
  sections: readonly BlockDocument[],
  held: BlockDocument,
): BlockDocument | undefined {
  const said = headingOf(held);
  return said === undefined
    ? undefined
    : sections.find((content) => headingOf(content) === said);
}
