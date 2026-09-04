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
  LeaveCommentPointerRequestSchema,
  type NoteComment,
  type NoteReaction,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { Public } from "../auth/public.decorator";
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

  /**
   * Somebody else's instance saying that one of their people answered this
   * note. Public, because the identity leaving it has no relationship with the
   * author — and safe to be, because it carries no words and is believed only
   * as far as the store it names will back it up on the way out.
   *
   * It always answers 204: whether a bound refused it, or the note takes no
   * answers, is not something a depositor may learn.
   */
  @Public()
  @HttpCode(204)
  @Post(":did/:localId/replies")
  async reply(
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.social.leaveReply(
      requireRef(did, localId),
      parseBody(LeaveCommentPointerRequestSchema, body),
    );
  }

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
