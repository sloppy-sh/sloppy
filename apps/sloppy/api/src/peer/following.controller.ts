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
import { type FollowedIdentity, FollowRequestSchema } from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import {
  parseBody,
  principalOrRefuse,
  viewerDelegation,
} from "../node/request";
import { PeerService } from "./peer.service";

/** Who the reader follows. The list is their identity store's, so every route
 *  here reads or writes it there and Sloppy keeps none of it. */
@Controller("following")
export class FollowingController {
  constructor(private readonly peers: PeerService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<FollowedIdentity[]> {
    return this.peers.following(viewerDelegation(req));
  }

  @Post()
  @HttpCode(204)
  follow(@Req() req: AuthedRequest, @Body() body: unknown): Promise<void> {
    return this.peers.follow(
      viewerDelegation(req),
      parseBody(FollowRequestSchema, body).did,
    );
  }

  /** Takes whoever `POST` takes: a follow this instance let somebody make has
   *  to be one they can undo. */
  @Delete(":did")
  @HttpCode(204)
  unfollow(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
  ): Promise<void> {
    return this.peers.unfollow(viewerDelegation(req), principalOrRefuse(did));
  }
}
