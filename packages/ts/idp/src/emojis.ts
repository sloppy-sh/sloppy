// A person's own emoji catalog, served the way syr serves one: owned by a DID,
// published by that DID's instance, so somebody else's `:shortcode:` still
// renders on a note a peer pulled.

import { nowIso, type SyrEmoji } from "@sloppy/types";
import { z } from "zod";
import type { IdpContext } from "./context.js";
import { IdpError } from "./errors.js";
import { blobIdIn, requireUpload } from "./files.js";
import {
  createEmoji,
  deleteEmoji,
  type EmojiRow,
  findEmoji,
  findEmojiByShortcode,
  listEmoji,
} from "./store.js";

export const EmojiCreateSchema = z.object({
  shortcode: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9_]{2,32}$/i,
      "A shortcode is 2 to 32 letters, digits or underscores.",
    ),
  url: z.url(),
  mime_type: z.string().min(1).max(255),
  size: z.int().nonnegative(),
  is_sticker: z.boolean().optional(),
  /** syr distinguishes a person's own catalog from an instance-wide one. This
   *  provider serves only the first, and reads the field to say so. */
  scope: z.enum(["user"]).optional(),
});
export type EmojiCreate = z.infer<typeof EmojiCreateSchema>;

export function emojiView(row: EmojiRow): SyrEmoji {
  return {
    did: row.did,
    local_id: String(row.id.id),
    shortcode: row.shortcode,
    url: row.url,
    is_sticker: row.is_sticker,
  };
}

export async function emojiCatalog(
  ctx: IdpContext,
  did: string,
  page: { limit: number; offset: number },
): Promise<{ entries: SyrEmoji[]; total: number }> {
  const { rows, total } = await listEmoji(ctx.db, did, page);
  return { entries: rows.map(emojiView), total };
}

/**
 * The picture has to be one of this identity's own finished uploads. Anything
 * else would let a shortcode point at a machine the author does not control,
 * and every reader of a note carrying it would then fetch from there.
 */
export async function addEmoji(
  ctx: IdpContext,
  did: string,
  request: EmojiCreate,
): Promise<SyrEmoji> {
  const localId = blobIdIn(ctx, did, request.url);
  if (!localId) {
    throw new IdpError(
      400,
      "invalid_emoji",
      "Add the picture to your files first, then name it.",
    );
  }

  const upload = await requireUpload(ctx, did, localId);
  if (upload.status !== "completed" || !upload.is_public) {
    throw new IdpError(
      400,
      "invalid_emoji",
      "That picture cannot be used as an emoji yet.",
    );
  }

  try {
    return emojiView(
      await createEmoji(ctx.db, {
        did,
        shortcode: request.shortcode,
        url: upload.url,
        mime_type: upload.mime_type,
        size: upload.size,
        is_sticker: request.is_sticker ?? false,
        created_at: nowIso(),
      }),
    );
  } catch (error) {
    if (await findEmojiByShortcode(ctx.db, did, request.shortcode)) {
      throw new IdpError(
        409,
        "shortcode_taken",
        "You already have an emoji with that name.",
      );
    }
    throw error;
  }
}

export async function removeEmoji(
  ctx: IdpContext,
  did: string,
  localId: string,
): Promise<void> {
  const row = await findEmoji(ctx.db, localId);
  if (!row || row.did !== did) {
    throw new IdpError(404, "not_found", "That emoji is already gone.");
  }
  await deleteEmoji(ctx.db, row.id);
}
