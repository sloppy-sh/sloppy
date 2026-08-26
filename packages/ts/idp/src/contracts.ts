// What this instance accepts and answers, as a syr instance.
//
// `@sloppy/types`' `syr.ts` is the same contracts read from the other side —
// what Sloppy sends to somebody else's instance. The two must agree, so the
// response shapes here are asserted against those schemas in `contracts.test.ts`
// rather than merely written to look alike.

import { DidSyrSchema, SyrScopeSchema, TimestampSchema } from "@sloppy/types";
import { z } from "zod";

/** Bounded because the instance stores it and hands it back on the redirect. */
const OpaqueStateSchema = z.string().max(512);

const MALFORMED_LINK =
  "That app's sign-in link is malformed. Ask its author to fix it.";

const HttpUrlSchema = z
  .url(MALFORMED_LINK)
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    MALFORMED_LINK,
  );

export const RegisterRequestSchema = z.object({
  username: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])$/,
      "Pick a name of 3–32 characters: letters, numbers, dashes and underscores.",
    ),
  password: z
    .string()
    .min(12, "Use a password of at least 12 characters.")
    .max(256, "That password is too long."),
  display_name: z
    .string()
    .min(1, "Give a name people will see, or leave it out.")
    .max(64, "That name is too long.")
    .optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

const CHECK_CREDENTIALS = "Check your name and password and try again.";

export const LoginRequestSchema = z.object({
  username: z.string().min(1, CHECK_CREDENTIALS).max(64, CHECK_CREDENTIALS),
  password: z.string().min(1, CHECK_CREDENTIALS).max(256, CHECK_CREDENTIALS),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** What register and login both answer. The token is a syr bearer token, so a
 *  client points the same code at this instance and at any other one. */
export const SessionGrantSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.int().positive(),
  did: DidSyrSchema,
});
export type SessionGrant = z.infer<typeof SessionGrantSchema>;

export const ProfileSchema = z.object({
  did: DidSyrSchema,
  username: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

// ── Platform Delegation, the instance's half ──────────────────────────────

/**
 * Opening a consent request. `platform_name` defaults to the origin's hostname
 * and `scopes` to what the spec's consent page defaults to, so a platform that
 * sends neither still gets a delegation it can use.
 */
export const ConsentRequestSchema = z.object({
  platform_origin: HttpUrlSchema,
  platform_name: z.string().min(1).max(100).optional(),
  callback_url: HttpUrlSchema,
  scopes: z.array(SyrScopeSchema).min(1).optional(),
  state: OpaqueStateSchema.optional(),
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

/** What the person is being asked to agree to, in the words they decide on. */
export const ConsentPromptSchema = z.object({
  challenge_id: z.string().min(1),
  did: DidSyrSchema,
  display_name: z.string().nullable(),
  platform_name: z.string(),
  platform_origin: z.url(),
  scopes: z.array(SyrScopeSchema),
  expires_in: z.int().positive(),
});
export type ConsentPrompt = z.infer<typeof ConsentPromptSchema>;

/** The password unlocks the root key that signs the delegation — the identity's
 *  own authority, and the reason a session alone cannot approve one. */
export const ConsentApprovalSchema = z.object({
  password: z
    .string()
    .min(1, "Enter your password to continue.")
    .max(256, "That password is too long."),
});
export type ConsentApproval = z.infer<typeof ConsentApprovalSchema>;

export const ConsentOutcomeSchema = z.object({ redirect_url: z.url() });
export type ConsentOutcome = z.infer<typeof ConsentOutcomeSchema>;

/**
 * `callback_url` is compared byte for byte against the one consent was opened
 * with — a trailing slash is a different callback. `delegation_id` rides along
 * because syr's callback returns it, but the code alone identifies the request.
 */
export const TokenRequestSchema = z.object({
  code: z.string().min(1),
  callback_url: z.url(),
  platform_origin: z.url(),
  delegation_id: z.string().min(1).optional(),
});
export type TokenRequest = z.infer<typeof TokenRequestSchema>;

export const SignRequestSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  payload_type: z.string().max(128).optional(),
});
export type SignRequest = z.infer<typeof SignRequestSchema>;

export const ChallengeRequestSchema = z.object({
  did: DidSyrSchema,
  platform_origin: z.url(),
  challenge: z.string().min(1).max(4096),
});
export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export const RevokeRequestSchema = z.object({
  platform_origin: z.url(),
});
export type RevokeRequest = z.infer<typeof RevokeRequestSchema>;

/**
 * Public verification info. A verifier reads `revoked_at` before trusting a
 * signature: a revoked key's old signatures still check out arithmetically.
 *
 * `statement` and `statement_signature` are more than syr v0.1's listing
 * carries, and they are what turn "the provider says this key is authorised"
 * into something a stranger checks: the DID *is* the root public key, so those
 * two verify the delegation without trusting the instance that served them.
 */
export const DelegationInfoSchema = z.object({
  delegate_public_key: z.string(),
  platform_origin: z.string(),
  platform_name: z.string(),
  scope: z.literal("platform"),
  created_at: TimestampSchema,
  revoked_at: TimestampSchema.optional(),
  expires_at: TimestampSchema.optional(),
  /** The canonical bytes the root key signed, verbatim. */
  statement: z.string(),
  statement_signature: z.string(),
});
export type DelegationInfo = z.infer<typeof DelegationInfoSchema>;

/**
 * The exact object the root key signs to authorise a delegate key. Its
 * canonical form is the signed bytes, so every field name, and `createdAt`'s
 * camel case among them, is syr's and not ours to tidy.
 */
export const DelegationStatementSchema = z.object({
  did: DidSyrSchema,
  delegate: z.string().min(1),
  scope: z.literal("platform"),
  platform_origin: z.string(),
  platform_name: z.string(),
  createdAt: TimestampSchema,
});
export type DelegationStatement = z.infer<typeof DelegationStatementSchema>;
