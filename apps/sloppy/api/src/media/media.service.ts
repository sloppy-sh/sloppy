import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type CompleteUploadRequest,
  type CreateUploadRequest,
  type MediaAsset,
  type MediaRole,
  type UploadTicket,
} from "@sloppy/types";
import { type Delegation, SyrService } from "../syr/syr.service";

/**
 * What a role may carry. The store enforces its own limits too; these are
 * Sloppy's, and they exist so a file that will be refused is refused before
 * somebody spends a minute uploading it.
 */
const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

const ROLE_LIMITS: Record<
  MediaRole,
  { maxBytes: number; mimeTypes: readonly string[] }
> = {
  block: { maxBytes: 25 * 1024 * 1024, mimeTypes: IMAGE_MIME_TYPES },
  avatar: { maxBytes: 8 * 1024 * 1024, mimeTypes: IMAGE_MIME_TYPES },
  banner: { maxBytes: 12 * 1024 * 1024, mimeTypes: IMAGE_MIME_TYPES },
  emoji: { maxBytes: 2 * 1024 * 1024, mimeTypes: IMAGE_MIME_TYPES },
};

export function roleLimits(role: MediaRole): {
  maxBytes: number;
  mimeTypes: readonly string[];
} {
  return ROLE_LIMITS[role];
}

/** How long to keep asking a store that has not seen the bytes land yet. */
const FINALIZE_ATTEMPTS = 5;
const FINALIZE_DELAY_MS = 1500;
const SEND_TIMEOUT_MS = 30_000;

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * `<did>/<local id>`: the two halves the store keys an upload by, carried as
 * one opaque token so nothing outside here has to know it is two.
 */
export function splitUploadId(uploadId: string): {
  did: string;
  localId: string;
} {
  const cut = uploadId.lastIndexOf("/");
  if (cut < 1 || cut === uploadId.length - 1) {
    throw new BadRequestException("That file is no longer being uploaded.");
  }
  return { did: uploadId.slice(0, cut), localId: uploadId.slice(cut + 1) };
}

/**
 * Blobs belong to the person's identity store, never to Sloppy — AI.md
 * § "Sloppy's Vocabulary Stays Out of the Identity Store". This service asks
 * that store for somewhere to put them and then confirms they arrived; the
 * bytes themselves never pass through here.
 */
@Injectable()
export class MediaService {
  constructor(private readonly syr: SyrService) {}

  async createUpload(
    delegation: Delegation,
    request: CreateUploadRequest,
  ): Promise<UploadTicket> {
    const limits = ROLE_LIMITS[request.role];
    if (!limits.mimeTypes.includes(request.mime_type)) {
      throw new BadRequestException(
        "That file type cannot be used here. Try a PNG, JPEG, GIF or WebP.",
      );
    }
    if (request.size > limits.maxBytes) {
      throw new BadRequestException(
        `That file is too big. The limit here is ${megabytes(limits.maxBytes)}.`,
      );
    }

    const ticket = await this.syr.createUpload(delegation, request);
    return {
      upload_id: `${ticket.uploadDid}/${ticket.uploadLocalId}`,
      upload_url: ticket.signedUrl,
      upload_headers: { "content-type": request.mime_type },
      asset_url: ticket.finalUrl,
    };
  }

  /**
   * All three steps, for bytes this instance already holds. A device uploads
   * straight to the ticket instead; this exists for the one case where the
   * bytes were fetched here so that fetching them told nobody who asked.
   */
  async store(
    delegation: Delegation,
    file: {
      role: MediaRole;
      filename: string;
      mimeType: string;
      bytes: Uint8Array;
    },
  ): Promise<MediaAsset> {
    const ticket = await this.createUpload(delegation, {
      role: file.role,
      filename: file.filename,
      mime_type: file.mimeType,
      size: file.bytes.byteLength,
    });
    const sent = await fetch(ticket.upload_url, {
      method: "PUT",
      headers: ticket.upload_headers,
      body: file.bytes as BodyInit,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!sent.ok) {
      throw new BadRequestException("That file could not be added. Try again.");
    }
    return this.completeUpload(delegation, { upload_id: ticket.upload_id });
  }

  /**
   * Told the bytes are there. A store that has not seen them yet is asked
   * again rather than believed, because "not yet" and "never" look the same
   * from one answer and only one of them is worth telling somebody about.
   */
  async completeUpload(
    delegation: Delegation,
    request: CompleteUploadRequest,
  ): Promise<MediaAsset> {
    const upload = splitUploadId(request.upload_id);
    const measured = {
      ...(request.width ? { width: request.width } : {}),
      ...(request.height ? { height: request.height } : {}),
      ...(request.sha256 ? { sha256: request.sha256 } : {}),
    };

    for (let attempt = 1; ; attempt++) {
      const stored = await this.syr.completeUpload(
        delegation,
        upload,
        measured,
      );
      if (stored?.url) {
        return {
          upload_id: request.upload_id,
          url: stored.url,
          mime_type: stored.mime_type,
          size: stored.size,
          width: stored.metadata?.width ?? request.width ?? null,
          height: stored.metadata?.height ?? request.height ?? null,
        };
      }
      if (attempt >= FINALIZE_ATTEMPTS) {
        throw new BadRequestException(
          "That file is taking longer than expected. Try adding it again.",
        );
      }
      await new Promise((done) => setTimeout(done, FINALIZE_DELAY_MS));
    }
  }
}
