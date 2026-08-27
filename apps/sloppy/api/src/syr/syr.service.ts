import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type CreateUploadRequest,
  type SyrEmoji,
  SyrEmojiSchema,
  type SyrIdentityManifest,
  SyrIdentityManifestSchema,
  type SyrInstanceManifest,
  SyrInstanceManifestSchema,
  type SyrPlatformSignResponse,
  SyrPlatformSignResponseSchema,
  type SyrPlatformTokenRequest,
  SyrPlatformTokenRequestSchema,
  type SyrPlatformTokenResponse,
  SyrPlatformTokenResponseSchema,
  type SyrProfile,
  SyrProfileSchema,
  type SyrScope,
  type SyrUpload,
  SyrUploadSchema,
  type SyrUploadTicket,
  SyrUploadTicketSchema,
  syrEnvelope,
  type UpdateProfileRequest,
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

/** Absent `revoked_at` / `expires_at` mean the delegation still stands. */
const DelegationSchema = z.object({
  delegate_public_key: z.string(),
  revoked_at: z.iso.datetime().optional(),
  expires_at: z.iso.datetime().optional(),
});
type DelegationEntry = z.infer<typeof DelegationSchema>;

/**
 * Two syr instances in the wild disagree on whether this listing is wrapped,
 * and the spec settles neither, so read it either way.
 */
const DelegationListSchema = z.union([
  z.array(DelegationSchema),
  z.object({ data: z.array(DelegationSchema) }).transform(({ data }) => data),
]);

/** A folder in somebody's own file store, as the instance serialises one. */
const FolderSchema = z.object({ id: z.string(), name: z.string() });

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
  private readonly identityManifests = new Map<
    string,
    { at: number; manifest: SyrIdentityManifest }
  >();
  /** Keyed by instance, identity and role. Folders are never renamed away from
   *  under us, so a hit stays true for this process's life. */
  private readonly folders = new Map<string, string>();

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

  async exchangeCode(
    instanceUrl: string,
    exchange: SyrPlatformTokenRequest,
  ): Promise<SyrPlatformTokenResponse> {
    const { token } = await this.platform(instanceUrl);
    const failure = "Sign-in did not finish. Start again from Sloppy.";
    const body = await this.readJson(
      token,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SyrPlatformTokenRequestSchema.parse(exchange)),
      },
      failure,
    );
    return this.readShape(SyrPlatformTokenResponseSchema, body, token, failure);
  }

  async signContent(
    delegation: Delegation,
    payload: Record<string, unknown>,
    payloadType?: string,
  ): Promise<SyrPlatformSignResponse> {
    const { sign } = await this.platform(delegation.syr_instance_url);
    const failure =
      "That could not be saved to your identity right now. Try again.";
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
      failure,
    );
    return this.readShape(SyrPlatformSignResponseSchema, body, sign, failure);
  }

  /**
   * Whether the person's instance still stands behind this delegation. Read
   * from the public listing rather than by re-authenticating, because it is the
   * one endpoint that reports revocation as data: everything else fails the
   * same way for a revoked delegation and for an instance having a bad
   * afternoon, and that difference decides whether somebody gets signed out.
   */
  async delegationState(delegation: Delegation): Promise<DelegationState> {
    const listing = await this.listDelegations(delegation);
    if (!listing) return "unknown";

    const held = listing.find(
      (entry) => entry.delegate_public_key === delegation.delegate_public_key,
    );
    if (!held || held.revoked_at) return "ended";
    if (held.expires_at && Date.parse(held.expires_at) <= Date.now())
      return "ended";
    return "active";
  }

  private async listDelegations(
    delegation: Delegation,
  ): Promise<DelegationEntry[] | null> {
    const inst = delegation.syr_instance_url;
    let response: Response;
    try {
      const { delegations } = await this.platform(inst);
      const url = new URL(delegations);
      url.searchParams.set("did", delegation.did);
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `${inst} did not list its delegations: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
    if (!response.ok) {
      this.logger.warn(
        `${inst} answered ${response.status} listing its delegations`,
      );
      return null;
    }

    const listing = DelegationListSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!listing.success) {
      this.logger.warn(
        `${inst} listed its delegations in a shape Sloppy cannot read`,
      );
      return null;
    }
    return listing.data;
  }

  // ── The identity store: profile, media and emoji ──────────────────────────

  /**
   * A single identity's manifest, `/.well-known/syr/{did}` — where the profile
   * and the catalogs a stranger may read live, as that identity's own instance
   * declares them.
   */
  async identityManifest(
    instanceUrl: string,
    did: string,
  ): Promise<SyrIdentityManifest> {
    const key = `${instanceUrl}|${did}`;
    const cached = this.identityManifests.get(key);
    if (cached && Date.now() - cached.at < MANIFEST_TTL_MS)
      return cached.manifest;

    const template = (await this.manifest(instanceUrl))
      .identity_manifest_template;
    const url = template.replace("{did}", encodeURIComponent(did));
    const failure = "We could not read that identity. Try again in a moment.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
    );
    const manifest = this.readShape(
      SyrIdentityManifestSchema,
      body,
      url,
      failure,
    );
    const now = Date.now();
    for (const [at, entry] of this.identityManifests) {
      if (now - entry.at >= MANIFEST_TTL_MS) this.identityManifests.delete(at);
    }
    this.identityManifests.set(key, { at: now, manifest });
    return manifest;
  }

  /**
   * Anyone may read this: it is the document a peer resolving the DID gets, so
   * a pulled note renders with its author's name and picture.
   */
  async readProfile(instanceUrl: string, did: string): Promise<SyrProfile> {
    const { endpoints } = await this.identityManifest(instanceUrl, did);
    const failure = "We could not read that profile. Try again in a moment.";
    const body = await this.readJson(
      endpoints.profile,
      { headers: { accept: "application/json" } },
      failure,
    );
    return this.readShape(
      syrEnvelope(SyrProfileSchema),
      body,
      endpoints.profile,
      failure,
    ).data;
  }

  async updateProfile(
    delegation: Delegation,
    patch: UpdateProfileRequest,
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/user/profile`,
      { method: "PATCH", body: JSON.stringify(patch) },
      "Your profile could not be saved. Try again.",
    );
  }

  /** Step one of three: where to send the bytes, and where they will live. */
  async createUpload(
    delegation: Delegation,
    request: CreateUploadRequest,
  ): Promise<SyrUploadTicket> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/uploads`;
    const failure = "That file could not be added. Try again.";
    const body = await this.asPerson(
      delegation,
      url,
      {
        method: "POST",
        body: JSON.stringify({
          filename: request.filename,
          mime_type: request.mime_type,
          size: request.size,
          ...(request.sha256 ? { sha256: request.sha256 } : {}),
          folder_id: await this.sharedFolder(delegation, request.role),
        }),
      },
      failure,
    );
    return this.readShape(
      syrEnvelope(SyrUploadTicketSchema),
      body,
      url,
      failure,
    ).data;
  }

  /**
   * Step three, once the bytes have been PUT. `null` where the instance's own
   * store has not shown them yet — not a failure, and the caller asks again.
   */
  async completeUpload(
    delegation: Delegation,
    upload: { did: string; localId: string },
    measured: { width?: number; height?: number; sha256?: string },
  ): Promise<SyrUpload | null> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/uploads`;
    const failure = "That file did not finish uploading. Try again.";
    const body = await this.asPerson(
      delegation,
      url,
      {
        method: "PATCH",
        body: JSON.stringify({
          did: upload.did,
          local_id: upload.localId,
          status: "completed",
          ...measured,
        }),
      },
      failure,
    );
    if (z.object({ status: z.literal("finalizing") }).safeParse(body).success) {
      return null;
    }
    return this.readShape(syrEnvelope(SyrUploadSchema), body, url, failure)
      .data;
  }

  /** One of the caller's own uploads, so a route can act on what is actually
   *  stored rather than on what a client says is. */
  async readUpload(
    delegation: Delegation,
    upload: { did: string; localId: string },
  ): Promise<SyrUpload> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    const url = `${base}/uploads/${encodeURIComponent(upload.did)}/${encodeURIComponent(upload.localId)}`;
    const failure = "We could not find that file. Try adding it again.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "GET" },
      failure,
    );
    return this.readShape(syrEnvelope(SyrUploadSchema), body, url, failure)
      .data;
  }

  async listOwnEmoji(delegation: Delegation): Promise<SyrEmoji[]> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/emojis?limit=100`;
    const failure = "We could not read your emoji. Try again in a moment.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "GET" },
      failure,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrEmojiSchema)),
      body,
      url,
      failure,
    ).data;
  }

  /** Anyone's catalog, as that identity's own instance publishes it. An empty
   *  answer where the manifest names no such endpoint: nothing to show is the
   *  same outcome as an instance that does not host emoji. */
  async listPublicEmoji(instanceUrl: string, did: string): Promise<SyrEmoji[]> {
    const { endpoints } = await this.identityManifest(instanceUrl, did);
    if (!endpoints.public_emojis) return [];
    const url = `${endpoints.public_emojis}?limit=100`;
    const failure = "We could not read that emoji set. Try again in a moment.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrEmojiSchema)),
      body,
      url,
      failure,
    ).data;
  }

  async createEmoji(
    delegation: Delegation,
    entry: {
      shortcode: string;
      url: string;
      mime_type: string;
      size: number;
      is_sticker: boolean;
    },
  ): Promise<SyrEmoji> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/emojis`;
    const failure = "That emoji could not be added. Try again.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "POST", body: JSON.stringify({ ...entry, scope: "user" }) },
      failure,
    );
    return this.readShape(syrEnvelope(SyrEmojiSchema), body, url, failure).data;
  }

  async deleteEmoji(
    delegation: Delegation,
    emoji: { did: string; localId: string },
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/emojis/${encodeURIComponent(emoji.did)}/${encodeURIComponent(emoji.localId)}`,
      { method: "DELETE" },
      "That emoji could not be removed. Try again.",
    );
  }

  /**
   * Where the instance's authenticated routes hang, read off `platform.token`
   * rather than assumed from the origin — an instance is free to mount its API
   * under a prefix, and the manifest reveals that prefix nowhere else.
   */
  private async ownerApiBase(instanceUrl: string): Promise<string> {
    const { token } = await this.platform(instanceUrl);
    const base = token.replace(/\/platform\/token\/?$/, "");
    if (base === token) {
      throw new ServiceUnavailableException(
        "That instance cannot hold files for Sloppy yet.",
      );
    }
    return base;
  }

  /**
   * The folder a role's blobs land in. Anything under a folder named `public`
   * is readable by a peer, which is what a pulled note and a federated emoji
   * both need; the rest of the path is there so a person browsing their own
   * files can see what put them there.
   */
  private async sharedFolder(
    delegation: Delegation,
    role: string,
  ): Promise<string> {
    const key = `${delegation.syr_instance_url}|${delegation.did}|${role}`;
    const known = this.folders.get(key);
    if (known) return known;

    let folder = "";
    let parent: string | null = null;
    for (const name of ["public", "sloppy", role]) {
      folder = await this.findOrCreateFolder(delegation, name, parent);
      parent = folder;
    }
    this.folders.set(key, folder);
    return folder;
  }

  private async findOrCreateFolder(
    delegation: Delegation,
    name: string,
    parent: string | null,
  ): Promise<string> {
    const base = `${await this.ownerApiBase(delegation.syr_instance_url)}/folders`;
    const failure = "That file could not be added. Try again.";
    const listing = await this.asPerson(
      delegation,
      `${base}?parent_id=${encodeURIComponent(parent ?? "")}`,
      { method: "GET" },
      failure,
    );
    const held = z
      .object({ data: z.object({ folders: z.array(FolderSchema) }) })
      .safeParse(listing);
    const found = held.success
      ? held.data.data.folders.find((f) => f.name === name)
      : undefined;
    if (found) return found.id;

    const created = await this.asPerson(
      delegation,
      base,
      { method: "POST", body: JSON.stringify({ name, parent_id: parent }) },
      failure,
    );
    return this.readShape(syrEnvelope(FolderSchema), created, base, failure)
      .data.id;
  }

  /**
   * A request the instance is meant to read as the person rather than as
   * Sloppy. The delegated token is the whole of that claim, so it goes on this
   * request and into no response.
   */
  private async asPerson(
    delegation: Delegation,
    url: string,
    init: RequestInit,
    failure: string,
  ): Promise<unknown> {
    return this.readJson(
      url,
      {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${delegation.access_token}`,
        },
      },
      failure,
    );
  }

  private readShape<T extends z.ZodType>(
    schema: T,
    body: unknown,
    url: string,
    failure: string,
  ): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const why = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      this.logger.warn(`${url} answered a shape Sloppy cannot read: ${why}`);
      throw new ServiceUnavailableException(failure);
    }
    return parsed.data;
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
