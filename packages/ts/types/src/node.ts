// A node: one thought, and its place in the sequence of thought that produced
// it. The address is the protocol — see `address.ts` and AI.md § "The Address
// Is the Protocol".

import { z } from "zod";
import { addressDepth, AddressSchema, RootAddressSchema } from "./address.js";
import { NodeAppearanceSchema, WrittenAppearanceSchema } from "./appearance.js";
import { OwnedEntitySchema, type OwnedRef, OwnedRefSchema } from "./common.js";
import { graphRef, requireOwnGraph } from "./graph.js";
import { TagsSchema } from "./tag.js";

export const NodeSchema = OwnedEntitySchema.extend({
  /**
   * Which of its author's graphs this note is in, and so which context its
   * address is read in. Written on every note, and absent only on one stored
   * before anybody could have a second graph, where it reads as the author's
   * home graph — `@sloppy/data`'s `schema.ts` says why such a row is filled in
   * at boot rather than left to be read that way forever.
   */
  graph: OwnedRefSchema.optional(),
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
   * The notes this one's own writing names, derived from its blocks and
   * rewritten whenever they change — so the words going takes the line with
   * them, where a link stays until a hand removes it. Absent is a note nothing
   * has ever derived them for, and every reader takes that as none. Derived
   * means the server alone writes it: docs/ARCHITECTURE.md § "Data model".
   */
  references: z.array(OwnedRefSchema).optional(),
  /**
   * Whether a publication row roots at this note or at one of its ancestors,
   * denormalized so a mark can be drawn without the publication list beside it.
   * What makes a subtree readable is still the row; docs/ARCHITECTURE.md
   * § "Data model" carries the ruling and what maintaining this must never
   * leave behind.
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

/** The graph a note is in, as a ref. */
export function graphOf(node: Pick<Node, "created_by" | "graph">): OwnedRef {
  return graphRef(node.created_by, node.graph);
}

/**
 * The key the run a note lies in is grouped by: the note it sprang from, or —
 * for a root — the graph it opens a branch in. Never the author alone: two
 * graphs of one person each hold a `1`, so grouping by author would draw a run
 * between branches that are not alongside each other at all.
 */
export function runKeyOf(
  node: Pick<Node, "created_by" | "graph" | "parent">,
): string {
  // Prefixed rather than bare, so a graph's ref can never be read as a note's.
  return node.parent ?? `graph/${graphOf(node)}`;
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
 * What `NodeSchema` cannot refuse and immutable columns make permanent: a
 * `depth` disagreeing with the address, and a `graph` belonging to somebody
 * else.
 */
export function requireNodeConsistent(
  node: Pick<Node, "created_by" | "graph" | "address" | "depth">,
): void {
  if (!nodeDepthMatchesAddress(node)) {
    throw new NodeDepthMismatchError(
      node.address,
      node.depth,
      addressDepth(node.address),
    );
  }
  requireOwnGraph(node.created_by, node.graph);
}

/**
 * Every node row crosses this, in both directions: a writer's before it is
 * stored, a reader's after it comes back. A wrong row that gets past here is
 * wrong for as long as it exists.
 */
export function parseNode(row: unknown): Node {
  const node = NodeSchema.parse(row);
  requireNodeConsistent(node);
  return node;
}

/**
 * Where a new node goes, said against a node that is already there: `under` it,
 * so the new one springs out of it, or `after` it, so the new one continues the
 * run it belongs to. `root` opens a branch at a number the author picked, and
 * `branch` opens one at the next number.
 *
 * Only the two that open a branch name a graph, because only they have nothing
 * to read it off: a note placed against another is in that note's graph.
 * Absent, as everywhere, is the author's home graph.
 */
export const NodePlacementSchema = z.discriminatedUnion("relation", [
  z.strictObject({ relation: z.literal("under"), note: OwnedRefSchema }),
  z.strictObject({ relation: z.literal("after"), note: OwnedRefSchema }),
  z.strictObject({
    relation: z.literal("root"),
    address: RootAddressSchema,
    graph: OwnedRefSchema.optional(),
  }),
  z.strictObject({
    relation: z.literal("branch"),
    graph: OwnedRefSchema.optional(),
  }),
]);
export type NodePlacement = z.infer<typeof NodePlacementSchema>;

/** The graph a placement asks for, where it is one that names a graph at all. */
export function graphAsked(
  from: NodePlacement | undefined,
): OwnedRef | undefined {
  return from?.relation === "root" || from?.relation === "branch"
    ? from.graph
    : undefined;
}

/**
 * Create a node. The server mints the id, and assigns every address except the
 * one a `root` placement names: a client that could name a node's place under
 * another could mint a citation into somebody else's graph.
 *
 * An absent `from` opens a branch at the next number in the home graph, which
 * is what `branch` says with a graph beside it. An unknown field, in the body
 * or in the placement, is refused rather than dropped: a place is assigned once
 * and never rewritten, so a caller that placed a note through a field this
 * route no longer reads would be handed a permanent place it did not ask for.
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
 * `graph`, `address`, `depth` and `origin` are absent because they are
 * immutable, and `parent` because a move writes an alias rather than a new
 * address, and that mechanism does not exist yet.
 */
export const UpdateNodeRequestSchema = z.object({
  title: z.string().max(512).optional(),
  /** The WHOLE set, never a delta: a tag absent from it is a tag removed. */
  tags: TagsSchema.optional(),
  links: z.array(OwnedRefSchema).optional(),
  /** `null` takes the look back off and leaves the note unstyled; absent leaves
   *  whatever look it has alone. */
  appearance: WrittenAppearanceSchema.nullable().optional(),
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
 * a field on every request that three acts out of four leave empty.
 */
export const NodeBulkActSchema = z.discriminatedUnion("act", [
  /** Added to what each note already carries, rather than replacing it. */
  z.object({ act: z.literal("tag"), tags: TagsSchema }),
  /** Taken off; a note that never carried one of these is left alone. */
  z.object({ act: z.literal("untag"), tags: TagsSchema }),
  /** `null` leaves every note it reaches unstyled. */
  z.object({
    act: z.literal("set_appearance"),
    appearance: WrittenAppearanceSchema.nullable(),
  }),
  /** Each note leaves with everything that sprang from it, and with its blocks. */
  z.object({ act: z.literal("delete") }),
  /**
   * Each chosen note is published as it stands, rooted at itself and carrying
   * its subtree. A note another chosen note carries goes out inside that one
   * rather than a second time; one that is already published takes another
   * version. docs/ARCHITECTURE.md § "Federating the graph".
   */
  z.object({ act: z.literal("publish") }),
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
