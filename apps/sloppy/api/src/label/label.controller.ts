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
  CreateLabelDimensionRequestSchema,
  type LabelDimensionView,
  UpdateLabelDimensionRequestSchema,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { parseBody, parsePatch, requireRef, viewerDid } from "../node/request";
import { LabelService } from "./label.service";

@Controller("label-dimensions")
export class LabelController {
  constructor(private readonly labels: LabelService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<LabelDimensionView[]> {
    return this.labels.list(viewerDid(req));
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<LabelDimensionView> {
    return this.labels.create(
      viewerDid(req),
      parseBody(CreateLabelDimensionRequestSchema, body),
    );
  }

  @Patch(":did/:localId")
  update(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
    @Body() body: unknown,
  ): Promise<LabelDimensionView> {
    return this.labels.update(
      viewerDid(req),
      requireRef(did, localId),
      parsePatch(UpdateLabelDimensionRequestSchema, body),
    );
  }

  @Delete(":did/:localId")
  @HttpCode(204)
  remove(
    @Req() req: AuthedRequest,
    @Param("did") did: string,
    @Param("localId") localId: string,
  ): Promise<void> {
    return this.labels.remove(viewerDid(req), requireRef(did, localId));
  }
}
