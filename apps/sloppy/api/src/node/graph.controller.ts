import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import {
  CreateGraphRequestSchema,
  type GraphView,
  UpdateGraphRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { GraphService } from "./graph.service";
import { parseBody, requireGraphRef, viewerDid } from "./request";

@Controller("graphs")
export class GraphController {
  constructor(private readonly graphs: GraphService) {}

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

  @Patch(":did/:localId")
  rename(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<GraphView> {
    return this.graphs.rename(
      viewerDid(req),
      requireGraphRef(did, localId),
      parseBody(UpdateGraphRequestSchema, body).title,
    );
  }
}
