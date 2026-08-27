import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  CopyEmojiRequestSchema,
  CreateEmojiRequestSchema,
  type CustomEmoji,
  DidSyrSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { parseBody, viewerDelegation } from "../node/request";
import { EmojiService } from "./emoji.service";

@Controller("emoji")
export class EmojiController {
  constructor(private readonly emoji: EmojiService) {}

  @Get("me")
  listOwn(@Req() req: AuthedRequest): Promise<CustomEmoji[]> {
    return this.emoji.listOwn(viewerDelegation(req));
  }

  @Post("me")
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<CustomEmoji> {
    return this.emoji.create(
      viewerDelegation(req),
      parseBody(CreateEmojiRequestSchema, body),
    );
  }

  @Post("me/copies")
  copy(@Req() req: AuthedRequest, @Body() body: unknown): Promise<CustomEmoji> {
    return this.emoji.copy(
      viewerDelegation(req),
      parseBody(CopyEmojiRequestSchema, body),
    );
  }

  @Delete("me/:did/:localId")
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.emoji.remove(
      viewerDelegation(req),
      `${decodeURIComponent(did)}/${decodeURIComponent(localId)}`,
    );
  }

  /** Somebody else's catalog, so their `:shortcode:` renders on a note of
   *  theirs that the reader is looking at. */
  @Get(":did")
  listFor(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
  ): Promise<CustomEmoji[]> {
    return this.emoji.listFor(
      viewerDelegation(req).syr_instance_url,
      parseBody(DidSyrSchema, decodeURIComponent(did)),
    );
  }
}
