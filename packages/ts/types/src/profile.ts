// Who somebody is, as their identity store reports them. Sloppy reads it and
// caches it; it never keeps a copy of record — AI.md § "Sloppy's Vocabulary
// Stays Out of the Identity Store".

import { z } from "zod";
import { DidSyrSchema } from "./common.js";
import { LinkedPictureSchema, PictureSourceSchema } from "./media.js";

/**
 * `username` is what the store holds; `display_name` is what the person chose
 * to be called. A null field is a field the person has not filled in, which is
 * different from a store that does not offer it — that arrives as null too, so
 * a surface renders the absence rather than distinguishing the two.
 *
 * A picture is drawn from where its source says, read by scheme: an address
 * on the instance, or an `https:` link only a graph kept on a device carries.
 */
export const ProfileViewSchema = z.object({
  did: DidSyrSchema,
  username: z.string(),
  display_name: z.string().nullable(),
  bio: z.string().nullable(),
  avatar_src: PictureSourceSchema.nullable(),
  banner_src: PictureSourceSchema.nullable(),
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;

export const DISPLAY_NAME_MAX = 64;
export const BIO_MAX = 500;

/**
 * A patch, and only a patch: an absent key leaves that field as it was, and an
 * explicit `null` clears it. The two are not interchangeable — sending
 * `{ bio: null }` erases a bio, sending `{}` does not.
 *
 * A picture is named by the upload it arrived on, or by `avatar_url` /
 * `banner_url`, an `https:` link to it. **A store serving a graph off a server
 * refuses a link in words**: an address would let a caller point their profile
 * at a machine of their choosing and have every reader fetch from it. A graph
 * kept on a device takes one, because whoever opens that folder is drawn what
 * its owner chose — docs/ARCHITECTURE.md § "A graph on disk". One picture is
 * named one way per patch ({@link namesEachPictureOnce}).
 */
export const UpdateProfileRequestSchema = z.object({
  display_name: z.string().max(DISPLAY_NAME_MAX).nullable().optional(),
  bio: z.string().max(BIO_MAX).nullable().optional(),
  avatar_upload_id: z.string().min(1).nullable().optional(),
  banner_upload_id: z.string().min(1).nullable().optional(),
  avatar_url: LinkedPictureSchema.nullable().optional(),
  banner_url: LinkedPictureSchema.nullable().optional(),
});
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequestSchema>;

/** Whether a patch names each picture by an upload or by a link, never by
 *  both. */
export function namesEachPictureOnce(request: UpdateProfileRequest): boolean {
  return (
    (request.avatar_upload_id === undefined ||
      request.avatar_url === undefined) &&
    (request.banner_upload_id === undefined || request.banner_url === undefined)
  );
}

/** Whether a patch links a picture, which a store serving a graph off a server
 *  refuses. Clearing one names no address and is not refused. */
export function linksAPicture(request: UpdateProfileRequest): boolean {
  return request.avatar_url != null || request.banner_url != null;
}
