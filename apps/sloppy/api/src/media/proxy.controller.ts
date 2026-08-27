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
import { AssetLinks } from "./asset-link";
import { IMAGE_MIME_TYPES } from "./media.service";
import { relayPicture } from "./picture-relay";
import { ownOrigin } from "./remote-host";

const MAX_PROXY_BYTES = 32 * 1024 * 1024;
/** Per caller, refilled steadily: a page of a pulled graph loads many at once. */
export const RATE_CAPACITY = 300;
const RATE_REFILL_PER_SEC = 5;
/** A bucket back at capacity is the same as no bucket, so it is dropped —
 *  otherwise every caller ever seen is remembered for the process's life. */
const RATE_IDLE_MS = (RATE_CAPACITY / RATE_REFILL_PER_SEC) * 1000;
/** A ceiling on how many callers are held at once, so a burst of addresses
 *  cannot grow this faster than idle buckets are dropped. */
const RATE_CALLERS = 8192;

class ProxyRate {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  take(caller: string): boolean {
    const now = Date.now();
    this.evict(now);
    const bucket = this.buckets.get(caller) ?? {
      tokens: RATE_CAPACITY,
      at: now,
    };
    bucket.tokens = Math.min(
      RATE_CAPACITY,
      bucket.tokens + ((now - bucket.at) / 1000) * RATE_REFILL_PER_SEC,
    );
    bucket.at = now;
    // Deleted first so the map's order is least-recently-used, which is what
    // `evict` reads when it has to drop a bucket that is still spending.
    this.buckets.delete(caller);
    this.buckets.set(caller, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private evict(now: number): void {
    for (const [caller, bucket] of this.buckets) {
      if (now - bucket.at >= RATE_IDLE_MS) this.buckets.delete(caller);
    }
    for (const caller of this.buckets.keys()) {
      if (this.buckets.size <= RATE_CALLERS) break;
      this.buckets.delete(caller);
    }
  }
}

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
 * origin carries no cookie — so the rate limit below falls back to the caller's
 * address where there is no session to key on.
 */
@Controller("proxy")
export class ProxyController {
  private readonly rate = new ProxyRate();

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

    if (!this.rate.take(this.caller(req))) {
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

  /**
   * The address Express resolved, never a header of its own accord: an
   * `x-forwarded-for` is whatever the caller typed unless a proxy this instance
   * was told to trust set it — `AppConfigService.trustedProxies`. An instance
   * behind a reverse proxy that has not been told so sees the proxy for every
   * reader, and one reader's fetch loop then falls on all of them.
   */
  private caller(req: AuthedRequest): string {
    return req.viewer?.did ?? req.ip ?? "anonymous";
  }
}
