import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  CreateNodeRequestSchema,
  type NodeView,
  UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { NodeService } from "./node.service";
import {
  depthBound,
  ownedRefOrRefuse,
  parseBody,
  parsePatch,
  refOrNull,
  requireRef,
  viewerDid,
} from "./request";

@Controller("nodes")
export class NodeController {
  constructor(private readonly nodes: NodeService) {}

  /** With no `origin`, the caller's roots; with one, that tree, cut off past
   *  `max_depth` levels. */
  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("origin") origin?: string,
    @Query("max_depth") maxDepth?: string,
  ): Promise<NodeView[]> {
    return this.nodes.list(viewerDid(req), {
      origin: ownedRefOrRefuse(origin),
      maxDepth: depthBound(maxDepth),
    });
  }

  @Get(":did/:localId")
  async get(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<NodeView | null> {
    const ref = refOrNull(did, localId);
    return ref === null ? null : this.nodes.get(viewerDid(req), ref);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<NodeView> {
    return this.nodes.create(
      viewerDid(req),
      parseBody(CreateNodeRequestSchema, body),
    );
  }

  @Patch(":did/:localId")
  update(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<NodeView> {
    return this.nodes.update(
      viewerDid(req),
      requireRef(did, localId),
      parsePatch(UpdateNodeRequestSchema, body),
    );
  }

  @Delete(":did/:localId")
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.nodes.remove(viewerDid(req), requireRef(did, localId));
  }
}
