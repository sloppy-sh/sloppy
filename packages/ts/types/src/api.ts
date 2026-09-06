// Sloppy's own API on the wire — what its routes accept and answer.
// `syr.ts` is this file's mirror for somebody else's routes.

import type { RecordId } from "surrealdb";
import { z } from "zod";
import { AddressSchema } from "./address.js";
import { BlockSchema } from "./block.js";
import { ownedRefFrom, splitOwnedRef } from "./codecs.js";
import {
  DidSyrSchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
import { GraphSchema } from "./graph.js";
import { requireNodeConsistent } from "./node.js";
import { NodeSchema } from "./node.js";
import { type PulledBlock, type PulledNode, PullSchema } from "./federation.js";
import { PublicationSchema } from "./publication.js";
import { PublishedVersionSchema } from "./published.js";
import { TagSchema } from "./tag.js";

/**
 * A stored row as it crosses the wire: the composite key replaced by the
 * `<did>/<ulid>` reference the row is already pointed at by everywhere else.
 * Nothing else changes — a view is its row.
 *
 * The substitution is what makes a row expressible as JSON at all: the key is a
 * SurrealDB `RecordId`, which no JSON encoding round-trips back into the class
 * `RecordIdSchema` checks for.
 */
export function entityView<T extends { id: RecordId }>(
  row: T,
): Omit<T, "id"> & { ref: OwnedRef } {
  const { id, ...rest } = row;
  return { ...rest, ref: ownedRefFrom(id) };
}

export const NodeViewSchema = NodeSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
});
export type NodeView = z.infer<typeof NodeViewSchema>;

export const BlockViewSchema = BlockSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
});
export type BlockView = z.infer<typeof BlockViewSchema>;

/**
 * A graph as a listing carries it. The home graph is listed like any other and
 * carries the ref its absence stands for, so a surface picking one has a single
 * kind of value to hold — whether or not a row has ever been written for it.
 */
export const GraphViewSchema = GraphSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
});
export type GraphView = z.infer<typeof GraphViewSchema>;

/**
 * One tag somebody has used, and how many of their notes carry it. There is no
 * tag row to view — a tag exists exactly as long as a note holds it, so this is
 * counted from the notes rather than read from a table.
 */
export const TagCountSchema = z.object({
  tag: TagSchema,
  notes: z.int().positive(),
});
export type TagCount = z.infer<typeof TagCountSchema>;

/**
 * The author's own view of a publication: the chain, and the version a plain
 * read of it answers with. `latest` is read from the versions rather than kept
 * on the row, so there is one place a chain's newest version is written down.
 *
 * `identity_store` stays on the row: it is how this instance resolves a voice
 * somebody claims to be, and nothing a surface draws.
 */
export const PublicationViewSchema = PublicationSchema.omit({
  id: true,
  identity_store: true,
}).extend({ ref: OwnedRefSchema, latest: PublishedVersionSchema });
export type PublicationView = z.infer<typeof PublicationViewSchema>;

export const PullViewSchema = PullSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
});
export type PullView = z.infer<typeof PullViewSchema>;

/**
 * A held node as the rest of Sloppy reads it, addressed by its AUTHOR — which
 * is what `provenanceOf` in `@sloppy/graph` reads to draw it as foreign, and it
 * needs the viewer beside it to do so. `graph` is the author's too.
 *
 * `published` is asserted, not read: no publication row on this instance covers
 * a foreign node, and whether the author still publishes it is not something a
 * reader can learn, so this says what was true when the copy arrived. There is
 * no look and no references, because a published node travels without either.
 */
export function pulledNodeView(row: PulledNode): NodeView {
  const { node } = row;
  return {
    ref: row.source,
    created_by: splitOwnedRef(row.source).did,
    graph: row.source_graph,
    address: node.address,
    depth: row.depth,
    parent: node.parent,
    origin: node.origin,
    title: node.title,
    tags: node.tags,
    links: node.links,
    published: true,
    created_at: node.created_at,
    updated_at: node.updated_at,
    content_signature: node.content_signature,
    signed_payload_json: node.signed_payload_json,
    signing_device_public_key: node.signing_device_public_key,
  };
}

/**
 * A held block, likewise. The timestamps are the copy's own: a published block
 * carries none of the author's, so these say when the copy arrived.
 */
export function pulledBlockView(row: PulledBlock): BlockView {
  return {
    ref: row.source,
    created_by: splitOwnedRef(row.source).did,
    node: row.node,
    ord: row.ord,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** `parseNode`'s boundary, on the wire: a node arrives checked or not at all. */
export function parseNodeView(value: unknown): NodeView {
  const view = NodeViewSchema.parse(value);
  requireNodeConsistent(view);
  return view;
}

/**
 * What one bulk act did.
 *
 * `notes` is what the act left behind — every note it reached, as that note now
 * stands — and is empty where the act was to delete them, which is why the
 * count is its own field. `missed` is the rest of what was asked for: gone,
 * never the caller's, or — publishing — one this instance could not put out. An
 * act that reaches nothing is refused instead, so a reader of these two numbers
 * is always reading a partial success.
 */
export const NodeBulkResultSchema = z.object({
  reached: z.int().nonnegative(),
  missed: z.int().nonnegative(),
  notes: z.array(NodeViewSchema),
});
export type NodeBulkResult = z.infer<typeof NodeBulkResultSchema>;

/** {@link parseNodeView}'s boundary over a whole answer. */
export function parseNodeBulkResult(value: unknown): NodeBulkResult {
  const result = NodeBulkResultSchema.parse(value);
  return { ...result, notes: result.notes.map(parseNodeView) };
}

/**
 * A branch its author deleted, as the listing of what can still be put back
 * carries it. `ref` is the branch's root, `address` the label they cite it by,
 * and `notes` how many notes come back with it — the root and everything under
 * it — which is the size of the act a person is choosing.
 */
export const DeletedBranchSchema = z.object({
  ref: OwnedRefSchema,
  address: AddressSchema,
  graph: OwnedRefSchema,
  title: z.string(),
  deleted_at: TimestampSchema,
  notes: z.int().positive(),
});
export type DeletedBranch = z.infer<typeof DeletedBranchSchema>;

/**
 * Everything `did` keeps, as JSON they can hold. A deleted note is not part of
 * it, and a section carries its document exactly as it is stored.
 */
export const GraphExportSchema = z.object({
  exported_at: TimestampSchema,
  did: DidSyrSchema,
  graphs: z.array(GraphViewSchema),
  notes: z.array(NodeViewSchema),
  blocks: z.array(BlockViewSchema),
});
export type GraphExport = z.infer<typeof GraphExportSchema>;

/**
 * Who the API believes is calling.
 *
 * `delegate_public_key` is the PUBLIC half of the key the syr instance signs
 * this platform's content with. Sloppy never holds the private half; code here
 * that wants to sign locally has misread the delegation model.
 */
export const ViewerSchema = z.object({
  did: DidSyrSchema,
  syr_instance_url: z.url(),
  delegate_public_key: z.string().min(1),
});
export type Viewer = z.infer<typeof ViewerSchema>;

/**
 * Begin Platform Delegation against an instance. `redirect` names where the
 * person lands afterwards; the API decides which targets it will honour, so an
 * unacceptable one is dropped rather than refused.
 */
export const StartLoginRequestSchema = z.object({
  instance_url: z.url(),
  redirect: z.string().min(1).optional(),
});
export type StartLoginRequest = z.input<typeof StartLoginRequestSchema>;

export const ConsentRedirectSchema = z.object({ consent_url: z.url() });
export type ConsentRedirect = z.infer<typeof ConsentRedirectSchema>;

/**
 * Trade a consent callback's code for a session, for a client that received the
 * callback itself — the native shell's deep link. A browser that lands back on
 * the API instead never sends this: it already has the session.
 */
export const ExchangeSessionRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type ExchangeSessionRequest = z.input<
  typeof ExchangeSessionRequestSchema
>;

export const SessionSchema = z.object({
  token: z.string().min(1),
  expires_at: TimestampSchema,
  viewer: ViewerSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const ServiceStatusSchema = z.enum(["up", "down"]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

/** What an API instance depends on. A new dependency is a value here. */
export const ServiceDependencySchema = z.enum([
  "database",
  "object_storage",
  "identity",
]);
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>;

/**
 * `status` is `degraded` when any check is down, and the API answers 503 with
 * this same body then — so a reader parses the report either way.
 */
export const HealthReportSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.array(
    z.object({
      dependency: ServiceDependencySchema,
      status: ServiceStatusSchema,
    }),
  ),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;
