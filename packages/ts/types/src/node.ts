// A node: one thought, and its place in the sequence of thought that produced
// it. The address is the protocol — see `address.ts` and AI.md § "The Address
// Is the Protocol".

import { z } from "zod";
import { AddressSchema } from "./address.js";
import { OwnedEntitySchema, OwnedRefSchema } from "./common.js";
import { LabelSetSchema } from "./label.js";

export const NodeSchema = OwnedEntitySchema.extend({
  /** Assigned at creation and never rewritten. `schema.ts` enforces this. */
  address: AddressSchema,
  /**
   * `addressDepth(address)`, and a writer must keep it so. A value derived from
   * an address is otherwise never stored; docs/ARCHITECTURE.md § "Data model"
   * carries the ruling that makes this one an exception.
   */
  depth: z.int().positive(),
  /** Absent on a root. */
  parent: OwnedRefSchema.optional(),
  /** The root of this node's tree; a root node is its own origin. */
  origin: OwnedRefSchema,
  title: z.string().max(512).default(""),
  labels: LabelSetSchema.default({}),
  /**
   * Associative links, the ones genealogy does not carry. A target may belong
   * to somebody else and may have been deleted, so resolving one must tolerate
   * a miss rather than treat it as corruption.
   */
  links: z.array(OwnedRefSchema).default([]),
  published: z.boolean().default(false),
  content_signature: z.string().optional(),
  signed_payload_json: z.string().optional(),
  signing_device_public_key: z.string().optional(),
});
export type Node = z.infer<typeof NodeSchema>;

/**
 * Create a node. The server mints the id and assigns the address: a client that
 * could name either could mint a citation into somebody else's graph.
 *
 * An absent `parent` creates a root.
 */
export const CreateNodeRequestSchema = z.object({
  parent: OwnedRefSchema.optional(),
  title: z.string().max(512).default(""),
  labels: LabelSetSchema.default({}),
});
export type CreateNodeRequest = z.infer<typeof CreateNodeRequestSchema>;

/**
 * `address`, `depth` and `origin` are absent because they are immutable, and
 * `published` because publishing is its own act with its own consequences.
 * `parent` is absent because a move writes an alias rather than a new address,
 * and that mechanism does not exist yet.
 */
export const UpdateNodeRequestSchema = z.object({
  title: z.string().max(512).optional(),
  labels: LabelSetSchema.optional(),
  links: z.array(OwnedRefSchema).optional(),
});
export type UpdateNodeRequest = z.infer<typeof UpdateNodeRequestSchema>;
