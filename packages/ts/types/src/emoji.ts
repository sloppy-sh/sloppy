// Per-identity emoji catalogs. Each one belongs to a DID and is served by that
// identity's store, so a note written with somebody else's emoji still renders
// for a peer who pulled it — AI.md § "Sloppy's Vocabulary Stays Out of the
// Identity Store".

import { z } from "zod";
import { DidSyrSchema } from "./common.js";

/** Letters, digits and underscores, as `:shortcode:` is written in a block. */
export const EMOJI_SHORTCODE_PATTERN = /^[a-z0-9_]{2,32}$/i;

export const EmojiShortcodeSchema = z
  .string()
  .trim()
  .regex(
    EMOJI_SHORTCODE_PATTERN,
    "A shortcode is 2 to 32 letters, digits or underscores",
  );

/**
 * Both are images the author uploaded; the difference is how big they draw and
 * which syntax cites them — `:code:` against `::code::`.
 */
export const CustomEmojiKindSchema = z.enum(["emoji", "sticker"]);
export type CustomEmojiKind = z.infer<typeof CustomEmojiKindSchema>;

export const CustomEmojiSchema = z.object({
  /** Opaque, and only meaningful to the store that issued it. */
  emoji_id: z.string().min(1),
  did: DidSyrSchema,
  shortcode: EmojiShortcodeSchema,
  kind: CustomEmojiKindSchema,
  /** The author's store, so every render of it goes through `proxied()`. */
  url: z.url(),
});
export type CustomEmoji = z.infer<typeof CustomEmojiSchema>;

/** The blob is uploaded first; this names what to call it. */
export const CreateEmojiRequestSchema = z.object({
  shortcode: EmojiShortcodeSchema,
  kind: CustomEmojiKindSchema,
  /** From the ticket the upload was made against. */
  upload_id: z.string().min(1),
});
export type CreateEmojiRequest = z.input<typeof CreateEmojiRequestSchema>;

/**
 * Take one seen on somebody else's note into your own catalog. The bytes are
 * re-uploaded under the caller's identity, so the copy survives the original
 * being deleted and does not call on a stranger's server to render.
 */
export const CopyEmojiRequestSchema = z.object({
  shortcode: EmojiShortcodeSchema,
  kind: CustomEmojiKindSchema,
  source_url: z.url(),
});
export type CopyEmojiRequest = z.input<typeof CopyEmojiRequestSchema>;
