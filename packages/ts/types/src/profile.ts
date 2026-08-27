// Who somebody is, as their identity store reports them. Sloppy reads it and
// caches it; it never keeps a copy of record — AI.md § "Sloppy's Vocabulary
// Stays Out of the Identity Store".

import { z } from "zod";
import { DidSyrSchema } from "./common.js";

/**
 * `username` is what the store holds; `display_name` is what the person chose
 * to be called. A null field is a field the person has not filled in, which is
 * different from a store that does not offer it — that arrives as null too, so
 * a surface renders the absence rather than distinguishing the two.
 */
export const ProfileViewSchema = z.object({
  did: DidSyrSchema,
  username: z.string(),
  display_name: z.string().nullable(),
  bio: z.string().nullable(),
  avatar_url: z.url().nullable(),
  banner_url: z.url().nullable(),
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;

export const DISPLAY_NAME_MAX = 64;
export const BIO_MAX = 500;

/**
 * A patch, and only a patch: an absent key leaves that field as it was, and an
 * explicit `null` clears it. The two are not interchangeable — sending
 * `{ bio: null }` erases a bio, sending `{}` does not.
 */
export const UpdateProfileRequestSchema = z.object({
  display_name: z.string().max(DISPLAY_NAME_MAX).nullable().optional(),
  bio: z.string().max(BIO_MAX).nullable().optional(),
  avatar_url: z.url().nullable().optional(),
  banner_url: z.url().nullable().optional(),
});
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequestSchema>;
