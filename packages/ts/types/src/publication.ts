// Publishing a subtree, and the shape a peer pulls it back in.
//
// Federation is pull-only, so this is a read contract rather than a delivery
// one: a publication row says a subtree may be read, and a peer that follows
// the DID fetches it whenever it likes. See docs/ARCHITECTURE.md § "Federating
// the graph".

import { z } from "zod";
import { AddressSchema } from "./address.js";
import { BlockTypeSchema } from "./block.js";
import {
  DidSyrSchema,
  OwnedEntitySchema,
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
 * One node as a peer receives it. Rows travel by `<did>/<ulid>` reference
 * rather than by record id, and carry no `depth`: a reader computes it, along
 * with the sector and subtree membership, from the address.
 */
export const PublishedNodeSchema = z.object({
  ref: OwnedRefSchema,
  address: AddressSchema,
  parent: OwnedRefSchema.optional(),
  origin: OwnedRefSchema,
  title: z.string(),
  tags: TagsSchema,
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

export const PublishedBlockSchema = z.object({
  ref: OwnedRefSchema,
  node: OwnedRefSchema,
  ord: z.string(),
  type: BlockTypeSchema,
  content: z.string(),
  data: z.unknown().optional(),
});
export type PublishedBlock = z.infer<typeof PublishedBlockSchema>;

/** What a peer's public endpoint answers with. */
export const PublishedSubtreeSchema = z.object({
  did: DidSyrSchema,
  root_address: AddressSchema,
  nodes: z.array(PublishedNodeSchema),
  blocks: z.array(PublishedBlockSchema),
});
export type PublishedSubtree = z.infer<typeof PublishedSubtreeSchema>;
