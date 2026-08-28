// A node: one thought, and its place in the sequence of thought that produced
// it. The address is the protocol — see `address.ts` and AI.md § "The Address
// Is the Protocol".

import { z } from "zod";
import { addressDepth, AddressSchema } from "./address.js";
import { OwnedEntitySchema, OwnedRefSchema } from "./common.js";
import { TagsSchema } from "./tag.js";

export const NodeSchema = OwnedEntitySchema.extend({
  /** Assigned at creation and never rewritten. `schema.ts` enforces this. */
  address: AddressSchema,
  /**
   * `addressDepth(address)`. A value derived from an address is otherwise never
   * stored; docs/ARCHITECTURE.md § "Data model" carries the ruling that makes
   * this one an exception, and `parseNode` is the boundary it is held at.
   */
  depth: z.int().positive(),
  /** Absent on a root. */
  parent: OwnedRefSchema.optional(),
  /** The root of this node's tree; a root node is its own origin. */
  origin: OwnedRefSchema,
  title: z.string().max(512).default(""),
  tags: TagsSchema.default([]),
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

export function nodeDepthMatchesAddress(
  node: Pick<Node, "address" | "depth">,
): boolean {
  return node.depth === addressDepth(node.address);
}

export class NodeDepthMismatchError extends Error {
  constructor(address: string, stored: number, actual: number) {
    super(
      `Address ${JSON.stringify(address)} is ${actual} deep; the row stores ${stored}`,
    );
    this.name = "NodeDepthMismatchError";
  }
}

/**
 * Every node row crosses this, in both directions: a writer's before it is
 * stored, a reader's after it comes back. `NodeSchema` cannot refuse a `depth`
 * disagreeing with its `address`, and the column is immutable, so a wrong row
 * that gets past here is wrong for as long as it exists.
 */
export function parseNode(row: unknown): Node {
  const node = NodeSchema.parse(row);
  if (!nodeDepthMatchesAddress(node)) {
    throw new NodeDepthMismatchError(
      node.address,
      node.depth,
      addressDepth(node.address),
    );
  }
  return node;
}

/**
 * Create a node. The server mints the id and assigns the address: a client that
 * could name either could mint a citation into somebody else's graph.
 *
 * An absent `parent` creates a root.
 */
export const CreateNodeRequestSchema = z.object({
  parent: OwnedRefSchema.optional(),
  title: z.string().max(512).default(""),
  tags: TagsSchema.default([]),
});
export type CreateNodeRequest = z.input<typeof CreateNodeRequestSchema>;

/**
 * `address`, `depth` and `origin` are absent because they are immutable, and
 * `published` because publishing is its own act with its own consequences.
 * `parent` is absent because a move writes an alias rather than a new address,
 * and that mechanism does not exist yet.
 */
export const UpdateNodeRequestSchema = z.object({
  title: z.string().max(512).optional(),
  /** The WHOLE set, never a delta: a tag absent from it is a tag removed. */
  tags: TagsSchema.optional(),
  links: z.array(OwnedRefSchema).optional(),
});
export type UpdateNodeRequest = z.input<typeof UpdateNodeRequestSchema>;
