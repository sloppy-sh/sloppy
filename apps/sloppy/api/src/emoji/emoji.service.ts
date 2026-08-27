import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  CopyEmojiRequest,
  CreateEmojiRequest,
  CustomEmoji,
  DidSyr,
  SyrEmoji,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import {
  MediaService,
  roleLimits,
  splitUploadId,
} from "../media/media.service";
import { readRemotePicture } from "../media/remote-fetch";
import { type Delegation, SyrService } from "../syr/syr.service";

function viewOf(entry: SyrEmoji): CustomEmoji {
  return {
    emoji_id: `${entry.did}/${entry.local_id}`,
    did: entry.did,
    shortcode: entry.shortcode,
    kind: entry.is_sticker ? "sticker" : "emoji",
    url: entry.url,
  };
}

/**
 * Emoji catalogs belong to an identity, not to Sloppy — AI.md § "Sloppy's
 * Vocabulary Stays Out of the Identity Store". A note written with somebody's
 * `:shortcode:` therefore keeps rendering for a peer who pulled it, because the
 * peer reads the catalog from the author's own instance.
 */
@Injectable()
export class EmojiService {
  constructor(
    private readonly syr: SyrService,
    private readonly media: MediaService,
    private readonly config: AppConfigService,
  ) {}

  async listOwn(delegation: Delegation): Promise<CustomEmoji[]> {
    return (await this.syr.listOwnEmoji(delegation)).map(viewOf);
  }

  async listFor(instanceUrl: string, did: DidSyr): Promise<CustomEmoji[]> {
    return (await this.syr.listPublicEmoji(instanceUrl, did)).map(viewOf);
  }

  /**
   * The blob was uploaded first; this names it. What is registered is read
   * back from the store rather than taken from the request, so a shortcode
   * cannot be pointed at somebody else's picture.
   */
  async create(
    delegation: Delegation,
    request: CreateEmojiRequest,
  ): Promise<CustomEmoji> {
    const stored = await this.syr.readUpload(
      delegation,
      splitUploadId(request.upload_id),
    );
    if (!stored.url) {
      throw new BadRequestException(
        "That picture has not finished uploading yet.",
      );
    }
    return viewOf(
      await this.syr.createEmoji(delegation, {
        shortcode: request.shortcode,
        url: stored.url,
        mime_type: stored.mime_type,
        size: stored.size,
        is_sticker: request.kind === "sticker",
      }),
    );
  }

  async remove(delegation: Delegation, emojiId: string): Promise<void> {
    const cut = emojiId.lastIndexOf("/");
    if (cut < 1) throw new BadRequestException("That emoji is already gone.");
    await this.syr.deleteEmoji(delegation, {
      did: emojiId.slice(0, cut),
      localId: emojiId.slice(cut + 1),
    });
  }

  /**
   * One seen on somebody else's note, taken into the caller's own catalog. The
   * bytes are re-uploaded under their identity, so the copy outlives the
   * original and renders without calling on a stranger's machine.
   */
  async copy(
    delegation: Delegation,
    request: CopyEmojiRequest,
  ): Promise<CustomEmoji> {
    const limits = roleLimits("emoji");
    const picture = await readRemotePicture(request.source_url, {
      allowPrivate: !this.config.isProduction,
      publicUrl: this.config.publicUrl,
      maxBytes: limits.maxBytes,
      mimeTypes: limits.mimeTypes,
    });
    const stored = await this.media.store(delegation, {
      role: "emoji",
      filename: request.shortcode,
      mimeType: picture.mimeType,
      bytes: picture.bytes,
    });
    return viewOf(
      await this.syr.createEmoji(delegation, {
        shortcode: request.shortcode,
        url: stored.url,
        mime_type: stored.mime_type,
        size: stored.size,
        is_sticker: request.kind === "sticker",
      }),
    );
  }
}
