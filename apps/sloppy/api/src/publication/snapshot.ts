// One note and one section as a version freezes them: the shape a peer
// receives, with every citation resolved to something the publication owns.
// docs/ARCHITECTURE.md § "Federating the graph" and § "Pictures".

import {
  type Address,
  authorsOf,
  type BlockDocument,
  type DocumentMark,
  type DocumentNode,
  EMOJI_UPLOAD_ATTR,
  type Node,
  type NodeAppearance,
  OwnedRefSchema,
  type OwnedRef,
  type PublishedLook,
  type PublishedNode,
  REFERENCE_NOTE_ATTR,
  orderSiblings,
  ownedRefFrom,
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
 * The words a note was cited under, beside the {@link REFERENCE_NOTE_ATTR} that
 * names it. The words are the CITED note's title, so a citation the reader
 * cannot follow loses both: a title is what a note says, and an unpublished
 * note says nothing to anybody.
 */
const NOTE_LABEL_ATTR = "label";

/** `upload_id`, or anything ending `_upload_id` — `citedUploads`' convention,
 *  applied in the other direction. */
const CITES_UPLOAD = /^(?:.*_)?upload_id$/;

/**
 * How wide a place in the walk is written. Fixed, because the keys are compared
 * as strings: a run of them the same length puts note 10 after note 9.
 */
const ORD_DIGITS = 8;

/**
 * The branch in the order a version serves it: every note ahead of the notes
 * that spring from it, and each run in the order a person reads it —
 * `orderSiblings`, which is the whole of that rule.
 *
 * A reader meeting a note before its parent would be holding a note springing
 * from nothing it has, so this order is what lets a version be paged at all.
 */
export function inPreorder(root: Node, branch: readonly Node[]): Node[] {
  const rootRef = ownedRefFrom(root.id);
  const springing = new Map<OwnedRef, Alongside[]>();
  for (const node of branch) {
    const ref = ownedRefFrom(node.id);
    if (ref === rootRef || node.parent === undefined) continue;
    const run = springing.get(node.parent);
    const member = alongside(ref, node);
    if (run) run.push(member);
    else springing.set(node.parent, [member]);
  }
  const order: Node[] = [];
  const walk = (ref: OwnedRef, node: Node): void => {
    order.push(node);
    for (const member of orderSiblings(springing.get(ref) ?? [])) {
      walk(member.ref, member.node);
    }
  };
  walk(rootRef, root);
  return order;
}

/** Where a note sits in {@link inPreorder}, as the key its version is paged on. */
export function ordAt(place: number): string {
  return String(place).padStart(ORD_DIGITS, "0");
}

interface Alongside {
  ref: OwnedRef;
  address?: Address;
  created_at: string;
  node: Node;
}

function alongside(ref: OwnedRef, node: Node): Alongside {
  return {
    ref,
    ...(node.address === undefined ? {} : { address: node.address }),
    created_at: node.created_at,
    node,
  };
}

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
 * One note as a version froze it. It carries no `depth` — a reader mints that
 * walking the parents the region carries — and `origin` is the root of the
 * REGION, which for a publication rooted below depth 1 is not the root of the
 * author's tree.
 *
 * Its look is the shape channels alone; DESIGN.md § "A note's look never uses
 * colour" carries why the pictures stay behind.
 */
export function publishedNodeOf(
  node: Node,
  region: { root: OwnedRef },
  carried: { links: readonly OwnedRef[]; aliases: readonly Address[] },
): Omit<PublishedNode, "ref"> {
  const root = ownedRefFrom(node.id) === region.root;
  const look = travellingLook(node.appearance);
  const writers = authorsOf(node);
  return {
    ...(node.address === undefined ? {} : { address: node.address }),
    ...(carried.aliases.length === 0 ? {} : { aliases: [...carried.aliases] }),
    ...(root || node.parent === undefined ? {} : { parent: node.parent }),
    origin: region.root,
    ...(node.owner === undefined ? {} : { owner: node.owner }),
    ...(writers.length === 1 && writers[0] === node.created_by
      ? {}
      : { authors: [...writers] }),
    ...(node.contributors?.length
      ? { contributors: [...node.contributors] }
      : {}),
    title: node.title,
    tags: node.tags,
    ...(look === undefined ? {} : { look }),
    links: [...carried.links],
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

/** `undefined` for a mark nobody shaped, and for one shaped only in the
 *  channels that stay behind — a look with nothing in it is not a look. */
function travellingLook(
  appearance: NodeAppearance | undefined,
): PublishedLook | undefined {
  const look: PublishedLook = {
    ...(appearance?.ring_weight === undefined
      ? {}
      : { ring_weight: appearance.ring_weight }),
    ...(appearance?.ring_style === undefined
      ? {}
      : { ring_style: appearance.ring_style }),
    ...(appearance?.mark_radius === undefined
      ? {}
      : { mark_radius: appearance.mark_radius }),
    ...(appearance?.mark_scale === undefined
      ? {}
      : { mark_scale: appearance.mark_scale }),
  };
  return Object.keys(look).length === 0 ? undefined : look;
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
  const cited = attrs[REFERENCE_NOTE_ATTR];
  if (typeof cited !== "string" || !cited) return attrs;
  const ref = OwnedRefSchema.safeParse(cited);
  if (ref.success && held.reaches(ref.data)) return attrs;
  return {
    ...attrs,
    [REFERENCE_NOTE_ATTR]: "",
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
