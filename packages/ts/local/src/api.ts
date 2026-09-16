// The client a graph on this device is served through —
// docs/ARCHITECTURE.md § "Local-only mode".

import { type SloppyApi, serverOnly } from "@sloppy/client";
import { encodePublicKey, publicKeyFromDid } from "@sloppy/idp/crypto";
import {
  type Address,
  AddressSchema,
  type AmendmentView,
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
  type DocumentNode,
  type ExchangeSessionRequest,
  type FollowRequest,
  type FollowedIdentity,
  type GraphExport,
  type GraphView,
  type HealthReport,
  type ImportConflict,
  type ImportResolution,
  type ImportSettlement,
  ImportSettlementSchema,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_NOTES,
  MAX_RECENT_NOTES,
  type MediaAsset,
  type MediaLibraryRole,
  MediaRoleSchema,
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
  type ProposeAmendmentRequest,
  ProposeAmendmentRequestSchema,
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
  writeOutcome,
} from "@sloppy/types";
import {
  type EmojiDrawing,
  type NoteSource,
  type Vault,
  VAULT_FORMAT,
  GRAPH_FILE,
  PICTURES_FILE,
  amendmentAt,
  decodeText,
  emojiAt,
  inkAt,
  manifest,
  noteAt,
  graphFile,
  pack,
  readGraphFile,
  readPicturesFile,
  rekey,
  unpack,
  uploadAt,
  type VaultDifference,
  vaultDifference,
  type VaultGraph,
  type VaultNote,
  vaultToAmendment,
  vaultToNote,
  VaultFormatError,
} from "@sloppy/vault";
import { type Files, MemoryFiles } from "./files.js";
import {
  LocalGraph,
  localOf,
  picturesDrawnBy,
  type StoredAmendment,
  type StoredNote,
  type StoredPicture,
} from "./graph.js";
import {
  type LocalIdentity,
  openLocalIdentity,
  SEED_FILE,
} from "./identity.js";
import { lookWritten, NoteWriter, offerInstead } from "./notes.js";
import { absent, checked, contested, refuse } from "./refusal.js";
import { recent, search } from "./search.js";
import { type KnownVault, readVaults, writeVaults } from "./vaults.js";
import {
  carriedOut,
  EMOJI_FILE,
  extensionOf,
  MEDIA_FILE,
  mimeForExtension,
  vaultOwned,
} from "./vault-paths.js";

/** Whether a folder holds a graph. A shell asks this of a folder it wrote down
 *  before serving it, so that both sides read a folder that has been moved or
 *  emptied the same way. */
export function holdsAGraph(files: Files): Promise<boolean> {
  return files.exists(GRAPH_FILE);
}

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
  private readonly starting = new Map<string, Promise<LocalGraph>>();
  private readonly opened = new Map<string, LocalGraph>();
  /** One write at a time: an act reads where it is landing and then writes
   *  there, and two would each land where the other had already left. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly writingAs?: DidSyr;

  /**
   * `as` is whose graph this is reading, for a folder that is not this device's
   * own to write in; absent is the identity this device writes under.
   *
   * `writer` is which of the identities this device holds is doing the writing.
   * Absent is the graph's own owner, which is every device holding one
   * identity — docs/ARCHITECTURE.md § "A graph off the device".
   */
  constructor(
    readonly files: Files,
    options: { as?: LocalIdentity; writer?: DidSyr } = {},
  ) {
    this.identity = options.as;
    this.writingAs = options.writer;
  }

  /** Whose writing a note written here carries. */
  get writer(): Promise<DidSyr> {
    return this.writingAs !== undefined
      ? Promise.resolve(this.writingAs)
      : this.who().then((identity) => identity.did);
  }

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

  /** The graph in the folder this device has open, which is the one somebody
   *  writes in. A folder holding none has one started in it, exactly as reading
   *  it does. */
  async graphHere(): Promise<OwnedRef> {
    return (await this.graphAt()).ref;
  }

  /** A graph is a folder, so starting one asks for the folder to keep it in. */
  async createGraph(asked: CreateGraphRequest): Promise<GraphView> {
    const request = checked(() => CreateGraphRequestSchema.parse(asked));
    return this.write(async () => {
      const did = (await this.who()).did;
      const root = await this.files.pickFolder();
      if (root === undefined) throw refuse("No folder was chosen.");
      const known = await this.vaults();
      if (known.some((one) => one.root === root)) {
        throw refuse("There is already a graph in that folder.");
      }
      const graph = await LocalGraph.start(this.files.at(root), did, {
        format: VAULT_FORMAT,
        graph: ulid(),
        name: request.title,
        owner: did,
      });
      this.opened.set(root, graph);
      await this.rememberVault(root);
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
      if (request.ownership !== undefined) await graph.gate(request.ownership);
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
      this.starting.delete(root);
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
      new NoteWriter(
        await this.landingGraph(request.from),
        await this.writer,
      ).create(request),
    );
  }

  async updateNode(
    ref: OwnedRef,
    request: UpdateNodeRequest,
  ): Promise<NodeView> {
    return this.write(async () => {
      const graph = await this.holder(ref);
      const written = await new NoteWriter(graph, await this.writer).update(
        ref,
        request,
      );
      await this.carryPictures(graph, graph.find(ref));
      return written;
    });
  }

  async setAddress(ref: OwnedRef, address: Address | null): Promise<NodeView> {
    const label =
      address === null ? null : checked(() => AddressSchema.parse(address));
    return this.write(async () =>
      new NoteWriter(await this.holder(ref), await this.writer).setAddress(
        ref,
        label,
      ),
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
      new NoteWriter(await this.holder(ref), await this.writer).move(
        ref,
        destination,
        label,
      ),
    );
  }

  async deleteNode(ref: OwnedRef): Promise<void> {
    await this.write(async () => {
      const graph = await this.graphHolding(ref);
      if (graph) await new NoteWriter(graph, await this.writer).remove(ref);
    });
  }

  async actOnNodes(request: NodeBulkRequest): Promise<NodeBulkResult> {
    return this.write(async () => {
      const first = request.notes?.[0];
      const graph = first ? await this.holder(first) : await this.graphAt();
      const done = await new NoteWriter(graph, await this.writer).bulk(request);
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
      new NoteWriter(await this.holder(ref, true), await this.writer).restore(
        ref,
      ),
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
      const writing = await this.writing(graph, note);
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
      const sections = [...writing.sections];
      sections.splice(at, 0, section);
      const written = await graph.save({
        ...writing,
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
      const from = await this.writing(graph, held.note);
      const target = stays ? from : graph.find(into);
      if (!target) throw refuse("That note is not here.");
      const landing = stays ? target : await this.writing(graph, target);

      const left = held.note.sections.filter(
        (one) => one.ulid !== written.ulid,
      );
      const stack = stays ? left : [...landing.sections];
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
        await graph.save({ ...from, sections: left, updated_at: nowIso() });
      }
      const saved = await graph.save({
        ...landing,
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
      const writing = await this.writing(graph, held.note);
      await graph.save({
        ...writing,
        sections: writing.sections.filter((one) => one.ulid !== localOf(ref)),
        updated_at: nowIso(),
      });
    });
  }

  // ── Offered changes ──────────────────────────────────────────────────────

  /** What has been offered on one note, oldest offer first. Whoever the note's
   *  writing lands for reads every offer on it; anybody else reads the one they
   *  made. */
  async listAmendments(note: OwnedRef): Promise<AmendmentView[]> {
    const graph = await this.graphHolding(note);
    const held = graph?.find(note);
    if (!graph || !held) return [];
    const writer = await this.writer;
    const settles = writeOutcome(held, writer) === "lands";
    return graph
      .offersOn(note)
      .filter((offer) => settles || offer.by === writer)
      .map((offer) => graph.offerView(offer));
  }

  /** A change offered on a note somebody else writes, or the offer already
   *  standing there written again. */
  async proposeAmendment(
    asked: ProposeAmendmentRequest,
  ): Promise<AmendmentView> {
    const request = checked(() => ProposeAmendmentRequestSchema.parse(asked));
    return this.write(async () => {
      const graph = await this.holder(request.note);
      const note = graph.find(request.note);
      if (!note) throw absent("That note is not here.");
      const writer = await this.writer;
      if (writeOutcome(note, writer) === "lands") {
        throw refuse(
          "You can write in this note. Change it rather than offering a change.",
        );
      }
      const look =
        request.appearance === undefined
          ? undefined
          : lookWritten(request.appearance);
      const standing = graph.offerBy(request.note, writer);
      const offer = await graph.saveOffer({
        ulid: standing?.ulid ?? ulid(),
        amends: request.note,
        by: writer,
        at: nowIso(),
        ...(request.message === undefined ? {} : { message: request.message }),
        title: request.title,
        tags: [...request.tags],
        ...(look === undefined ? {} : { appearance: look }),
        sections: request.blocks.map((block) => ({
          ulid: localOf(block.ref),
          content: block.content,
        })),
      });
      return graph.offerView(offer);
    });
  }

  async withdrawAmendment(ref: OwnedRef): Promise<void> {
    await this.write(async () => {
      const { graph, offer } = await this.offerAt(ref);
      if (offer.by !== (await this.writer)) {
        throw refuse(
          "Only the person who offered this change can take it back.",
        );
      }
      await graph.dropOffer(offer);
    });
  }

  /** The note's writing becomes the offer's, whole, and the person who offered
   *  it joins its contributors. Whose writing the note carries is untouched. */
  async approveAmendment(ref: OwnedRef): Promise<NodeView> {
    return this.write(async () => {
      const { graph, offer } = await this.offerAt(ref);
      const note = graph.find(offer.amends);
      if (!note) throw absent("That note is not here.");
      await this.settling(note);
      const at = nowIso();
      const written = await graph.save({
        ...note,
        title: offer.title,
        tags: [...offer.tags],
        ...(offer.appearance === undefined
          ? {}
          : { appearance: offer.appearance }),
        contributors: [...new Set([...(note.contributors ?? []), offer.by])],
        sections: offer.sections.map((section) => {
          const had = note.sections.find((one) => one.ulid === section.ulid);
          return {
            ...section,
            created_at: had?.created_at ?? at,
            updated_at: at,
          };
        }),
        updated_at: at,
      });
      await graph.dropOffer(offer);
      await this.carryPictures(graph, written);
      return graph.view(written);
    });
  }

  async declineAmendment(ref: OwnedRef): Promise<void> {
    await this.write(async () => {
      const { graph, offer } = await this.offerAt(ref);
      const note = graph.find(offer.amends);
      if (note) await this.settling(note);
      await graph.dropOffer(offer);
    });
  }

  private async offerAt(
    ref: OwnedRef,
  ): Promise<{ graph: LocalGraph; offer: StoredAmendment }> {
    for (const graph of await this.allGraphs()) {
      const offer = graph.offer(ref);
      if (offer) return { graph, offer };
    }
    throw absent("That change is not here.");
  }

  /** Whoever the note's writing lands for is who takes in what is offered on
   *  it and who turns it down. */
  private async settling(note: StoredNote): Promise<void> {
    if (writeOutcome(note, await this.writer) === "offered") {
      throw refuse("This change is for the person who writes that note.");
    }
  }

  /** The note as a landed write leaves it, refused where its writing is
   *  somebody else's to take in — `NoteWriter` holds the same rule. */
  private async writing(
    graph: LocalGraph,
    note: StoredNote,
  ): Promise<StoredNote> {
    const writer = await this.writer;
    if (writeOutcome(note, writer) === "offered") throw offerInstead(note);
    return graph.authored(note, writer);
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
    return {
      bytes: pack(await this.vaultHere(ref)),
      filename: archiveName(graph.title),
    };
  }

  /** The graph in the folder as it stands, as a state to read beside the ones
   *  a history kept. What is in the bin is not in it, and is in no kept state
   *  either. */
  async vaultHere(ref?: OwnedRef): Promise<Vault> {
    return this.vaultOf(await this.graphAt(ref));
  }

  private async vaultOf(graph: LocalGraph): Promise<Vault> {
    const vault: Vault = new Map();
    for (const [path, bytes] of await graph.carry()) {
      if (carriedOut(path)) vault.set(path, bytes);
    }
    return vault;
  }

  async previewArchive(archive: BodyInit): Promise<ArchivePreview> {
    const opened = await this.openArchive(archive);
    const held = await this.holdingAny(
      opened.notes.map((note) => note.ref),
      opened.into,
    );
    const merge = opened.into
      ? await this.merging(opened.into, opened.vault)
      : undefined;
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
      replaces: false,
      replacing: 0,
      merges: merge !== undefined,
      conflicts: merge?.conflicts ?? [],
    };
  }

  /**
   * A graph brought in as a folder of its own, under this device's identity. A
   * copy of one this device already keeps is settled into it note by note
   * instead — docs/ARCHITECTURE.md § "A graph on disk". `settle` is what the
   * person chose where the two copies disagree.
   */
  async importArchive(
    archive: BodyInit,
    settle?: ImportSettlement,
  ): Promise<GraphView> {
    const chosen = checked(() =>
      ImportSettlementSchema.parse(settle ?? {}),
    ).resolutions;
    const opened = await this.openArchive(archive);
    return this.write(async () => {
      const held = await this.holdingAny(
        opened.notes.map((note) => note.ref),
        opened.into,
      );
      if (held.length > 0) throw alreadyHere(held.length);
      return opened.into
        ? this.settleInto(opened.into, opened.vault, chosen)
        : this.arriveOnItsOwn(opened.vault);
    });
  }

  /** A graph this device does not keep, put in a folder of its own. */
  private async arriveOnItsOwn(vault: Vault): Promise<GraphView> {
    const root = await this.files.pickFolder();
    if (root === undefined) throw refuse("No folder was chosen.");
    if ((await this.vaults()).some((one) => one.root === root)) {
      throw refuse("There is already a graph in that folder.");
    }
    const files = this.files.at(root);
    for (const [path, bytes] of vault) await files.write(path, bytes);
    const graph = await LocalGraph.open(files, (await this.who()).did);
    this.opened.set(root, graph);
    await this.rememberVault(root);
    return this.graphView(graph);
  }

  /**
   * The two copies of one graph settled into the folder: what only the file
   * holds arrives, what only the folder holds stays, and what they say
   * differently about one note is settled as the person chose. Nothing is
   * written over, so no number either copy has spent comes free.
   */
  private async settleInto(
    into: LocalGraph,
    vault: Vault,
    settle: readonly ImportResolution[],
  ): Promise<GraphView> {
    const merge = await this.merging(into, vault);
    const chosen = new Map(settle.map((one) => [settling(one), one]));
    const unsettled = merge.conflicts.filter(
      (one) => !chosen.has(settling(one)),
    );
    if (unsettled.length > 0) throw stillContested(unsettled.length);

    await this.carryEmoji(into, vault);
    await this.carryArrivingPictures(into, vault, merge.theirs);
    const arriving = notesIn(
      vault,
      new Map(into.ownEmoji().map((one) => [one.shortcode, { src: one.src }])),
    );
    const contested = new Set(
      merge.conflicts.flatMap((one) =>
        one.address === undefined ? [] : [one.address],
      ),
    );
    for (const [ref, theirs] of arriving) {
      const how =
        chosen.get(settling({ kind: "note", ref })) ??
        chosen.get(settling({ kind: "section", ref }));
      const mine = into.find(ref);
      if (mine && !how) continue;
      const gone = into.findDeleted(ref);
      if (gone) await into.restore(gone);
      const note =
        mine && how ? settled(asVaultNote(mine), theirs, how) : theirs;
      await into.save(
        stored(asNumberedHere(note, into, contested), into.held(ref)),
      );
    }
    for (const conflict of merge.conflicts) {
      await this.settleAddress(into, conflict, chosen.get(settling(conflict)));
    }
    await this.carryArrivingOffers(into, vault);
    return this.reopened(into);
  }

  /** The number goes to the note the person chose, and the note that loses it
   *  keeps leading by it — AI.md § "The Genealogy Is the Protocol". */
  private async settleAddress(
    into: LocalGraph,
    conflict: ImportConflict,
    how: ImportResolution | undefined,
  ): Promise<void> {
    const { address, other } = conflict;
    if (conflict.kind !== "address" || !address || !other) return;
    const said = how?.numbered;
    const keeps =
      said === conflict.ref || said === other
        ? said
        : how?.keep === "theirs"
          ? other
          : conflict.ref;
    const loser = into.held(keeps === conflict.ref ? other : conflict.ref);
    if (loser?.address === address) {
      const { address: _spent, ...rest } = loser;
      await into.save({
        ...rest,
        aliases: loser.aliases.includes(address)
          ? [...loser.aliases]
          : [...loser.aliases, address],
      });
    }
    const winner = into.held(keeps);
    if (winner && winner.address !== address) {
      await into.save({
        ...winner,
        address,
        aliases: winner.aliases.filter((one) => one !== address),
      });
    }
  }

  /** The folder read again, so what the settled graph answers is what its files
   *  say. */
  private async reopened(into: LocalGraph): Promise<GraphView> {
    const root = this.rootOf(into);
    this.starting.delete(root);
    const graph = await LocalGraph.open(into.files, (await this.who()).did);
    this.opened.set(root, graph);
    return this.graphView(graph);
  }

  /**
   * What the folder's copy of a graph and the file's copy of it disagree about,
   * note by note and section by section. `vaultDifference` in `@sloppy/vault`
   * is what enumerates it; a note whose tags, links or look alone differ is not
   * in that enumeration and is a disagreement all the same.
   */
  private async merging(into: LocalGraph, vault: Vault): Promise<Merging> {
    const here = await this.vaultOf(into);
    const difference = vaultDifference(here, vault);
    const mine = notesIn(here, new Map());
    const theirs = notesIn(vault, new Map());
    const sections = new Map(
      difference.notes.changed.map((one) => [one.ref, one.sections.changed]),
    );
    const differing = new Set<OwnedRef>([
      ...difference.notes.moved.map((one) => one.ref),
      ...difference.notes.retitled.map((one) => one.ref),
      ...difference.notes.renumbered.map((one) => one.ref),
      ...difference.notes.changed.map((one) => one.ref),
    ]);
    for (const [ref, was] of mine) {
      const now = theirs.get(ref);
      if (now && !alike(was, now)) differing.add(ref);
    }
    const conflicts: ImportConflict[] = [];
    for (const ref of [...differing].sort()) {
      const changed = sections.get(ref) ?? [];
      const was = mine.get(ref);
      const now = theirs.get(ref);
      conflicts.push({
        kind: changed.length > 0 ? "section" : "note",
        ref,
        sections: changed.map((section) => ({
          section,
          mine: sectionWords(was, section),
          theirs: sectionWords(now, section),
        })),
        mine: asWords(was, mine, now),
        theirs: asWords(now, theirs, was),
      });
    }
    const at = numbered(theirs);
    for (const [address, ref] of numbered(mine)) {
      const other = at.get(address);
      if (other === undefined || other === ref) continue;
      conflicts.push({
        kind: "address",
        ref,
        other,
        address,
        sections: [],
        mine: asWords(mine.get(ref), mine),
        theirs: asWords(theirs.get(other), theirs),
      });
    }
    return { theirs, conflicts };
  }

  /**
   * The offers standing in the file that this graph holds none of. One it
   * already has stays as it is, and so does the one standing from the same
   * person on the same note: an import writes nothing over.
   */
  private async carryArrivingOffers(
    into: LocalGraph,
    vault: Vault,
  ): Promise<void> {
    const drawings = new Map(
      into.ownEmoji().map((one) => [one.shortcode, { src: one.src }]),
    );
    for (const offer of readOffers(vault, drawings)) {
      if (into.offer(`${into.did}/${offer.ulid}`)) continue;
      if (!into.find(offer.amends)) continue;
      if (into.offerBy(offer.amends, offer.by)) continue;
      await into.saveOffer(offer);
    }
  }

  /** The emoji the file was written with that this graph has no picture for,
   *  put into it so an arriving note draws them. */
  private async carryEmoji(into: LocalGraph, vault: Vault): Promise<void> {
    const here = new Set(into.ownEmoji().map((one) => one.shortcode));
    const said = readSaid(vault.get(EMOJI_FILE));
    for (const [path, bytes] of vault) {
      const shortcode = emojiAt(path);
      if (shortcode === undefined || here.has(shortcode)) continue;
      const mimeType = mimeForExtension(extensionOf(path));
      if (mimeType === undefined) continue;
      const picture = await into.putPicture(
        {
          role: "emoji",
          filename: path.slice(path.lastIndexOf("/") + 1),
          mime_type: mimeType,
        },
        bytes,
      );
      await into.addEmoji(
        shortcode,
        said[shortcode]?.kind === "sticker" ? "sticker" : "emoji",
        picture.upload_id,
      );
      await into.removePicture(picture.upload_id);
      here.add(shortcode);
    }
  }

  /** The pictures the file's notes draw that this graph does not hold yet. */
  private async carryArrivingPictures(
    into: LocalGraph,
    vault: Vault,
    theirs: ReadonlyMap<OwnedRef, VaultNote>,
  ): Promise<void> {
    const drawn = new Set<string>();
    for (const note of theirs.values()) {
      for (const upload of picturesDrawnBy(note)) drawn.add(upload);
    }
    const said = readSaid(vault.get(MEDIA_FILE));
    for (const [path, bytes] of vault) {
      const upload = uploadAt(path);
      if (upload === undefined || !drawn.has(upload)) continue;
      if (into.picturePath(upload)) continue;
      await into.keepPicture(upload, asPicture(said[upload], path), bytes);
    }
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

  /** Write a folder down, against the list as it stands rather than one read
   *  before an await: a read that starts a graph writes this list too, and it
   *  does not wait for the writing queue. */
  private async rememberVault(root: string): Promise<void> {
    const known = await this.vaults();
    if (known.some((one) => one.root === root)) return;
    const at = nowIso();
    await this.remember([...known, { root, created_at: at, updated_at: at }]);
  }

  /** Every graph this device keeps: the folders it has written down, and the
   *  folder it has open, which holds a graph whether or not it has been written
   *  down yet. One that cannot be opened is left out here and said where
   *  somebody writes, so the graphs beside it still read. */
  private async allGraphs(): Promise<LocalGraph[]> {
    const graphs = await this.writtenDownGraphs();
    const open = this.files.root;
    if (!open) return graphs;
    const here = await this.graphInTheOpenFolder(open).catch(() => undefined);
    return here && !graphs.includes(here) ? [...graphs, here] : graphs;
  }

  /** The graphs in the folders this device wrote down, in the order it opened
   *  them. A folder that is no longer a vault is left out rather than refused:
   *  somebody moved it, and the graphs beside it still open. */
  private async writtenDownGraphs(): Promise<LocalGraph[]> {
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

  /** The graph named; otherwise the one in the folder this device has open,
   *  and where it has none, the one it started with. */
  private async graphAt(ref?: OwnedRef): Promise<LocalGraph> {
    const open = this.files.root;
    if (ref === undefined && open) return this.graphInTheOpenFolder(open);
    const graphs = await this.allGraphs();
    if (graphs.length === 0) {
      throw absent("There is no graph on this device yet. Start one to write.");
    }
    if (ref === undefined) return graphs[0];
    const found = graphs.find((graph) => graph.ref === ref);
    if (!found) throw absent("That graph is not on this device.");
    return found;
  }

  /**
   * The graph in the folder a shell opened: opening a folder is how somebody
   * says a graph is in it, so one that holds a graph is read and one that does
   * not becomes it. The name is the folder's, which is what they called the
   * place; it is renamed like any other. A folder this device wrote a graph
   * into and that now holds none has been moved or emptied, and is said rather
   * than started over.
   *
   * Held as the promise rather than the graph, one per folder, so two reads
   * landing together start one graph between them and a second folder opened in
   * the same session still starts.
   */
  private graphInTheOpenFolder(root: string): Promise<LocalGraph> {
    let opening = this.starting.get(root);
    if (opening) return opening;
    opening = (async () => {
      const already = this.opened.get(root);
      if (already) return already;
      const did = (await this.who()).did;
      const at = this.files.at(root);
      const written = (await this.vaults()).some((one) => one.root === root);
      const holds = await holdsAGraph(at);
      if (!holds && written) {
        throw absent(
          "The folder your notes are in is not there any more. Open it again, or choose another folder.",
        );
      }
      const graph = holds
        ? await LocalGraph.open(at, did)
        : await LocalGraph.start(at, did, {
            format: VAULT_FORMAT,
            graph: ulid(),
            name: folderName(root),
            owner: did,
          });
      this.opened.set(root, graph);
      if (!written) await this.rememberVault(root);
      return graph;
    })();
    this.starting.set(root, opening);
    return opening;
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
    const root = this.rootOf(graph);
    const written = this.known ?? [];
    const known = written.find((one) => one.root === root);
    const at = known?.created_at ?? nowIso();
    return {
      ref: graph.ref,
      created_by: graph.did,
      title: graph.title,
      ...(graph.ownership === undefined ? {} : { ownership: graph.ownership }),
      // The folder this device opened first is the one it started with.
      ...(written[0]?.root === root ? { home: true } : {}),
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
    // Whose it is now is whoever imported it, so somebody else's name does not
    // come with their graph; a person's own archive still carries theirs back.
    // What the graph gates its notes by is the graph's and rides in either way.
    const carried = readGraph(vault);
    const owned = said.owner === did ? carried : undefined;
    vault.set(
      GRAPH_FILE,
      graphFile({
        format: VAULT_FORMAT,
        graph: said.graph,
        name: said.name,
        owner: did,
        ...(carried?.ownership === undefined
          ? {}
          : { ownership: carried.ownership }),
        ...(owned?.owner_name === undefined
          ? {}
          : { owner_name: owned.owner_name }),
        ...(owned?.owner_avatar === undefined
          ? {}
          : { owner_avatar: owned.owner_avatar }),
      }),
    );
    const into = (await this.allGraphs()).find(
      (graph) => graph.ref === `${did}/${said.graph}`,
    );
    return { said, vault, notes, missing: [...missing], into };
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
  /** The graph on this device this archive is a copy of, absent where it opens
   *  one of its own. */
  into?: LocalGraph;
}

/** The file's copy of one graph, and what it and the folder's copy say
 *  differently. */
interface Merging {
  theirs: Map<OwnedRef, VaultNote>;
  conflicts: ImportConflict[];
}

/** A conflict and the choice made about it stand for the same note, which is
 *  what pairs them. */
function settling(one: {
  kind: ImportConflict["kind"];
  ref: OwnedRef;
}): string {
  return `${one.kind}:${one.ref}`;
}

/**
 * The note the two copies both hold, as the person settled it: the side they
 * kept, with each section they took from the other in its place.
 *
 * Both sides are copies of one graph, so a number the side they left leads by
 * is a number this graph has spent on this note, and the note keeps leading by
 * it — AI.md § "The Genealogy Is the Protocol".
 */
function settled(
  mine: VaultNote,
  theirs: VaultNote,
  how: ImportResolution,
): VaultNote {
  const base = how.keep === "theirs" ? theirs : mine;
  const other = how.keep === "theirs" ? mine : theirs;
  const taking = new Map(how.sections.map((one) => [one.section, one.keep]));
  const led = [
    ...base.aliases,
    ...other.aliases,
    ...(other.address === undefined ? [] : [other.address]),
  ];
  return {
    ...base,
    aliases: [...new Set(led)].filter((one) => one !== base.address),
    sections: base.sections.map((section) => {
      if ((taking.get(section.ulid) ?? how.keep) === how.keep) return section;
      return other.sections.find((one) => one.ulid === section.ulid) ?? section;
    }),
  };
}

/**
 * The note as it arrives, keeping its number only where this graph leads by it
 * to this same note: one another note was carried away from is that note's alone
 * to take back, and so is one this graph retired when it purged this note — AI.md
 * § "The Genealogy Is the Protocol". A number two notes carry is in `contested`,
 * and is the person's to settle instead.
 */
function asNumberedHere(
  note: VaultNote,
  into: LocalGraph,
  contested: ReadonlySet<Address>,
): VaultNote {
  const address = note.address;
  if (address === undefined || contested.has(address)) return note;
  const led = into.leadsTo(address);
  if (led === undefined || led.note === note.ref || led.purged === note.ref) {
    return note;
  }
  const { address: _theirs, ...rest } = note;
  return rest;
}

/** A note this graph holds, back as the file that carries it. */
function asVaultNote(note: StoredNote): VaultNote {
  const {
    ulid: _named,
    created_at,
    updated_at,
    deleted_at: _gone,
    ...rest
  } = note;
  return { ...rest, created: created_at, updated: updated_at };
}

/** A note as this graph holds it. The stamps are the file's, and the ones the
 *  graph already had where the file says nothing. */
function stored(note: VaultNote, held: StoredNote | undefined): StoredNote {
  const created = note.created ?? held?.created_at ?? nowIso();
  const updated = note.updated ?? held?.updated_at ?? created;
  const { sections, ...rest } = note;
  return {
    ...rest,
    ulid: localOf(note.ref),
    created_at: created,
    updated_at: updated,
    sections: sections.map((section) => ({
      ...section,
      created_at: created,
      updated_at: updated,
    })),
  };
}

/** Whether the two copies say the same about a note in the ways an enumerated
 *  difference does not name. */
function alike(a: VaultNote, b: VaultNote): boolean {
  return (
    JSON.stringify([a.tags, a.links, a.aliases, a.appearance ?? null]) ===
    JSON.stringify([b.tags, b.links, b.aliases, b.appearance ?? null])
  );
}

/** Which note each number is on, leaving out the notes that carry none. */
function numbered(
  notes: ReadonlyMap<OwnedRef, VaultNote>,
): Map<Address, OwnedRef> {
  const at = new Map<Address, OwnedRef>();
  for (const [ref, note] of notes) {
    if (note.address !== undefined && !at.has(note.address)) {
      at.set(note.address, ref);
    }
  }
  return at;
}

/** What one side holds, as words a person settles a disagreement by: where the
 *  two sides put the note differently, then what it is called, what it is
 *  tagged, and its writing. */
function asWords(
  note: VaultNote | undefined,
  held: ReadonlyMap<OwnedRef, VaultNote>,
  other?: VaultNote,
): string {
  if (!note) return "";
  return [
    ...whereItSits(note, other, held),
    note.title,
    note.tags.join(", "),
    ...note.sections.flatMap((one) => wordsIn(one.content)),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Where a side puts the note, said only where the other side puts it
 *  somewhere else: a renumber or a move is otherwise two identical texts to
 *  choose between. */
function whereItSits(
  note: VaultNote,
  other: VaultNote | undefined,
  held: ReadonlyMap<OwnedRef, VaultNote>,
): string[] {
  if (!other) return [];
  const said: string[] = [];
  if (note.address !== other.address) {
    said.push(
      note.address === undefined ? "No number" : `Numbered ${note.address}`,
    );
  }
  if (note.parent !== other.parent) said.push(under(note, held));
  return said;
}

/** The note this one springs from, as a person knows it. */
function under(
  note: VaultNote,
  held: ReadonlyMap<OwnedRef, VaultNote>,
): string {
  if (note.parent === undefined) {
    return note.address === undefined ? "On its own" : "A branch";
  }
  const parent = held.get(note.parent);
  const title = parent?.title.trim();
  if (title) return `Under “${title}”`;
  return parent?.address === undefined
    ? "Under another note"
    : `Under ${parent.address}`;
}

/** The same for one section of it, which is what a person chooses between
 *  where both sides wrote into the same note. */
function sectionWords(note: VaultNote | undefined, section: string): string {
  const held = note?.sections.find((one) => one.ulid === section);
  return held ? wordsIn(held.content).join("\n") : "";
}

/** An element that carries no words of its own, in the fewest that say what it
 *  is. One this build has never heard of is left out rather than named
 *  wrongly. */
const CALLED: Partial<Record<string, string>> = {
  picture: "A picture",
  ink: "A drawing",
  math: "A formula",
  mathBlock: "A formula",
  diagram: "A diagram",
};

/** One line per element of a section, in the order they are written. */
function wordsIn(content: BlockDocument): string[] {
  const written: string[] = [];
  const walk = (nodes: readonly DocumentNode[]): void => {
    for (const node of nodes) {
      if ((node.content ?? []).some((child) => child.content !== undefined)) {
        walk(node.content ?? []);
        continue;
      }
      const one = words(node).trim() || CALLED[node.type] || "";
      if (one !== "") written.push(one);
    }
  };
  walk(content.content ?? []);
  return written;
}

function words(node: DocumentNode): string {
  const label = node.attrs?.label;
  if (node.type === "reference") return typeof label === "string" ? label : "";
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(words).join("");
}

function readJson(
  bytes: Uint8Array | undefined,
): Record<string, unknown> | undefined {
  if (!bytes) return undefined;
  try {
    const held = JSON.parse(decodeText(bytes)) as unknown;
    return held && typeof held === "object" && !Array.isArray(held)
      ? (held as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The `.sloppy/` file that says what the names beside it stand for. One
 *  nobody can read leaves each file to say what it can for itself. */
function readSaid(
  bytes: Uint8Array | undefined,
): Record<string, Record<string, unknown> | undefined> {
  const said: Record<string, Record<string, unknown> | undefined> = {};
  for (const [key, value] of Object.entries(readJson(bytes) ?? {})) {
    if (value && typeof value === "object") {
      said[key] = value as Record<string, unknown>;
    }
  }
  return said;
}

/** A picture arriving, as this device will hold it: what the file it came in
 *  said, and what its own name says where that file said nothing. */
function asPicture(
  said: Record<string, unknown> | undefined,
  path: string,
): StoredPicture {
  const width = said?.width;
  const height = said?.height;
  return {
    role: MediaRoleSchema.safeParse(said?.role).data ?? "block",
    filename:
      typeof said?.filename === "string"
        ? said.filename
        : path.slice(path.lastIndexOf("/") + 1),
    mime_type:
      typeof said?.mime_type === "string"
        ? said.mime_type
        : (mimeForExtension(extensionOf(path)) ?? "application/octet-stream"),
    ...(typeof width === "number" ? { width } : {}),
    ...(typeof height === "number" ? { height } : {}),
  };
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

/** The drawings and the picture sizes a vault's own files draw on, which a note
 *  and an offered change in it are both read against. */
function sidecarsIn(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing>,
): Omit<NoteSource, "markdown"> {
  const ink = new Map<string, Record<string, unknown>>();
  for (const [path, bytes] of vault) {
    const stem = inkAt(path);
    if (stem === undefined || !path.endsWith(".ink.json")) continue;
    const attrs = readJson(bytes);
    if (attrs) ink.set(stem, attrs);
  }
  const sizes = vault.get(PICTURES_FILE);
  return {
    ink,
    pictures: sizes ? readPicturesFile(sizes) : new Map(),
    emoji,
  };
}

/** Every note file the vault holds, read with the sidecars beside it. */
function readNotes(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing>,
): VaultNote[] {
  const sidecars = sidecarsIn(vault, emoji);
  const notes: VaultNote[] = [];
  for (const [path, bytes] of vault) {
    if (noteAt(path) === undefined) continue;
    notes.push(vaultToNote({ ...sidecars, markdown: decodeText(bytes) }));
  }
  return notes;
}

/** Every offered change the vault holds, read the same way. A file that is not
 *  one is left where it is rather than refused. */
function readOffers(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing>,
): StoredAmendment[] {
  const sidecars = sidecarsIn(vault, emoji);
  const offers: StoredAmendment[] = [];
  for (const [path, bytes] of vault) {
    const ulid = amendmentAt(path);
    if (ulid === undefined) continue;
    try {
      const said = vaultToAmendment({
        ...sidecars,
        markdown: decodeText(bytes),
      });
      offers.push({ ...said, ulid, at: said.at ?? nowIso() });
    } catch {}
  }
  return offers;
}

/** The same, keyed by the ref that identifies each note. */
function notesIn(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing>,
): Map<OwnedRef, VaultNote> {
  const held = new Map<OwnedRef, VaultNote>();
  for (const note of readNotes(vault, emoji)) held.set(note.ref, note);
  return held;
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

/** An import of a copy of this graph, held until the person has said what each
 *  note they disagree about says. */
function stillContested(count: number): Error {
  return refuse(
    count === 1
      ? "Your copy of this graph and the one in the file disagree about one note. Choose what to keep, then bring it in again."
      : `Your copy of this graph and the one in the file disagree about ${count} notes. Choose what to keep for each, then bring it in again.`,
  );
}

function alreadyHere(count: number): Error {
  return refuse(
    count === 1
      ? "One of these notes is already in another of your graphs, so this cannot arrive as a graph of its own. Take that note out first, or import this somewhere else."
      : `${count} of these notes are already in another of your graphs, so this cannot arrive as a graph of its own. Take those notes out first, or import this somewhere else.`,
  );
}

/** Where a state the history kept is laid out to be read: nowhere on a disk, so
 *  reading one touches no folder anybody writes in. */
const STATE_ROOT = "/state";

/**
 * `SloppyApi` over a state of a graph rather than over the folder itself: it
 * reads exactly as the folder does and takes nothing. Every act that would
 * change a note is refused in words — docs/ARCHITECTURE.md § "The vault's
 * history".
 */
export class GraphAsItWas extends LocalApi {
  private refused(): never {
    throw refuse(
      "This is your graph as it was. Open it as it is now to write in it.",
    );
  }

  async createGraph(_asked: CreateGraphRequest): Promise<GraphView> {
    this.refused();
  }

  async updateGraph(
    _ref: OwnedRef,
    _asked: UpdateGraphRequest,
  ): Promise<GraphView> {
    this.refused();
  }

  async closeGraph(_ref: OwnedRef): Promise<void> {
    this.refused();
  }

  async createNode(_asked: CreateNodeRequest): Promise<NodeView> {
    this.refused();
  }

  async updateNode(
    _ref: OwnedRef,
    _asked: UpdateNodeRequest,
  ): Promise<NodeView> {
    this.refused();
  }

  async setAddress(
    _ref: OwnedRef,
    _address: Address | null,
  ): Promise<NodeView> {
    this.refused();
  }

  async moveNote(
    _ref: OwnedRef,
    _to: NoteDestination,
    _address?: Address,
  ): Promise<NodeView[]> {
    this.refused();
  }

  async deleteNode(_ref: OwnedRef): Promise<void> {
    this.refused();
  }

  async actOnNodes(_request: NodeBulkRequest): Promise<NodeBulkResult> {
    this.refused();
  }

  async restoreBranch(_ref: OwnedRef): Promise<NodeView> {
    this.refused();
  }

  async createBlock(_asked: CreateBlockRequest): Promise<BlockView> {
    this.refused();
  }

  async updateBlock(
    _ref: OwnedRef,
    _asked: UpdateBlockRequest,
  ): Promise<BlockView> {
    this.refused();
  }

  async deleteBlock(_ref: OwnedRef): Promise<void> {
    this.refused();
  }

  async importArchive(_archive: BodyInit): Promise<GraphView> {
    this.refused();
  }

  async proposeAmendment(
    _request: ProposeAmendmentRequest,
  ): Promise<AmendmentView> {
    this.refused();
  }

  async withdrawAmendment(_ref: OwnedRef): Promise<void> {
    this.refused();
  }

  async approveAmendment(_ref: OwnedRef): Promise<NodeView> {
    this.refused();
  }

  async declineAmendment(_ref: OwnedRef): Promise<void> {
    this.refused();
  }

  async createUpload(_asked: CreateUploadRequest): Promise<UploadTicket> {
    this.refused();
  }

  async sendUpload(_ticket: UploadTicket, _file: Blob): Promise<void> {
    this.refused();
  }

  async completeUpload(_asked: CompleteUploadRequest): Promise<MediaAsset> {
    this.refused();
  }

  async removePicture(_uploadId: MediaAsset["upload_id"]): Promise<void> {
    this.refused();
  }

  async updateProfile(_asked: UpdateProfileRequest): Promise<ProfileView> {
    this.refused();
  }

  async addEmoji(_asked: CreateEmojiRequest): Promise<CustomEmoji> {
    this.refused();
  }

  async removeEmoji(_emojiId: CustomEmoji["emoji_id"]): Promise<void> {
    this.refused();
  }
}

/**
 * The graph a state of the folder held, ready to read on the canvas and in the
 * outline. It is read under the identity the graph itself says it belongs to,
 * so nothing this device keeps about itself is wanted to open one.
 */
export async function graphAsItWas(vault: Vault): Promise<GraphAsItWas> {
  const said = readGraph(vault);
  if (!said) {
    throw absent("Your graph was not in this folder yet at that point.");
  }
  const files = new MemoryFiles({ root: STATE_ROOT });
  for (const [path, bytes] of vault) await files.write(path, bytes);
  return new GraphAsItWas(files, {
    as: {
      did: said.owner,
      public_key: encodePublicKey(publicKeyFromDid(said.owner)),
      seed: SEED_FILE,
    },
  });
}

/**
 * The graph in the folder as it stands, for a page that reaches the folder only
 * through whatever is serving the graph out of it. `graph` absent is the one in
 * the folder that is open.
 */
export async function graphAsItIs(
  api: SloppyApi,
  graph?: OwnedRef,
): Promise<Vault> {
  const serving = api as Partial<LocalApi>;
  if (typeof serving.vaultHere !== "function") {
    throw absent("The graph in front of you is not one this device keeps.");
  }
  return serving.vaultHere(graph);
}

/** One section of a note as two states have it, each as the editor's own
 *  document. Absent on a side is a state that has no such section at all. */
export interface SectionBesideSection {
  ulid: string;
  before?: BlockDocument;
  after?: BlockDocument;
}

/**
 * A note something happened to between two states, with what to call it and
 * what changed inside it. The title and the address are the later state's where
 * it has the note and the earlier one's where it does not.
 */
export interface NoteChangedBetween {
  ref: OwnedRef;
  title: string;
  address?: Address;
  became: "added" | "removed" | "kept";
  /** Absent on a side is no parent at all — a branch, or a note on its own. */
  moved?: { from?: OwnedRef; to?: OwnedRef };
  retitled?: { from: string; to: string };
  renumbered?: { from?: Address; to?: Address };
  /** Only the sections the two states do not hold alike, in the order they
   *  stand in the note — the later state's order, then whatever only the
   *  earlier one has. */
  sections: SectionBesideSection[];
  /** The sections both states hold, standing in another order. */
  reordered: boolean;
}

/** What a person did between two states of a graph, as a surface says it. */
export interface ChangedBetween {
  notes: NoteChangedBetween[];
  pictures: { added: number; removed: number };
}

/**
 * What changed between two states of a graph, note by note and section by
 * section, in the words each side had. `vaultDifference` in `@sloppy/vault` is
 * what enumerates it; this is that enumeration with the notes' own words beside
 * it.
 *
 * A drawing's own attributes are not read: a difference is read as words and
 * as what each element is, and nothing that reads this draws one.
 */
export function changedBetween(before: Vault, after: Vault): ChangedBetween {
  const difference = vaultDifference(before, after);
  const was = notesIn(before, new Map());
  const now = notesIn(after, new Map());
  const notes = new Map<OwnedRef, NoteChangedBetween>();
  const of = (ref: OwnedRef, became: NoteChangedBetween["became"]) => {
    const held = notes.get(ref);
    if (held) return held;
    const note = now.get(ref) ?? was.get(ref);
    const fresh: NoteChangedBetween = {
      ref,
      title: note?.title ?? "",
      ...(note?.address === undefined ? {} : { address: note.address }),
      became,
      sections: [],
      reordered: false,
    };
    notes.set(ref, fresh);
    return fresh;
  };
  for (const ref of difference.notes.added) of(ref, "added");
  for (const ref of difference.notes.removed) of(ref, "removed");
  for (const held of difference.notes.moved) {
    of(held.ref, "kept").moved = {
      ...(held.from === undefined ? {} : { from: held.from }),
      ...(held.to === undefined ? {} : { to: held.to }),
    };
  }
  for (const held of difference.notes.retitled) {
    of(held.ref, "kept").retitled = { from: held.from, to: held.to };
  }
  for (const held of difference.notes.renumbered) {
    of(held.ref, "kept").renumbered = {
      ...(held.from === undefined ? {} : { from: held.from }),
      ...(held.to === undefined ? {} : { to: held.to }),
    };
  }
  for (const held of difference.notes.changed) {
    const note = of(held.ref, "kept");
    note.reordered = held.sections.reordered;
    note.sections = sectionsBeside(
      held.sections,
      was.get(held.ref),
      now.get(held.ref),
    );
  }
  return {
    notes: [...notes.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
    pictures: {
      added: difference.media.added.length,
      removed: difference.media.removed.length,
    },
  };
}

function sectionsBeside(
  changed: VaultDifference["notes"]["changed"][number]["sections"],
  was: VaultNote | undefined,
  now: VaultNote | undefined,
): SectionBesideSection[] {
  const said = (note: VaultNote | undefined, ulid: string) =>
    note?.sections.find((one) => one.ulid === ulid)?.content;
  const left = new Set([
    ...changed.added,
    ...changed.removed,
    ...changed.changed,
  ]);
  const standing: string[] = [];
  for (const note of [now, was]) {
    for (const one of note?.sections ?? []) {
      if (left.delete(one.ulid)) standing.push(one.ulid);
    }
  }
  return [...standing, ...[...left].sort()].map((ulid) => {
    const before = said(was, ulid);
    const after = said(now, ulid);
    return {
      ulid,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    };
  });
}
