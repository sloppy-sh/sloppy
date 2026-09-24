import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  type BlockView,
  CreatePullRequestSchema,
  type NodeView,
  type OwnedRef,
  type PulledNoteHit,
  type PullView,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import {
  depthBound,
  parseBody,
  refOrNull,
  requireRef,
  viewerDid,
} from "../node/request";
import { PullService } from "./pull.service";

function regionRef(did: string, localId: string): OwnedRef {
  const ref = refOrNull(did, localId);
  if (ref === null) throw new NotFoundException("That region is not here.");
  return ref;
}

/** The regions of other people's graphs the caller holds. Read-only by
 *  construction: nothing here writes a note, and the routes that do write one
 *  read `node` and `block`, which hold only the caller's own. */
@Controller("pulls")
export class PullController {
  constructor(private readonly pulls: PullService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<PullView[]> {
    return this.pulls.list(viewerDid(req));
  }

  @Post()
  pull(@Req() req: AuthedRequest, @Body() body: unknown): Promise<PullView> {
    return this.pulls.pull(
      viewerDid(req),
      parseBody(CreatePullRequestSchema, body),
      req.delegation?.syr_instance_url,
    );
  }

  /** A held note's stack. Declared before the region routes because a literal
   *  segment and a parameter would otherwise be read in file order. */
  @Get("nodes/:did/:localId/blocks")
  blocks(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<BlockView[]> {
    return this.pulls.blocks(viewerDid(req), requireRef(did, localId));
  }

  /** The held copy of a note a citation names, and a region that serves it —
   *  `null` where the reader holds none of it. Declared before the region
   *  routes for the same reason the stack above is. */
  @Get("nodes/:did/:localId")
  heldNote(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<PulledNoteHit | null> {
    return this.pulls.heldBySource(viewerDid(req), requireRef(did, localId));
  }

  @Get(":did/:localId/nodes")
  nodes(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Query("max_depth") maxDepth?: string,
  ): Promise<NodeView[]> {
    return this.pulls.nodes(
      viewerDid(req),
      regionRef(did, localId),
      depthBound(maxDepth),
    );
  }

  @Delete(":did/:localId")
  @HttpCode(204)
  drop(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.pulls.drop(viewerDid(req), regionRef(did, localId));
  }
}
