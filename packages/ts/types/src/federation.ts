// Following somebody, and holding a region of their graph.
//
// A follow lives in the reader's identity store, not here — AI.md § "Sloppy's
// Vocabulary Stays Out of the Identity Store" — so `FollowedIdentity` is a read
// of that store rather than a row of ours. The pulled region is the opposite
// case: it is nodes and blocks, which no identity store has words for, so
// Sloppy holds it.
//
// docs/ARCHITECTURE.md § "Federating the graph" is the doc of record.

import { z } from "zod";
import { addressDepth, AddressSchema } from "./address.js";
import { splitOwnedRef } from "./codecs.js";
import { DidSyrSchema, OwnedEntitySchema, OwnedRefSchema } from "./common.js";
import { BlockDocumentSchema } from "./document.js";
import { NodeDepthMismatchError } from "./node.js";
import { PublishedNodeSchema } from "./publication.js";

/**
 * Somebody the reader follows. `provider_url` is where their identity store
 * answers; absent where the reader's own store recorded none, and the DID is
 * then resolved from scratch.
 */
export const FollowedIdentitySchema = z.object({
  did: DidSyrSchema,
  provider_url: z.url().nullable().optional(),
});
export type FollowedIdentity = z.infer<typeof FollowedIdentitySchema>;

export const FollowRequestSchema = z.object({ did: DidSyrSchema });
export type FollowRequest = z.input<typeof FollowRequestSchema>;

/**
 * A region of somebody else's graph the reader holds a copy of. One row per
 * reader, author and root address — pulling again refreshes this row rather
 * than writing a second, and `updated_at` is when that last happened.
 *
 * `created_by` is the READER. They are the one whose purge has to reach the
 * copy, and the author is `source_did`.
 */
export const PullSchema = OwnedEntitySchema.extend({
  source_did: DidSyrSchema,
  /** The address the reader cited to find it. */
  root_address: AddressSchema,
  /**
   * The instance that served it, and the one a refresh asks again. A DID does
   * not answer this: syr's identity manifest names an identity's own store and
   * nothing about where that identity's graph is served, so where is carried
   * rather than resolved.
   */
  source_url: z.url(),
});
export type Pull = z.infer<typeof PullSchema>;

export const CreatePullRequestSchema = z.object({
  did: DidSyrSchema,
  root_address: AddressSchema,
  /** Where to ask. Absent means this instance, which is the whole of it when
   *  the author keeps their graph here. */
  source_url: z.url().optional(),
});
export type CreatePullRequest = z.input<typeof CreatePullRequestSchema>;

/**
 * One node of a held copy, as its author's instance answered.
 *
 * A node is held ONCE per reader however many regions cover it: which regions
 * those are is `isInSubtree` over the roots of the reader's `pull` rows for
 * this author, derived from the address like everything else derived from one
 * (AI.md § "The Address Is the Protocol"). So pulling `1` after `1a` shares
 * these rows rather than colliding with them, and dropping a region deletes
 * only what no surviving region still covers.
 *
 * `node` is carried untouched, because a signature is over what the author
 * sent: a reader that reshaped it could no longer check one. Its `ref` is not
 * in there — `source` below is the single home for it, so the two cannot
 * disagree.
 */
export const PulledNodeSchema = OwnedEntitySchema.extend({
  /** The node as its AUTHOR addresses it: `<their did>/<their ulid>`. */
  source: OwnedRefSchema,
  /** Its author, beside `source` rather than read out of it, because an index
   *  cannot seek on half a column. `parsePulledNode` holds the two together. */
  source_did: DidSyrSchema,
  /**
   * `addressDepth(node.address)`, minted here because a published node carries
   * none. It is the same ratified exception `node.depth` is, bought by the same
   * level-of-detail read; `parsePulledNode` is the boundary it is held at.
   */
  depth: z.int().positive(),
  node: PublishedNodeSchema.omit({ ref: true }),
});
export type PulledNode = z.infer<typeof PulledNodeSchema>;

/**
 * Every pulled node row crosses this, in both directions, for the reason
 * `parseNode` exists: both columns are immutable, so a row that gets past here
 * disagreeing with the node it copies is wrong for as long as it exists.
 */
export function parsePulledNode(row: unknown): PulledNode {
  const pulled = PulledNodeSchema.parse(row);
  const actual = addressDepth(pulled.node.address);
  if (pulled.depth !== actual) {
    throw new NodeDepthMismatchError(pulled.node.address, pulled.depth, actual);
  }
  const { did } = splitOwnedRef(pulled.source);
  if (pulled.source_did !== did) {
    throw new Error(
      `Held node ${pulled.source} says it was written by ${pulled.source_did}`,
    );
  }
  return pulled;
}

/**
 * One block of a held copy, held once like the node it belongs to. Flat rather
 * than nesting the published block: every column but `content` is one an index
 * reads, and SurrealDB will not index a nested path.
 */
export const PulledBlockSchema = OwnedEntitySchema.extend({
  /** The block as its AUTHOR addresses it. */
  source: OwnedRefSchema,
  /** The node it belongs to, as its author addresses it. */
  node: OwnedRefSchema,
  ord: z.string().min(1),
  content: BlockDocumentSchema,
});
export type PulledBlock = z.infer<typeof PulledBlockSchema>;
