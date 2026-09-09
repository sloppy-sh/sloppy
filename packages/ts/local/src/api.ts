// The client a graph on this device is served through —
// docs/ARCHITECTURE.md § "Local-only mode".

import { type SloppyApi, serverOnly } from "@sloppy/client";
import {
  type Address,
  AddressSchema,
  type AnsweredNote,
  type ArchivePreview,
  type BlockDocument,
  type BlockView,
  type CompleteUploadRequest,
  CompleteUploadRequestSchema,
  type ConsentRedirect,
  type Converses,
  type CopyEmojiRequest,
  type CreateBlockRequest,
  CreateBlockRequestSchema,
  type CreateEmojiRequest,
  CreateEmojiRequestSchema,
  type CreateGraphRequest,
  CreateGraphRequestSchema,
  type CreateNodeRequest,
  CreateNodeRequestSchema,
  type CreateNoteCommentRequest,
  type CreateNoteReactionRequest,
  type CreatePublicationRequest,
  type CreateUploadRequest,
  CreateUploadRequestSchema,
  type CustomEmoji,
  type DeletedBranch,
  type DidSyr,
  type ExchangeSessionRequest,
  type FollowRequest,
  type FollowedIdentity,
  type GraphExport,
  type GraphView,
  type HealthReport,
  HOME_GRAPH_ULID,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_NOTES,
  MAX_RECENT_NOTES,
  type MediaAsset,
  type MediaLibraryRole,
  type NodeBulkRequest,
  type NodeBulkResult,
  type NodePlacement,
  type NodeView,
  type NoteComment,
  type NoteDestination,
  NoteDestinationSchema,
  type NoteReaction,
  type OwnInstance,
  type OwnedMediaAsset,
  type OwnedRef,
  type PeerIdentity,
  type ProfileView,
  type PublicationView,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedSubtree,
  type PublishedVersion,
  type PublishedVersionsPage,
  type PullView,
  type PulledNoteHit,
  RECENT_NOTES,
  type RefuseVoiceRequest,
  type RefusedVoiceView,
  type SearchHit,
  type Session,
  type StartLoginRequest,
  type TagCount,
  type UnpublishedChanges,
  type UpdateBlockRequest,
  UpdateBlockRequestSchema,
  type UpdateGraphRequest,
  UpdateGraphRequestSchema,
  type UpdateNodeRequest,
  type UpdateProfileRequest,
  UpdateProfileRequestSchema,
  type UploadTicket,
  type Viewer,
  type UpdatePublicationRequest,
  graphAsked,
  namesGraph,
  nowIso,
  ulid,
} from "@sloppy/types";
import {
  type EmojiDrawing,
  type Vault,
  VAULT_FORMAT,
  GRAPH_FILE,
  decodeText,
  emojiAt,
  manifest,
  noteAt,
  graphFile,
  pack,
  readGraphFile,
  rekey,
  unpack,
  uploadAt,
  type VaultGraph,
  type VaultNote,
  vaultToNote,
  VaultFormatError,
} from "@sloppy/vault";
import type { Files } from "./files.js";
import {
  LocalGraph,
  localOf,
  picturesDrawnBy,
  type StoredNote,
  type StoredPicture,
} from "./graph.js";
import { type LocalIdentity, openLocalIdentity } from "./identity.js";
import { NoteWriter } from "./notes.js";
import { absent, checked, contested, refuse } from "./refusal.js";
import { recent, search } from "./search.js";
import { type KnownVault, readVaults, writeVaults } from "./vaults.js";
import { carriedOut, vaultOwned } from "./vault-paths.js";

/**
 * `SloppyApi` over a folder on the device: the vault is the store, and nothing
 * here reaches a network.
 *
 * A method that calls `serverOnly` is one this can never answer — publishing,
 * peers, pulls, conversation, following and somebody else's identity all need a
 * second machine to exist, and a surface that offers them here has a bug.
 */
export class LocalApi implements SloppyApi {
  private identity?: LocalIdentity;
  private known?: KnownVault[];
  private starting?: Promise<LocalGraph>;
  private readonly opened = new Map<string, LocalGraph>();
  /** One write at a time: an act reads where it is landing and then writes
   *  there, and two would each land where the other had already left. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly files: Files) {}

  // ── Service ──────────────────────────────────────────────────────────────

  async health(): Promise<HealthReport> {
    serverOnly("Checking a server");
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async ownInstance(): Promise<string | undefined> {
    serverOnly("Making an identity somewhere else");
  }

  async instanceHome(): Promise<OwnInstance> {
    serverOnly("Making an identity somewhere else");
  }

  async startLogin(_request: StartLoginRequest): Promise<ConsentRedirect> {
    serverOnly("Signing in");
  }

  async exchangeSession(_request: ExchangeSessionRequest): Promise<Session> {
    serverOnly("Signing in");
  }

  async signOut(): Promise<void> {
    serverOnly("Signing out");
  }

  /** The identity this device writes under — `identity.ts` makes it on first
   *  run, so this never answers `null`. */
  async me(): Promise<Viewer | null> {
    const identity = await this.who();
    return {
      did: identity.did,
      syr_instance_url: "",
      delegate_public_key: identity.public_key,
    };
  }

  // ── Graphs ───────────────────────────────────────────────────────────────

  async listGraphs(): Promise<GraphView[]> {
    const graphs = await this.allGraphs();
    return graphs.map((graph) => this.graphView(graph));
  }

  /** A graph is a folder, so starting one asks for the folder to keep it in. */
  async createGraph(asked: CreateGraphRequest): Promise<GraphView> {
    const request = checked(() => CreateGraphRequestSchema.parse(asked));
    return this.write(async () => {
      const did = (await this.who()).did;
      const known = await this.vaults();
      const root = await this.files.pickFolder();
      if (root === undefined) throw refuse("No folder was chosen.");
      if (known.some((one) => one.root === root)) {
        throw refuse("There is already a graph in that folder.");
      }
      const at = nowIso();
      const graph = await LocalGraph.start(this.files.at(root), did, {
        format: VAULT_FORMAT,
        graph: known.length === 0 ? HOME_GRAPH_ULID : ulid(),
        name: request.title,
        owner: did,
      });
      this.opened.set(root, graph);
      await this.remember([...known, { root, created_at: at, updated_at: at }]);
      return this.graphView(graph);
    });
  }

  async updateGraph(
    ref: OwnedRef,
    asked: UpdateGraphRequest,
  ): Promise<GraphView> {
    const request = checked(() => UpdateGraphRequestSchema.parse(asked));
    return this.write(async () => {
      const graph = await this.graphAt(ref);
      await graph.rename(request.title);
      return this.graphView(graph);
    });
  }

  /**
   * The graph's own files go, and the folder stays: what else somebody keeps in
   * it — a README, the history git holds — is theirs and was never Sloppy's to
   * take.
   */
  async closeGraph(ref: OwnedRef): Promise<void> {
    await this.write(async () => {
      const graph = await this.graphAt(ref);
      const root = this.rootOf(graph);
      await emptyVault(graph.files);
      this.opened.delete(root);
      await this.remember(
        (await this.vaults()).filter((one) => one.root !== root),
      );
    });
  }

  // ── Nodes ────────────────────────────────────────────────────────────────

  async listNodes(
    query: { origin?: OwnedRef; maxDepth?: number; graph?: OwnedRef } = {},
  ): Promise<NodeView[]> {
    if (query.origin === undefined) {
      const graph = await this.graphAt(query.graph);
      return graph
        .live()
        .filter((note) => note.parent === undefined)
        .map((note) => graph.view(note));
    }
    const graph = await this.graphHolding(query.origin);
    if (!graph) return [];
    return graph
      .live()
      .map((note) => graph.view(note))
      .filter(
        (view) =>
          view.origin === query.origin &&
          (query.maxDepth === undefined || view.depth <= query.maxDepth),
      );
  }

  async getNode(ref: OwnedRef): Promise<NodeView | null> {
    const graph = await this.graphHolding(ref);
    const note = graph?.find(ref);
    return graph && note ? graph.view(note) : null;
  }

  async createNode(asked: CreateNodeRequest): Promise<NodeView> {
    const request = checked(() => CreateNodeRequestSchema.parse(asked));
    return this.write(async () =>
      new NoteWriter(await this.landingGraph(request.from)).create(request),
    );
  }

  async updateNode(
    ref: OwnedRef,
    request: UpdateNodeRequest,
  ): Promise<NodeView> {
    return this.write(async () => {
      const graph = await this.holder(ref);
      const written = await new NoteWriter(graph).update(ref, request);
      await this.carryPictures(graph, graph.find(ref));
      return written;
    });
  }

  async setAddress(ref: OwnedRef, address: Address | null): Promise<NodeView> {
    const label =
      address === null ? null : checked(() => AddressSchema.parse(address));
    return this.write(async () =>
      new NoteWriter(await this.holder(ref)).setAddress(ref, label),
    );
  }

  async moveNote(
    ref: OwnedRef,
    to: NoteDestination,
    address?: Address,
  ): Promise<NodeView[]> {
    const destination = checked(() => NoteDestinationSchema.parse(to));
    const label =
      address === undefined
        ? undefined
        : checked(() => AddressSchema.parse(address));
    return this.write(async () =>
      new NoteWriter(await this.holder(ref)).move(ref, destination, label),
    );
  }

  async deleteNode(ref: OwnedRef): Promise<void> {
    await this.write(async () => {
      const graph = await this.graphHolding(ref);
      if (graph) await new NoteWriter(graph).remove(ref);
    });
  }

  async actOnNodes(request: NodeBulkRequest): Promise<NodeBulkResult> {
    return this.write(async () => {
      const first = request.notes?.[0];
      const graph = first ? await this.holder(first) : await this.graphAt();
      const done = await new NoteWriter(graph).bulk(request);
      for (const note of done.notes) {
        await this.carryPictures(graph, graph.find(note.ref));
      }
      return done;
    });
  }

  async deletedBranches(): Promise<DeletedBranch[]> {
    return this.write(async () => {
      const branches: DeletedBranch[] = [];
      for (const graph of await this.allGraphs()) {
        await graph.sweep();
        branches.push(...graph.deletedBranches());
      }
      return branches.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
    });
  }

  async restoreBranch(ref: OwnedRef): Promise<NodeView> {
    return this.write(async () =>
      new NoteWriter(await this.holder(ref, true)).restore(ref),
    );
  }

  async searchNotes(q: string, graph?: OwnedRef): Promise<SearchHit[]> {
    const within = graph ? [await this.graphAt(graph)] : await this.allGraphs();
    return search(within, q);
  }

  async recentNotes(
    query: { graph?: OwnedRef; limit?: number } = {},
  ): Promise<NodeView[]> {
    const limit = Math.min(query.limit ?? RECENT_NOTES, MAX_RECENT_NOTES);
    const within = query.graph
      ? [await this.graphAt(query.graph)]
      : await this.allGraphs();
    return within
      .flatMap((graph) => recent(graph, limit).map((note) => graph.view(note)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
  }

  /** The tags one graph's notes carry, most-used first, ties alphabetical. */
  async listTags(graph?: OwnedRef): Promise<TagCount[]> {
    const counted = new Map<string, number>();
    for (const note of (await this.graphAt(graph)).live()) {
      for (const tag of note.tags) {
        counted.set(tag, (counted.get(tag) ?? 0) + 1);
      }
    }
    return [...counted]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag));
  }

  // ── Blocks ───────────────────────────────────────────────────────────────

  async listBlocks(node: OwnedRef): Promise<BlockView[]> {
    const graph = await this.graphHolding(node);
    const note = graph?.find(node);
    if (!graph || !note) throw absent("That note is not here.");
    return graph.blockViews(note);
  }

  async createBlock(asked: CreateBlockRequest): Promise<BlockView> {
    const request = checked(() => CreateBlockRequestSchema.parse(asked));
    return this.write(async () => {
      const graph = await this.holder(request.node);
      const note = graph.find(request.node);
      if (!note) throw absent("That note is not here.");
      const at =
        request.after === undefined
          ? 0
          : placeAfter(
              note,
              request.after,
              "The block this one was going after is not in the note it is going into.",
            );
      const section = {
        ulid: ulid(),
        content: request.content,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      const sections = [...note.sections];
      sections.splice(at, 0, section);
      const written = await graph.save({
        ...note,
        sections,
        updated_at: nowIso(),
      });
      await this.carryPictures(graph, written);
      return graph.blockViews(written)[at];
    });
  }

  async updateBlock(
    ref: OwnedRef,
    asked: UpdateBlockRequest,
  ): Promise<BlockView> {
    const request = checked(() => UpdateBlockRequestSchema.parse(asked));
    if (request.after === ref) throw refuse("A block cannot follow itself.");
    return this.write(async () => {
      const graph = await this.holderOfSection(ref);
      const held = graph.sectionAt(ref);
      if (!held || held.note.deleted_at !== undefined) {
        throw absent("That block is not here.");
      }
      const section = held.note.sections[held.at];
      if (
        request.expects !== undefined &&
        request.expects !== section.updated_at
      ) {
        throw contested(
          "This section was written somewhere else. Open the note again to see what it says now.",
        );
      }
      const written = {
        ...section,
        ...(request.content === undefined ? {} : { content: request.content }),
        updated_at: nowIso(),
      };
      const into = request.node ?? held.note.ref;
      const stays = into === held.note.ref;
      const target = stays ? held.note : graph.find(into);
      if (!target) throw refuse("That note is not here.");

      const left = held.note.sections.filter(
        (one) => one.ulid !== written.ulid,
      );
      const stack = stays ? left : [...target.sections];
      const at =
        stays && request.after === undefined
          ? Math.min(held.at, stack.length)
          : request.after == null
            ? 0
            : placeAfter(
                { sections: stack },
                request.after,
                "The block this one was going after is not in the note it is going into.",
              );
      stack.splice(at, 0, written);
      if (!stays) {
        await graph.save({
          ...held.note,
          sections: left,
          updated_at: nowIso(),
        });
      }
      const saved = await graph.save({
        ...target,
        sections: stack,
        updated_at: nowIso(),
      });
      await this.carryPictures(graph, saved);
      return graph.blockViews(saved)[at];
    });
  }

  async deleteBlock(ref: OwnedRef): Promise<void> {
    await this.write(async () => {
      const graph = await this.graphHoldingSection(ref);
      const held = graph?.sectionAt(ref);
      if (!graph || !held) return;
      await graph.save({
        ...held.note,
        sections: held.note.sections.filter((one) => one.ulid !== localOf(ref)),
        updated_at: nowIso(),
      });
    });
  }

  // ── Archives ─────────────────────────────────────────────────────────────

  async exportEverything(): Promise<GraphExport> {
    const graphs = await this.allGraphs();
    return {
      exported_at: nowIso(),
      did: (await this.who()).did,
      graphs: graphs.map((graph) => this.graphView(graph)),
      notes: graphs.flatMap((graph) =>
        graph.live().map((note) => graph.view(note)),
      ),
      blocks: graphs.flatMap((graph) =>
        graph.live().flatMap((note) => graph.blockViews(note)),
      ),
    };
  }

  async exportArchive(
    ref: OwnedRef,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    const graph = await this.graphAt(ref);
    const vault: Vault = new Map();
    for (const [path, bytes] of await graph.carry()) {
      if (carriedOut(path)) vault.set(path, bytes);
    }
    return { bytes: pack(vault), filename: archiveName(graph.title) };
  }

  async previewArchive(archive: BodyInit): Promise<ArchivePreview> {
    const opened = await this.openArchive(archive);
    const held = await this.holdingAny(
      opened.notes.map((note) => note.ref),
      opened.into,
    );
    const replacing = opened.into
      ? opened.into.live().length + opened.into.binned().length
      : 0;
    return {
      format: opened.said.format,
      graph: opened.said.graph,
      name: opened.said.name,
      owner: opened.said.owner,
      notes: opened.notes.length,
      pictures: [...opened.vault.keys()].filter(
        (path) => uploadAt(path) !== undefined,
      ).length,
      missing_emoji: opened.missing,
      collisions: held,
      replaces: opened.into !== undefined,
      replacing,
    };
  }

  /** A graph brought in as a folder of its own, under this device's identity.
   *  One this device already keeps takes the place of what is in that folder. */
  async importArchive(archive: BodyInit): Promise<GraphView> {
    const opened = await this.openArchive(archive);
    return this.write(async () => {
      const held = await this.holdingAny(
        opened.notes.map((note) => note.ref),
        opened.into,
      );
      if (held.length > 0) throw alreadyHere(held.length);
      const did = (await this.who()).did;
      const known = await this.vaults();
      const into = opened.into;
      const root = into ? this.rootOf(into) : await this.files.pickFolder();
      if (root === undefined) throw refuse("No folder was chosen.");
      if (!into && known.some((one) => one.root === root)) {
        throw refuse("There is already a graph in that folder.");
      }
      const files = this.files.at(root);
      const retired = into ? spentBefore(into, opened.notes) : [];
      if (into) await emptyVault(files);
      for (const [path, bytes] of opened.vault) await files.write(path, bytes);
      const graph = await LocalGraph.open(files, did);
      await graph.keepRetired(retired);
      this.opened.set(root, graph);
      if (!into) {
        const at = nowIso();
        await this.remember([
          ...known,
          { root, created_at: at, updated_at: at },
        ]);
      }
      return this.graphView(graph);
    });
  }

  // ── Publications ─────────────────────────────────────────────────────────

  async listPublications(): Promise<PublicationView[]> {
    serverOnly("Publishing");
  }

  async publish(_request: CreatePublicationRequest): Promise<PublicationView> {
    serverOnly("Publishing");
  }

  async updatePublication(
    _ref: OwnedRef,
    _request: UpdatePublicationRequest,
  ): Promise<PublicationView> {
    serverOnly("Publishing");
  }

  async unpublish(_ref: OwnedRef): Promise<void> {
    serverOnly("Publishing");
  }

  async publicationVersions(_ref: OwnedRef): Promise<PublishedVersion[]> {
    serverOnly("Publishing");
  }

  async unpublishedChanges(_ref: OwnedRef): Promise<UnpublishedChanges> {
    serverOnly("Publishing");
  }

  // ── Peers ────────────────────────────────────────────────────────────────

  async readPublishedSubtree(
    _publication: OwnedRef,
    _version?: OwnedRef,
  ): Promise<PublishedSubtree | null> {
    serverOnly("Reading a published branch");
  }

  async peerIdentity(
    _name: string,
    _options: { sourceUrl?: string } = {},
  ): Promise<PeerIdentity> {
    serverOnly("Finding somebody");
  }

  async publishedBy(
    _did: string,
    _options: { sourceUrl?: string; cursor?: string } = {},
  ): Promise<PublishedIndex> {
    serverOnly("Reading what somebody has published");
  }

  async publishedVersions(
    _publication: OwnedRef,
    _options: { sourceUrl?: string; cursor?: string } = {},
  ): Promise<PublishedVersionsPage> {
    serverOnly("Reading what somebody has published");
  }

  async publishedChanges(
    _publication: OwnedRef,
    _from: OwnedRef,
    _to: OwnedRef,
    _options: { sourceUrl?: string; cursor?: string } = {},
  ): Promise<PublishedChangesPage> {
    serverOnly("Reading what somebody has published");
  }

  // ── Pulls ────────────────────────────────────────────────────────────────

  async pullSubtree(
    _publication: OwnedRef,
    _options: { version?: OwnedRef; sourceUrl?: string } = {},
  ): Promise<PullView> {
    serverOnly("Pulling a branch in");
  }

  async listPulls(): Promise<PullView[]> {
    serverOnly("Pulling a branch in");
  }

  async dropPull(_ref: OwnedRef): Promise<void> {
    serverOnly("Pulling a branch in");
  }

  async listPulledNodes(
    _pull: OwnedRef,
    _query: { maxDepth?: number } = {},
  ): Promise<NodeView[]> {
    serverOnly("Reading a branch pulled in");
  }

  async listPulledBlocks(_node: OwnedRef): Promise<BlockView[]> {
    serverOnly("Reading a branch pulled in");
  }

  async heldNoteBySource(_node: OwnedRef): Promise<PulledNoteHit | null> {
    serverOnly("Reading a branch pulled in");
  }

  async publishedPicture(
    _uploadId: MediaAsset["upload_id"],
  ): Promise<{ src: string; release: () => void }> {
    serverOnly("Reading a picture in a published branch");
  }

  // ── Follows ──────────────────────────────────────────────────────────────

  async following(): Promise<FollowedIdentity[]> {
    serverOnly("Following somebody");
  }

  async follow(_request: FollowRequest): Promise<void> {
    serverOnly("Following somebody");
  }

  async unfollow(_did: string): Promise<void> {
    serverOnly("Following somebody");
  }

  // ── Conversation ─────────────────────────────────────────────────────────

  async listComments(_node: OwnedRef): Promise<NoteComment[]> {
    serverOnly("Comments");
  }

  async addComment(_request: CreateNoteCommentRequest): Promise<NoteComment> {
    serverOnly("Comments");
  }

  async removeComment(_commentId: NoteComment["comment_id"]): Promise<void> {
    serverOnly("Comments");
  }

  async listReactions(_node: OwnedRef): Promise<NoteReaction[]> {
    serverOnly("Reactions");
  }

  async addReaction(
    _request: CreateNoteReactionRequest,
  ): Promise<NoteReaction> {
    serverOnly("Reactions");
  }

  async removeReaction(
    _reactionId: NoteReaction["reaction_id"],
  ): Promise<void> {
    serverOnly("Reactions");
  }

  async converses(): Promise<Converses> {
    serverOnly("Comments and reactions");
  }

  async refusedVoices(): Promise<RefusedVoiceView[]> {
    serverOnly("Choosing who may answer a note");
  }

  async refuseVoice(_request: RefuseVoiceRequest): Promise<RefusedVoiceView> {
    serverOnly("Choosing who may answer a note");
  }

  async allowVoice(_request: RefuseVoiceRequest): Promise<void> {
    serverOnly("Choosing who may answer a note");
  }

  async answeredNotes(): Promise<AnsweredNote[]> {
    serverOnly("Comments and reactions");
  }

  // ── Media ────────────────────────────────────────────────────────────────

  /** Where to send a picture's bytes, and where they will read back from —
   *  both the one address the vault keeps that file at. */
  async createUpload(asked: CreateUploadRequest): Promise<UploadTicket> {
    const request = checked(() => CreateUploadRequestSchema.parse(asked));
    return this.write(async () => {
      const graph = await this.graphAt();
      const { upload, path } = graph.addPicture({
        role: request.role,
        filename: request.filename,
        mime_type: request.mime_type,
        ...(request.width === undefined ? {} : { width: request.width }),
        ...(request.height === undefined ? {} : { height: request.height }),
      });
      return {
        upload_id: upload,
        upload_url: graph.files.url(path),
        upload_headers: {},
      };
    });
  }

  /**
   * A picture's bytes, put where its ticket says. They cross the same bridge
   * every other write does rather than being sent to the address the ticket
   * names: a webview carries no request body to the app it belongs to, so
   * there is no address on this device that could receive them.
   */
  async sendUpload(ticket: UploadTicket, file: Blob): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.write(async () => {
      const graph = await this.graphAt();
      const path = graph.picturePath(ticket.upload_id);
      if (!path) throw absent("That picture is not here.");
      await graph.files.write(path, bytes);
    });
  }

  async completeUpload(asked: CompleteUploadRequest): Promise<MediaAsset> {
    const request = checked(() => CompleteUploadRequestSchema.parse(asked));
    return this.write(async () =>
      (await this.graphAt()).completePicture(request.upload_id),
    );
  }

  async ownPictures(
    role: MediaLibraryRole = "block",
  ): Promise<OwnedMediaAsset[]> {
    const listed: OwnedMediaAsset[] = [];
    for (const graph of await this.allGraphs()) {
      listed.push(...(await graph.listPictures(role)));
    }
    return listed;
  }

  async removePicture(uploadId: MediaAsset["upload_id"]): Promise<void> {
    await this.write(async () => {
      for (const graph of await this.allGraphs()) {
        if (graph.picturePath(uploadId)) await graph.removePicture(uploadId);
      }
    });
  }

  /** A picture in a graph on this device is already an address this page can
   *  load, so there is nothing to free afterwards. */
  async ownPicture(
    uploadId: MediaAsset["upload_id"],
  ): Promise<{ src: string; release: () => void }> {
    for (const graph of await this.allGraphs()) {
      const path = graph.picturePath(uploadId);
      if (path) return { src: graph.files.url(path), release: () => {} };
    }
    throw absent("That picture is not here.");
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  /** Who this device writes under, as the graphs on it say. Every graph here
   *  belongs to the one identity, so the first that says who owns it answers
   *  for all of them. */
  async profile(): Promise<ProfileView> {
    const did = (await this.who()).did;
    const graphs = await this.allGraphs();
    const graph = graphs.find(
      (held) =>
        held.owner.name !== undefined || held.owner.avatar !== undefined,
    );
    const avatar = graph?.owner.avatar;
    return {
      did,
      // There is nothing here to be known by but the identity itself.
      username: did,
      display_name: graph?.owner.name ?? null,
      bio: null,
      avatar_src: graph && avatar ? graph.files.url(avatar) : null,
      banner_src: null,
    };
  }

  /** A name and a picture, written into every graph on this device — a graph
   *  says whose it is wherever it is opened, so each keeps its own copy of the
   *  picture. */
  async updateProfile(asked: UpdateProfileRequest): Promise<ProfileView> {
    const request = checked(() => UpdateProfileRequestSchema.parse(asked));
    if (request.bio != null || request.banner_upload_id != null) {
      throw refuse(
        "A graph on this device keeps your name and your picture, and nothing else about you.",
      );
    }
    return this.write(async () => {
      const graphs = await this.allGraphs();
      if (graphs.length === 0) {
        throw absent(
          "There is no graph on this device yet. Start one to write.",
        );
      }
      const picture =
        request.avatar_upload_id == null
          ? undefined
          : await this.devicePicture(request.avatar_upload_id);
      for (const graph of graphs) {
        const held = graph.owner;
        const name = chosenName(request.display_name, held.name);
        const avatar =
          request.avatar_upload_id === undefined
            ? held.avatar
            : picture && (await this.avatarIn(graph, picture));
        await graph.setOwner({
          ...(name === undefined ? {} : { name }),
          ...(avatar === undefined ? {} : { avatar }),
        });
        const gone = held.avatar === avatar ? undefined : held.avatar;
        const upload = gone === undefined ? undefined : uploadAt(gone);
        if (upload && !graph.draws(upload)) await graph.removePicture(upload);
      }
      return this.profile();
    });
  }

  async profileOf(_did: string): Promise<ProfileView> {
    serverOnly("Somebody else's profile");
  }

  // ── Emoji ────────────────────────────────────────────────────────────────

  async ownEmoji(): Promise<CustomEmoji[]> {
    return (await this.graphAt()).ownEmoji();
  }

  async addEmoji(asked: CreateEmojiRequest): Promise<CustomEmoji> {
    const request = checked(() => CreateEmojiRequestSchema.parse(asked));
    return this.write(async () =>
      (await this.graphAt()).addEmoji(
        request.shortcode,
        request.kind,
        request.upload_id,
      ),
    );
  }

  async removeEmoji(emojiId: CustomEmoji["emoji_id"]): Promise<void> {
    await this.write(async () => {
      await (await this.graphAt()).removeEmoji(emojiId);
    });
  }

  async emojiOf(_did: string): Promise<CustomEmoji[]> {
    serverOnly("Somebody else's emoji");
  }

  async copyEmoji(_request: CopyEmojiRequest): Promise<CustomEmoji> {
    serverOnly("Somebody else's emoji");
  }

  // ── What every act above stands on ───────────────────────────────────────

  private write<T>(task: () => Promise<T>): Promise<T> {
    const done = this.queue.then(task, task);
    this.queue = done.catch(() => {});
    return done;
  }

  /** The bytes of a picture on this device, wherever it was added. */
  private async devicePicture(upload: string): Promise<DevicePicture> {
    for (const graph of await this.allGraphs()) {
      const said = graph.pictureOf(upload);
      const path = graph.picturePath(upload);
      const bytes = said && path ? await graph.files.read(path) : undefined;
      if (said && bytes) return { upload, said, bytes };
    }
    throw refuse("That picture is not here. Add it again.");
  }

  private async avatarIn(
    graph: LocalGraph,
    picture: DevicePicture,
  ): Promise<string> {
    return (
      graph.picturePath(picture.upload) ??
      (await graph.keepPicture(picture.upload, picture.said, picture.bytes))
    );
  }

  /**
   * A vault holds the pictures its own notes draw. A picture is added before
   * anybody knows which note will draw it, so one that turns out to belong to a
   * note in another graph on this device is carried into that graph's folder —
   * where the archive taken out of it will carry it too.
   */
  private async carryPictures(
    graph: LocalGraph,
    note: StoredNote | undefined,
  ): Promise<void> {
    if (!note) return;
    const wanted = new Set(
      [...picturesDrawnBy(note)].filter((upload) => !graph.picturePath(upload)),
    );
    if (wanted.size === 0) return;
    for (const other of await this.allGraphs()) {
      if (other === graph) continue;
      for (const upload of [...wanted]) {
        const said = other.pictureOf(upload);
        const path = other.picturePath(upload);
        const bytes = said && path ? await other.files.read(path) : undefined;
        if (!said || !bytes) continue;
        await graph.keepPicture(upload, said, bytes);
        wanted.delete(upload);
        if (!other.draws(upload)) await other.removePicture(upload);
      }
    }
  }

  private async who(): Promise<LocalIdentity> {
    this.identity ??= await openLocalIdentity(this.files);
    return this.identity;
  }

  private async vaults(): Promise<KnownVault[]> {
    this.known ??= await readVaults(this.files.at(await this.files.dataPath()));
    return this.known;
  }

  private async remember(vaults: readonly KnownVault[]): Promise<void> {
    this.known = [...vaults];
    await writeVaults(this.files.at(await this.files.dataPath()), this.known);
  }

  /** Every graph this device keeps, in the order it opened them. A folder that
   *  is no longer a vault is left out rather than refused: somebody moved it,
   *  and the graphs beside it still open. */
  private async allGraphs(): Promise<LocalGraph[]> {
    const graphs: LocalGraph[] = [];
    for (const known of await this.vaults()) {
      const already = this.opened.get(known.root);
      if (already) {
        graphs.push(already);
        continue;
      }
      try {
        const graph = await LocalGraph.open(
          this.files.at(known.root),
          (await this.who()).did,
        );
        this.opened.set(known.root, graph);
        graphs.push(graph);
      } catch {}
    }
    return graphs;
  }

  /** The graph a new note lands in: the one holding the note it is placed
   *  against, and otherwise the one the placement names. */
  private async landingGraph(
    from: NodePlacement | undefined,
  ): Promise<LocalGraph> {
    if (from === undefined || namesGraph(from)) {
      return this.graphAt(graphAsked(from));
    }
    const graph = await this.graphHolding(from.note);
    if (!graph) {
      throw refuse(
        from.relation === "under"
          ? "The note this springs from is not here."
          : "The note this follows is not here.",
      );
    }
    return graph;
  }

  /** The graph named, or the one this device started with. */
  private async graphAt(ref?: OwnedRef): Promise<LocalGraph> {
    let graphs = await this.allGraphs();
    const open = this.files.root;
    if (graphs.length === 0 && open) {
      await this.graphInTheOpenFolder(open);
      graphs = await this.allGraphs();
    }
    if (graphs.length === 0) {
      throw absent("There is no graph on this device yet. Start one to write.");
    }
    if (ref === undefined) return graphs[0];
    const found = graphs.find((graph) => graph.ref === ref);
    if (!found) throw absent("That graph is not on this device.");
    return found;
  }

  /**
   * The graph in the folder a shell opened, where this device knows of none
   * yet: opening a folder is how somebody says a graph is in it, so one that
   * holds a graph is read and one that does not becomes it. The name is the
   * folder's, which is what they called the place; it is renamed like any other.
   *
   * Held as the promise rather than the graph, so two reads landing together
   * start one graph between them.
   */
  private graphInTheOpenFolder(root: string): Promise<LocalGraph> {
    this.starting ??= (async () => {
      const did = (await this.who()).did;
      const at = this.files.at(root);
      const graph = (await at.exists(GRAPH_FILE))
        ? await LocalGraph.open(at, did)
        : await LocalGraph.start(at, did, {
            format: VAULT_FORMAT,
            graph: HOME_GRAPH_ULID,
            name: folderName(root),
            owner: did,
          });
      this.opened.set(root, graph);
      const known = await this.vaults();
      const when = nowIso();
      if (!known.some((one) => one.root === root)) {
        await this.remember([
          ...known,
          { root, created_at: when, updated_at: when },
        ]);
      }
      return graph;
    })();
    return this.starting;
  }

  private async graphHolding(ref: OwnedRef): Promise<LocalGraph | undefined> {
    for (const graph of await this.allGraphs()) {
      if (graph.held(ref)) return graph;
    }
    return undefined;
  }

  private async holder(ref: OwnedRef, binned = false): Promise<LocalGraph> {
    const graph = await this.graphHolding(ref);
    if (!graph) {
      throw absent(
        binned
          ? "That branch is not here to put back."
          : "That note is not here.",
      );
    }
    return graph;
  }

  private async graphHoldingSection(
    ref: OwnedRef,
  ): Promise<LocalGraph | undefined> {
    for (const graph of await this.allGraphs()) {
      if (graph.sectionAt(ref)) return graph;
    }
    return undefined;
  }

  private async holderOfSection(ref: OwnedRef): Promise<LocalGraph> {
    const graph = await this.graphHoldingSection(ref);
    if (!graph) throw absent("That block is not here.");
    return graph;
  }

  /** Which of these notes this device already keeps in a graph other than the
   *  one they are arriving into. */
  private async holdingAny(
    refs: readonly OwnedRef[],
    into?: LocalGraph,
  ): Promise<OwnedRef[]> {
    const wanted = new Set(refs);
    const found: OwnedRef[] = [];
    for (const graph of await this.allGraphs()) {
      if (graph === into) continue;
      for (const note of graph.all()) {
        if (wanted.has(note.ref)) found.push(note.ref);
      }
    }
    return found;
  }

  private rootOf(graph: LocalGraph): string {
    for (const [root, held] of this.opened) {
      if (held === graph) return root;
    }
    return graph.files.root;
  }

  private graphView(graph: LocalGraph): GraphView {
    const known = (this.known ?? []).find(
      (one) => one.root === this.rootOf(graph),
    );
    const at = known?.created_at ?? nowIso();
    return {
      ref: graph.ref,
      created_by: graph.did,
      title: graph.title,
      created_at: at,
      updated_at: known?.updated_at ?? at,
    };
  }

  /** An archive read and put under this device's identity. Nothing here writes:
   *  the preview and the import answer for the same file. */
  private async openArchive(archive: BodyInit): Promise<Opened> {
    const bytes = new Uint8Array(await new Response(archive).arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw refuse(
        `That file is too big. The limit here is ${Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024))} MB.`,
      );
    }
    const said = readable(() => manifest(bytes));
    if (said.notes > MAX_ARCHIVE_NOTES) {
      throw refuse(
        `That graph has more notes than can arrive at once. The limit here is ${MAX_ARCHIVE_NOTES.toLocaleString("en-US")} notes.`,
      );
    }
    const did = (await this.who()).did;
    const vault = rekey(
      readable(() => unpack(bytes)),
      said.owner,
      did,
    );
    const drawings = new Map<string, EmojiDrawing>();
    for (const path of vault.keys()) {
      const shortcode = emojiAt(path);
      if (shortcode !== undefined) drawings.set(shortcode, { src: path });
    }
    const notes = readable(() => readNotes(vault, drawings));
    const missing = new Set<string>();
    for (const note of notes) {
      for (const shortcode of shortcodesIn(note.sections)) {
        if (!drawings.has(shortcode)) missing.add(shortcode);
      }
    }
    // The graph a person started with is the one every archive of one names, so
    // one arriving opens a graph of its own rather than writing over theirs.
    const opening =
      said.graph === HOME_GRAPH_ULID ? { ...said, graph: ulid() } : said;
    // Whose it is now is whoever imported it, so somebody else's name does not
    // come with their graph; a person's own archive still carries theirs back.
    const owned = said.owner === did ? readGraph(vault) : undefined;
    vault.set(
      GRAPH_FILE,
      graphFile({
        format: VAULT_FORMAT,
        graph: opening.graph,
        name: opening.name,
        owner: did,
        ...(owned?.owner_name === undefined
          ? {}
          : { owner_name: owned.owner_name }),
        ...(owned?.owner_avatar === undefined
          ? {}
          : { owner_avatar: owned.owner_avatar }),
      }),
    );
    const into = (await this.allGraphs()).find(
      (graph) => graph.ref === `${did}/${opening.graph}`,
    );
    return { said: opening, vault, notes, missing: [...missing], into };
  }
}

/** What a person is called after this patch: absent leaves what they were
 *  called, and a name cleared or left blank leaves them with none. */
function chosenName(
  said: string | null | undefined,
  held: string | undefined,
): string | undefined {
  if (said === undefined) return held;
  const name = said?.trim() ?? "";
  return name === "" ? undefined : name;
}

/** A picture as some graph on this device holds it. */
interface DevicePicture {
  upload: string;
  said: StoredPicture;
  bytes: Uint8Array;
}

interface Opened {
  said: { format: number; graph: string; name: string; owner: DidSyr };
  vault: Vault;
  notes: VaultNote[];
  missing: string[];
  /** The graph on this device this archive writes over, absent where it opens
   *  one of its own. */
  into?: LocalGraph;
}

/**
 * Every address the graph an import writes over has spent: the ones its notes
 * are at, the bin's among them, the ones they were carried away from, and the
 * ones it had already retired — less the ones the arriving notes lead by. None
 * of them is ever assigned again, AI.md § "The Genealogy Is the Protocol".
 */
function spentBefore(
  into: LocalGraph,
  arriving: readonly VaultNote[],
): Address[] {
  const led = new Set<Address>();
  for (const note of arriving) {
    if (note.address !== undefined) led.add(note.address);
    for (const alias of note.aliases) led.add(alias);
  }
  const going = into
    .all()
    .flatMap((note) => [
      ...(note.address === undefined ? [] : [note.address]),
      ...note.aliases,
    ])
    .filter((address) => !led.has(address));
  return [...new Set([...into.retiredAddresses(), ...going])];
}

/** The graph's own files gone from a folder somebody keeps. What else is in it
 *  is theirs. */
async function emptyVault(files: Files): Promise<void> {
  for (const path of await files.list("")) {
    if (vaultOwned(path)) await files.remove(path);
  }
}

/** Where a section lands in a stack: right after the one named. */
function placeAfter(
  note: { sections: readonly { ulid: string }[] },
  after: OwnedRef,
  words: string,
): number {
  const at = note.sections.findIndex((one) => one.ulid === localOf(after));
  if (at < 0) throw refuse(words);
  return at + 1;
}

/** Every note file the vault holds, read with the sidecars beside it. */
function readNotes(vault: Vault, emoji: ReadonlyMap<string, EmojiDrawing>) {
  const notes = [];
  for (const [path, bytes] of vault) {
    if (noteAt(path) === undefined) continue;
    notes.push(vaultToNote({ markdown: decodeText(bytes), emoji }));
  }
  return notes;
}

/** The `:shortcode:`s a note's writing is written with. */
function shortcodesIn(
  sections: readonly { content: BlockDocument }[],
): Set<string> {
  const named = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const held of value) walk(held);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const held = value as { type?: unknown; attrs?: { name?: unknown } };
    if (held.type === "emoji" && typeof held.attrs?.name === "string") {
      named.add(held.attrs.name);
    }
    for (const inside of Object.values(value)) walk(inside);
  };
  walk(sections.map((section) => section.content));
  return named;
}

/** The graph's name and the day, so a folder of archives reads as a shelf. */
export function archiveName(name: string, at: Date = new Date()): string {
  const called = name
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${called === "" ? "graph" : called} ${at.toISOString().slice(0, 10)}.sloppy`;
}

/** What a person called the folder, which is what a graph in it is called
 *  until they say otherwise. */
function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? "My graph";
}

/** The graph file the vault holds, or absent where it holds none this build can
 *  read. */
function readGraph(vault: Vault): VaultGraph | undefined {
  const bytes = vault.get(GRAPH_FILE);
  try {
    return bytes && readGraphFile(bytes);
  } catch {
    return undefined;
  }
}

/** An archive nobody can read is refused in the words the reader gave. */
function readable<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    if (err instanceof VaultFormatError) {
      throw refuse(err.message || "This file isn't a Sloppy graph.");
    }
    throw err;
  }
}

function alreadyHere(count: number): Error {
  return refuse(
    count === 1
      ? "One of these notes is already in another of your graphs, so this cannot arrive as a graph of its own. Take that note out first, or import this somewhere else."
      : `${count} of these notes are already in another of your graphs, so this cannot arrive as a graph of its own. Take those notes out first, or import this somewhere else.`,
  );
}
