// One note and one section as a version freezes them: the shape a peer
// receives, with every citation resolved to something the publication owns.
// docs/ARCHITECTURE.md § "Federating the graph" and § "Pictures".

import {
  type Address,
  type BlockDocument,
  type DocumentMark,
  type DocumentNode,
  EMOJI_UPLOAD_ATTR,
  type Node,
  OwnedRefSchema,
  type OwnedRef,
  type PublishedNode,
} from "@sloppy/types";

/**
 * The element that names its picture by a shortcode rather than by an upload,
 * which is why `citedUploads` cannot reach it — `emoji-node.ts` in
 * `@sloppy/ui`. Publishing resolves the shortcode against the author's own
 * catalog and writes the copy under {@link EMOJI_UPLOAD_ATTR}.
 */
const EMOJI_ELEMENT = "emoji";
const EMOJI_SRC_ATTR = "src";
const EMOJI_NAME_ATTR = "name";

/**
 * How one note cites another inside a section, and the words it was cited under
 * — `reference-node.ts` in `@sloppy/ui`. The words are the CITED note's title,
 * so a citation the reader cannot follow loses both: a title is what a note
 * says, and an unpublished note says nothing to anybody.
 */
const NOTE_ATTR = "note";
const NOTE_LABEL_ATTR = "label";

/** `upload_id`, or anything ending `_upload_id` — `citedUploads`' convention,
 *  applied in the other direction. */
const CITES_UPLOAD = /^(?:.*_)?upload_id$/;

/** What a publication holds, as the walk below asks after it. */
export interface Snapshotted {
  /** The publication's own copy of an upload the note cites. */
  copyOf(uploadId: string): string | undefined;
  /** The copy of the picture a shortcode names, absent where the author's
   *  catalog no longer claims that shortcode. */
  emojiOf(shortcode: string): string | undefined;
  /** Whether a note cited from a section is one the reader may go and read. */
  reaches(note: OwnedRef): boolean;
}

/** Every custom emoji a section draws, by the shortcode that names it. */
export function citedEmoji(content: BlockDocument): string[] {
  const named = new Set<string>();
  const walk = (nodes: readonly DocumentNode[]): void => {
    for (const node of nodes) {
      const shortcode = customEmojiIn(node);
      if (shortcode) named.add(shortcode);
      if (node.content) walk(node.content);
    }
  };
  walk(content.content);
  return [...named];
}

/** Every note a section cites, in the order it cites them. */
export function citedNotes(content: BlockDocument): OwnedRef[] {
  const cited = new Set<OwnedRef>();
  walkValues(content.content, (key, held) => {
    if (key !== NOTE_ATTR || typeof held !== "string") return;
    const ref = OwnedRefSchema.safeParse(held);
    if (ref.success) cited.add(ref.data);
  });
  return [...cited];
}

/**
 * The section as a peer receives it: the pictures are the publication's own
 * copies, an emoji draws from a copy rather than from a catalog its author can
 * empty, and a citation of a note nobody published carries neither the note nor
 * its title.
 */
export function publishedDocument(
  content: BlockDocument,
  held: Snapshotted,
): BlockDocument {
  return { type: "doc", content: content.content.map((n) => element(n, held)) };
}

/**
 * One note as a version froze it. It carries no `depth` and no look — a reader
 * computes the first from the address and draws a pulled mark unstyled — and
 * `origin` is the root of the REGION, which for a publication rooted below
 * depth 1 is not the root of the author's tree.
 */
export function publishedNodeOf(
  node: Node,
  region: { root: OwnedRef; address: Address },
  links: readonly OwnedRef[],
): Omit<PublishedNode, "ref"> {
  const root = node.address === region.address;
  return {
    address: node.address,
    ...(root || node.parent === undefined ? {} : { parent: node.parent }),
    origin: region.root,
    title: node.title,
    tags: node.tags,
    links: [...links],
    created_at: node.created_at,
    updated_at: node.updated_at,
    ...(node.content_signature === undefined
      ? {}
      : { content_signature: node.content_signature }),
    ...(node.signed_payload_json === undefined
      ? {}
      : { signed_payload_json: node.signed_payload_json }),
    ...(node.signing_device_public_key === undefined
      ? {}
      : { signing_device_public_key: node.signing_device_public_key }),
  };
}

function element(node: DocumentNode, held: Snapshotted): DocumentNode {
  return {
    ...node,
    ...(node.attrs === undefined
      ? {}
      : { attrs: attributes(node.type, node.attrs, held) }),
    ...(node.content === undefined
      ? {}
      : { content: node.content.map((child) => element(child, held)) }),
    ...(node.marks === undefined
      ? {}
      : { marks: node.marks.map((mark) => marked(mark, held)) }),
  };
}

function marked(mark: DocumentMark, held: Snapshotted): DocumentMark {
  return mark.attrs === undefined
    ? mark
    : { ...mark, attrs: attributes(mark.type, mark.attrs, held) };
}

function attributes(
  type: string,
  attrs: Record<string, unknown>,
  held: Snapshotted,
): Record<string, unknown> {
  const written = rewritten(attrs, held) as Record<string, unknown>;
  return type === EMOJI_ELEMENT ? emoji(written, held) : written;
}

/**
 * Both rules at every level of an `attrs` payload, so an element kind this
 * build has no renderer for is carried with its pictures copied and its
 * citations held to what was published — AI.md § "A Block Is a Section" is why
 * storage does not enumerate the kinds.
 */
function rewritten(value: unknown, held: Snapshotted): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((member) => rewritten(member, held));
  const written: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    written[key] =
      CITES_UPLOAD.test(key) && typeof member === "string" && member
        ? copyOf(member, held)
        : rewritten(member, held);
  }
  return withheld(written, held);
}

function copyOf(uploadId: string, held: Snapshotted): string {
  const copy = held.copyOf(uploadId);
  if (copy === undefined) {
    throw new Error(`Publishing reached ${uploadId} with no copy of it`);
  }
  return copy;
}

/** A published emoji draws from the publication's copy. Where the author's
 *  catalog no longer claims the shortcode there is nothing to copy, so the
 *  element keeps the name it was written under and draws no picture. */
function emoji(
  attrs: Record<string, unknown>,
  held: Snapshotted,
): Record<string, unknown> {
  const shortcode = customEmojiIn({ type: EMOJI_ELEMENT, attrs });
  if (!shortcode) return attrs;
  const copy = held.emojiOf(shortcode);
  const { [EMOJI_SRC_ATTR]: _minted, ...rest } = attrs;
  return copy === undefined ? rest : { ...rest, [EMOJI_UPLOAD_ATTR]: copy };
}

function withheld(
  attrs: Record<string, unknown>,
  held: Snapshotted,
): Record<string, unknown> {
  const cited = attrs[NOTE_ATTR];
  if (typeof cited !== "string" || !cited) return attrs;
  const ref = OwnedRefSchema.safeParse(cited);
  if (ref.success && held.reaches(ref.data)) return attrs;
  return {
    ...attrs,
    [NOTE_ATTR]: "",
    ...(NOTE_LABEL_ATTR in attrs ? { [NOTE_LABEL_ATTR]: "" } : {}),
  };
}

function customEmojiIn(node: DocumentNode): string | undefined {
  if (node.type !== EMOJI_ELEMENT) return undefined;
  const name = node.attrs?.[EMOJI_NAME_ATTR];
  const src = node.attrs?.[EMOJI_SRC_ATTR];
  if (typeof name !== "string" || !name) return undefined;
  return typeof src === "string" && src ? name : undefined;
}

function walkValues(
  value: unknown,
  seen: (key: string, held: unknown) => void,
): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, held] of Object.entries(value)) {
    seen(key, held);
    walkValues(held, seen);
  }
}
