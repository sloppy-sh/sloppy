import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type SyrInstanceManifest,
  SyrInstanceManifestSchema,
  type SyrPlatformSignResponse,
  SyrPlatformSignResponseSchema,
  SyrPlatformTokenRequestSchema,
  type SyrPlatformTokenResponse,
  SyrPlatformTokenResponseSchema,
  type SyrScope,
} from "@sloppy/types";
import { z } from "zod";

/** syr's own `Cache-Control` on the manifest is 300s; this matches it. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * What a caller must hold to act as somebody on their instance. The token is a
 * credential: it belongs on a request to syr and nowhere else.
 */
export interface Delegation {
  readonly did: string;
  readonly syr_instance_url: string;
  /** Which delegation this is. An instance can hold several per identity. */
  readonly delegate_public_key: string;
  readonly access_token: string;
}

/**
 * `unknown` is not `ended`: an instance we cannot reach has told us nothing,
 * and signing everyone out because somebody else's server is down would make
 * their outage ours.
 */
export type DelegationState = "active" | "ended" | "unknown";

export interface ConsentRequest {
  platform_origin: string;
  platform_name: string;
  callback_url: string;
  scopes: readonly SyrScope[];
  state: string;
}

export interface CodeExchange {
  code: string;
  delegation_id: string;
  callback_url: string;
  platform_origin: string;
}

/**
 * syr's token endpoint additionally requires the `delegation_id` the consent
 * callback carried, which `SyrPlatformTokenRequestSchema` does not declare.
 */
const TokenRequestSchema = SyrPlatformTokenRequestSchema.extend({
  delegation_id: z.string().min(1),
});

/** Absent `revoked_at` / `expires_at` mean the delegation still stands. */
const DelegationListSchema = z.object({
  data: z.array(
    z.object({
      delegate_public_key: z.string(),
      revoked_at: z.iso.datetime().optional(),
      expires_at: z.iso.datetime().optional(),
    }),
  ),
});

/** A person typed this; take a bare hostname and give back an origin. */
export function normalizeInstanceUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * Everything Sloppy says to somebody else's syr instance, in one place. Nothing
 * outside this directory speaks syr's dialect, which is what keeps
 * `@sloppy/types`' `syr.ts` the only description of that wire.
 *
 * docs/ARCHITECTURE.md § "Auth: Platform Delegation v0.1".
 */
@Injectable()
export class SyrService {
  private readonly logger = new Logger(SyrService.name);
  private readonly manifests = new Map<
    string,
    { at: number; manifest: SyrInstanceManifest }
  >();

  async manifest(instanceUrl: string): Promise<SyrInstanceManifest> {
    const cached = this.manifests.get(instanceUrl);
    if (cached && Date.now() - cached.at < MANIFEST_TTL_MS)
      return cached.manifest;

    const body = await this.readJson(
      `${instanceUrl}/.well-known/syr`,
      { headers: { accept: "application/json" } },
      "We could not reach that instance. Check the address and try again.",
    );
    const parsed = SyrInstanceManifestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "That address is not a syr instance. Check it and try again.",
      );
    }
    const now = Date.now();
    for (const [url, entry] of this.manifests) {
      if (now - entry.at >= MANIFEST_TTL_MS) this.manifests.delete(url);
    }
    this.manifests.set(instanceUrl, { at: now, manifest: parsed.data });
    return parsed.data;
  }

  private async platform(
    instanceUrl: string,
  ): Promise<NonNullable<SyrInstanceManifest["platform"]>> {
    const { platform } = await this.manifest(instanceUrl);
    if (!platform) {
      throw new BadRequestException(
        "That instance cannot be used to sign in to Sloppy.",
      );
    }
    return platform;
  }

  async consentUrl(
    instanceUrl: string,
    request: ConsentRequest,
  ): Promise<string> {
    const { consent } = await this.platform(instanceUrl);
    const url = new URL(consent);
    url.searchParams.set("platform_origin", request.platform_origin);
    url.searchParams.set("platform_name", request.platform_name);
    url.searchParams.set("callback_url", request.callback_url);
    url.searchParams.set("scopes", request.scopes.join(","));
    url.searchParams.set("state", request.state);
    return url.toString();
  }

  /**
   * `callback_url` must be byte-identical to the one the consent request
   * carried — syr compares the strings, not the URLs.
   */
  async exchangeCode(
    instanceUrl: string,
    exchange: CodeExchange,
  ): Promise<SyrPlatformTokenResponse> {
    const { token } = await this.platform(instanceUrl);
    const body = await this.readJson(
      token,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(TokenRequestSchema.parse(exchange)),
      },
      "Sign-in did not finish. Start again from Sloppy.",
    );
    return SyrPlatformTokenResponseSchema.parse(body);
  }

  async signContent(
    delegation: Delegation,
    payload: Record<string, unknown>,
    payloadType?: string,
  ): Promise<SyrPlatformSignResponse> {
    const { sign } = await this.platform(delegation.syr_instance_url);
    const body = await this.readJson(
      sign,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${delegation.access_token}`,
        },
        body: JSON.stringify({
          payload,
          ...(payloadType ? { payload_type: payloadType } : {}),
        }),
      },
      "That could not be saved to your identity right now. Try again.",
    );
    return SyrPlatformSignResponseSchema.parse(body);
  }

  /**
   * Whether the person's instance still stands behind this delegation. Read
   * from the public listing rather than by re-authenticating, because it is the
   * one endpoint that reports revocation as data: everything else fails the
   * same way for a revoked delegation and for an instance having a bad
   * afternoon, and that difference decides whether somebody gets signed out.
   */
  async delegationState(delegation: Delegation): Promise<DelegationState> {
    let response: Response;
    try {
      const { delegations } = await this.platform(delegation.syr_instance_url);
      const url = new URL(delegations);
      url.searchParams.set("did", delegation.did);
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return "unknown";
    }
    if (!response.ok) return "unknown";

    const listing = DelegationListSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!listing.success) return "unknown";

    const held = listing.data.data.find(
      (entry) => entry.delegate_public_key === delegation.delegate_public_key,
    );
    if (!held || held.revoked_at) return "ended";
    if (held.expires_at && Date.parse(held.expires_at) <= Date.now())
      return "ended";
    return "active";
  }

  private async readJson(
    url: string,
    init: RequestInit,
    failure: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `${url} did not answer: ${err instanceof Error ? err.message : err}`,
      );
      throw new ServiceUnavailableException(failure);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      this.logger.warn(`${url} answered ${response.status} ${detail}`);
      throw new ServiceUnavailableException(failure);
    }
    return response.json();
  }
}
