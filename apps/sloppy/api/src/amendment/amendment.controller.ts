import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { AmendmentView, NodeView } from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { requireAmendmentRef, requireRef, viewerDid } from "../node/request";
import { AmendmentService } from "./amendment.service";

/** Offered changes. A note's own are read under the note, and one offer is
 *  addressed by its `<did>/<ulid>` the way every other row here is — the DID
 *  half being the owner of the graph the note is in. */
@Controller()
export class AmendmentController {
  constructor(private readonly amendments: AmendmentService) {}

  @Get("nodes/:did/:localId/amendments")
  list(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<AmendmentView[]> {
    return this.amendments.list(viewerDid(req), requireRef(did, localId));
  }

  @Post("amendments")
  offer(): never {
    return this.amendments.offer();
  }

  @Delete("amendments/:did/:localId")
  @HttpCode(204)
  withdraw(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.amendments.withdraw(
      viewerDid(req),
      requireAmendmentRef(did, localId),
    );
  }

  @Post("amendments/:did/:localId/approve")
  approve(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<NodeView> {
    return this.amendments.approve(
      viewerDid(req),
      requireAmendmentRef(did, localId),
    );
  }

  @Post("amendments/:did/:localId/decline")
  @HttpCode(204)
  decline(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.amendments.decline(
      viewerDid(req),
      requireAmendmentRef(did, localId),
    );
  }
}
