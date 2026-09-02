// The whole of Sloppy's API, as one typed object. Backend-agnostic by
// construction: `host.ts` decides where the API is, so the same client serves
// the hosted instance, somebody's self-hosted one, and the native shell's
// embedded server. docs/ARCHITECTURE.md § "Deployment modes" states the three.

import {
  type BlockView,
  BlockViewSchema,
  type CompleteUploadRequest,
  type ConsentRedirect,
  ConsentRedirectSchema,
  type CopyEmojiRequest,
  type CreateBlockRequest,
  type CreateEmojiRequest,
  type CreateNodeRequest,
  type CreateNoteCommentRequest,
  type CreateNoteReactionRequest,
  type CreatePublicationRequest,
  type CreatePullRequest,
  type CreateUploadRequest,
  type CustomEmoji,
  CustomEmojiSchema,
  type ExchangeSessionRequest,
  type FollowedIdentity,
  FollowedIdentitySchema,
  type FollowRequest,
  type HealthReport,
  HealthReportSchema,
  type MediaAsset,
  MediaAssetSchema,
  type NodeBulkRequest,
  type NodeBulkResult,
  type NodeView,
  type NoteComment,
  NoteCommentSchema,
  type NoteReaction,
  NoteReactionSchema,
  type OwnedMediaAsset,
  OwnedMediaAssetSchema,
  type OwnedRef,
  PeerOriginSchema,
  type ProfileView,
  ProfileViewSchema,
  type PublicationView,
  PublicationViewSchema,
  type PublishedBlock,
  type PublishedIndex,
  type PublishedNode,
  type PublishedSubtree,
  type PullView,
  PullViewSchema,
  type Session,
  SessionSchema,
  type StartLoginRequest,
  type TagCount,
  TagCountSchema,
  type UpdateBlockRequest,
  type UpdateNodeRequest,
  type UpdateProfileRequest,
  type UploadTicket,
  UploadTicketSchema,
  type Viewer,
  ViewerSchema,
  parseNodeBulkResult,
  parseNodeView,
  parsePublishedIndex,
  publishedSubtreeReader,
} from "@sloppy/types";
import { SloppyApiError } from "./errors.js";
import { apiUrl, isSameOrigin } from "./host.js";

export * from "./errors.js";
export * from "./host.js";
export * from "./upload.js";

export type TokenSource = string | (() => string | undefined);

export interface SloppyClientOptions {
  /** A getter, so re-pointing the app re-points a client already in flight. */
  token?: TokenSource;
  fetch?: typeof fetch;
  /** Fired once per credential the server rejects — the session is gone; sign
   *  out app-wide. Signing back in re-arms it, so the second expiry in one app
   *  lifetime is reported like the first. */
  onAuthInvalid?: () => void;
}

/** A ref split into the two path segments a route binds it as. */
function refPath(ref: string): string {
  const separator = ref.lastIndexOf("/");
  if (separator < 1)
    throw new Error(`Expected a <did>/<ulid> reference: ${ref}`);
  return `/${encodeURIComponent(ref.slice(0, separator))}/${encodeURIComponent(
    ref.slice(separator + 1),
  )}`;
}

/**
 * Sloppy's API, validated on the way in. Every response is parsed against the
 * schema `@sloppy/types` publishes for it, so a server running ahead of this
 * client fails at the boundary rather than three components later.
 */
export class SloppyClient {
  private readonly token?: TokenSource;
  private readonly fetchImpl: typeof fetch;
  private readonly onAuthInvalid?: () => void;
  private authInvalidFor: string | null = null;

  constructor(options: SloppyClientOptions = {}) {
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.onAuthInvalid = options.onAuthInvalid;
  }

  private currentToken(): string | undefined {
    return typeof this.token === "function" ? this.token() : this.token;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    // The anonymous credential is still a credential: a same-origin cookie
    // session rides the request with no bearer token, and its rejection ends a
    // session the same way.
    const credential = this.currentToken() ?? "";
    if (credential) headers.set("authorization", `Bearer ${credential}`);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    const res = await this.fetchImpl(apiUrl(path), {
      // A cookie session only exists where the API shares the page's origin.
      // Everywhere else the bearer token above is the whole of the credential,
      // and asking for credentials would fail the API's own CORS policy.
      credentials: isSameOrigin() ? "include" : "omit",
      ...init,
      headers,
    });
    if (
      res.status === 401 &&
      this.onAuthInvalid &&
      this.authInvalidFor !== credential
    ) {
      this.authInvalidFor = credential;
      this.onAuthInvalid();
    }
    return res;
  }

  /** NestJS puts its reason in `message` and a machine code in `code`. */
  private error(res: Response, path: string, text: string): SloppyApiError {
    let code: string | undefined;
    let detail: string | undefined;
    let suffix = "";
    if (text) {
      try {
        const body = JSON.parse(text) as { message?: unknown; code?: unknown };
        if (typeof body?.code === "string") code = body.code;
        const message = body?.message;
        if (message == null) {
          suffix = `: ${text.slice(0, 300)}`;
        } else {
          detail =
            typeof message === "string" ? message : JSON.stringify(message);
          suffix = `: ${detail}`;
        }
      } catch {
        suffix = `: ${text.slice(0, 300)}`;
      }
    }
    return new SloppyApiError(
      res.status,
      `Sloppy API ${res.status} ${res.statusText} for ${path}${suffix}`,
      { code, detail },
    );
  }

  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const res = await this.request(path, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw this.error(res, path, text);
    }
    // A nullable read answers an empty 200 body, which `res.json()` rejects.
    const text = await res.text();
    return text.trim() ? (JSON.parse(text) as unknown) : null;
  }

  private send(
    method: "POST" | "PATCH" | "PUT",
    path: string,
    body: unknown,
  ): Promise<unknown> {
    return this.json(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** A missing target is success: deleting twice is one outcome, not an error. */
  private async del(path: string): Promise<void> {
    const res = await this.request(path, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw this.error(res, path, await res.text().catch(() => ""));
    }
  }

  // ── Service ──────────────────────────────────────────────────────────────

  /**
   * The API answers 503 with the same body when a dependency is down, so this
   * reads the report either way and only a network failure throws.
   */
  async health(): Promise<HealthReport> {
    const res = await this.request("/health", { method: "GET" });
    const text = await res.text();
    if (!text.trim()) throw this.error(res, "/health", text);
    return HealthReportSchema.parse(JSON.parse(text));
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Where this Sloppy's own identities live, for somebody who has none
   * anywhere. Asked of the API rather than read off the page's origin, which
   * the shells do not share.
   *
   * `undefined` means this instance only ever delegates elsewhere; a rejection
   * means the answer could not be had. A caller that shows the two the same way
   * hides the only way in on an instance that has one.
   */
  async ownInstance(): Promise<string | undefined> {
    const body = (await this.json("/auth/own-instance", {
      method: "GET",
    })) as {
      instance_url?: unknown;
    } | null;
    const url = body?.instance_url;
    return typeof url === "string" && url ? url : undefined;
  }

  /**
   * Step one of Platform Delegation: the API reads the instance's manifest and
   * hands back where to send the person for consent. Where that URL is opened
   * is the shell's call — `AppRuntime.openExternal` in `@sloppy/app-core`.
   */
  async startLogin(request: StartLoginRequest): Promise<ConsentRedirect> {
    return ConsentRedirectSchema.parse(
      await this.send("POST", "/auth/login", request),
    );
  }

  /** Step two, for a shell that caught the callback itself (a deep link). */
  async exchangeSession(request: ExchangeSessionRequest): Promise<Session> {
    return SessionSchema.parse(
      await this.send("POST", "/auth/exchange", request),
    );
  }

  /** `null` where nobody is signed in — not an error, the ordinary first visit. */
  async me(): Promise<Viewer | null> {
    const body = await this.json("/auth/me", { method: "GET" });
    return body == null ? null : ViewerSchema.parse(body);
  }

  async signOut(): Promise<void> {
    await this.send("POST", "/auth/logout", {});
  }

  // ── Nodes ────────────────────────────────────────────────────────────────

  /**
   * A region of the caller's own graph. With no `origin` this is their roots;
   * with one it is that tree, and `maxDepth` bounds it — the level-of-detail
   * read docs/ARCHITECTURE.md § "Data model" keeps `node.depth` for.
   */
  async listNodes(
    query: { origin?: OwnedRef; maxDepth?: number } = {},
  ): Promise<NodeView[]> {
    const params = new URLSearchParams();
    if (query.origin) params.set("origin", query.origin);
    if (query.maxDepth != null) params.set("max_depth", String(query.maxDepth));
    const search = params.toString();
    const path = search ? `/nodes?${search}` : "/nodes";
    const body = await this.json(path, { method: "GET" });
    return (body as unknown[]).map(parseNodeView);
  }

  /** `null` where the node is gone, which a stale associative link expects. */
  async getNode(ref: OwnedRef): Promise<NodeView | null> {
    const body = await this.json(`/nodes${refPath(ref)}`, { method: "GET" });
    return body == null ? null : parseNodeView(body);
  }

  async createNode(request: CreateNodeRequest): Promise<NodeView> {
    return parseNodeView(await this.send("POST", "/nodes", request));
  }

  async updateNode(
    ref: OwnedRef,
    request: UpdateNodeRequest,
  ): Promise<NodeView> {
    return parseNodeView(
      await this.send("PATCH", `/nodes${refPath(ref)}`, request),
    );
  }

  async deleteNode(ref: OwnedRef): Promise<void> {
    await this.del(`/nodes${refPath(ref)}`);
  }

  /**
   * One act over the notes somebody chose. Which act it is, is a value, so this
   * is the only route any of them takes and a selection of one is not a special
   * case. Only the caller's own notes are reached; `missed` counts the rest,
   * which is something to say rather than a failure.
   */
  async actOnNodes(request: NodeBulkRequest): Promise<NodeBulkResult> {
    return parseNodeBulkResult(await this.send("POST", "/nodes/bulk", request));
  }

  /** Every tag the caller has used, most-used first. A tag is written by
   *  putting it on a note, so there is nothing else here to call. */
  async listTags(): Promise<TagCount[]> {
    const body = await this.json("/nodes/tags", { method: "GET" });
    return (body as unknown[]).map((t) => TagCountSchema.parse(t));
  }

  // ── Blocks ───────────────────────────────────────────────────────────────

  /** A node's stack, already in `ord` order. */
  async listBlocks(node: OwnedRef): Promise<BlockView[]> {
    const body = await this.json(`/nodes${refPath(node)}/blocks`, {
      method: "GET",
    });
    return (body as unknown[]).map((b) => BlockViewSchema.parse(b));
  }

  async createBlock(request: CreateBlockRequest): Promise<BlockView> {
    return BlockViewSchema.parse(await this.send("POST", "/blocks", request));
  }

  async updateBlock(
    ref: OwnedRef,
    request: UpdateBlockRequest,
  ): Promise<BlockView> {
    return BlockViewSchema.parse(
      await this.send("PATCH", `/blocks${refPath(ref)}`, request),
    );
  }

  async deleteBlock(ref: OwnedRef): Promise<void> {
    await this.del(`/blocks${refPath(ref)}`);
  }

  // ── Publishing, following, and what a peer holds ─────────────────────────
  // Declared, not served: `apps/sloppy/api` answers none of the routes from
  // here to the end of this block yet, so a call reaches a 404.
  // docs/ARCHITECTURE.md § "Federating the graph" is what they answer to.

  async listPublications(): Promise<PublicationView[]> {
    const body = await this.json("/publications", { method: "GET" });
    return (body as unknown[]).map((p) => PublicationViewSchema.parse(p));
  }

  async publish(request: CreatePublicationRequest): Promise<PublicationView> {
    return PublicationViewSchema.parse(
      await this.send("POST", "/publications", request),
    );
  }

  /**
   * The row existing is what makes the subtree readable, so unpublishing
   * deletes it. A peer who already pulled the subtree keeps their copy.
   */
  async unpublish(ref: OwnedRef): Promise<void> {
    await this.del(`/publications${refPath(ref)}`);
  }

  /**
   * A published subtree held by THIS instance, read without a session — the
   * endpoint a peer's instance calls. It answers a page at a time and this
   * follows the pages to the end; `null` where nothing is published at that
   * address, which is also what an unpublish leaves behind.
   */
  async readPublishedSubtree(
    did: string,
    rootAddress: string,
  ): Promise<PublishedSubtree | null> {
    const reader = publishedSubtreeReader({ did, root_address: rootAddress });
    const path = `/public/subtrees/${encodeURIComponent(did)}/${encodeURIComponent(
      rootAddress,
    )}`;
    const nodes: PublishedNode[] = [];
    const blocks: PublishedBlock[] = [];
    let cursor: string | undefined;
    do {
      const at =
        cursor === undefined
          ? path
          : `${path}?cursor=${encodeURIComponent(cursor)}`;
      const body = await this.json(at, { method: "GET" });
      if (body == null && cursor === undefined) return null;
      const page = reader.take(body);
      nodes.push(...page.nodes);
      blocks.push(...page.blocks);
      cursor = page.next_cursor;
    } while (cursor !== undefined);
    return { did, root_address: rootAddress, nodes, blocks };
  }

  /**
   * One page of what somebody publishes, which is what following them leads to:
   * a DID names a person and never a place, so `sourceUrl` says which instance
   * to ask. Omitted, this one answers about itself — the whole of it for
   * somebody who keeps their graph here. The asking is done by the API, so the
   * instance asked learns this instance and never the reader. `next_cursor` on
   * the answer is what a surface asks for to show more.
   *
   * `sourceUrl` is an origin and is refused here as well as at the API, so a
   * surface that took one from a person hears about it before the send;
   * `peerOrigin` in `@sloppy/types` is what turns what they typed into one. A
   * caller that follows the pages to the end holds them to each other with
   * `publishedIndexReader` rather than page by page.
   */
  async publishedBy(
    did: string,
    options: { sourceUrl?: string; cursor?: string } = {},
  ): Promise<PublishedIndex> {
    const query = [`did=${encodeURIComponent(did)}`];
    if (options.sourceUrl !== undefined) {
      const origin = PeerOriginSchema.parse(options.sourceUrl);
      query.push(`source_url=${encodeURIComponent(origin)}`);
    }
    if (options.cursor !== undefined) {
      query.push(`cursor=${encodeURIComponent(options.cursor)}`);
    }
    const body = await this.json(`/peers/publications?${query.join("&")}`, {
      method: "GET",
    });
    return parsePublishedIndex(body, did);
  }

  /**
   * Take somebody else's published subtree as a foreign, read-only region.
   *
   * The copy is kept, which is what the reader still has when the author stops
   * publishing; pulling the same subtree again refreshes that region rather
   * than making a second one, and a region overlapping one already held shares
   * its notes. The resolution runs on the API — a browser resolving a peer's
   * provider would leak the viewer to it, which `proxied()` exists to prevent.
   */
  async pullSubtree(
    did: string,
    rootAddress: string,
    sourceUrl?: string,
  ): Promise<PullView> {
    const request: CreatePullRequest = {
      did,
      root_address: rootAddress,
      ...(sourceUrl === undefined
        ? {}
        : { source_url: PeerOriginSchema.parse(sourceUrl) }),
    };
    return PullViewSchema.parse(await this.send("POST", "/pulls", request));
  }

  /** Every region the caller holds, most recently pulled first. */
  async listPulls(): Promise<PullView[]> {
    const body = await this.json("/pulls", { method: "GET" });
    return (body as unknown[]).map((p) => PullViewSchema.parse(p));
  }

  /** Let a held region go. It is the reader's copy, so nothing of the author's
   *  is touched, and a note another region still covers stays. */
  async dropPull(ref: OwnedRef): Promise<void> {
    await this.del(`/pulls${refPath(ref)}`);
  }

  /**
   * A held region's notes, addressed by their author. `maxDepth` counts from
   * the REGION's own root, not from the author's — a region pulled at `1a1`
   * starts at its root however deep that sits in the graph it came from.
   */
  async listPulledNodes(
    pull: OwnedRef,
    query: { maxDepth?: number } = {},
  ): Promise<NodeView[]> {
    const search =
      query.maxDepth == null ? "" : `?max_depth=${String(query.maxDepth)}`;
    const body = await this.json(`/pulls${refPath(pull)}/nodes${search}`, {
      method: "GET",
    });
    return (body as unknown[]).map(parseNodeView);
  }

  /** A held note's stack, already in `ord` order. */
  async listPulledBlocks(node: OwnedRef): Promise<BlockView[]> {
    const body = await this.json(`/pulls/nodes${refPath(node)}/blocks`, {
      method: "GET",
    });
    return (body as unknown[]).map((b) => BlockViewSchema.parse(b));
  }

  /**
   * A picture inside a published note, from its author's store. Publishing is
   * what makes one readable — docs/ARCHITECTURE.md § "Pictures" — and the fetch
   * is made here rather than by the browser, so the author's instance never
   * learns who is reading. `release` frees the bytes; call it when the picture
   * comes off the screen.
   */
  async publishedPicture(
    uploadId: MediaAsset["upload_id"],
  ): Promise<{ src: string; release: () => void }> {
    return this.picture(`/media/published${refPath(uploadId)}`);
  }

  /** The identities the caller follows. Their own identity store keeps the
   *  list; Sloppy reads and writes it there. */
  async following(): Promise<FollowedIdentity[]> {
    const body = await this.json("/following", { method: "GET" });
    return (body as unknown[]).map((f) => FollowedIdentitySchema.parse(f));
  }

  async follow(request: FollowRequest): Promise<void> {
    await this.send("POST", "/following", request);
  }

  async unfollow(did: string): Promise<void> {
    await this.del(`/following/${encodeURIComponent(did)}`);
  }

  /**
   * What people have said on a note. Reading somebody's comments means reading
   * them from their own identity store, so this answers with what the caller
   * and the identities they follow have written, and cannot answer with more.
   */
  async listComments(node: OwnedRef): Promise<NoteComment[]> {
    const body = await this.json(`/nodes${refPath(node)}/comments`, {
      method: "GET",
    });
    return (body as unknown[]).map((c) => NoteCommentSchema.parse(c));
  }

  async addComment(request: CreateNoteCommentRequest): Promise<NoteComment> {
    return NoteCommentSchema.parse(
      await this.send("POST", "/comments", request),
    );
  }

  /** A comment is cited the way the store that issued it cites one, so it
   *  binds as a single segment rather than as a `<did>/<ulid>` pair. */
  async removeComment(commentId: NoteComment["comment_id"]): Promise<void> {
    await this.del(`/comments/${encodeURIComponent(commentId)}`);
  }

  /** The same reach as {@link listComments}: the caller and who they follow,
   *  and no total, because nobody can see one. */
  async listReactions(node: OwnedRef): Promise<NoteReaction[]> {
    const body = await this.json(`/nodes${refPath(node)}/reactions`, {
      method: "GET",
    });
    return (body as unknown[]).map((r) => NoteReactionSchema.parse(r));
  }

  async addReaction(request: CreateNoteReactionRequest): Promise<NoteReaction> {
    return NoteReactionSchema.parse(
      await this.send("POST", "/reactions", request),
    );
  }

  async removeReaction(reactionId: NoteReaction["reaction_id"]): Promise<void> {
    await this.del(`/reactions/${encodeURIComponent(reactionId)}`);
  }

  // ── Media ────────────────────────────────────────────────────────────────

  /**
   * Where to send a file, and where it will read back from. `uploadFile` in
   * this package drives all three steps; a caller that has bytes rather than a
   * `File` uses this and {@link completeUpload} directly.
   */
  async createUpload(request: CreateUploadRequest): Promise<UploadTicket> {
    return UploadTicketSchema.parse(
      await this.send("POST", "/media/uploads", request),
    );
  }

  async completeUpload(request: CompleteUploadRequest): Promise<MediaAsset> {
    return MediaAssetSchema.parse(
      await this.send("POST", "/media/uploads/complete", request),
    );
  }

  /** The pictures the caller has already put in a note, newest first. */
  async ownPictures(): Promise<OwnedMediaAsset[]> {
    const body = await this.json("/media/uploads", { method: "GET" });
    return (body as unknown[]).map((a) => OwnedMediaAssetSchema.parse(a));
  }

  /**
   * One of the caller's own pictures, ready for an `<img>`. A note is private
   * until its subtree is published and so are its pictures, so this is the only
   * way one of them draws.
   *
   * An `<img>` sends no credential of its own and this route needs one, so the
   * bytes are fetched with the caller's and served from memory — which is what
   * `release` frees. Call it when the picture comes off the screen.
   */
  async ownPicture(
    uploadId: MediaAsset["upload_id"],
  ): Promise<{ src: string; release: () => void }> {
    return this.picture(`/media/uploads${refPath(uploadId)}`);
  }

  private async picture(
    path: string,
  ): Promise<{ src: string; release: () => void }> {
    const res = await this.request(path, {
      method: "GET",
      headers: { accept: "image/*" },
    });
    if (!res.ok) {
      throw this.error(res, path, await res.text().catch(() => ""));
    }
    const src = URL.createObjectURL(await res.blob());
    return { src, release: () => URL.revokeObjectURL(src) };
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async profile(): Promise<ProfileView> {
    return ProfileViewSchema.parse(
      await this.json("/profile/me", { method: "GET" }),
    );
  }

  async updateProfile(request: UpdateProfileRequest): Promise<ProfileView> {
    return ProfileViewSchema.parse(
      await this.send("PATCH", "/profile/me", request),
    );
  }

  /** Somebody else, as the reader's own instance can resolve them. */
  async profileOf(did: string): Promise<ProfileView> {
    return ProfileViewSchema.parse(
      await this.json(`/profile/${encodeURIComponent(did)}`, { method: "GET" }),
    );
  }

  // ── Emoji ────────────────────────────────────────────────────────────────

  async ownEmoji(): Promise<CustomEmoji[]> {
    const body = await this.json("/emoji/me", { method: "GET" });
    return (body as unknown[]).map((e) => CustomEmojiSchema.parse(e));
  }

  /** The catalog a note's author wrote their `:shortcode:` against. */
  async emojiOf(did: string): Promise<CustomEmoji[]> {
    const body = await this.json(`/emoji/${encodeURIComponent(did)}`, {
      method: "GET",
    });
    return (body as unknown[]).map((e) => CustomEmojiSchema.parse(e));
  }

  /** The picture is uploaded first; this names it. */
  async addEmoji(request: CreateEmojiRequest): Promise<CustomEmoji> {
    return CustomEmojiSchema.parse(
      await this.send("POST", "/emoji/me", request),
    );
  }

  async copyEmoji(request: CopyEmojiRequest): Promise<CustomEmoji> {
    return CustomEmojiSchema.parse(
      await this.send("POST", "/emoji/me/copies", request),
    );
  }

  async removeEmoji(emojiId: CustomEmoji["emoji_id"]): Promise<void> {
    await this.del(`/emoji/me${refPath(emojiId)}`);
  }
}
