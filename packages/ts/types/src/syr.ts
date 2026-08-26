// syr's wire contracts, as Sloppy consumes them.
//
// This is the one file allowed to name the vendor: it exists to speak syr's
// dialect, and everything it produces is normalized into shapes elsewhere in
// this package that do not. Mirrors syr's own `identity-manifest.ts` and
// `platform-delegation.ts`; it is a copy of the wire, not of the source.
//
// These are somebody else's responses. Unknown keys are dropped rather than
// rejected, so an instance running ahead of us stays readable.

import { z } from "zod";
import { DidSyrSchema } from "./common.js";

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
  node_id: z.string().min(1),
  address: z.string().min(1),
  title: z.string(),
  created_at: z.string(),
});
export type NodeSignedPayloadV1 = z.infer<typeof NodeSignedPayloadV1Schema>;
