// What a route lets one caller spend. It sits beside `public.decorator.ts`
// because a route that answers without a session is where it is needed: there
// is no account behind the request to hold to anything else.

import type { AuthedRequest } from "./authed-request";

export interface CallerRateTerms {
  /** How many requests one caller may make before waiting. */
  capacity: number;
  perSecond: number;
  /** How many callers are held at once, so a burst of addresses cannot grow
   *  this faster than idle buckets are dropped. */
  callers?: number;
}

const DEFAULT_CALLERS = 8192;

/**
 * A token bucket per caller. A bucket back at capacity is the same as no
 * bucket, so it is dropped — otherwise every caller ever seen is remembered for
 * the process's life.
 */
export class CallerRate {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly idleMs: number;
  private readonly callers: number;

  constructor(private readonly terms: CallerRateTerms) {
    this.idleMs = (terms.capacity / terms.perSecond) * 1000;
    this.callers = terms.callers ?? DEFAULT_CALLERS;
  }

  take(caller: string): boolean {
    const now = Date.now();
    this.evict(now);
    const bucket = this.buckets.get(caller) ?? {
      tokens: this.terms.capacity,
      at: now,
    };
    bucket.tokens = Math.min(
      this.terms.capacity,
      bucket.tokens + ((now - bucket.at) / 1000) * this.terms.perSecond,
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
      if (now - bucket.at >= this.idleMs) this.buckets.delete(caller);
    }
    for (const caller of this.buckets.keys()) {
      if (this.buckets.size <= this.callers) break;
      this.buckets.delete(caller);
    }
  }
}

/**
 * The address Express resolved, never a header of its own accord: an
 * `x-forwarded-for` is whatever the caller typed unless a proxy this instance
 * was told to trust set it — `AppConfigService.trustedProxies`. An instance
 * behind a reverse proxy that has not been told so sees the proxy for every
 * reader, and one reader's spending then falls on all of them.
 */
export function callerOf(req: AuthedRequest): string {
  return req.viewer?.did ?? req.ip ?? "anonymous";
}
