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
});
export type CreateUploadRequest = z.input<typeof CreateUploadRequestSchema>;

export const UploadTicketSchema = z.object({
  /** Opaque; hand it back to complete the upload, and to cite the asset. */
  upload_id: z.string().min(1),
  /** Single-use, short-lived, and the only place the bytes may be sent. */
  upload_url: z.url(),
  /** Sent verbatim on the PUT. A store that signed a header expects it back. */
  upload_headers: z.record(z.string(), z.string()),
  /** Where the bytes read back from once the upload is completed. */
  asset_url: z.url(),
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

/**
 * Dimensions are the uploader's, because only it has the file: a store that
 * does not decode images has no other way to learn them, and one that does is
 * free to ignore these.
 */
export const CompleteUploadRequestSchema = z.object({
  upload_id: z.string().min(1),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  sha256: Sha256HexSchema.optional(),
});
export type CompleteUploadRequest = z.input<typeof CompleteUploadRequestSchema>;

/**
 * A blob that is there. `url` is the author's instance, so every render of it
 * goes through Sloppy's own asset route — `proxied()` in `@sloppy/client` — or
 * the viewer's address reaches the author's server.
 */
export const MediaAssetSchema = z.object({
  upload_id: z.string().min(1),
  url: z.url(),
  mime_type: z.string(),
  size: z.int().nonnegative(),
  width: z.int().positive().nullable().optional(),
  height: z.int().positive().nullable().optional(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
