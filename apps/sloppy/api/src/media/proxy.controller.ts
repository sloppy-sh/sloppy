import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/authed-request";
import { Public } from "../auth/public.decorator";
import { AppConfigService } from "../config/app-config.service";
import { CallerRate, callerOf } from "../auth/caller-rate";
import { AssetLinks } from "./asset-link";
import { IMAGE_MIME_TYPES } from "./media.service";
import { relayPicture } from "./picture-relay";
import { ownOrigin } from "./remote-host";

const MAX_PROXY_BYTES = 32 * 1024 * 1024;
/** Per caller, refilled steadily: a page of a pulled graph loads many at once. */
export const RATE_CAPACITY = 300;

/**
 * Where a picture anyone may read is loaded from, so the machine that holds it
 * learns this instance's address and never the reader's — AI.md § "Sloppy's
 * Vocabulary Stays Out of the Identity Store".
 *
 * The address to fetch comes out of the signed link and never off the query, so
 * a route that has to be public is still not somewhere a stranger can aim this
 * instance. `AssetLinks` mints them; `proxied()` in `@sloppy/client` is what
 * carries one to an `<img>`.
 *
 * Public because an `<img>` cannot present a credential, and the native shell's
 * origin carries no cookie — so the rate limit is keyed on the caller's address
 * where there is no session to key on.
 */
@Controller("proxy")
export class ProxyController {
  private readonly rate = new CallerRate({
    capacity: RATE_CAPACITY,
    perSecond: 5,
  });

  constructor(
    private readonly config: AppConfigService,
    private readonly links: AssetLinks,
  ) {}

  @Public()
  @Get()
  async asset(
    @Query("ref") ref: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    // Before the rate limit, because a link this instance did not mint costs it
    // a signature check and no fetch at all — charging for one would let a
    // caller with no valid link empty a bucket anyway.
    const target = this.links.target(ref);
    if (!target) {
      throw new ForbiddenException("That picture could not be loaded.");
    }

    if (!this.rate.take(callerOf(req))) {
      throw new HttpException(
        "Too many pictures at once. Try again in a moment.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await relayPicture(res, target, {
      policy: {
        allowPrivate: !this.config.isProduction,
        ownOrigin: ownOrigin(this.config.publicUrl),
      },
      maxBytes: MAX_PROXY_BYTES,
      mimeTypes: IMAGE_MIME_TYPES,
      cacheControl: "private, max-age=300",
    });
  }
}
