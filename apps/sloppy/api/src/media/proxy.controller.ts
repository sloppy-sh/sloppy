import { Readable } from "node:stream";
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/authed-request";
import { Public } from "../auth/public.decorator";
import { AppConfigService } from "../config/app-config.service";
import { fetchReachable, ownOrigin } from "./remote-host";

const MAX_PROXY_BYTES = 32 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 10_000;
/** Per caller, refilled steadily: a page of a pulled graph loads many at once. */
const RATE_CAPACITY = 300;
const RATE_REFILL_PER_SEC = 5;
/** A bucket back at capacity is the same as no bucket, so it is dropped —
 *  otherwise every caller ever seen is remembered for the process's life. */
const RATE_IDLE_MS = (RATE_CAPACITY / RATE_REFILL_PER_SEC) * 1000;

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
    this.buckets.set(caller, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private evict(now: number): void {
    for (const [caller, bucket] of this.buckets) {
      if (now - bucket.at >= RATE_IDLE_MS) this.buckets.delete(caller);
    }
  }
}

/**
 * Every remote picture a note renders is fetched here first, so the machine
 * that holds it learns this instance's address and never the reader's — AI.md
 * § "Sloppy's Vocabulary Stays Out of the Identity Store". `proxied()` in
 * `@sloppy/client` is the other half; a raw remote URL in an `<img>` is the bug
 * this route exists to prevent.
 *
 * Public because an `<img>` cannot present a credential, and the native shell's
 * origin carries no cookie — so the rate limit below falls back to the caller's
 * address where there is no session to key on.
 */
@Controller("proxy")
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);
  private readonly rate = new ProxyRate();

  constructor(private readonly config: AppConfigService) {}

  @Public()
  @Get()
  async asset(
    @Query("url") target: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.rate.take(this.caller(req))) {
      throw new HttpException(
        "Too many pictures at once. Try again in a moment.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), PROXY_TIMEOUT_MS);

    let upstream: globalThis.Response;
    try {
      upstream = await fetchReachable(
        target,
        {
          allowPrivate: !this.config.isProduction,
          ownOrigin: ownOrigin(this.config.publicUrl),
        },
        {
          signal: stop.signal,
          // Nothing about the reader travels with this: no agent, no language,
          // no cookie. The whole point is that the far end learns nothing.
          headers: { accept: "image/*,*/*;q=0.8" },
        },
      );
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `${target} did not answer: ${err instanceof Error ? err.message : err}`,
      );
      throw new HttpException(
        "That picture could not be loaded.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!upstream.ok || !upstream.body) {
      clearTimeout(timer);
      throw new HttpException(
        "That picture could not be loaded.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PROXY_BYTES) {
      clearTimeout(timer);
      stop.abort();
      throw new HttpException(
        "That picture is too big to show.",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    res.status(HttpStatus.OK);
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/octet-stream",
    );
    // Served from this origin, so a document type would run as this origin.
    res.setHeader("content-security-policy", "sandbox; default-src 'none'");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, max-age=300");

    let sent = 0;
    const body = Readable.fromWeb(upstream.body as never);
    body.on("data", (chunk: Buffer) => {
      sent += chunk.length;
      // The declared length can be absent or a lie, so the cap is enforced on
      // what actually arrives. The head is already out by here; ending the
      // response truncates the picture rather than reporting a size.
      if (sent > MAX_PROXY_BYTES) {
        stop.abort();
        body.destroy();
        res.end();
      }
    });
    body.on("end", () => clearTimeout(timer));
    body.on("error", () => {
      clearTimeout(timer);
      res.end();
    });
    body.pipe(res);
  }

  /** The address Express resolved, never a header — `x-forwarded-for` is
   *  whatever the caller typed unless a trusted proxy set it, and this is the
   *  only thing standing between a public route and a stranger's fetch loop. */
  private caller(req: AuthedRequest): string {
    return req.viewer?.did ?? req.ip ?? "anonymous";
  }
}
