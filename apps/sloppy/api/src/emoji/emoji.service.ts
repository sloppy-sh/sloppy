import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  CopyEmojiRequest,
  CreateEmojiRequest,
  CustomEmoji,
  SyrEmoji,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { AssetLinks } from "../media/asset-link";
import {
  MediaService,
  roleLimits,
  splitUploadId,
} from "../media/media.service";
import { readRemotePicture } from "../media/remote-fetch";
import { type Delegation, SyrService } from "../syr/syr.service";

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
    private readonly links: AssetLinks,
  ) {}

  async listOwn(delegation: Delegation): Promise<CustomEmoji[]> {
    return (await this.syr.listOwnEmoji(delegation)).map((e) => this.viewOf(e));
  }

  async listFor(instanceUrl: string, did: string): Promise<CustomEmoji[]> {
    return (await this.syr.listPublicEmoji(instanceUrl, did)).map((e) =>
      this.viewOf(e),
    );
  }

  /** The picture comes back as an address on this instance: rendering somebody
   *  else's `:shortcode:` must not reach the machine that holds it. */
  private viewOf(entry: SyrEmoji): CustomEmoji {
    return {
      emoji_id: `${entry.did}/${entry.local_id}`,
      did: entry.did,
      shortcode: entry.shortcode,
      kind: entry.is_sticker ? "sticker" : "emoji",
      src: this.links.to(entry.url),
    };
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
    return this.viewOf(
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
    await this.syr.deleteEmoji(delegation, splitEmojiId(emojiId));
  }

  /**
   * One seen on somebody else's note, taken into the caller's own catalog. The
   * bytes are re-uploaded under their identity, so the copy outlives the
   * original and renders without calling on a stranger's machine.
   *
   * What is copied is an entry in that identity's own catalog, looked up here:
   * an address off the request would make this a way to have Sloppy fetch
   * whatever the caller named.
   */
  async copy(
    delegation: Delegation,
    request: CopyEmojiRequest,
  ): Promise<CustomEmoji> {
    const limits = roleLimits("emoji");
    const source = await this.sourceOf(delegation, request.source_emoji_id);
    const picture = await readRemotePicture(source.url, {
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
    return this.viewOf(
      await this.syr.createEmoji(delegation, {
        shortcode: request.shortcode,
        url: stored.url,
        mime_type: stored.mime_type,
        size: stored.size,
        is_sticker: request.kind === "sticker",
      }),
    );
  }

  /** The entry the reader was actually shown, from the catalog of the identity
   *  that published it. */
  private async sourceOf(
    delegation: Delegation,
    emojiId: string,
  ): Promise<SyrEmoji> {
    const source = splitEmojiId(emojiId);
    const catalog = await this.syr.listPublicEmoji(
      delegation.syr_instance_url,
      source.did,
    );
    const entry = catalog.find((one) => one.local_id === source.localId);
    if (!entry) {
      throw new BadRequestException("That emoji is no longer there to copy.");
    }
    return entry;
  }
}

/** `<did>/<local id>`: the pair a catalog keys an entry by, carried as one
 *  opaque token so nothing outside here has to know it is two. */
function splitEmojiId(emojiId: string): { did: string; localId: string } {
  const cut = emojiId.lastIndexOf("/");
  if (cut < 1 || cut === emojiId.length - 1) {
    throw new BadRequestException("That emoji is not there.");
  }
  return { did: emojiId.slice(0, cut), localId: emojiId.slice(cut + 1) };
}
