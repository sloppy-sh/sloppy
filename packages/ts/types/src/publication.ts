// Publishing a subtree, and the shape a peer pulls it back in.
//
// Federation is pull-only, so this is a read contract rather than a delivery
// one: a publication row says a subtree may be read, and a peer that follows
// the DID fetches it whenever it likes. See docs/ARCHITECTURE.md § "Federating
// the graph".

import { z } from "zod";
import { type Address, AddressSchema, isInSubtree } from "./address.js";
import { splitOwnedRef } from "./codecs.js";
import { BlockDocumentSchema } from "./document.js";
import {
  type DidSyr,
  DidSyrSchema,
  OwnedEntitySchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
import { TagsSchema } from "./tag.js";

/**
 * A subtree its author has made readable. The row existing is what makes it
 * readable, so unpublishing deletes the row — and a peer who already pulled the
 * subtree keeps their copy, which is a fact the product states plainly rather
 * than a gap.
 */
export const PublicationSchema = OwnedEntitySchema.extend({
  root: OwnedRefSchema,
  /** The address a peer cites, denormalized so a public read needs no join. */
  root_address: AddressSchema,
});
export type Publication = z.infer<typeof PublicationSchema>;

export const CreatePublicationRequestSchema = z.object({
  root: OwnedRefSchema,
});
export type CreatePublicationRequest = z.input<
  typeof CreatePublicationRequestSchema
>;

/**
 * The public duplicate of a picture inside a published note, and the row that
 * remembers which picture it is a copy of. Publishing copies the bytes rather
 * than widening the original, so the same picture in a note nobody published
 * stays private; docs/ARCHITECTURE.md § "Pictures" carries the ruling.
 *
 * `created_by` is the AUTHOR: both uploads are theirs, and the copy is theirs
 * to delete.
 */
export const PublishedPictureSchema = OwnedEntitySchema.extend({
  /** The picture as the author's own note cites it. Private, and stays so. */
  source_upload: z.string().min(1),
  /** The copy a peer reads, and the one a published note cites. */
  public_upload: z.string().min(1),
});
export type PublishedPicture = z.infer<typeof PublishedPictureSchema>;

/**
 * How much of somebody else's graph one answer may carry.
 *
 * A pull is an OUTBOUND fetch, so nothing about the reader's own request bounds
 * it: what arrives is whatever the author's instance chose to send, and the
 * reader's instance parses all of it and writes a row per node and per block.
 * An answer past these is refused whole — half a subtree held as a complete one
 * would be a region the reader cannot tell is missing notes.
 */
export const MAX_PUBLISHED_ROOTS = 500;
export const MAX_PUBLISHED_NODES = 2_000;
export const MAX_PUBLISHED_BLOCKS = 10_000;

/**
 * One subtree an identity publishes, as an instance lists it: enough to choose
 * one and pull it, and nothing that is not already public in it.
 */
export const PublishedRootSchema = z.object({
  root_address: AddressSchema,
  title: z.string().max(512),
  /** When the author last published or republished it. */
  updated_at: TimestampSchema,
});
export type PublishedRoot = z.infer<typeof PublishedRootSchema>;

/**
 * What one identity publishes on one instance — the answer to "I follow this
 * person, what can I read?", which a DID alone cannot give: nothing in syr's
 * identity manifest names where somebody's graph is served, so the instance is
 * asked and never derived. docs/ARCHITECTURE.md § "Federating the graph".
 */
export const PublishedIndexSchema = z.object({
  did: DidSyrSchema,
  roots: z.array(PublishedRootSchema).max(MAX_PUBLISHED_ROOTS),
});
export type PublishedIndex = z.infer<typeof PublishedIndexSchema>;

/**
 * One node as a peer receives it. Rows travel by `<did>/<ulid>` reference
 * rather than by record id, and carry no `depth`: a reader computes it, along
 * with the sector and subtree membership, from the address.
 *
 * **Every reference on it names a note the caller may read**, because this
 * whole shape reaches an anonymous one. A `<did>/<ulid>` is not readable by
 * itself, but it says a note exists and when it was written; the three fields
 * below each carry the rule that keeps one out.
 */
export const PublishedNodeSchema = z.object({
  ref: OwnedRefSchema,
  address: AddressSchema,
  /** Absent on the region's own root, whose parent is outside the publication
   *  and is not named. */
  parent: OwnedRefSchema.optional(),
  /**
   * The root of the REGION, not of the author's tree: a publication rooted
   * below depth 1 would otherwise name a note nobody published. What a peer
   * holds is a tree rooted here, so its root is its own origin the way any root
   * is.
   */
  origin: OwnedRefSchema,
  title: z.string().max(512),
  tags: TagsSchema,
  /** Only targets the same author publishes. A link to a note nobody published
   *  is dropped rather than named. */
  links: z.array(OwnedRefSchema),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  /**
   * Present when the author signed this node through their syr instance. A
   * reader that cannot verify a signature still renders the node; a reader that
   * can, and finds it wrong, must not present it as the author's.
   */
  content_signature: z.string().optional(),
  signed_payload_json: z.string().optional(),
  signing_device_public_key: z.string().optional(),
});
export type PublishedNode = z.infer<typeof PublishedNodeSchema>;

/**
 * One block as a peer receives it. A picture in `content` is cited by the
 * PUBLIC copy of its upload and never by the private original the author's own
 * note reads, so what a peer holds is an address that answers for them;
 * docs/ARCHITECTURE.md § "Pictures" is the ruling and who does the swap.
 */
export const PublishedBlockSchema = z.object({
  ref: OwnedRefSchema,
  node: OwnedRefSchema,
  ord: z.string(),
  content: BlockDocumentSchema,
});
export type PublishedBlock = z.infer<typeof PublishedBlockSchema>;

/** What a peer's public endpoint answers with. */
export const PublishedSubtreeSchema = z.object({
  did: DidSyrSchema,
  root_address: AddressSchema,
  nodes: z.array(PublishedNodeSchema).max(MAX_PUBLISHED_NODES),
  blocks: z.array(PublishedBlockSchema).max(MAX_PUBLISHED_BLOCKS),
});
export type PublishedSubtree = z.infer<typeof PublishedSubtreeSchema>;

/** An answer from a peer that is not the answer that was asked for. */
export class UnaskedAnswerError extends Error {
  constructor(reason: string) {
    super(`A peer answered with ${reason}`);
    this.name = "UnaskedAnswerError";
  }
}

/** A peer's listing, held to the identity it was asked about. */
export function parsePublishedIndex(
  body: unknown,
  did: DidSyr,
): PublishedIndex {
  const index = PublishedIndexSchema.parse(body);
  if (index.did !== did) throw new UnaskedAnswerError(`about ${index.did}`);
  return index;
}

/**
 * A peer's subtree, held to what was asked for. A failure here is an answer to
 * refuse WHOLE and never rows to store in part: what gets past is written into
 * the reader's own store under the author's name.
 */
export function parsePublishedSubtree(
  body: unknown,
  asked: { did: DidSyr; root_address: Address },
): PublishedSubtree {
  const subtree = PublishedSubtreeSchema.parse(body);
  if (subtree.did !== asked.did) {
    throw new UnaskedAnswerError(`${asked.did}'s subtree as ${subtree.did}`);
  }
  if (subtree.root_address !== asked.root_address) {
    throw new UnaskedAnswerError(`the subtree at ${subtree.root_address}`);
  }

  const sent = new Set<OwnedRef>();
  for (const node of subtree.nodes) {
    requireAuthor(node.ref, asked.did);
    if (!isInSubtree(asked.root_address, node.address)) {
      throw new UnaskedAnswerError(`a note at ${node.address}`);
    }
    if (sent.has(node.ref)) throw new UnaskedAnswerError(`${node.ref} twice`);
    sent.add(node.ref);
  }

  const root = subtree.nodes.find((n) => n.address === asked.root_address);
  if (!root) throw new UnaskedAnswerError("a subtree without its own root");
  if (root.parent !== undefined || root.origin !== root.ref) {
    throw new UnaskedAnswerError("a root pointing outside the subtree");
  }

  for (const node of subtree.nodes) {
    for (const ref of [node.parent, node.origin]) {
      if (ref !== undefined && !sent.has(ref)) {
        throw new UnaskedAnswerError(`a note referring to ${ref}`);
      }
    }
  }
  for (const block of subtree.blocks) {
    requireAuthor(block.ref, asked.did);
    if (!sent.has(block.node)) {
      throw new UnaskedAnswerError(`a section of ${block.node}`);
    }
  }
  return subtree;
}

function requireAuthor(ref: OwnedRef, did: DidSyr): void {
  if (splitOwnedRef(ref).did !== did) {
    throw new UnaskedAnswerError(`${ref} among ${did}'s own`);
  }
}
