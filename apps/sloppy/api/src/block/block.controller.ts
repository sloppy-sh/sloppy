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
  type BlockView,
  CreateBlockRequestSchema,
  UpdateBlockRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { parseBody, parsePatch, requireRef, viewerDid } from "../node/request";
import { BlockService } from "./block.service";

@Controller("blocks")
export class BlockController {
  constructor(private readonly blocks: BlockService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<BlockView> {
    return this.blocks.create(
      viewerDid(req),
      parseBody(CreateBlockRequestSchema, body),
    );
  }

  @Patch(":did/:localId")
  update(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<BlockView> {
    return this.blocks.update(
      viewerDid(req),
      requireRef(did, localId),
      parsePatch(UpdateBlockRequestSchema, body),
    );
  }

  @Delete(":did/:localId")
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.blocks.remove(viewerDid(req), requireRef(did, localId));
  }
}

/** A stack is read through the note that holds it, which is the only place a
 *  reader has a reference for. */
@Controller("nodes")
export class NodeBlocksController {
  constructor(private readonly blocks: BlockService) {}

  @Get(":did/:localId/blocks")
  list(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<BlockView[]> {
    return this.blocks.list(viewerDid(req), requireRef(did, localId));
  }
}
