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
  CreateNoteCommentRequestSchema,
  CreateNoteReactionRequestSchema,
  type NoteComment,
  type NoteReaction,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { parseBody, requireRef, viewerDelegation } from "../node/request";
import { SocialService } from "./social.service";

@Controller()
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Post("comments")
  comment(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<NoteComment> {
    return this.social.comment(
      viewerDelegation(req),
      parseBody(CreateNoteCommentRequestSchema, body),
    );
  }

  /** A comment is cited the way the store that issued it cites one, so it binds
   *  as a single segment rather than as a pair of path parts. */
  @Delete("comments/:commentId")
  @HttpCode(204)
  removeComment(
    @Req() req: AuthedRequest,
    @Param("commentId") commentId: string,
  ): Promise<void> {
    return this.social.removeComment(viewerDelegation(req), commentId);
  }

  @Post("reactions")
  react(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<NoteReaction> {
    return this.social.react(
      viewerDelegation(req),
      parseBody(CreateNoteReactionRequestSchema, body),
    );
  }

  @Delete("reactions/:reactionId")
  @HttpCode(204)
  removeReaction(
    @Req() req: AuthedRequest,
    @Param("reactionId") reactionId: string,
  ): Promise<void> {
    return this.social.removeReaction(viewerDelegation(req), reactionId);
  }
}

/** What people have said about one note, which hangs off the note the way its
 *  sections do. */
@Controller("nodes")
export class NoteConversationController {
  constructor(private readonly social: SocialService) {}

  @Get(":did/:localId/comments")
  comments(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<NoteComment[]> {
    return this.social.comments(
      viewerDelegation(req),
      requireRef(did, localId),
    );
  }

  @Get(":did/:localId/reactions")
  reactions(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<NoteReaction[]> {
    return this.social.reactions(
      viewerDelegation(req),
      requireRef(did, localId),
    );
  }
}
