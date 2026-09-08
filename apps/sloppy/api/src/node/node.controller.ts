import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  CreateNodeRequestSchema,
  type DeletedBranch,
  MAX_RECENT_NOTES,
  MoveNoteRequestSchema,
  type NodeBulkResult,
  NodeBulkRequestSchema,
  type NodeView,
  type OwnedRef,
  OwnedRefSchema,
  RECENT_NOTES,
  type SearchHit,
  SetAddressRequestSchema,
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

/**
 * Which graph a find is narrowed to, or every graph the caller keeps where they
 * name none. The graph need not be one of theirs — a note they hold is read in
 * its AUTHOR's graph — and naming somebody else's tells them nothing, because
 * the answer is their own rows either way.
 */
function narrowedTo(raw: string | undefined): OwnedRef | undefined {
  if (!raw) return undefined;
  const parsed = OwnedRefSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundException("That graph is not here.");
  return parsed.data;
}

/** How many notes to answer with, bounded; absent asks for {@link
 *  RECENT_NOTES}. */
function noteBound(raw: string | undefined): number {
  if (!raw) return RECENT_NOTES;
  const wanted = Number(raw);
  if (!Number.isSafeInteger(wanted) || wanted < 1) {
    throw new BadRequestException("Ask for at least one note.");
  }
  return Math.min(wanted, MAX_RECENT_NOTES);
}

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

  /** The notes `q` reaches, best match first: the one it addresses, then the
   *  ones whose writing carries it — their own and the copies they hold. */
  @Get("search")
  search(
    @Req() req: AuthedRequest,
    @Query("q") q?: string,
    @Query("graph") graph?: string,
  ): Promise<SearchHit[]> {
    return this.nodes.search(viewerDid(req), q ?? "", narrowedTo(graph));
  }

  /** The notes they last wrote a section into, newest first. */
  @Get("recent")
  recent(
    @Req() req: AuthedRequest,
    @Query("graph") graph?: string,
    @Query("limit") limit?: string,
  ): Promise<NodeView[]> {
    return this.nodes.recent(viewerDid(req), {
      graph: narrowedTo(graph),
      limit: noteBound(limit),
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

  /** The label this note is cited by, written or taken off with `null`. */
  @Put(":did/:localId/address")
  setAddress(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<NodeView> {
    return this.nodes.setAddress(
      viewerDid(req),
      requireRef(did, localId),
      parseBody(SetAddressRequestSchema, body).address,
    );
  }

  /** One note carried somewhere else, with everything that sprang from it. */
  @Post(":did/:localId/move")
  move(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<NodeView[]> {
    return this.nodes.move(
      viewerDid(req),
      requireRef(did, localId),
      parseBody(MoveNoteRequestSchema, body).to,
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
