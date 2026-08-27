import { Body, Controller, Post, Req } from "@nestjs/common";
import {
  CompleteUploadRequestSchema,
  CreateUploadRequestSchema,
  type MediaAsset,
  type UploadTicket,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { parseBody, viewerDelegation } from "../node/request";
import { MediaService } from "./media.service";

/**
 * The two ends of an upload. The middle — the bytes — goes from the device
 * straight to where the ticket points, so a file never travels through here.
 */
@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

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
}
