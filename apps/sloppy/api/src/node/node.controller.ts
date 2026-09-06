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
  type DeletedBranch,
  type NodeBulkResult,
  NodeBulkRequestSchema,
  type NodeView,
  type TagCount,
  UpdateNodeRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { NodeService } from "./node.service";
import {
  depthBound,
  graphOrRefuse,
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

  /** With no `origin`, the branches of one `graph` — the caller's home graph
   *  where they named none; with one, that tree, cut off past `max_depth`
   *  levels. */
  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("origin") origin?: string,
    @Query("max_depth") maxDepth?: string,
    @Query("graph") graph?: string,
  ): Promise<NodeView[]> {
    const did = viewerDid(req);
    return this.nodes.list(did, {
      origin: ownedRefOrRefuse(origin),
      maxDepth: depthBound(maxDepth),
      graph: graphOrRefuse(graph, did),
    });
  }

  /** Every tag the caller has used inside one `graph` — their home graph where
   *  they named none — most-used first. */
  @Get("tags")
  tags(
    @Req() req: AuthedRequest,
    @Query("graph") graph?: string,
  ): Promise<TagCount[]> {
    const did = viewerDid(req);
    return this.nodes.tags(did, graphOrRefuse(graph, did));
  }

  /** The branches the caller has deleted and can still put back. */
  @Get("deleted")
  deleted(@Req() req: AuthedRequest): Promise<DeletedBranch[]> {
    return this.nodes.deleted(viewerDid(req));
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

  /** One act over the notes somebody chose, whether that is one of them or forty. */
  @Post("bulk")
  act(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<NodeBulkResult> {
    return this.nodes.bulk(
      viewerDid(req),
      parseBody(NodeBulkRequestSchema, body),
      req.delegation,
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
      req.delegation,
    );
  }

  /** One deleted branch back where it was, with everything that went with it. */
  @Post(":did/:localId/restore")
  restore(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<NodeView> {
    return this.nodes.restore(viewerDid(req), requireRef(did, localId));
  }

  @Delete(":did/:localId")
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.nodes.remove(
      viewerDid(req),
      requireRef(did, localId),
      req.delegation,
    );
  }
}
