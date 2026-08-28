// Sloppy's own API on the wire — what its routes accept and answer.
// `syr.ts` is this file's mirror for somebody else's routes.

import type { RecordId } from "surrealdb";
import { z } from "zod";
import { addressDepth } from "./address.js";
import { BlockSchema } from "./block.js";
import { ownedRefFrom } from "./codecs.js";
import {
  DidSyrSchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
import { NodeDepthMismatchError, nodeDepthMatchesAddress } from "./node.js";
import { NodeSchema } from "./node.js";
import { PublicationSchema } from "./publication.js";
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
 * One tag somebody has used, and how many of their notes carry it. There is no
 * tag row to view — a tag exists exactly as long as a note holds it, so this is
 * counted from the notes rather than read from a table.
 */
export const TagCountSchema = z.object({
  tag: TagSchema,
  notes: z.int().positive(),
});
export type TagCount = z.infer<typeof TagCountSchema>;

export const PublicationViewSchema = PublicationSchema.omit({
  id: true,
}).extend({ ref: OwnedRefSchema });
export type PublicationView = z.infer<typeof PublicationViewSchema>;

/** `parseNode`'s boundary, on the wire: a node arrives depth-checked or not at all. */
export function parseNodeView(value: unknown): NodeView {
  const view = NodeViewSchema.parse(value);
  if (!nodeDepthMatchesAddress(view)) {
    throw new NodeDepthMismatchError(
      view.address,
      view.depth,
      addressDepth(view.address),
    );
  }
  return view;
}

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
