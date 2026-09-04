import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  CreatePublicationRequestSchema,
  MAX_PUBLISHED_VERSIONS_PER_PAGE,
  type PublicationView,
  type PublishedVersion,
  type UnpublishedChanges,
  UpdatePublicationRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import {
  parseBody,
  requireRef,
  viewerDelegation,
  viewerDid,
} from "../node/request";
import { PublicationService } from "./publication.service";

/** The author's own side of publishing. What a peer reads is
 *  `published.controller.ts`. */
@Controller("publications")
export class PublicationController {
  constructor(private readonly publications: PublicationService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<PublicationView[]> {
    return this.publications.list(viewerDid(req));
  }

  /**
   * Publish a branch as it stands. A note that is already published takes
   * another version rather than a second publication, so this is the whole of
   * the act either way.
   */
  @Post()
  publish(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<PublicationView> {
    return this.publications.publish(
      viewerDelegation(req),
      parseBody(CreatePublicationRequestSchema, body),
    );
  }

  /** Who is invited to answer this. */
  @Patch(":did/:localId")
  setComments(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<PublicationView> {
    return this.publications.setComments(
      viewerDid(req),
      requireRef(did, localId),
      parseBody(UpdatePublicationRequestSchema, body),
    );
  }

  @Get(":did/:localId/versions")
  versions(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<PublishedVersion[]> {
    return this.publications.versions(
      viewerDid(req),
      requireRef(did, localId),
      MAX_PUBLISHED_VERSIONS_PER_PAGE,
    );
  }

  /** What this branch has done since it was last published — read beside the
   *  decision to publish it again. */
  @Get(":did/:localId/unpublished")
  unpublished(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<UnpublishedChanges> {
    return this.publications.unpublished(
      viewerDid(req),
      requireRef(did, localId),
    );
  }

  @Delete(":did/:localId")
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.publications.remove(
      viewerDelegation(req),
      requireRef(did, localId),
    );
  }
}
