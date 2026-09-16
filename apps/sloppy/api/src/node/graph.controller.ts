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
  CreateGraphRequestSchema,
  type GraphView,
  UpdateGraphRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { GraphService } from "./graph.service";
import { NodeService } from "./node.service";
import { parseBody, requireGraphRef, viewerDid } from "./request";

@Controller("graphs")
export class GraphController {
  constructor(
    private readonly graphs: GraphService,
    private readonly nodes: NodeService,
  ) {}

  /** The caller's graphs, the one they started with first. */
  @Get()
  list(@Req() req: AuthedRequest): Promise<GraphView[]> {
    return this.graphs.list(viewerDid(req));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<GraphView> {
    return this.graphs.open(
      viewerDid(req),
      parseBody(CreateGraphRequestSchema, body).title,
    );
  }

  /** Rename one, and say what it gates the notes written in it by. */
  @Patch(":did/:localId")
  update(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<GraphView> {
    return this.graphs.write(
      viewerDid(req),
      requireGraphRef(did, localId),
      parseBody(UpdateGraphRequestSchema, body),
    );
  }

  /** Close one. The notes in it go the way a deleted branch goes, and the
   *  graph somebody started with is refused. */
  @Delete(":did/:localId")
  @HttpCode(204)
  close(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.nodes.closeGraph(
      viewerDid(req),
      requireGraphRef(did, localId),
      req.delegation,
    );
  }
}
