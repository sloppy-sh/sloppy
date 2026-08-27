// The address a picture is rendered from. Nothing else in Sloppy hands a
// reader a URL that points at somebody's file store.

import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignedTokens } from "../auth/signed-token";
import { AppConfigService } from "../config/app-config.service";

/** Long enough that a page left open all week still draws its pictures, short
 *  enough that a link somebody copied out of one stops working. */
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Half the life, so a link handed out now is still good when it is loaded. */
const REMINT_AFTER_MS = LINK_TTL_MS / 2;
/** A ceiling on how many addresses are remembered at once, so a long-running
 *  instance that has served a great many pictures does not grow forever. */
const REMEMBERED = 4096;

/**
 * Every renderable link Sloppy hands out is minted here, and the asset route
 * fetches nothing else — which is what stops a public route from being a
 * general-purpose web proxy for whoever finds it.
 *
 * docs/ARCHITECTURE.md § "Pictures".
 */
@Injectable()
export class AssetLinks {
  private readonly links: SignedTokens<{ u: string }>;
  /** One address, one link, while that link stays fresh — a new one on every
   *  read would send the reader back for a picture they already have. */
  private readonly minted = new Map<string, { link: string; at: number }>();

  constructor(
    private readonly app: AppConfigService,
    config: ConfigService,
  ) {
    // The instance's session key; `AuthService` warns when it is unset.
    const key =
      config.get<string>("SLOPPY_SESSION_SECRET") ??
      randomBytes(32).toString("hex");
    this.links = new SignedTokens(key, LINK_TTL_MS);
  }

  /** Where a reader loads `url` from, so its host learns this instance's
   *  address and never theirs. Absolute, because the shells do not share an
   *  origin with the API. */
  to(url: string): string {
    const now = Date.now();
    const held = this.minted.get(url);
    if (held && now - held.at < REMINT_AFTER_MS) return held.link;

    const link = `${this.base}?ref=${encodeURIComponent(this.links.issue({ u: url }))}`;
    this.minted.set(url, { link, at: now });
    this.forget(now);
    return link;
  }

  /** What a link vouches for, or null for one this instance did not mint. */
  target(ref: string | undefined): string | null {
    return (ref ? this.links.verify(ref)?.u : null) ?? null;
  }

  /**
   * A link back into the address it stands for; anything else unchanged. A
   * surface only ever holds links, so one arriving in a request is somebody
   * naming the picture they were shown.
   */
  unwrap(url: string): string {
    if (!url.startsWith(`${this.base}?`)) return url;
    try {
      return (
        this.target(new URL(url).searchParams.get("ref") ?? undefined) ?? url
      );
    } catch {
      return url;
    }
  }

  /** Stale entries first; then the oldest, because a `Map` hands them back in
   *  the order they were written. */
  private forget(now: number): void {
    if (this.minted.size <= REMEMBERED) return;
    for (const [url, entry] of this.minted) {
      if (now - entry.at >= REMINT_AFTER_MS) this.minted.delete(url);
    }
    for (const url of this.minted.keys()) {
      if (this.minted.size <= REMEMBERED) break;
      this.minted.delete(url);
    }
  }

  private get base(): string {
    return `${this.app.publicUrl.replace(/\/+$/, "")}/api/proxy`;
  }
}
