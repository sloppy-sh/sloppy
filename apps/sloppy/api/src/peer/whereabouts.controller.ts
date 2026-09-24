import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Req,
} from "@nestjs/common";
import {
  SetWhereaboutsRequestSchema,
  WHEREABOUTS_DOCUMENT,
  type Whereabouts,
  type WhereaboutsDocument,
} from "@sloppy/types";
import type { AuthedRequest } from "../auth/authed-request";
import { Public } from "../auth/public.decorator";
import { parseBody, principalOrRefuse, viewerDid } from "../node/request";
import { WhereaboutsService } from "./whereabouts.service";

/** Where the person signed in says their graph is served. It is theirs, so
 *  these are the only routes that write one and each writes their own. */
@Controller("whereabouts")
export class WhereaboutsController {
  constructor(private readonly whereabouts: WhereaboutsService) {}

  @Get()
  mine(@Req() req: AuthedRequest): Promise<Whereabouts | null> {
    return this.whereabouts.declared(viewerDid(req));
  }

  @Put()
  declare(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<Whereabouts> {
    return this.whereabouts.declare(
      viewerDid(req),
      parseBody(SetWhereaboutsRequestSchema, body),
    );
  }

  @Delete()
  @HttpCode(204)
  withdraw(@Req() req: AuthedRequest): Promise<void> {
    return this.whereabouts.withdraw(viewerDid(req));
  }
}

/**
 * The declaration this instance serves on somebody's behalf, at the path their
 * own domain would serve one at — so a reader asks one address either way.
 *
 * `main.ts` keeps this out of the `/api` prefix: a peer resolves it at the site
 * root, the way it resolves syr's own documents.
 */
@Controller(".well-known")
@Public()
export class WhereaboutsWellKnownController {
  constructor(private readonly whereabouts: WhereaboutsService) {}

  @Get("sloppy-whereabouts/:principal")
  @Header("Cache-Control", "public, max-age=300")
  async declared(
    @Param("principal") principal: string,
  ): Promise<WhereaboutsDocument> {
    const said = await this.whereabouts.declared(principalOrRefuse(principal));
    if (said === null) throw new NotFoundException("That person is not here.");
    return { type: WHEREABOUTS_DOCUMENT, ...said };
  }
}
