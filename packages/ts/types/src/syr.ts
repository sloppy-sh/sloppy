// syr's wire contracts, as Sloppy consumes them.
//
// This is the one file that speaks syr's wire dialect — request and response
// shapes syr defines and we only read. Mirrors syr's own `identity-manifest.ts`
// and `platform-delegation.ts`; it is a copy of the wire, not of the source.
//
// These are somebody else's responses. Unknown keys are dropped rather than
// rejected, so an instance running ahead of us stays readable.

import { z } from "zod";
import { AddressSchema } from "./address.js";
import { splitOwnedRef } from "./codecs.js";
import {
  DidSyrSchema,
  type OwnedRef,
  OwnedRefSchema,
  TimestampSchema,
  UlidSchema,
} from "./common.js";

/**
 * What Sloppy asks for. A response may name a scope this version does not,
 * which is why granted scopes below are plain strings.
 */
export const SyrScopeSchema = z.enum([
  "identity:read",
  "identity:verify",
  "profile:read",
  "posts:read",
  "posts:write",
]);
export type SyrScope = z.infer<typeof SyrScopeSchema>;

/** `{id}` stands in for a path segment the caller substitutes. */
const urlTemplate = z
  .string()
  .refine((s) => s.startsWith("http://") || s.startsWith("https://"), {
    message: "Expected an absolute http(s) URL or URL template",
  });

/**
 * The instance manifest at `/.well-known/syr`.
 *
 * An absent `platform` block means this instance does not offer Platform
 * Delegation — Sloppy cannot sign against it and must say so before a person
 * commits to it, rather than failing at the first save.
 */
export const SyrInstanceManifestSchema = z.object({
  name: z.literal("syr"),
  public_url: z.url(),
  identity_manifest_template: urlTemplate,
  platform: z
    .object({
      consent: urlTemplate,
      token: urlTemplate,
      sign: urlTemplate,
      challenge: urlTemplate,
      delegations: urlTemplate,
      revoke: urlTemplate,
    })
    .optional(),
  /**
   * `public_profile` is where the instance answers about a person by the name
   * they go by there, a name appended to it. Absent — the block, the field, or
   * both — means it answers about nobody that way, and a reader is told to use
   * the identifier instead.
   */
  api: z.object({ public_profile: z.url().optional() }).optional(),
});
export type SyrInstanceManifest = z.infer<typeof SyrInstanceManifestSchema>;

/**
 * The per-identity manifest at `/.well-known/syr/{did}`. `uploads` is the one
 * Sloppy uses most: block images and ink rasters are syr's blobs, not ours.
 */
export const SyrIdentityManifestSchema = z.object({
  version: z.literal(1),
  did: DidSyrSchema,
  provider: z.url(),
  endpoints: z.object({
    profile: z.url(),
    uploads: z.url(),
    did_document: z.url(),
    public_emojis: z.url().optional(),
    public_gifs: z.url().optional(),
    public_reactions: z.url().optional(),
    public_comments: z.url().optional(),
    public_following: z.url().optional(),
  }),
  web_profile: z.url(),
});
export type SyrIdentityManifest = z.infer<typeof SyrIdentityManifestSchema>;

/**
 * Exchanging the consent callback's code for a token. `callback_url` must be
 * byte-identical to the one the consent request carried — syr compares the
 * strings, not the URLs, so a trailing slash is a different callback.
 */
export const SyrPlatformTokenRequestSchema = z.object({
  code: z.string().min(1),
  /**
   * The callback carries this beside the code, and syr refuses the exchange
   * without it — it looks the delegation up by id rather than searching for the
   * code, so the two are not interchangeable.
   */
  delegation_id: z.string().min(1),
  callback_url: z.url(),
  platform_origin: z.url(),
});
export type SyrPlatformTokenRequest = z.infer<
  typeof SyrPlatformTokenRequestSchema
>;

export const SyrPlatformTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.int().positive(),
  did: DidSyrSchema,
  /**
   * The key the instance will sign our content with. Sloppy stores it to verify
   * signatures later; the private half never leaves syr, and code here that
   * wants to sign locally has misread the delegation model.
   */
  delegate_public_key: z.string().min(1),
  scopes: z.array(z.string()),
});
export type SyrPlatformTokenResponse = z.infer<
  typeof SyrPlatformTokenResponseSchema
>;

/** `payload` is JCS-canonicalized by the instance before it is signed. */
export const SyrPlatformSignRequestSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  payload_type: z.string().optional(),
});
export type SyrPlatformSignRequest = z.infer<
  typeof SyrPlatformSignRequestSchema
>;

export const SyrPlatformSignResponseSchema = z.object({
  /** Multibase-encoded Ed25519. */
  signature: z.string().min(1),
  delegate_public_key: z.string().min(1),
  did: DidSyrSchema,
  signed_at: z.iso.datetime(),
});
export type SyrPlatformSignResponse = z.infer<
  typeof SyrPlatformSignResponseSchema
>;

/** Re-authenticating a delegation that already exists. */
export const SyrPlatformChallengeRequestSchema = z.object({
  did: DidSyrSchema,
  platform_origin: z.url(),
  challenge: z.string().min(1),
});
export type SyrPlatformChallengeRequest = z.infer<
  typeof SyrPlatformChallengeRequestSchema
>;

export const SyrPlatformChallengeResponseSchema = z.object({
  signature: z.string().min(1),
  delegate_public_key: z.string().min(1),
  did: DidSyrSchema,
});
export type SyrPlatformChallengeResponse = z.infer<
  typeof SyrPlatformChallengeResponseSchema
>;

/**
 * What Sloppy signs a node with. The instance signs whatever object it is
 * handed, so this is the shape that has to stay stable: a verifier
 * reconstructing it differently gets a different canonical form and a
 * signature that does not check out.
 */
export const NodeSignedPayloadV1Schema = z.object({
  type: z.literal("sloppy-node@v1"),
  did: DidSyrSchema,
  /** The ULID half of the node's key. `did` above is the other half. */
  node_id: UlidSchema,
  address: AddressSchema,
  title: z.string(),
  created_at: TimestampSchema,
});
export type NodeSignedPayloadV1 = z.infer<typeof NodeSignedPayloadV1Schema>;

/**
 * What a comment is signed with. syr defines this one — it is the payload its
 * own signing flow builds — so the field set is its to change, and a verifier
 * reconstructing it differently gets a signature that does not check out.
 *
 * Two halves are easy to get wrong. `comment_id` is the LOCAL half of the
 * comment's key, not the `<did>:<local id>` a thread cites it by; `created_at`
 * is the store's own serialization of the comment it just wrote, at whatever
 * width that store used, because the signature is over those bytes and not over
 * a timestamp Sloppy normalized afterwards.
 */
export const CommentSignedPayloadV1Schema = z.object({
  type: z.literal("comment@v1"),
  did: DidSyrSchema,
  comment_id: z.string().min(1),
  post_did: z.string().min(1),
  post_id: z.string().min(1),
  ancestor_chain: z.array(z.string()),
  content: z.string(),
  visibility: z.literal("public"),
  status: z.literal("completed"),
  created_at: z.iso.datetime(),
});
export type CommentSignedPayloadV1 = z.infer<
  typeof CommentSignedPayloadV1Schema
>;

/**
 * Every syr API response is wrapped in an envelope; the payload is under
 * `data`. The listing endpoints add `pagination` beside it, which nothing here
 * reads — a caller that needs a second page asks for one by offset.
 */
export function syrEnvelope<T extends z.ZodType>(
  data: T,
): z.ZodObject<{ data: T }> {
  return z.object({ data });
}

/**
 * What `POST {endpoints.uploads-owner}` answers: where to PUT the bytes, and
 * where they will read back from. `signedUrl` is single-use and expires; the
 * bytes behind `finalUrl` do not.
 */
export const SyrUploadTicketSchema = z.object({
  signedUrl: z.url(),
  finalUrl: z.url(),
  uploadDid: DidSyrSchema,
  uploadLocalId: z.string().min(1),
});
export type SyrUploadTicket = z.infer<typeof SyrUploadTicketSchema>;

/**
 * An upload row. `url` is null until the upload is completed, and `status` is
 * `finalizing` on an instance whose object store has not shown the bytes yet —
 * the caller asks again rather than treating it as a failure.
 */
export const SyrUploadSchema = z.object({
  filename: z.string(),
  mime_type: z.string(),
  size: z.int().nonnegative(),
  url: z.url().nullable().optional(),
  /** syr's own spelling, and the one that actually reads: `url` is the raw
   *  object-store address, which a private blob refuses. Absent on a store that
   *  gates the raw address itself, where `url` is what to use. */
  downloadUrl: z.url().nullable().optional(),
  status: z.string().optional(),
  /** Whether a stranger may read the bytes. Absent where a store does not say,
   *  which is not the same as `false`: a caller that must not accept a private
   *  blob refuses only what a store has told it is one. */
  is_public: z.boolean().optional(),
  metadata: z
    .object({
      width: z.int().positive().optional(),
      height: z.int().positive().optional(),
    })
    .optional(),
});
export type SyrUpload = z.infer<typeof SyrUploadSchema>;

/** One row of an owner's own listing, which adds the two halves of the id an
 *  upload is cited by — a read of a single upload already knows them. */
export const SyrOwnedUploadSchema = SyrUploadSchema.extend({
  did: DidSyrSchema,
  local_id: z.string().min(1),
});
export type SyrOwnedUpload = z.infer<typeof SyrOwnedUploadSchema>;

/** `did` is null on an account whose identity has not been minted yet. */
export const SyrProfileSchema = z.object({
  did: DidSyrSchema.nullable(),
  username: z.string(),
  display_name: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatar_url: z.url().nullable().optional(),
  banner_url: z.url().nullable().optional(),
});
export type SyrProfile = z.infer<typeof SyrProfileSchema>;

/**
 * What a store is sent to change a profile. An absent key leaves that field
 * alone and an explicit `null` clears it, which is why every field is both
 * nullable and optional. The pictures are addresses in that store, resolved
 * from the upload the caller named — `ProfileService` is where that happens.
 */
export const SyrProfilePatchSchema = z.object({
  display_name: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatar_url: z.url().nullable().optional(),
  banner_url: z.url().nullable().optional(),
});
export type SyrProfilePatch = z.infer<typeof SyrProfilePatchSchema>;

/** The owner's view of one catalog entry. `local_id` pairs with `did` as its key. */
export const SyrEmojiSchema = z.object({
  did: DidSyrSchema,
  local_id: z.string().min(1),
  shortcode: z.string(),
  url: z.url(),
  is_sticker: z.boolean().default(false),
});
export type SyrEmoji = z.infer<typeof SyrEmojiSchema>;

/**
 * A note, as an identity store addresses the thing a comment or a reaction is
 * about. The store never learns it is a note: it holds an opaque pair, which is
 * what keeps Sloppy's vocabulary out of it.
 */
export function syrPostRefFor(node: OwnedRef): {
  post_did: string;
  post_id: string;
} {
  const { did, localId } = splitOwnedRef(node);
  return { post_did: did, post_id: localId };
}

/** The other direction, for a record read back off a store. */
export function nodeRefFromSyrPost(post: {
  post_did: string;
  post_id: string;
}): OwnedRef {
  return OwnedRefSchema.parse(`${post.post_did}/${post.post_id}`);
}

/**
 * One row of `endpoints.public_following` — a DID this identity says it
 * follows. The owner's own listing answers the same shape with more beside it,
 * which is dropped here.
 */
export const SyrFollowSchema = z.object({
  followed_did: DidSyrSchema,
  followed_provider_url: z.url().nullable().optional(),
});
export type SyrFollow = z.infer<typeof SyrFollowSchema>;

/**
 * One comment as an identity's public endpoint answers it. That endpoint serves
 * only what its author made public and finished, so nothing downstream filters
 * again.
 *
 * `created_at` is a foreign instance's serialization and is accepted at
 * whatever width it wrote — `asTimestamp` brings it to the one encoding
 * Sloppy's own wire uses.
 */
export const SyrCommentSchema = z.object({
  did: DidSyrSchema,
  local_id: z.string().min(1),
  post_did: z.string().min(1),
  post_id: z.string().min(1),
  /**
   * Root comment first, immediate parent last. Each entry is a `StoreRef`, and
   * the array is plain strings so that one entry Sloppy cannot read costs a
   * thread its shape rather than costing a reader the whole comment.
   */
  ancestor_chain: z.array(z.string()).default([]),
  content: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  /**
   * Present when the author signed the comment. syr's create route drops the
   * envelope it accepts, so a comment is written unsigned and signed by the
   * patch below; this listing serves whatever landed that way.
   */
  content_signature: z.string().optional(),
  signed_payload_json: z.string().optional(),
  signing_device_public_key: z.string().optional(),
});
export type SyrComment = z.infer<typeof SyrCommentSchema>;

/**
 * What Sloppy posts to write one. `visibility` and `status` are sent rather
 * than left to the store's defaults: a comment a reader wrote to be read is not
 * something to discover a default about.
 */
export const SyrCommentCreateRequestSchema = z.object({
  post_did: z.string().min(1),
  post_id: z.string().min(1),
  ancestor_chain: z.array(z.string()),
  content: z.string().min(1),
  visibility: z.literal("public"),
  status: z.literal("completed"),
});
export type SyrCommentCreateRequest = z.infer<
  typeof SyrCommentCreateRequestSchema
>;

/**
 * What attaches a signature to a comment already written, sent to the store
 * that holds it. Writing and signing are two calls because the create route
 * takes no signature; a comment whose second call never lands stays as it is,
 * unsigned, rather than being lost.
 */
export const SyrCommentSignatureSchema = z.object({
  content_signature: z.string().min(1),
  signed_payload_json: z.string().min(1),
  signing_device_public_key: z.string().min(1),
});
export type SyrCommentSignature = z.infer<typeof SyrCommentSignatureSchema>;

/** What a reaction is carried by. `gif` is one syr has and Sloppy has no
 *  renderer for, so a reader is handed the kinds it can draw and the rest are
 *  dropped rather than refused. */
export const SyrReactionKindSchema = z.enum([
  "unicode",
  "custom_emoji",
  "sticker",
  "gif",
]);
export type SyrReactionKind = z.infer<typeof SyrReactionKindSchema>;

/**
 * One reaction as an identity's public endpoint answers it. `parent_type` is
 * `post` for a reaction on a note; `comment` is one on a comment, which the
 * same endpoint carries and which a reader drops — Sloppy has no surface for
 * reacting inside a thread, so an unfiltered listing would draw a comment's
 * reactions on the note.
 *
 * `image_url` is the author's own store, so it never reaches a reader — every
 * remote address is minted into one of ours first. AI.md § "Sloppy's Vocabulary
 * Stays Out of the Identity Store".
 */
export const SyrReactionSchema = z.object({
  did: DidSyrSchema,
  local_id: z.string().min(1),
  parent_type: z.enum(["post", "comment"]),
  parent_did: z.string().min(1),
  parent_id: z.string().min(1),
  kind: SyrReactionKindSchema,
  value: z.string().min(1),
  image_url: z.url().nullable().optional(),
  created_at: z.iso.datetime(),
});
export type SyrReaction = z.infer<typeof SyrReactionSchema>;

export const SyrReactionCreateRequestSchema = z.object({
  parent_type: z.literal("post"),
  parent_did: z.string().min(1),
  parent_id: z.string().min(1),
  kind: SyrReactionKindSchema,
  value: z.string().min(1),
  image_url: z.url().optional(),
});
export type SyrReactionCreateRequest = z.infer<
  typeof SyrReactionCreateRequestSchema
>;
