import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
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
import { CallerRate, callerOf } from "../auth/caller-rate";
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

/** Per caller: a peer instance leaves one of these when one of its people
 *  answers a note here, so a steady trickle is the shape of the real traffic. */
const REPLIES_AT_ONCE = 60;
const REPLIES_PER_SEC = 1;

/** What people have said about one note, which hangs off the note the way its
 *  sections do. */
@Controller("nodes")
export class NoteConversationController {
  private readonly rate = new CallerRate({
    capacity: REPLIES_AT_ONCE,
    perSecond: REPLIES_PER_SEC,
  });

  constructor(private readonly social: SocialService) {}

  /**
   * Somebody else's instance saying that one of their people answered this
   * note. Public, because the identity leaving it has no relationship with the
   * author — and safe to be, because it carries neither words nor a place: it
   * names an identity, and where that identity's store answers is resolved by
   * the reader's own instance when the note is read.
   *
   * A deposit that lands answers 204 whatever became of it: whether a bound
   * refused it, whether the note takes answers, and whether the identity
   * resolves are all facts about somebody else's graph. What a caller can learn
   * is how much of this instance they have already spent.
   */
  @Public()
  @HttpCode(204)
  @Post(":did/:localId/replies")
  async reply(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.rate.take(callerOf(req))) {
      throw new HttpException(
        "Too many at once. Try again in a moment.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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
