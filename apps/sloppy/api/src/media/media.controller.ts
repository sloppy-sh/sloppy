import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  CompleteUploadRequestSchema,
  CreateUploadRequestSchema,
  type MediaAsset,
  type MediaLibraryRole,
  MediaLibraryRoleSchema,
  type OwnedMediaAsset,
  type UploadTicket,
} from "@sloppy/types";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/authed-request";
import { AppConfigService } from "../config/app-config.service";
import { parseBody, viewerDelegation, viewerDid } from "../node/request";
import { HeldPictures } from "./held-pictures";
import { IMAGE_MIME_TYPES, MediaService, roleLimits } from "./media.service";
import { relayPicture } from "./picture-relay";
import { ownOrigin } from "./remote-host";

function libraryRole(role: string | undefined): MediaLibraryRole {
  const asked = MediaLibraryRoleSchema.safeParse(role ?? "block");
  if (!asked.success) {
    throw new BadRequestException("There is no picture library of that kind.");
  }
  return asked.data;
}

/**
 * The two ends of an upload. The middle — the bytes — goes from the device
 * straight to where the ticket points, so a file never travels through here.
 */
@Controller("media")
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly held: HeldPictures,
    private readonly config: AppConfigService,
  ) {}

  @Post("uploads")
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<UploadTicket> {
    return this.media.createUpload(
      viewerDelegation(req),
      parseBody(CreateUploadRequestSchema, body),
    );
  }

  @Post("uploads/complete")
  complete(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<MediaAsset> {
    return this.media.completeUpload(
      viewerDelegation(req),
      parseBody(CompleteUploadRequestSchema, body),
    );
  }

  /** One of the caller's libraries, so a picture can be used twice without
   *  being sent twice. Absent names the pictures in their notes. */
  @Get("uploads")
  pictures(
    @Req() req: AuthedRequest,
    @Query("role") role?: string,
  ): Promise<OwnedMediaAsset[]> {
    return this.media.ownPictures(viewerDelegation(req), libraryRole(role));
  }

  /**
   * One of the caller's own pictures, gone. A section still citing it has
   * nothing left to draw; a publication cites its own copy, which only taking
   * that branch down releases.
   */
  @Delete("uploads/:did/:localId")
  async remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    await this.media.removeOwnPicture(
      viewerDelegation(req),
      `${decodeURIComponent(did)}/${decodeURIComponent(localId)}`,
    );
  }

  /**
   * A picture inside a note the caller pulled, out of the author's own store.
   * Fetched here rather than by the browser, so the author's instance learns
   * this one and never the reader — AI.md § "Sloppy's Vocabulary Stays Out of
   * the Identity Store".
   */
  @Get("published/:did/:localId")
  async publishedPicture(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Res() res: Response,
  ): Promise<void> {
    const picture = await this.held.address(viewerDid(req), {
      did: decodeURIComponent(did),
      localId: decodeURIComponent(localId),
    });

    await relayPicture(res, picture, {
      policy: {
        allowPrivate: !this.config.isProduction,
        ownOrigin: ownOrigin(this.config.publicUrl),
      },
      maxBytes: roleLimits("block").maxBytes,
      mimeTypes: IMAGE_MIME_TYPES,
      cacheControl: "private, max-age=300",
    });
  }

  /**
   * One of the caller's own pictures. It is not readable by anyone else, so it
   * is fetched from their store as them and only ever for a request carrying
   * their session — unlike `/proxy`, which serves what a stranger may read too.
   */
  @Get("uploads/:did/:localId")
  async picture(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Res() res: Response,
  ): Promise<void> {
    const delegation = viewerDelegation(req);
    const picture = await this.media.ownPicture(
      delegation,
      `${decodeURIComponent(did)}/${decodeURIComponent(localId)}`,
      "block",
    );

    await relayPicture(res, picture, {
      policy: {
        allowPrivate: !this.config.isProduction,
        ownOrigin: ownOrigin(this.config.publicUrl),
      },
      maxBytes: roleLimits("block").maxBytes,
      mimeTypes: IMAGE_MIME_TYPES,
      cacheControl: "private, max-age=300",
      headers: { authorization: `Bearer ${delegation.access_token}` },
    });
  }
}
