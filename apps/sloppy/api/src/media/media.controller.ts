import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import {
  CompleteUploadRequestSchema,
  CreateUploadRequestSchema,
  type MediaAsset,
  type UploadTicket,
} from "@sloppy/types";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/authed-request";
import { AppConfigService } from "../config/app-config.service";
import { parseBody, viewerDelegation } from "../node/request";
import { IMAGE_MIME_TYPES, MediaService, roleLimits } from "./media.service";
import { relayPicture } from "./picture-relay";
import { ownOrigin } from "./remote-host";

/**
 * The two ends of an upload. The middle — the bytes — goes from the device
 * straight to where the ticket points, so a file never travels through here.
 */
@Controller("media")
export class MediaController {
  constructor(
    private readonly media: MediaService,
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

  /**
   * A picture from one of the caller's own notes. It is not readable by anyone
   * else, so it is fetched from their store as them and only ever for a request
   * carrying their session — unlike `/proxy`, which serves what a stranger may
   * read too.
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
