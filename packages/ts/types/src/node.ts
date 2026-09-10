// A node: one thought, and its place in the sequence of thought that produced
// it. What it sprang out of is the protocol and its address is a label — see
// `address.ts` and AI.md § "The Genealogy Is the Protocol".

import { z } from "zod";
import { AddressSchema, RootAddressSchema } from "./address.js";
import { NodeAppearanceSchema, WrittenAppearanceSchema } from "./appearance.js";
import {
  OwnedEntitySchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
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
  /**
   * The label its author cites it by, offered at creation and theirs to write,
   * change or take off. Absent is a note with none, which is read by its title.
   * Every address it has held keeps leading to it, as a `node_alias` row.
   */
  address: AddressSchema.optional(),
  /**
   * The parent's depth and one more; a branch and a note with no parent are 1.
   * A derived value is otherwise never stored; docs/ARCHITECTURE.md § "Data
   * model" carries the ruling that makes this one an exception.
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
  /** Whether a published version carries this note, maintained from the
   *  snapshot rows and never from a publication rooted above it; docs/ARCHITECTURE.md
   *  § "Data model" carries the ruling. Absent is false. */
  published: z.boolean().default(false),
  /**
   * How its author asked the mark to be drawn. Absent is a note nobody styled,
   * which is why this carries no default — `appearance.ts` says what the mark
   * then draws as.
   */
  appearance: NodeAppearanceSchema.optional(),
  /**
   * When its author deleted it. Absent is a note that is there, which is every
   * note stored before anybody could put one back. A deleted note keeps its row
   * and its address, and the address stays spent whether or not it comes back —
   * AI.md § "The Genealogy Is the Protocol".
   */
  deleted_at: TimestampSchema.optional(),
  content_signature: z.string().optional(),
  signed_payload_json: z.string().optional(),
  signing_device_public_key: z.string().optional(),
});
export type Node = z.infer<typeof NodeSchema>;

/**
 * How long a deleted branch stays where its author can put it back. The sweep
 * that ends the window and the confirmation that promises it read this same
 * number, so the promise cannot outlive what is kept.
 */
export const DELETED_KEPT_FOR_DAYS = 30;

/**
 * An address a graph has assigned and will not assign again, kept after the
 * note that held it is purged — AI.md § "The Genealogy Is the Protocol".
 * `parent` is absent for a branch, as it is on the note the row outlives.
 *
 * `note` is the ref the number was spent on, and that note — arriving again in
 * the same graph — is the one thing that may write the number again. Absent is
 * a row from before the column, whose number is refused to everyone.
 */
export const RetiredAddressSchema = OwnedEntitySchema.extend({
  graph: OwnedRefSchema,
  parent: OwnedRefSchema.optional(),
  address: AddressSchema,
  note: OwnedRefSchema.optional(),
});
export type RetiredAddress = z.infer<typeof RetiredAddressSchema>;

/**
 * An address a note was at before it was moved, and the note it still resolves
 * to — AI.md § "The Genealogy Is the Protocol". `parent` is the note it hung
 * under when it was left, absent for a branch, and it is what puts the address
 * back in the run it was spent in.
 */
export const NodeAliasSchema = OwnedEntitySchema.extend({
  graph: OwnedRefSchema,
  parent: OwnedRefSchema.optional(),
  address: AddressSchema,
  note: OwnedRefSchema,
});
export type NodeAlias = z.infer<typeof NodeAliasSchema>;

/**
 * What a person reads this note by: its address where it has one, its title
 * where it does not, and a word for a note that has neither yet. One function,
 * so two surfaces cannot name the same note differently.
 */
export function noteLabel(note: Pick<Node, "address" | "title">): string {
  return note.address ?? (note.title.trim() || "Untitled");
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

/** What `NodeSchema` cannot refuse: a `graph` belonging to somebody else. */
export function requireNodeConsistent(
  node: Pick<Node, "created_by" | "graph">,
): void {
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
 * run it belongs to. `root` opens a branch at a number the author picked,
 * `branch` opens one at the next number, and `free` writes a note that springs
 * from nothing and carries no number until its author gives it one.
 *
 * Only the three with nothing to read a graph off name one: a note placed
 * against another is in that note's graph. Absent, as everywhere, is the
 * author's home graph.
 */
const UNDER = z.strictObject({
  relation: z.literal("under"),
  note: OwnedRefSchema,
});
const AFTER = z.strictObject({
  relation: z.literal("after"),
  note: OwnedRefSchema,
});

export const NodePlacementSchema = z.discriminatedUnion("relation", [
  UNDER,
  AFTER,
  z.strictObject({
    relation: z.literal("root"),
    address: RootAddressSchema,
    graph: OwnedRefSchema.optional(),
  }),
  z.strictObject({
    relation: z.literal("branch"),
    graph: OwnedRefSchema.optional(),
  }),
  z.strictObject({
    relation: z.literal("free"),
    graph: OwnedRefSchema.optional(),
  }),
]);
export type NodePlacement = z.infer<typeof NodePlacementSchema>;

/** Whether a placement is one that names its own graph, having no note to read
 *  one off. */
export function namesGraph(
  from: NodePlacement,
): from is Extract<NodePlacement, { relation: "root" | "branch" | "free" }> {
  return (
    from.relation === "root" ||
    from.relation === "branch" ||
    from.relation === "free"
  );
}

/** The graph a placement asks for, where it is one that names a graph at all. */
export function graphAsked(
  from: NodePlacement | undefined,
): OwnedRef | undefined {
  return from && namesGraph(from) ? from.graph : undefined;
}

/**
 * Create a node. The server mints the id, and assigns every address the
 * request does not name.
 *
 * An absent `from` opens a branch at the next number in the home graph, which
 * is what `branch` says with a graph beside it. An unknown field, in the body
 * or in the placement, is refused rather than dropped: a caller that placed a
 * note through a field this route no longer reads would be handed a place it
 * did not ask for, and the address that place gives it keeps leading to it
 * however far it is moved afterwards.
 */
export const CreateNodeRequestSchema = z.strictObject(
  {
    from: NodePlacementSchema.optional(),
    /**
     * Absent leaves the address to the rule: the next in the run the note is
     * written into. A person who names one has the new note take it instead,
     * and it must spring from the address of the note it is written under — or
     * from nothing, where the note opens a branch. A `root` placement names a
     * branch's own number already, and a request carrying both is refused.
     */
    address: AddressSchema.optional(),
    title: z.string().max(512).default(""),
    tags: TagsSchema.default([]),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type CreateNodeRequest = z.input<typeof CreateNodeRequestSchema>;

/**
 * Where a note is carried to: `under` another note, so it springs out of that
 * one, or `after` it, so it continues the run that one is in. It names no
 * graph — a note stays in the one it was written in — and no address, which
 * rides the request beside it.
 *
 * Dropping it between two siblings is `after` the one before it, and puts it at
 * the end of their run: neither of them is renumbered, and the address it leaves
 * keeps leading to it. AI.md § "The Genealogy Is the Protocol".
 */
export const NoteDestinationSchema = z.discriminatedUnion("relation", [
  UNDER,
  AFTER,
]);
export type NoteDestination = z.infer<typeof NoteDestinationSchema>;

export const MoveNoteRequestSchema = z.strictObject(
  {
    to: NoteDestinationSchema,
    /**
     * Absent leaves the address to the rule: the next in the run the note
     * joins. A person who names one has the note take it instead, and it must
     * spring from the address of the note it lands under — or from nothing,
     * where the note becomes a branch. Everything beneath the note keeps its
     * place relative to it either way.
     */
    address: AddressSchema.optional(),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type MoveNoteRequest = z.input<typeof MoveNoteRequestSchema>;

/**
 * What a person writes in the place an address is shown. `null` takes the
 * address off and leaves the note with none; a string is the label it takes,
 * which nothing else in its graph may already hold or ever have held.
 */
export const SetAddressRequestSchema = z.strictObject(
  { address: AddressSchema.nullable() },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type SetAddressRequest = z.input<typeof SetAddressRequestSchema>;

/**
 * `graph` is absent because it is immutable, and `address`, `depth`, `origin`
 * and `parent` because a move is what rewrites them —
 * {@link MoveNoteRequestSchema}.
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
