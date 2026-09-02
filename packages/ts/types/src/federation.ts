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
 * `scheme://host[:port]` and nothing else. Spelled out rather than delegated to
 * a URL parser, because this package compiles against no platform globals and
 * because a wire shape says what it accepts: lowercase, `http` or `https`, a
 * name or an address literal, and a port that is present only where it is not
 * the scheme's own.
 */
const PEER_ORIGIN =
  /^(https?):\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::([0-9]+))?$/;

/** Whether a string is an origin and nothing more: no path, query, fragment or
 *  credentials, and one spelling of each instance. */
export function isPeerOrigin(value: string): boolean {
  const match = PEER_ORIGIN.exec(value);
  if (!match) return false;
  const [, scheme, port] = match;
  if (port === undefined) return true;
  return (
    /^[1-9][0-9]{0,4}$/.test(port) &&
    Number(port) <= 65535 &&
    Number(port) !== (scheme === "https" ? 443 : 80)
  );
}

/**
 * Where somebody else's graph is served. An ORIGIN and never a URL, because the
 * caller names an instance and the instance names the path: a value carrying
 * one would let a signed-in reader have this instance fetch an address of their
 * choosing and read the answer back. The single spelling is also what keeps one
 * peer from becoming two `pull` rows.
 *
 * This bounds the shape. WHICH addresses an instance will connect to is the
 * separate question `api/src/media/remote-host.ts` already answers once, and a
 * peer fetch goes through it rather than answering it again.
 * docs/ARCHITECTURE.md § "Federating the graph".
 */
export const PeerOriginSchema = z
  .string()
  .refine(
    isPeerOrigin,
    "Enter an instance address, like https://sloppy.example",
  );
export type PeerOrigin = z.infer<typeof PeerOriginSchema>;

/**
 * What somebody typed, as an origin: a bare hostname gets `https://`, and a
 * whole address they pasted keeps only the instance out of it. `null` where it
 * cannot be one at all, which is a text field's answer rather than a throw.
 */
export function peerOrigin(typed: string): PeerOrigin | null {
  const trimmed = typed.trim().toLowerCase();
  const written = /^([a-z][a-z0-9+.-]*):\/\//.exec(trimmed);
  // A scheme somebody wrote is theirs; `peer.example:8040` is a host and a
  // port, and treating it as one would make a hostname out of `file`.
  if (written && written[1] !== "http" && written[1] !== "https") return null;
  const scheme = written?.[1] ?? "https";
  const authority = trimmed.slice(written?.[0].length ?? 0).split(/[/?#]/)[0];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  const ownPort = scheme === "https" ? ":443" : ":80";
  const named = host.endsWith(ownPort) ? host.slice(0, -ownPort.length) : host;
  const origin = `${scheme}://${named}`;
  return isPeerOrigin(origin) ? origin : null;
}

/** What `GET /peers/publications` binds. An absent `source_url` is this
 *  instance, which is the whole of it for somebody who keeps their graph here. */
export const PeerPublicationsQuerySchema = z.object({
  did: DidSyrSchema,
  source_url: PeerOriginSchema.optional(),
});
export type PeerPublicationsQuery = z.input<typeof PeerPublicationsQuerySchema>;

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
  source_url: PeerOriginSchema,
});
export type Pull = z.infer<typeof PullSchema>;

export const CreatePullRequestSchema = z.object({
  did: DidSyrSchema,
  root_address: AddressSchema,
  /** Where to ask. Absent means this instance, which is the whole of it when
   *  the author keeps their graph here. */
  source_url: PeerOriginSchema.optional(),
});
export type CreatePullRequest = z.input<typeof CreatePullRequestSchema>;

/**
 * One node of a held copy, as its author's instance answered.
 *
 * Held ONCE per reader however many regions cover it, and no column says which:
 * membership is `isInSubtree` over the reader's `pull` roots for this author.
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
