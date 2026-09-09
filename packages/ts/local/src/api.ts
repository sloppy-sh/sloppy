// The client a graph on this device is served through —
// docs/ARCHITECTURE.md § "Local-only mode".

import { notImplemented, type SloppyApi, serverOnly } from "@sloppy/client";
import type {
  Address,
  AnsweredNote,
  ArchivePreview,
  BlockView,
  CompleteUploadRequest,
  ConsentRedirect,
  Converses,
  CopyEmojiRequest,
  CreateBlockRequest,
  CreateEmojiRequest,
  CreateGraphRequest,
  CreateNodeRequest,
  CreateNoteCommentRequest,
  CreateNoteReactionRequest,
  CreatePublicationRequest,
  CreateUploadRequest,
  CustomEmoji,
  DeletedBranch,
  ExchangeSessionRequest,
  FollowRequest,
  FollowedIdentity,
  GraphExport,
  GraphView,
  HealthReport,
  MediaAsset,
  MediaLibraryRole,
  NodeBulkRequest,
  NodeBulkResult,
  NodeView,
  NoteComment,
  NoteDestination,
  NoteReaction,
  OwnInstance,
  OwnedMediaAsset,
  OwnedRef,
  PeerIdentity,
  ProfileView,
  PublicationView,
  PublishedChangesPage,
  PublishedIndex,
  PublishedSubtree,
  PublishedVersion,
  PublishedVersionsPage,
  PullView,
  PulledNoteHit,
  RefuseVoiceRequest,
  RefusedVoiceView,
  SearchHit,
  Session,
  StartLoginRequest,
  TagCount,
  UnpublishedChanges,
  UpdateBlockRequest,
  UpdateGraphRequest,
  UpdateNodeRequest,
  UpdatePublicationRequest,
  UpdateProfileRequest,
  UploadTicket,
  Viewer,
} from "@sloppy/types";
import type { Files } from "./files.js";

/**
 * `SloppyApi` over a folder on the device: the vault is the store, and nothing
 * here reaches a network.
 *
 * Two kinds of method sit below and they mean different things. One calls
 * `serverOnly`, which is the permanent answer — publishing, peers, pulls,
 * conversation, following and somebody else's identity all need a second
 * machine to exist, and a surface that offers them here has a bug. The other
 * calls `notImplemented`, which is this milestone's own boundary: the graph,
 * note, section, tag, search, media and emoji reads are what the local track is
 * landing, and the signature they will land behind is already the one a call
 * site compiles against.
 */
export class LocalApi implements SloppyApi {
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
   *  run, so this never answers `null` once a graph is open. */
  async me(): Promise<Viewer | null> {
    notImplemented("Reading who this device writes as");
  }

  // ── Graphs ───────────────────────────────────────────────────────────────

  async listGraphs(): Promise<GraphView[]> {
    notImplemented("Listing the graphs on this device");
  }

  async createGraph(_request: CreateGraphRequest): Promise<GraphView> {
    notImplemented("Starting a graph on this device");
  }

  async updateGraph(
    _ref: OwnedRef,
    _request: UpdateGraphRequest,
  ): Promise<GraphView> {
    notImplemented("Renaming a graph on this device");
  }

  async closeGraph(_ref: OwnedRef): Promise<void> {
    notImplemented("Closing a graph on this device");
  }

  // ── Nodes ────────────────────────────────────────────────────────────────

  async listNodes(
    _query: { origin?: OwnedRef; maxDepth?: number; graph?: OwnedRef } = {},
  ): Promise<NodeView[]> {
    notImplemented("Reading a graph on this device");
  }

  async getNode(_ref: OwnedRef): Promise<NodeView | null> {
    notImplemented("Opening a note on this device");
  }

  async createNode(_request: CreateNodeRequest): Promise<NodeView> {
    notImplemented("Writing a note on this device");
  }

  async updateNode(
    _ref: OwnedRef,
    _request: UpdateNodeRequest,
  ): Promise<NodeView> {
    notImplemented("Changing a note on this device");
  }

  async setAddress(
    _ref: OwnedRef,
    _address: Address | null,
  ): Promise<NodeView> {
    notImplemented("Changing a note's address on this device");
  }

  async moveNote(
    _ref: OwnedRef,
    _to: NoteDestination,
    _address?: Address,
  ): Promise<NodeView[]> {
    notImplemented("Moving a note on this device");
  }

  async deleteNode(_ref: OwnedRef): Promise<void> {
    notImplemented("Removing a note on this device");
  }

  async actOnNodes(_request: NodeBulkRequest): Promise<NodeBulkResult> {
    notImplemented("Acting on several notes on this device");
  }

  async deletedBranches(): Promise<DeletedBranch[]> {
    notImplemented("Reading the bin on this device");
  }

  async restoreBranch(_ref: OwnedRef): Promise<NodeView> {
    notImplemented("Putting a note back on this device");
  }

  async searchNotes(_q: string, _graph?: OwnedRef): Promise<SearchHit[]> {
    notImplemented("Searching a graph on this device");
  }

  async recentNotes(
    _query: { graph?: OwnedRef; limit?: number } = {},
  ): Promise<NodeView[]> {
    notImplemented("Reading what was written last on this device");
  }

  async listTags(_graph?: OwnedRef): Promise<TagCount[]> {
    notImplemented("Reading a graph's tags on this device");
  }

  // ── Blocks ───────────────────────────────────────────────────────────────

  async listBlocks(_node: OwnedRef): Promise<BlockView[]> {
    notImplemented("Reading a note's sections on this device");
  }

  async createBlock(_request: CreateBlockRequest): Promise<BlockView> {
    notImplemented("Adding a section on this device");
  }

  async updateBlock(
    _ref: OwnedRef,
    _request: UpdateBlockRequest,
  ): Promise<BlockView> {
    notImplemented("Writing a section on this device");
  }

  async deleteBlock(_ref: OwnedRef): Promise<void> {
    notImplemented("Removing a section on this device");
  }

  // ── Archives ─────────────────────────────────────────────────────────────

  async exportEverything(): Promise<GraphExport> {
    notImplemented("Taking everything on this device out as one file");
  }

  async exportArchive(
    _graph: OwnedRef,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    notImplemented("Taking a graph on this device out as a file");
  }

  async previewArchive(_archive: BodyInit): Promise<ArchivePreview> {
    notImplemented("Reading what a graph in a file holds on this device");
  }

  async importArchive(_archive: BodyInit): Promise<GraphView> {
    notImplemented("Bringing a graph into this device");
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

  async createUpload(_request: CreateUploadRequest): Promise<UploadTicket> {
    notImplemented("Adding a picture on this device");
  }

  async completeUpload(_request: CompleteUploadRequest): Promise<MediaAsset> {
    notImplemented("Adding a picture on this device");
  }

  async ownPictures(
    _role: MediaLibraryRole = "block",
  ): Promise<OwnedMediaAsset[]> {
    notImplemented("Reading the pictures on this device");
  }

  async removePicture(_uploadId: MediaAsset["upload_id"]): Promise<void> {
    notImplemented("Removing a picture on this device");
  }

  async ownPicture(
    _uploadId: MediaAsset["upload_id"],
  ): Promise<{ src: string; release: () => void }> {
    notImplemented("Opening a picture on this device");
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async profile(): Promise<ProfileView> {
    serverOnly("A profile");
  }

  async updateProfile(_request: UpdateProfileRequest): Promise<ProfileView> {
    serverOnly("A profile");
  }

  async profileOf(_did: string): Promise<ProfileView> {
    serverOnly("Somebody else's profile");
  }

  // ── Emoji ────────────────────────────────────────────────────────────────

  async ownEmoji(): Promise<CustomEmoji[]> {
    notImplemented("Reading the emoji on this device");
  }

  async addEmoji(_request: CreateEmojiRequest): Promise<CustomEmoji> {
    notImplemented("Adding an emoji on this device");
  }

  async removeEmoji(_emojiId: CustomEmoji["emoji_id"]): Promise<void> {
    notImplemented("Removing an emoji on this device");
  }

  async emojiOf(_did: string): Promise<CustomEmoji[]> {
    serverOnly("Somebody else's emoji");
  }

  async copyEmoji(_request: CopyEmojiRequest): Promise<CustomEmoji> {
    serverOnly("Somebody else's emoji");
  }
}
