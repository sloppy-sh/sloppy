// A node: one thought, and its place in the sequence of thought that produced
// it. The address is the protocol — see `address.ts` and AI.md § "The Address
// Is the Protocol".

import { z } from "zod";
import { addressDepth, AddressSchema, RootAddressSchema } from "./address.js";
import { NodeAppearanceSchema } from "./appearance.js";
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
  /**
   * The note's published mark, which decides how the mark draws and nothing
   * else. What makes a subtree readable is a `publication` row, and the two are
   * not yet reconciled — docs/ARCHITECTURE.md § "Data model".
   */
  published: z.boolean().default(false),
  /**
   * How its author asked the mark to be drawn. Absent is a note nobody styled,
   * which is why this carries no default — `appearance.ts` says what the mark
   * then draws as.
   */
  appearance: NodeAppearanceSchema.optional(),
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
 * Where a new node goes, said against a node that is already there: `under` it,
 * so the new one springs out of it, or `after` it, so the new one continues the
 * run it belongs to. `root` opens a branch at a number the author picked.
 */
export const NodePlacementSchema = z.discriminatedUnion("relation", [
  z.object({ relation: z.literal("under"), note: OwnedRefSchema }),
  z.object({ relation: z.literal("after"), note: OwnedRefSchema }),
  z.object({ relation: z.literal("root"), address: RootAddressSchema }),
]);
export type NodePlacement = z.infer<typeof NodePlacementSchema>;

/**
 * Create a node. The server mints the id, and assigns every address except the
 * one a `root` placement names: a client that could name a node's place under
 * another could mint a citation into somebody else's graph.
 *
 * An absent `from` opens a branch at the next number. An unknown field beside
 * it is refused rather than dropped: an address is assigned once and never
 * rewritten, so a caller that placed a note through a field this route no
 * longer reads would be handed a permanent place it did not ask for.
 */
export const CreateNodeRequestSchema = z.strictObject(
  {
    from: NodePlacementSchema.optional(),
    title: z.string().max(512).default(""),
    tags: TagsSchema.default([]),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type CreateNodeRequest = z.input<typeof CreateNodeRequestSchema>;

/**
 * `address`, `depth` and `origin` are absent because they are immutable, and
 * `published` because it is written by {@link NodeBulkActSchema}'s own act
 * rather than alongside a title. `parent` is absent because a move writes an
 * alias rather than a new address, and that mechanism does not exist yet.
 */
export const UpdateNodeRequestSchema = z.object({
  title: z.string().max(512).optional(),
  /** The WHOLE set, never a delta: a tag absent from it is a tag removed. */
  tags: TagsSchema.optional(),
  links: z.array(OwnedRefSchema).optional(),
  /** `null` takes the look back off and leaves the note unstyled; absent leaves
   *  whatever look it has alone. */
  appearance: NodeAppearanceSchema.nullable().optional(),
});
export type UpdateNodeRequest = z.input<typeof UpdateNodeRequestSchema>;

/**
 * How many notes one act may reach. A person choosing marks on a canvas stays
 * well inside it; the bound is what keeps one tap from rewriting a graph.
 */
export const MAX_NOTES_PER_BULK_ACT = 200;

/**
 * One act, over however many notes somebody chose. Keyed by `act` so a fifth act
 * is a member here and a branch in the service — never a second route, and never
 * a field on every request that five acts out of six leave empty.
 */
export const NodeBulkActSchema = z.discriminatedUnion("act", [
  /** Added to what each note already carries, rather than replacing it. */
  z.object({ act: z.literal("tag"), tags: TagsSchema }),
  /** Taken off; a note that never carried one of these is left alone. */
  z.object({ act: z.literal("untag"), tags: TagsSchema }),
  /** `null` leaves every note it reaches unstyled. */
  z.object({
    act: z.literal("set_appearance"),
    appearance: NodeAppearanceSchema.nullable(),
  }),
  /**
   * Writes {@link NodeSchema}'s `published` mark and makes nothing readable by
   * anybody. Until a `publication` row is reachable, no surface may offer this
   * as publishing — docs/ARCHITECTURE.md § "Data model" is the ruling.
   */
  z.object({ act: z.literal("publish") }),
  z.object({ act: z.literal("unpublish") }),
  /** Each note leaves with everything that sprang from it, and with its blocks. */
  z.object({ act: z.literal("delete") }),
]);
export type NodeBulkAct = z.input<typeof NodeBulkActSchema>;

export const NodeBulkRequestSchema = z.object({
  notes: z
    .array(OwnedRefSchema)
    .min(1, "Choose a note first.")
    .max(
      MAX_NOTES_PER_BULK_ACT,
      `Sloppy can change ${MAX_NOTES_PER_BULK_ACT} notes at a time. Choose fewer.`,
    ),
  act: NodeBulkActSchema,
});
export type NodeBulkRequest = z.input<typeof NodeBulkRequestSchema>;
