// Handing a blob to the store that holds it, in three steps: ask for a ticket,
// PUT the bytes where the ticket says, then say they are there.
//
// Sloppy keeps no media of its own — AI.md § "Sloppy's Vocabulary Stays Out of
// the Identity Store". Nothing here names a storage vendor either: `upload_url`
// is opaque, so a store that signs an S3 URL and one that issues its own are
// the same shape to a caller.

import { z } from "zod";

/**
 * What the blob is for. The store decides where a role's bytes land and who may
 * read them, so a new surface that needs media is a new value here and a branch
 * in the store, never a second upload route.
 */
export const MediaRoleSchema = z.enum([
  /** An image or an ink raster inside a note. */
  "block",
  "avatar",
  "banner",
  "emoji",
]);
export type MediaRole = z.infer<typeof MediaRoleSchema>;

/** Lowercase hex, as `crypto.subtle.digest('SHA-256', …)` is rendered. */
export const Sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "Expected a hex SHA-256 digest");

export const CreateUploadRequestSchema = z.object({
  role: MediaRoleSchema,
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
  size: z.int().positive(),
  /**
   * Of the bytes about to be sent. A store that was given one checks it, and
   * refuses the PUT when it does not match — so a caller that computes it is
   * telling the store to verify, and one that omits it is not.
   */
  sha256: Sha256HexSchema.optional(),
  /**
   * Only the uploader has the file, so only it can measure one; a store that
   * does not decode images has no other way to learn them. Absent where the
   * uploader could not measure, and then no reader ever learns them — which is
   * why they are sent HERE, before the bytes, rather than after.
   */
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
});
export type CreateUploadRequest = z.input<typeof CreateUploadRequestSchema>;

export const UploadTicketSchema = z.object({
  /** Opaque; hand it back to complete the upload, and to cite the asset. */
  upload_id: z.string().min(1),
  /** Single-use, short-lived, and the only place the bytes may be sent. */
  upload_url: z.url(),
  /** Sent verbatim on the PUT. A store that signed a header expects it back. */
  upload_headers: z.record(z.string(), z.string()),
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

export const CompleteUploadRequestSchema = z.object({
  upload_id: z.string().min(1),
  sha256: Sha256HexSchema.optional(),
});
export type CompleteUploadRequest = z.input<typeof CompleteUploadRequestSchema>;

/**
 * Where a picture is loaded from: a path under Sloppy's API, which `proxied()`
 * in `@sloppy/client` resolves against the host this shell reaches its instance
 * at. Never absolute — the API cannot see which of its addresses a shell can
 * reach, and a picture loaded from anywhere else tells the machine holding it
 * who is reading.
 */
export const AssetAddressSchema = z
  .string()
  .regex(/^\/[a-z]/, "Expected an address on this instance");
export type AssetAddress = z.infer<typeof AssetAddressSchema>;

/**
 * A blob that is there, named by the upload it arrived on rather than by an
 * address. Who may read it is the store's answer and not this row's, so where
 * it renders from is asked separately: `ownPicture` in `@sloppy/client` is what
 * turns one of the caller's own into something an `<img>` can load.
 */
export const MediaAssetSchema = z.object({
  upload_id: z.string().min(1),
  mime_type: z.string(),
  size: z.int().nonnegative(),
  width: z.int().positive().nullable().optional(),
  height: z.int().positive().nullable().optional(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
