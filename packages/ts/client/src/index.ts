// The whole of Sloppy's API, as one typed object. Backend-agnostic by
// construction: `host.ts` decides where the API is, so the same client serves
// the hosted instance, somebody's self-hosted one, and the native shell's
// embedded server. docs/ARCHITECTURE.md § "Deployment modes" states the three.

import {
  type BlockView,
  BlockViewSchema,
  type ConsentRedirect,
  ConsentRedirectSchema,
  type CreateBlockRequest,
  type CreateLabelDimensionRequest,
  type CreateNodeRequest,
  type CreatePublicationRequest,
  type ExchangeSessionRequest,
  type HealthReport,
  HealthReportSchema,
  type LabelDimensionView,
  LabelDimensionViewSchema,
  type NodeView,
  type OwnedRef,
  type PublicationView,
  PublicationViewSchema,
  type PublishedSubtree,
  PublishedSubtreeSchema,
  type Session,
  SessionSchema,
  type StartLoginRequest,
  type UpdateBlockRequest,
  type UpdateLabelDimensionRequest,
  type UpdateNodeRequest,
  type Viewer,
  ViewerSchema,
  parseNodeView,
} from "@sloppy/types";
import { SloppyApiError, notImplemented } from "./errors.js";
import { apiUrl, isSameOrigin } from "./host.js";

export * from "./errors.js";
export * from "./host.js";

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
function refPath(ref: OwnedRef): string {
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
    headers.set("accept", "application/json");
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
   * anywhere; `undefined` on an instance that only ever delegates elsewhere.
   * Asked of the API rather than read off the page's origin, which the shells
   * do not share.
   */
  async ownInstance(): Promise<string | undefined> {
    try {
      const body = (await this.json("/auth/own-instance", {
        method: "GET",
      })) as {
        instance_url?: unknown;
      } | null;
      const url = body?.instance_url;
      return typeof url === "string" && url ? url : undefined;
    } catch {
      return undefined;
    }
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

  /** The server assigns the address; a client that could name one could mint a
   *  citation into somebody else's graph. */
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

  // ── Label dimensions ─────────────────────────────────────────────────────

  async listLabelDimensions(): Promise<LabelDimensionView[]> {
    const body = await this.json("/label-dimensions", { method: "GET" });
    return (body as unknown[]).map((d) => LabelDimensionViewSchema.parse(d));
  }

  async createLabelDimension(
    request: CreateLabelDimensionRequest,
  ): Promise<LabelDimensionView> {
    return LabelDimensionViewSchema.parse(
      await this.send("POST", "/label-dimensions", request),
    );
  }

  async updateLabelDimension(
    ref: OwnedRef,
    request: UpdateLabelDimensionRequest,
  ): Promise<LabelDimensionView> {
    return LabelDimensionViewSchema.parse(
      await this.send("PATCH", `/label-dimensions${refPath(ref)}`, request),
    );
  }

  async deleteLabelDimension(ref: OwnedRef): Promise<void> {
    await this.del(`/label-dimensions${refPath(ref)}`);
  }

  // ── Publications ─────────────────────────────────────────────────────────

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
   * endpoint a peer's instance calls. `null` where nothing is published at that
   * address, which is also what an unpublish leaves behind.
   */
  async readPublishedSubtree(
    did: string,
    rootAddress: string,
  ): Promise<PublishedSubtree | null> {
    const path = `/public/subtrees/${encodeURIComponent(did)}/${encodeURIComponent(
      rootAddress,
    )}`;
    const body = await this.json(path, { method: "GET" });
    return body == null ? null : PublishedSubtreeSchema.parse(body);
  }

  /**
   * Pull somebody else's published subtree in as a foreign, read-only region.
   *
   * Declared, not implemented: M4 owns whether a pull answers with the subtree
   * or schedules an import, and whether the region is stored or re-fetched.
   * The resolution itself runs on the API — a browser resolving a peer's
   * provider would leak the viewer to it, which `proxied()` exists to prevent.
   */
  async pullSubtree(
    _did: string,
    _rootAddress: string,
  ): Promise<PublishedSubtree> {
    return notImplemented("Pulling a peer's subtree");
  }
}
