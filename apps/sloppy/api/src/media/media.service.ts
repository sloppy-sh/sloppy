import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type CompleteUploadRequest,
  type CreateUploadRequest,
  type MediaAsset,
  type MediaRole,
  type OwnedMediaAsset,
  type UploadTicket,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { type Delegation, SyrService } from "../syr/syr.service";
import { readRemotePicture } from "./remote-fetch";

/**
 * What a role may carry. The store enforces its own limits too; these are
 * Sloppy's, and they exist so a file that will be refused is refused before
 * somebody spends a minute uploading it.
 */
export const IMAGE_MIME_TYPES = [
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

/**
 * Where a role's blobs land in the person's own file store. A folder named
 * `public` is that store's whole access rule, so only what a stranger has to be
 * able to read goes under one: a peer resolving a DID needs the avatar and the
 * banner, and a federated emoji has to render for everybody. A note's picture
 * stays here however much of the note is published: what a peer reads is the
 * publication's own copy, below.
 *
 * docs/ARCHITECTURE.md § "Pictures" carries the ruling.
 */
const ROLE_FOLDERS: Record<MediaRole, readonly string[]> = {
  block: ["sloppy", "notes"],
  avatar: ["public", "sloppy", "avatar"],
  banner: ["public", "sloppy", "banner"],
  emoji: ["public", "sloppy", "emoji"],
};

export function folderPathFor(role: MediaRole): readonly string[] {
  return ROLE_FOLDERS[role];
}

/**
 * Where a publication's own copy of a note's picture lands, readable by
 * anybody. Deliberately not a `MediaRole`: a role is what a caller asks for,
 * and one that put bytes straight into a public folder would let anybody have
 * this instance mint a durable public address for whatever they sent. A copy is
 * minted at publish, out of bytes the store already holds.
 * docs/ARCHITECTURE.md § "Pictures".
 */
const PUBLISHED_FOLDER: readonly string[] = ["public", "sloppy", "notes"];

export function roleIsPublic(role: MediaRole): boolean {
  return ROLE_FOLDERS[role].includes("public");
}

/**
 * A completed upload as its store describes it. `url` is where the bytes
 * actually live, which is why nothing outside this API ever sees one: handing
 * it to a reader is what tells that machine who is reading.
 */
export interface StoredBlob extends MediaAsset {
  url: string;
}

/** How long to keep asking a store that has not seen the bytes land yet. An
 *  upload that did land and was given up on is a file the person is told to
 *  send again, and a first copy nobody will ever look at. */
const FINALIZE_WINDOW_MS = 5 * 60 * 1000;
const FIRST_FINALIZE_DELAY_MS = 1500;
const LAST_FINALIZE_DELAY_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;
/** How far back a picker looks. Enough to find one somebody put in a note
 *  recently, which is what using it twice means. */
const LIBRARY_PAGE_SIZE = 60;

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
  constructor(
    private readonly syr: SyrService,
    private readonly config: AppConfigService,
  ) {}

  createUpload(
    delegation: Delegation,
    request: CreateUploadRequest,
  ): Promise<UploadTicket> {
    return this.ticket(delegation, request, folderPathFor(request.role));
  }

  private async ticket(
    delegation: Delegation,
    request: CreateUploadRequest,
    folder: readonly string[],
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

    const ticket = await this.syr.createUpload(delegation, request, folder);
    return {
      upload_id: `${ticket.uploadDid}/${ticket.uploadLocalId}`,
      upload_url: ticket.signedUrl,
      upload_headers: { "content-type": request.mime_type },
    };
  }

  /**
   * The pictures the caller has already put in a note, newest first, so one can
   * be used again without being sent again. A row still on its way has nothing
   * to draw, and one this app cannot render is not worth offering.
   */
  async ownPictures(
    delegation: Delegation,
    role: MediaRole,
  ): Promise<OwnedMediaAsset[]> {
    const rows = await this.syr.listUploads(
      delegation,
      folderPathFor(role),
      LIBRARY_PAGE_SIZE,
    );
    const limits = ROLE_LIMITS[role];
    return rows
      .filter(
        (row) =>
          row.url &&
          (row.status ?? "completed") === "completed" &&
          limits.mimeTypes.includes(row.mime_type),
      )
      .map((row) => ({
        upload_id: `${row.did}/${row.local_id}`,
        filename: row.filename,
        mime_type: row.mime_type,
        size: row.size,
        width: row.metadata?.width ?? null,
        height: row.metadata?.height ?? null,
      }));
  }

  /**
   * All three steps, for bytes this instance already holds. A device uploads
   * straight to the ticket instead; this exists for the one case where the
   * bytes were fetched here so that fetching them told nobody who asked.
   */
  store(
    delegation: Delegation,
    file: {
      role: MediaRole;
      filename: string;
      mimeType: string;
      bytes: Uint8Array;
    },
  ): Promise<StoredBlob> {
    return this.send(delegation, folderPathFor(file.role), file);
  }

  private async send(
    delegation: Delegation,
    folder: readonly string[],
    file: {
      role: MediaRole;
      filename: string;
      mimeType: string;
      bytes: Uint8Array;
    },
  ): Promise<StoredBlob> {
    const ticket = await this.ticket(
      delegation,
      {
        role: file.role,
        filename: file.filename,
        mime_type: file.mimeType,
        size: file.bytes.byteLength,
      },
      folder,
    );
    const sent = await fetch(ticket.upload_url, {
      method: "PUT",
      headers: ticket.upload_headers,
      body: file.bytes as BodyInit,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!sent.ok) {
      throw new BadRequestException("That file could not be added. Try again.");
    }
    return this.finalize(delegation, ticket.upload_id);
  }

  /**
   * Where one of the caller's own pictures actually lives. The caller names an
   * upload rather than an address, so nothing here can be pointed at a machine
   * the person's store does not hold.
   *
   * `role` is what the picture is about to be used AS: owning one is not
   * enough to put it on a profile, because a profile is read by strangers and
   * a note's picture is not.
   */
  async ownPicture(
    delegation: Delegation,
    uploadId: string,
    role: MediaRole,
  ): Promise<string> {
    return (await this.ownStoredPicture(delegation, uploadId, role)).url;
  }

  /** The same picture with the name it was sent under, for the caller that
   *  copies one rather than relaying it. */
  async ownStoredPicture(
    delegation: Delegation,
    uploadId: string,
    role: MediaRole,
  ): Promise<{ url: string; filename: string }> {
    const upload = splitUploadId(uploadId);
    if (upload.did !== delegation.did) {
      throw new NotFoundException("That picture is not there.");
    }
    const stored = await this.syr.readUpload(delegation, upload);
    const source = stored.downloadUrl ?? stored.url;
    if (!source) {
      throw new NotFoundException("That picture is not there.");
    }
    if (roleIsPublic(role) && stored.is_public === false) {
      throw new BadRequestException(
        "That picture cannot be used here. Add it again from your device.",
      );
    }
    return { url: source, filename: stored.filename };
  }

  /**
   * A publication's own copy of a picture, made from bytes this instance
   * fetched out of the author's own store — never from an address a caller
   * sent. What a peer reads is the copy, so the original stays private and
   * neither editing nor deleting it reaches a published note.
   */
  async copyForPublication(
    delegation: Delegation,
    picture: { url: string; filename: string },
  ): Promise<MediaAsset> {
    const limits = ROLE_LIMITS.block;
    const fetched = await readRemotePicture(picture.url, {
      allowPrivate: !this.config.isProduction,
      publicUrl: this.config.publicUrl,
      maxBytes: limits.maxBytes,
      mimeTypes: limits.mimeTypes,
      // A note's picture is readable by its owner alone, so the copy is taken
      // as them — the same credential `/media/uploads` relays one with.
      headers: { authorization: `Bearer ${delegation.access_token}` },
    });
    const { url: _storeAddress, ...asset } = await this.send(
      delegation,
      PUBLISHED_FOLDER,
      {
        role: "block",
        filename: picture.filename,
        mimeType: fetched.mimeType,
        bytes: fetched.bytes,
      },
    );
    return asset;
  }

  /** One of those copies, gone. A store that no longer holds it has already
   *  given this answer. */
  async removePublishedCopy(
    delegation: Delegation,
    uploadId: string,
  ): Promise<void> {
    await this.forget(delegation, splitUploadId(uploadId));
  }

  /**
   * One of the caller's own pictures, gone from their store. A section still
   * citing it has nothing left to draw; a publication cites its own copy, which
   * only taking that branch down releases.
   */
  async removeOwnPicture(
    delegation: Delegation,
    uploadId: string,
  ): Promise<void> {
    const upload = splitUploadId(uploadId);
    if (upload.did !== delegation.did) {
      throw new NotFoundException("That picture is not there.");
    }
    await this.forget(delegation, upload);
  }

  private async forget(
    delegation: Delegation,
    upload: { did: string; localId: string },
  ): Promise<void> {
    try {
      await this.syr.deleteUpload(delegation, upload);
    } catch (err) {
      const gone =
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.NOT_FOUND;
      if (!gone) throw err;
    }
  }

  async completeUpload(
    delegation: Delegation,
    request: CompleteUploadRequest,
  ): Promise<MediaAsset> {
    const { url: _storeAddress, ...asset } = await this.finalize(
      delegation,
      request.upload_id,
    );
    return asset;
  }

  /**
   * Told the bytes are there. A store that has not seen them yet is asked
   * again rather than believed, because "not yet" and "never" look the same
   * from one answer and only one of them is worth telling somebody about.
   */
  private async finalize(
    delegation: Delegation,
    uploadId: string,
  ): Promise<StoredBlob> {
    const upload = splitUploadId(uploadId);
    const until = Date.now() + FINALIZE_WINDOW_MS;
    let wait = FIRST_FINALIZE_DELAY_MS;

    for (;;) {
      const stored = await this.syr.completeUpload(delegation, upload);
      if (stored?.url) {
        return {
          upload_id: uploadId,
          url: stored.url,
          mime_type: stored.mime_type,
          size: stored.size,
          // The store's answer, never the uploader's: a second device and a
          // peer who pulled the note read this row too, and they were never
          // holding the file to measure it.
          width: stored.metadata?.width ?? null,
          height: stored.metadata?.height ?? null,
        };
      }
      if (Date.now() + wait >= until) {
        throw new BadRequestException(
          "That file is taking longer than expected. Try adding it again.",
        );
      }
      await new Promise((done) => setTimeout(done, wait));
      wait = Math.min(wait * 2, LAST_FINALIZE_DELAY_MS);
    }
  }
}
