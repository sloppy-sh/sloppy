import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  type CreateUploadRequest,
  type SyrComment,
  type SyrCommentCreateRequest,
  SyrCommentSchema,
  type SyrCommentSignature,
  type SyrEmoji,
  SyrEmojiSchema,
  type SyrFollow,
  SyrFollowSchema,
  type SyrIdentityManifest,
  SyrIdentityManifestSchema,
  type SyrInstanceManifest,
  SyrInstanceManifestSchema,
  type SyrOwnedUpload,
  SyrOwnedUploadSchema,
  type SyrPlatformSignResponse,
  SyrPlatformSignResponseSchema,
  type SyrPlatformTokenRequest,
  SyrPlatformTokenRequestSchema,
  type SyrPlatformTokenResponse,
  SyrPlatformTokenResponseSchema,
  type SyrProfile,
  type SyrProfilePatch,
  SyrProfileSchema,
  type SyrReaction,
  type SyrReactionCreateRequest,
  SyrReactionSchema,
  type SyrScope,
  type SyrUpload,
  SyrUploadSchema,
  type SyrUploadTicket,
  SyrUploadTicketSchema,
  syrEnvelope,
} from "@sloppy/types";
import { z } from "zod";
import { type HostPolicy, fetchReachable } from "../media/remote-host";

/** syr's own `Cache-Control` on the manifest is 300s; this matches it. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;
/** How many identities that resolved to nothing are remembered at once. */
const UNRESOLVED_MAX = 4096;
const REQUEST_TIMEOUT_MS = 10_000;
/** How much of one identity's conversation about one note is read. It is syr's
 *  own per-page ceiling, and one page of it is what a note shows. */
const CONVERSATION_LIMIT = 100;

/** The most of a catalog an instance serves in one answer. */
const EMOJI_PER_READ = 100;
/** Where reading a catalog stops asking, for an instance that answers the same
 *  page whatever offset it is given. */
const EMOJI_READ_LIMIT = 10_000;

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
  /** Keyed by instance, identity and path. Folders are never renamed away from
   *  under us, so a hit stays true for this process's life. */
  private readonly folders = new Map<string, string>();
  /** When an identity last failed to resolve at an instance, least recently
   *  written first. Anyone may name one, so it is capped as well as aged. */
  private readonly unresolved = new Map<string, number>();

  async manifest(
    instanceUrl: string,
    reach?: HostPolicy,
  ): Promise<SyrInstanceManifest> {
    const cached = this.manifests.get(instanceUrl);
    if (cached && Date.now() - cached.at < MANIFEST_TTL_MS)
      return cached.manifest;

    const body = await this.readJson(
      `${instanceUrl}/.well-known/syr`,
      { headers: { accept: "application/json" } },
      "We could not reach that instance. Check the address and try again.",
      reach,
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

  // ── The identity store: profile, media, follows and emoji ─────────────────

  /**
   * A single identity's manifest, `/.well-known/syr/{did}` — where the profile
   * and the catalogs a stranger may read live, as that identity's own instance
   * declares them.
   */
  async identityManifest(
    instanceUrl: string,
    did: string,
    reach?: HostPolicy,
  ): Promise<SyrIdentityManifest> {
    const key = `${instanceUrl}|${did}`;
    const cached = this.identityManifests.get(key);
    if (cached && Date.now() - cached.at < MANIFEST_TTL_MS)
      return cached.manifest;

    const template = (await this.manifest(instanceUrl, reach))
      .identity_manifest_template;
    const url = template.replace("{did}", encodeURIComponent(did));
    const failure = "We could not read that identity. Try again in a moment.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
      reach,
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
    patch: SyrProfilePatch,
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/user/profile`,
      { method: "PATCH", body: JSON.stringify(patch) },
      "Your profile could not be saved. Try again.",
    );
  }

  /**
   * Step one of three: where to send the bytes, and where they will live.
   * `folderPath` is the caller's, because who may read a blob is decided by the
   * folder it lands in and that is Sloppy's policy rather than syr's dialect —
   * `folderPathFor` in `media/media.service.ts`.
   */
  async createUpload(
    delegation: Delegation,
    request: CreateUploadRequest,
    folderPath: readonly string[],
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
          // The only call that carries them: syr's own complete endpoint parses
          // its body with a schema that names three keys and drops the rest, so
          // dimensions sent there are thrown away without an error.
          ...(request.width || request.height
            ? {
                metadata: {
                  ...(request.width ? { width: request.width } : {}),
                  ...(request.height ? { height: request.height } : {}),
                },
              }
            : {}),
          folder_id: await this.folderAt(delegation, folderPath),
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

  /**
   * What the person has in one of their folders, newest first. The sort is
   * asked for rather than assumed: syr answers by whichever field the request
   * names, and its default is not this one.
   */
  async listUploads(
    delegation: Delegation,
    folderPath: readonly string[],
    limit: number,
  ): Promise<SyrOwnedUpload[]> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    const folder = await this.folderAt(delegation, folderPath);
    const url =
      `${base}/uploads?folder_id=${encodeURIComponent(folder)}` +
      `&limit=${limit}&sort_field=created_at&sort_order=desc`;
    const failure = "We could not read your pictures. Try again in a moment.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "GET" },
      failure,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrOwnedUploadSchema)),
      body,
      url,
      failure,
    ).data;
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

  /** One of the caller's own uploads, erased. A 404 comes back as one, because
   *  a store that no longer holds it has given the answer this was asking for. */
  async deleteUpload(
    delegation: Delegation,
    upload: { did: string; localId: string },
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/uploads/${encodeURIComponent(upload.did)}/${encodeURIComponent(upload.localId)}`,
      { method: "DELETE" },
      "That picture could not be removed. Try again.",
    );
  }

  /**
   * Where an identity's own store answers, as this instance can resolve it, or
   * `null` where it cannot say — an identity held somewhere this instance has
   * never heard of, or an instance that did not answer just now. A follow
   * recorded without one is resolved from scratch when somebody reads it.
   *
   * The `null` is remembered for as long as an answer would be. Anyone may name
   * an identity this instance has never heard of, so a name that resolves to
   * nothing has to cost what one that resolves costs.
   */
  async providerFor(instanceUrl: string, did: string): Promise<string | null> {
    const key = `${instanceUrl}|${did}`;
    const missed = this.unresolved.get(key);
    if (missed !== undefined && Date.now() - missed < MANIFEST_TTL_MS) {
      return null;
    }
    try {
      return (await this.identityManifest(instanceUrl, did)).provider;
    } catch {
      const now = Date.now();
      for (const [at, when] of this.unresolved) {
        if (now - when >= MANIFEST_TTL_MS) this.unresolved.delete(at);
      }
      for (const at of this.unresolved.keys()) {
        if (this.unresolved.size < UNRESOLVED_MAX) break;
        this.unresolved.delete(at);
      }
      this.unresolved.set(key, now);
      return null;
    }
  }

  /**
   * Whether this identity's store keeps a follow list at all. A store that
   * declares no public one keeps none, so the answer is read off the manifest
   * rather than off a failed request.
   */
  async keepsFollows(instanceUrl: string, did: string): Promise<boolean> {
    const { endpoints } = await this.identityManifest(instanceUrl, did);
    return endpoints.public_following !== undefined;
  }

  /** Who this person follows, as their own store keeps it. */
  async listFollowing(delegation: Delegation): Promise<SyrFollow[]> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/follows`;
    const failure = "We could not read who you follow. Try again in a moment.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "GET" },
      failure,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrFollowSchema)),
      body,
      url,
      failure,
    ).data;
  }

  /** `providerUrl` is where that identity's own store answers, kept beside the
   *  DID so reading them later starts there rather than from scratch. */
  async follow(
    delegation: Delegation,
    did: string,
    providerUrl?: string,
  ): Promise<void> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/follows`;
    await this.asPerson(
      delegation,
      url,
      {
        method: "POST",
        body: JSON.stringify({
          followed_did: did,
          ...(providerUrl ? { provider_url: providerUrl } : {}),
        }),
      },
      "That could not be saved to your identity right now. Try again.",
    );
  }

  async unfollow(delegation: Delegation, did: string): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/follows?followed_did=${encodeURIComponent(did)}`,
      { method: "DELETE" },
      "That could not be saved to your identity right now. Try again.",
    );
  }

  /** The whole of the caller's catalog. A shortcode absent from this is one the
   *  author does not have, which is what publishing takes it to mean. */
  async listOwnEmoji(delegation: Delegation): Promise<SyrEmoji[]> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    const failure = "We could not read your emoji. Try again in a moment.";
    const held: SyrEmoji[] = [];
    while (held.length < EMOJI_READ_LIMIT) {
      const url = `${base}/emojis?limit=${EMOJI_PER_READ}&offset=${held.length}`;
      const body = await this.asPerson(
        delegation,
        url,
        { method: "GET" },
        failure,
      );
      const page = this.readShape(
        syrEnvelope(z.array(SyrEmojiSchema)),
        body,
        url,
        failure,
      ).data;
      held.push(...page);
      if (page.length < EMOJI_PER_READ) break;
    }
    return held;
  }

  /**
   * One page of what an identity keeps in the open, as their own instance
   * publishes it. syr serves no public read of a single upload, so finding one
   * is a walk of these pages rather than a lookup — docs/ARCHITECTURE.md
   * § "Pictures", and `media/held-pictures.ts` is the walk.
   */
  async listPublicUploads(
    instanceUrl: string,
    did: string,
    page: { limit: number; offset: number },
    reach?: HostPolicy,
  ): Promise<SyrOwnedUpload[]> {
    const { endpoints } = await this.identityManifest(instanceUrl, did, reach);
    const url = `${endpoints.uploads}?limit=${page.limit}&offset=${page.offset}`;
    const failure = "That picture could not be loaded.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
      reach,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrOwnedUploadSchema)),
      body,
      url,
      failure,
    ).data;
  }

  /** Anyone's catalog, as that identity's own instance publishes it. An empty
   *  answer where the manifest names no such endpoint: nothing to show is the
   *  same outcome as an instance that does not host emoji. */
  async listPublicEmoji(
    instanceUrl: string,
    did: string,
    reach?: HostPolicy,
  ): Promise<SyrEmoji[]> {
    const { endpoints } = await this.identityManifest(instanceUrl, did, reach);
    if (!endpoints.public_emojis) return [];
    const url = `${endpoints.public_emojis}?limit=100`;
    const failure = "We could not read that emoji set. Try again in a moment.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
      reach,
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
   * What one identity has said in public about one post. Empty where their
   * instance publishes no such listing, which is what an instance on the
   * embedded provider answers — docs/ARCHITECTURE.md § "Federating the graph".
   */
  async listPublicComments(
    instanceUrl: string,
    did: string,
    post: { post_did: string; post_id: string },
    reach?: HostPolicy,
  ): Promise<SyrComment[]> {
    const { endpoints } = await this.identityManifest(instanceUrl, did, reach);
    if (!endpoints.public_comments) return [];
    const url =
      `${endpoints.public_comments}?post_did=${encodeURIComponent(post.post_did)}` +
      `&post_id=${encodeURIComponent(post.post_id)}&limit=${CONVERSATION_LIMIT}`;
    const failure =
      "We could not read what people said. Try again in a moment.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
      reach,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrCommentSchema)),
      body,
      url,
      failure,
    ).data;
  }

  async createComment(
    delegation: Delegation,
    request: SyrCommentCreateRequest,
  ): Promise<SyrComment> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/comments`;
    const failure = "That could not be posted. Try again.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "POST", body: JSON.stringify(request) },
      failure,
    );
    return this.readShape(syrEnvelope(SyrCommentSchema), body, url, failure)
      .data;
  }

  /** Attaching a signature to a comment already written: syr's create route
   *  drops the signed envelope it accepts, so this is the second of two calls. */
  async signComment(
    delegation: Delegation,
    comment: { did: string; localId: string },
    signature: SyrCommentSignature,
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/comments/${encodeURIComponent(comment.did)}/${encodeURIComponent(comment.localId)}`,
      { method: "PATCH", body: JSON.stringify(signature) },
      "That could not be posted. Try again.",
    );
  }

  async deleteComment(
    delegation: Delegation,
    comment: { did: string; localId: string },
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/comments/${encodeURIComponent(comment.did)}/${encodeURIComponent(comment.localId)}`,
      { method: "DELETE" },
      "That could not be removed. Try again.",
    );
  }

  /** The same reach as {@link listPublicComments}, for one post's reactions. */
  async listPublicReactions(
    instanceUrl: string,
    did: string,
    post: { post_did: string; post_id: string },
    reach?: HostPolicy,
  ): Promise<SyrReaction[]> {
    const { endpoints } = await this.identityManifest(instanceUrl, did, reach);
    if (!endpoints.public_reactions) return [];
    const url =
      `${endpoints.public_reactions}?parent_type=post` +
      `&parent_did=${encodeURIComponent(post.post_did)}` +
      `&parent_id=${encodeURIComponent(post.post_id)}&limit=${CONVERSATION_LIMIT}`;
    const failure =
      "We could not read what people said. Try again in a moment.";
    const body = await this.readJson(
      url,
      { headers: { accept: "application/json" } },
      failure,
      reach,
    );
    return this.readShape(
      syrEnvelope(z.array(SyrReactionSchema)),
      body,
      url,
      failure,
    ).data;
  }

  /**
   * `null` where the store took the reaction OFF instead: its create route
   * toggles, so sending one the person already has removes it. The caller
   * asked for the reaction to be there and decides what to do about that.
   */
  async createReaction(
    delegation: Delegation,
    request: SyrReactionCreateRequest,
  ): Promise<SyrReaction | null> {
    const url = `${await this.ownerApiBase(delegation.syr_instance_url)}/reactions`;
    const failure = "That reaction could not be added. Try again.";
    const body = await this.asPerson(
      delegation,
      url,
      { method: "POST", body: JSON.stringify(request) },
      failure,
    );
    if (z.object({ action: z.literal("removed") }).safeParse(body).success) {
      return null;
    }
    return this.readShape(syrEnvelope(SyrReactionSchema), body, url, failure)
      .data;
  }

  async deleteReaction(
    delegation: Delegation,
    reaction: { did: string; localId: string },
  ): Promise<void> {
    const base = await this.ownerApiBase(delegation.syr_instance_url);
    await this.asPerson(
      delegation,
      `${base}/reactions/${encodeURIComponent(reaction.did)}/${encodeURIComponent(reaction.localId)}`,
      { method: "DELETE" },
      "That reaction could not be removed. Try again.",
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

  /** The innermost folder of a path, creating whatever is not there yet. */
  private async folderAt(
    delegation: Delegation,
    path: readonly string[],
  ): Promise<string> {
    const key = `${delegation.syr_instance_url}|${delegation.did}|${path.join("/")}`;
    const known = this.folders.get(key);
    if (known) return known;

    let folder = "";
    let parent: string | null = null;
    for (const name of path) {
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

  /**
   * `reach` is for an address somebody else chose — a store this instance was
   * pointed at rather than configured with. It answers the same question a
   * picture's address is held to, once, in `media/remote-host.ts`; a caller
   * reading the deployment's own instance passes none.
   */
  private async readJson(
    url: string,
    init: RequestInit,
    failure: string,
    reach?: HostPolicy,
  ): Promise<unknown> {
    let answer: Answered;
    try {
      answer = await answered(url, init, reach);
    } catch (err) {
      this.logger.warn(
        `${url} did not answer: ${err instanceof Error ? err.message : err}`,
      );
      throw new ServiceUnavailableException(failure);
    }
    const body = answer.body;
    if (!answer.ok) {
      this.logger.warn(`${url} answered ${answer.status} ${body}`);
      throw this.refusal(answer.status, body, failure);
    }
    // A store reporting a change it made sends no body — a 204 on one instance,
    // an empty 200 on another. Neither is JSON, and both read as `null` here.
    if (!body.trim()) return null;
    try {
      return JSON.parse(body);
    } catch {
      this.logger.warn(`${url} answered something that is not JSON`);
      throw new ServiceUnavailableException(failure);
    }
  }

  /**
   * An instance that refused on its own terms is passed through: a full store
   * and a rejected file will refuse the same way forever, and "try again" sends
   * somebody back into a wall. Only a 5xx — the instance itself failing — keeps
   * the retry, and the store's own sentence is preferred over ours wherever it
   * wrote one for a person.
   *
   * The two refusals a caller does something different about keep the status
   * they arrived with: a surface offers to reconnect the account on 403 and
   * treats 404 as the outcome it was asking for, and both are indistinguishable
   * once they are one 400.
   */
  private refusal(
    status: number,
    body: string,
    failure: string,
  ): HttpException {
    if (status >= 500 || status === 429) {
      return new ServiceUnavailableException(failure);
    }
    const kept =
      status === HttpStatus.FORBIDDEN || status === HttpStatus.NOT_FOUND;
    const answer = kept ? status : HttpStatus.BAD_REQUEST;
    const wrote = said(body);
    return new HttpException(
      {
        statusCode: answer,
        message: wrote.message ?? failure,
        ...(wrote.code ? { code: wrote.code } : {}),
      },
      answer,
    );
  }
}

/** syr answers a refusal with `{ message }` for a person and, where the reason
 *  is one a caller can act on, a `code` for the caller. */
function said(body: string): { message?: string; code?: string } {
  const parsed = z
    .object({
      message: z.string().min(1).max(300).optional(),
      code: z.string().min(1).max(64).optional(),
    })
    .safeParse(parseJson(body));
  return parsed.success ? parsed.data : {};
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** What one store said, as much of it as this instance is willing to hold. */
interface Answered {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * How much of one answer is read. A store this instance was pointed at chooses
 * how long to keep talking, so the read gives up rather than growing with it;
 * an identity's own records are far under this.
 */
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

/**
 * One read of a store. `reach` marks an address somebody else chose, which is
 * checked on every hop and answered within a bound — `media/remote-host.ts`.
 */
async function answered(
  url: string,
  init: RequestInit,
  reach?: HostPolicy,
): Promise<Answered> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (reach === undefined) {
    const response = await fetch(url, { ...init, signal });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text().catch(() => ""),
    };
  }
  const response = await fetchReachable(url, reach, {
    ...(init as Parameters<typeof fetchReachable>[2]),
    signal,
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await bounded(response.body),
  };
}

async function bounded(
  stream: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let read = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ANSWER_BYTES) throw new Error("answer too large");
      read += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return read + decoder.decode();
}
