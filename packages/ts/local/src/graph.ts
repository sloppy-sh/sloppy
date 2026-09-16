// One vault, opened: the index a graph on this device is read out of, and the
// writes that keep it and the folder in step.
//
// docs/ARCHITECTURE.md § "Local-only mode" and § "A graph on disk" are the docs
// of record. Every address rule here is a function from `@sloppy/types`, the
// same ones the server runs.

import {
  type Address,
  type BlockDocument,
  type BlockView,
  type CustomEmoji,
  type CustomEmojiKind,
  type DidSyr,
  type DeletedBranch,
  DELETED_KEPT_FOR_DAYS,
  type GraphOwnership,
  type MediaAsset,
  type MediaRole,
  type NodeAppearance,
  type NodeView,
  type OwnedMediaAsset,
  type OwnedRef,
  type Timestamp,
  UNNAMED_GRAPH_ULID,
  citedNotes,
  nowIso,
  orderSiblings,
  resolveAppearance,
  ulid,
} from "@sloppy/types";
import {
  type EmojiDrawing,
  type PictureSize,
  type VaultGraph,
  type VaultNote,
  type VaultSection,
  PICTURES_FILE,
  decodeText,
  emojiAt,
  emojiPath,
  encodeText,
  GRAPH_FILE,
  graphFile,
  inkAt,
  inkPath,
  inkImagePath,
  mediaPath,
  noteAt,
  notePath,
  picturesFile,
  readGraphFile,
  readPicturesFile,
  uploadAt,
  noteToVault,
  vaultToNote,
} from "@sloppy/vault";
import type { Files } from "./files.js";
import { absent, refuse } from "./refusal.js";
import {
  BIN_FILE,
  EMOJI_FILE,
  MEDIA_FILE,
  binAt,
  binPath,
  extensionFor,
  extensionOf,
  mimeForExtension,
  vaultOwned,
} from "./vault-paths.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One section as this graph holds it. A section written since the folder was
 *  read carries its own stamps; the rest carry the note's, which is all the
 *  file says. */
export interface StoredSection extends VaultSection {
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** A note as this graph holds it: what the file says, plus when it went where a
 *  person has thrown it away. */
export interface StoredNote extends Omit<VaultNote, "sections"> {
  ulid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Absent is a note that is there. */
  deleted_at?: Timestamp;
  sections: StoredSection[];
}

/** A picture in this vault, as `.sloppy/media.json` remembers it. Only the
 *  uploader can measure one, so an absent side is one nobody measured. */
export interface StoredPicture {
  role: MediaRole;
  filename: string;
  mime_type: string;
  width?: number;
  height?: number;
}

/** An address this graph spent on a note that has since been purged. It is
 *  never assigned to a second note, and the note that spent it is the only one
 *  that may take it back — AI.md § "The Genealogy Is the Protocol". */
interface RetiredAddress {
  address: Address;
  /** Absent in a bin written before this was kept, which is an address
   *  refused to everyone. */
  note?: OwnedRef;
}

/** What the bin holds, alongside the note files in it. */
interface BinFile {
  deleted: Record<string, Timestamp>;
  retired: RetiredAddress[];
}

/** How a graph holds one address — `LocalGraph.leadsTo`. */
export interface AddressHold {
  hold: "live" | "deleted" | "moved";
  note?: OwnedRef;
  purged?: OwnedRef;
}

/** Where a note sits, walked from the parent chain rather than from its
 *  address — a note nobody numbered is carried like any other. */
interface Place {
  depth: number;
  origin: OwnedRef;
}

export class LocalGraph {
  private readonly notes = new Map<OwnedRef, StoredNote>();
  private readonly pictures = new Map<string, PictureSize>();
  private readonly media = new Map<string, StoredPicture>();
  private readonly emoji = new Map<string, CustomEmojiKind>();
  private readonly emojiExtension = new Map<string, string>();
  private readonly ink = new Map<string, Record<string, unknown>>();
  private retired: RetiredAddress[] = [];
  private places: Map<OwnedRef, Place> | null = null;

  private constructor(
    readonly files: Files,
    readonly did: DidSyr,
    private said: VaultGraph,
  ) {}

  /**
   * The graph the folder holds, with its index built. Throws where the folder
   * is not a vault this build can read.
   *
   * A folder still spelling the ulid every first graph once shared is given one
   * of its own here, so an archive of it settles into itself rather than into
   * somebody else's first graph — docs/ARCHITECTURE.md § "A graph on disk".
   */
  static async open(files: Files, did: DidSyr): Promise<LocalGraph> {
    const bytes = await files.read(GRAPH_FILE);
    if (!bytes) throw absent("There is no graph in that folder.");
    const said = readGraphFile(bytes);
    const own =
      said.graph === UNNAMED_GRAPH_ULID ? { ...said, graph: ulid() } : said;
    if (own !== said) await files.write(GRAPH_FILE, graphFile(own));
    const graph = new LocalGraph(files, did, own);
    await graph.build();
    return graph;
  }

  /** A folder made into a vault, with nothing in it yet. */
  static async start(
    files: Files,
    did: DidSyr,
    said: VaultGraph,
  ): Promise<LocalGraph> {
    await files.write(GRAPH_FILE, graphFile(said));
    const graph = new LocalGraph(files, did, said);
    await graph.build();
    return graph;
  }

  get ref(): OwnedRef {
    return `${this.did}/${this.said.graph}`;
  }

  get title(): string {
    return this.said.name;
  }

  async rename(title: string): Promise<void> {
    this.said = { ...this.said, name: title };
    await this.files.write(GRAPH_FILE, graphFile(this.said));
  }

  get ownership(): GraphOwnership | undefined {
    return this.said.ownership;
  }

  async gate(ownership: GraphOwnership): Promise<void> {
    this.said = { ...this.said, ownership };
    await this.files.write(GRAPH_FILE, graphFile(this.said));
  }

  /** What this vault says about whose it is, beyond the DID: what the owner is
   *  called, and where their picture is in this folder. */
  get owner(): { name?: string; avatar?: string } {
    return {
      ...(this.said.owner_name === undefined
        ? {}
        : { name: this.said.owner_name }),
      ...(this.said.owner_avatar === undefined
        ? {}
        : { avatar: this.said.owner_avatar }),
    };
  }

  /** The whole block, so a name or a picture taken off is left out of the
   *  file. */
  async setOwner(said: { name?: string; avatar?: string }): Promise<void> {
    const { owner_name: _was, owner_avatar: _wore, ...rest } = this.said;
    this.said = {
      ...rest,
      ...(said.name === undefined ? {} : { owner_name: said.name }),
      ...(said.avatar === undefined ? {} : { owner_avatar: said.avatar }),
    };
    await this.files.write(GRAPH_FILE, graphFile(this.said));
  }

  // ── The index ────────────────────────────────────────────────────────────

  /** Only the files the index is read out of are read: a picture's bytes stay
   *  on the disk, so opening a graph costs what its writing weighs and never
   *  what its pictures do. */
  private async build(): Promise<void> {
    const paths = (await this.files.list("")).filter(vaultOwned);
    for (const path of paths) {
      const stem = inkAt(path);
      if (stem === undefined || !path.endsWith(".ink.json")) continue;
      const bytes = await this.files.read(path);
      const attrs = bytes ? readJson(bytes) : undefined;
      if (attrs) this.ink.set(stem, attrs);
    }
    const sizes = await this.files.read(PICTURES_FILE);
    if (sizes) {
      for (const [upload, size] of readPicturesFile(sizes)) {
        this.pictures.set(upload, size);
      }
    }
    this.readMedia(paths, await this.files.read(MEDIA_FILE));
    this.readEmoji(paths, await this.files.read(EMOJI_FILE));

    const bin = readBin(await this.files.read(BIN_FILE));
    this.retired = bin.retired;
    for (const path of paths) {
      const there = noteAt(path);
      const gone = binAt(path);
      if (there === undefined && gone === undefined) continue;
      const bytes = await this.files.read(path);
      const note = bytes && this.readNote(bytes);
      if (!note) continue;
      if (gone !== undefined) {
        note.deleted_at = bin.deleted[gone] ?? note.updated_at;
      }
      this.notes.set(note.ref, note);
    }
  }

  private readMedia(
    paths: readonly string[],
    file: Uint8Array | undefined,
  ): void {
    const said = readRecord(file);
    for (const path of paths) {
      const upload = uploadAt(path);
      if (upload === undefined) continue;
      const wrote = said[upload] as Partial<StoredPicture> | undefined;
      this.media.set(upload, {
        role: (wrote?.role as MediaRole) ?? "block",
        filename: wrote?.filename ?? path.slice(path.lastIndexOf("/") + 1),
        mime_type:
          wrote?.mime_type ??
          mimeForExtension(extensionOf(path)) ??
          "application/octet-stream",
        ...(typeof wrote?.width === "number" ? { width: wrote.width } : {}),
        ...(typeof wrote?.height === "number" ? { height: wrote.height } : {}),
      });
    }
  }

  private readEmoji(
    paths: readonly string[],
    file: Uint8Array | undefined,
  ): void {
    const said = readRecord(file);
    for (const path of paths) {
      const shortcode = emojiAt(path);
      if (shortcode === undefined) continue;
      const wrote = said[shortcode];
      this.emoji.set(
        shortcode,
        wrote?.kind === "sticker" ? "sticker" : "emoji",
      );
      this.emojiExtension.set(shortcode, extensionOf(path));
    }
  }

  private readNote(bytes: Uint8Array): StoredNote | undefined {
    let read: VaultNote;
    try {
      read = vaultToNote({
        markdown: decodeText(bytes),
        ink: this.ink,
        pictures: this.pictures,
        emoji: this.drawings(),
      });
    } catch {
      // A file in `notes/` that is not a note is somebody else's file in a
      // folder that is theirs; it costs the graph nothing to leave it alone.
      return undefined;
    }
    const created = read.created ?? nowIso();
    const updated = read.updated ?? created;
    const { sections, ...rest } = read;
    return {
      ...rest,
      ulid: localOf(read.ref),
      created_at: created,
      updated_at: updated,
      sections: sections.map((section) => ({
        ...section,
        created_at: created,
        updated_at: updated,
      })),
    };
  }

  /** How each shortcode this graph knows draws, which is what makes
   *  `:shortcode:` render off the folder rather than off a server. */
  private drawings(): Map<string, EmojiDrawing> {
    const drawn = new Map<string, EmojiDrawing>();
    for (const shortcode of this.emoji.keys()) {
      drawn.set(shortcode, { src: this.files.url(this.emojiFile(shortcode)) });
    }
    return drawn;
  }

  private emojiFile(shortcode: string): string {
    return emojiPath(shortcode, this.emojiExtension.get(shortcode));
  }

  // ── Reading notes ────────────────────────────────────────────────────────

  /** Every note that is there, in no particular order. */
  live(): StoredNote[] {
    return [...this.notes.values()].filter(
      (note) => note.deleted_at === undefined,
    );
  }

  /** Every note this graph holds, the ones in the bin among them. */
  all(): StoredNote[] {
    return [...this.notes.values()];
  }

  /** Every note in the bin, whether or not it can still be put back. */
  binned(): StoredNote[] {
    return [...this.notes.values()].filter(
      (note) => note.deleted_at !== undefined,
    );
  }

  find(ref: OwnedRef): StoredNote | undefined {
    const held = this.notes.get(ref);
    return held?.deleted_at === undefined ? held : undefined;
  }

  findDeleted(ref: OwnedRef): StoredNote | undefined {
    const held = this.notes.get(ref);
    return held?.deleted_at === undefined ? undefined : held;
  }

  /** The note at this ref, deleted or not — what a move carries and what a
   *  parent chain is walked through. */
  held(ref: OwnedRef): StoredNote | undefined {
    return this.notes.get(ref);
  }

  placeOf(note: StoredNote): Place {
    return this.allPlaces().get(note.ref) ?? { depth: 1, origin: note.ref };
  }

  private allPlaces(): Map<OwnedRef, Place> {
    if (this.places) return this.places;
    const places = new Map<OwnedRef, Place>();
    const settle = (
      note: StoredNote,
      walking: ReadonlySet<OwnedRef>,
    ): Place => {
      const already = places.get(note.ref);
      if (already) return already;
      const up =
        note.parent === undefined || walking.has(note.parent)
          ? undefined
          : this.notes.get(note.parent);
      const above = up
        ? settle(up, new Set([...walking, note.ref]))
        : undefined;
      const place: Place = above
        ? { depth: above.depth + 1, origin: above.origin }
        : { depth: 1, origin: note.ref };
      places.set(note.ref, place);
      return place;
    };
    for (const note of this.notes.values()) settle(note, new Set([note.ref]));
    this.places = places;
    return places;
  }

  /** One note as every surface reads it. A graph on this device publishes
   *  nothing, so nothing here is published. */
  view(note: StoredNote): NodeView {
    const place = this.placeOf(note);
    return {
      ref: note.ref,
      created_by: this.did,
      graph: this.ref,
      ...(note.address === undefined ? {} : { address: note.address }),
      ...(note.aliases.length > 0 ? { aliases: [...note.aliases] } : {}),
      depth: place.depth,
      ...(note.parent === undefined ? {} : { parent: note.parent }),
      origin: place.origin,
      title: note.title,
      tags: [...note.tags],
      links: [...note.links],
      references: referencesOf(note),
      ...(note.owner === undefined ? {} : { owner: note.owner }),
      ...(note.authors === undefined ? {} : { authors: [...note.authors] }),
      ...(note.contributors === undefined
        ? {}
        : { contributors: [...note.contributors] }),
      published: false,
      ...(note.appearance === undefined ? {} : { appearance: note.appearance }),
      ...(note.deleted_at === undefined ? {} : { deleted_at: note.deleted_at }),
      created_at: note.created_at,
      updated_at: note.updated_at,
    };
  }

  blockViews(note: StoredNote): BlockView[] {
    return note.sections.map((section, at) => ({
      ref: `${this.did}/${section.ulid}`,
      created_by: this.did,
      node: note.ref,
      ord: ordAt(at),
      content: section.content,
      created_at: section.created_at,
      updated_at: section.updated_at,
    }));
  }

  /** The note a section is in, and where in its stack it sits. */
  sectionAt(ref: OwnedRef): { note: StoredNote; at: number } | undefined {
    const id = localOf(ref);
    for (const note of this.notes.values()) {
      const at = note.sections.findIndex((section) => section.ulid === id);
      if (at >= 0) return { note, at };
    }
    return undefined;
  }

  // ── Addresses ────────────────────────────────────────────────────────────

  /**
   * The run a note written under `parent` joins, as `nextChildAddress` reads
   * one. The addresses of notes that are gone are in it, and so are the ones a
   * move left behind and the ones a purge retired: an address is assigned once
   * in a graph and never again. Which of those belong to another run is
   * `nextChildAddress`'s own answer.
   */
  runUnder(parent: StoredNote | null): Address[] {
    const run: Address[] = [];
    for (const note of this.notes.values()) {
      if ((note.parent ?? null) !== (parent?.ref ?? null)) continue;
      if (note.address !== undefined) run.push(note.address);
    }
    return [
      ...run,
      ...this.retired.map((one) => one.address),
      ...this.aliases().keys(),
    ];
  }

  /** Each address a note was carried away from, and the note it still leads
   *  to. */
  aliases(): Map<Address, OwnedRef> {
    const led = new Map<Address, OwnedRef>();
    for (const note of this.notes.values()) {
      for (const alias of note.aliases) {
        if (!led.has(alias)) led.set(alias, note.ref);
      }
    }
    return led;
  }

  /**
   * How this graph holds an address, and which note it leads to — absent where
   * it has never assigned it.
   *
   * `note` is one the graph still holds. `purged` is the note a retired address
   * was spent on: it is gone from here, and it alone may take that address
   * back.
   */
  leadsTo(address: Address): AddressHold | undefined {
    for (const note of this.notes.values()) {
      if (note.address !== address) continue;
      return {
        hold: note.deleted_at === undefined ? "live" : "deleted",
        note: note.ref,
      };
    }
    const led = this.aliases().get(address);
    if (led !== undefined) return { hold: "moved", note: led };
    const retired = this.retired.find((one) => one.address === address);
    if (retired === undefined) return undefined;
    return {
      hold: "deleted",
      ...(retired.note === undefined ? {} : { purged: retired.note }),
    };
  }

  spent(addresses: Iterable<Address>): Set<Address> {
    const led = this.aliases();
    const found = new Set<Address>();
    for (const address of addresses) {
      const at = [...this.notes.values()].some(
        (note) => note.address === address,
      );
      if (at || this.isRetired(address) || led.has(address)) {
        found.add(address);
      }
    }
    return found;
  }

  /** Of the addresses these notes are leaving, the ones theirs to keep leading
   *  by: where the graph already leads back by one, it leads to the note that
   *  left it first and that note keeps it. */
  keptBehind(leaving: readonly Address[]): Address[] {
    const led = this.aliases();
    const keeping = new Set<Address>();
    for (const address of leaving) {
      if (led.has(address) || keeping.has(address)) continue;
      keeping.add(address);
    }
    return [...keeping];
  }

  // ── Writing notes ────────────────────────────────────────────────────────

  /** The note as it now stands, in the index and in the folder. */
  async save(note: StoredNote): Promise<StoredNote> {
    this.notes.set(note.ref, note);
    this.places = null;
    await this.writeNote(note);
    return note;
  }

  async saveAll(notes: readonly StoredNote[]): Promise<void> {
    for (const note of notes) await this.save(note);
  }

  /** A note and everything that sprang from it, thrown away. Their files move
   *  into the bin, where putting one back moves it out again. */
  async bin(going: readonly StoredNote[], at: Timestamp): Promise<void> {
    for (const note of going) {
      await this.files.remove(notePath(note.ulid));
      const gone = { ...note, deleted_at: at };
      this.notes.set(gone.ref, gone);
      await this.writeNote(gone);
    }
    this.places = null;
    await this.writeBin();
  }

  /** One out of the bin, back where it was. */
  async restore(note: StoredNote): Promise<StoredNote> {
    await this.files.remove(binPath(note.ulid));
    const { deleted_at: _gone, ...back } = note;
    this.notes.set(back.ref, back);
    this.places = null;
    await this.writeNote(back);
    await this.writeBin();
    return back;
  }

  /**
   * Notes nobody can put back any more, gone for good. Their addresses retire
   * rather than coming free, and the aliases that led to them go with them —
   * except a number another note is at, there or in the bin, which is that
   * note's and stays its own to take back. AI.md § "The Genealogy Is the
   * Protocol".
   */
  async purge(going: readonly StoredNote[]): Promise<void> {
    if (going.length === 0) return;
    const leaving = new Set(going.map((note) => note.ref));
    const stillAt = new Set(
      [...this.notes.values()].flatMap((note) =>
        note.address !== undefined && !leaving.has(note.ref)
          ? [note.address]
          : [],
      ),
    );
    for (const note of going) {
      await this.files.remove(binPath(note.ulid));
      for (const stem of this.inkOf(note)) {
        await this.files.remove(inkPath(stem));
        await this.files.remove(inkImagePath(stem));
        this.ink.delete(stem);
      }
      for (const address of [
        ...(note.address === undefined ? [] : [note.address]),
        ...note.aliases,
      ]) {
        if (stillAt.has(address) || this.isRetired(address)) continue;
        this.retired.push({ address, note: note.ref });
      }
      this.notes.delete(note.ref);
    }
    this.places = null;
    await this.writeBin();
  }

  private isRetired(address: Address): boolean {
    return this.retired.some((one) => one.address === address);
  }

  /** Everything thrown away longer ago than it can be put back. */
  async sweep(now: number = Date.now()): Promise<void> {
    const closed = new Date(now - DELETED_KEPT_FOR_DAYS * DAY_MS).toISOString();
    await this.purge(
      this.binned().filter(
        (note) => note.deleted_at !== undefined && note.deleted_at < closed,
      ),
    );
  }

  /** The branches a person can still put back, newest first. One whose parent
   *  is also in the bin waits its turn, so putting one back never leaves a note
   *  hanging under nothing. */
  deletedBranches(): DeletedBranch[] {
    const gone = this.binned();
    const away = new Set(gone.map((note) => note.ref));
    const springsFrom = (root: OwnedRef, note: StoredNote): boolean => {
      const seen = new Set<OwnedRef>();
      for (let walk: StoredNote | undefined = note; walk !== undefined; ) {
        if (walk.ref === root) return true;
        if (seen.has(walk.ref)) return false;
        seen.add(walk.ref);
        walk =
          walk.parent === undefined ? undefined : this.notes.get(walk.parent);
      }
      return false;
    };
    const branches = gone.flatMap((root) => {
      const at = root.deleted_at;
      if (at === undefined) return [];
      if (root.parent !== undefined && away.has(root.parent)) return [];
      return [
        {
          ref: root.ref,
          ...(root.address === undefined ? {} : { address: root.address }),
          graph: this.ref,
          title: root.title,
          deleted_at: at,
          created_at: root.created_at,
          notes: gone.filter(
            (note) => note.deleted_at === at && springsFrom(root.ref, note),
          ).length,
        },
      ];
    });
    return orderSiblings(branches)
      .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
      .map(({ created_at: _written, ...branch }) => branch);
  }

  private async writeNote(note: StoredNote): Promise<void> {
    const written = noteToVault(
      this.view(note),
      note.aliases,
      this.blockViews(note),
      {
        media: this.mediaPaths(),
        pictures: this.pictures,
        emoji: this.drawings(),
      },
    );
    const before = this.inkOf(note);
    const from = notePath(note.ulid);
    const into = note.deleted_at === undefined ? from : binPath(note.ulid);
    for (const [path, bytes] of written.files) {
      await this.files.write(path === from ? into : path, bytes);
    }
    for (const stem of before) {
      if (written.files.has(inkPath(stem))) continue;
      await this.files.remove(inkPath(stem));
      await this.files.remove(inkImagePath(stem));
    }
    for (const [upload, size] of written.pictures) {
      this.pictures.set(upload, size);
    }
    if (this.pictures.size > 0) {
      await this.files.write(PICTURES_FILE, picturesFile(this.pictures));
    }
  }

  /** The drawings this note's sections have files for. Named from the section,
   *  so one note's are never another's. */
  private inkOf(note: StoredNote): string[] {
    const sections = new Set(note.sections.map((section) => section.ulid));
    return [...this.ink.keys()].filter((stem) =>
      sections.has(stem.slice(0, stem.lastIndexOf("-"))),
    );
  }

  private async writeBin(): Promise<void> {
    const deleted: Record<string, Timestamp> = {};
    for (const note of this.binned()) {
      if (note.deleted_at !== undefined) deleted[note.ulid] = note.deleted_at;
    }
    const held: BinFile = {
      deleted,
      retired: [...this.retired].sort((a, b) =>
        a.address < b.address ? -1 : 1,
      ),
    };
    await this.files.write(BIN_FILE, writeJson(held));
  }

  // ── Pictures ─────────────────────────────────────────────────────────────

  private mediaPaths(): Map<string, string> {
    const paths = new Map<string, string>();
    for (const [upload, held] of this.media) {
      paths.set(upload, mediaPath(upload, extensionFor(held.mime_type)));
    }
    return paths;
  }

  /** What a picture this graph knows is, or absent where it does not know
   *  one. */
  pictureOf(upload: string): StoredPicture | undefined {
    return this.media.get(upload);
  }

  /** Whether a note here draws this picture — in its writing or on its mark. */
  draws(upload: string): boolean {
    return this.all().some((note) => picturesDrawnBy(note).has(upload));
  }

  /** Where the bytes of a picture this graph knows sit, or absent where it does
   *  not know one. */
  picturePath(upload: string): string | undefined {
    const held = this.media.get(upload);
    return held === undefined
      ? undefined
      : mediaPath(upload, extensionFor(held.mime_type));
  }

  /**
   * A picture about to arrive: its name in this vault, and where its bytes go.
   * The bytes are written to that path — by whoever is holding them — and
   * {@link completePicture} is what says they are there.
   */
  addPicture(said: {
    role: MediaRole;
    filename: string;
    mime_type: string;
    width?: number;
    height?: number;
  }): { upload: string; path: string } {
    const upload = ulid();
    this.media.set(upload, {
      role: said.role,
      filename: said.filename,
      mime_type: said.mime_type,
      ...(said.width === undefined ? {} : { width: said.width }),
      ...(said.height === undefined ? {} : { height: said.height }),
    });
    return { upload, path: mediaPath(upload, extensionFor(said.mime_type)) };
  }

  async completePicture(upload: string): Promise<MediaAsset> {
    const held = this.media.get(upload);
    const path = this.picturePath(upload);
    if (!held || !path) throw absent("That picture is not here.");
    const bytes = await this.files.read(path);
    if (!bytes) {
      this.media.delete(upload);
      throw refuse("That picture could not be added. Try again.");
    }
    await this.writeMedia();
    return this.assetOf(upload, held, bytes.byteLength);
  }

  /** A picture under the id it is already known by, put into this vault as it
   *  stands. Answers where its bytes now are. */
  async keepPicture(
    upload: string,
    said: StoredPicture,
    bytes: Uint8Array,
  ): Promise<string> {
    this.media.set(upload, { ...said });
    const path = mediaPath(upload, extensionFor(said.mime_type));
    await this.files.write(path, bytes);
    await this.writeMedia();
    return path;
  }

  /** The picture's bytes put straight into the vault, for a caller that already
   *  has them — an archive arriving, or an emoji taking its own copy. */
  async putPicture(
    said: { role: MediaRole; filename: string; mime_type: string },
    bytes: Uint8Array,
  ): Promise<MediaAsset> {
    const { upload, path } = this.addPicture(said);
    await this.files.write(path, bytes);
    return this.completePicture(upload);
  }

  /** The pictures added for one surface, newest first — a ULID sorts by the
   *  moment it was drawn. */
  async listPictures(role: MediaRole): Promise<OwnedMediaAsset[]> {
    const listed: OwnedMediaAsset[] = [];
    for (const upload of [...this.media.keys()].sort().reverse()) {
      const held = this.media.get(upload);
      if (!held || held.role !== role) continue;
      const path = this.picturePath(upload);
      const bytes = path ? await this.files.read(path) : undefined;
      if (!bytes) continue;
      listed.push({
        ...this.assetOf(upload, held, bytes.byteLength),
        filename: held.filename,
      });
    }
    return listed;
  }

  async removePicture(upload: string): Promise<void> {
    const path = this.picturePath(upload);
    if (path) await this.files.remove(path);
    this.media.delete(upload);
    this.pictures.delete(upload);
    await this.writeMedia();
  }

  private assetOf(
    upload: string,
    held: StoredPicture,
    size: number,
  ): MediaAsset {
    return {
      upload_id: upload,
      mime_type: held.mime_type,
      size,
      ...(held.width === undefined ? {} : { width: held.width }),
      ...(held.height === undefined ? {} : { height: held.height }),
    };
  }

  private async writeMedia(): Promise<void> {
    const said: Record<string, StoredPicture> = {};
    for (const [upload, held] of this.media) said[upload] = held;
    await this.files.write(MEDIA_FILE, writeJson(said));
  }

  // ── Emoji ────────────────────────────────────────────────────────────────

  ownEmoji(): CustomEmoji[] {
    return [...this.emoji].map(([shortcode, kind]) => ({
      emoji_id: shortcode,
      did: this.did,
      shortcode,
      kind,
      src: this.files.url(this.emojiFile(shortcode)),
    }));
  }

  async addEmoji(
    shortcode: string,
    kind: CustomEmojiKind,
    upload: string,
  ): Promise<CustomEmoji> {
    const path = this.picturePath(upload);
    const bytes = path ? await this.files.read(path) : undefined;
    if (!bytes) throw refuse("That picture is not here. Add it again.");
    if (this.emoji.has(shortcode)) {
      throw refuse(`You already have an emoji called ${shortcode}.`);
    }
    const extension = extensionOf(path ?? "");
    this.emojiExtension.set(shortcode, extension);
    this.emoji.set(shortcode, kind);
    await this.files.write(emojiPath(shortcode, extension), bytes);
    await this.writeEmoji();
    return {
      emoji_id: shortcode,
      did: this.did,
      shortcode,
      kind,
      src: this.files.url(this.emojiFile(shortcode)),
    };
  }

  async removeEmoji(shortcode: string): Promise<void> {
    if (!this.emoji.has(shortcode)) return;
    await this.files.remove(this.emojiFile(shortcode));
    this.emoji.delete(shortcode);
    this.emojiExtension.delete(shortcode);
    await this.writeEmoji();
  }

  private async writeEmoji(): Promise<void> {
    const said: Record<string, { kind: CustomEmojiKind }> = {};
    for (const [shortcode, kind] of this.emoji) said[shortcode] = { kind };
    await this.files.write(EMOJI_FILE, writeJson(said));
  }

  // ── The folder ───────────────────────────────────────────────────────────

  /** Every file this vault wrote. Anything else in the folder is the person's
   *  own — a README, the history git keeps — and is neither read nor carried. */
  async carry(): Promise<Map<string, Uint8Array>> {
    const held = new Map<string, Uint8Array>();
    for (const path of await this.files.list("")) {
      if (!vaultOwned(path)) continue;
      const bytes = await this.files.read(path);
      if (bytes) held.set(path, bytes);
    }
    return held;
  }
}

/** Every picture a note draws: the ones in its writing, and the ones its mark
 *  wears. A vault holds the pictures its own notes draw. */
export function picturesDrawnBy(note: {
  sections: readonly { content: BlockDocument }[];
  appearance?: NodeAppearance;
}): Set<string> {
  const drawn = new Set(resolveAppearance(note.appearance).preview.pictures);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const held of value) walk(held);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const held = value as { type?: unknown; attrs?: { upload_id?: unknown } };
    if (held.type === "picture" && typeof held.attrs?.upload_id === "string") {
      drawn.add(held.attrs.upload_id);
    }
    for (const inside of Object.values(value)) walk(inside);
  };
  walk(note.sections.map((section) => section.content));
  return drawn;
}

/** The notes this one's own writing names, derived from its sections. The note
 *  itself is left out: a line from a mark back to itself says nothing. */
export function referencesOf(note: {
  ref: OwnedRef;
  sections: readonly { content: BlockDocument }[];
}): OwnedRef[] {
  const named = new Set<OwnedRef>();
  for (const section of note.sections) {
    for (const cited of citedNotes(section.content)) {
      if (cited !== note.ref) named.add(cited);
    }
  }
  return [...named];
}

/** A section's place in its note's stack, as a `BlockView` carries it. The
 *  stack's order is the order of the note's file, so this is read off that
 *  rather than kept beside it. */
export function ordAt(at: number): string {
  return String(at).padStart(8, "0");
}

export function localOf(ref: OwnedRef): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function readJson(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const held = JSON.parse(decodeText(bytes)) as unknown;
    return held && typeof held === "object"
      ? (held as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readRecord(
  bytes: Uint8Array | undefined,
): Record<string, Record<string, unknown> | undefined> {
  const held = bytes ? readJson(bytes) : undefined;
  const said: Record<string, Record<string, unknown> | undefined> = {};
  for (const [key, value] of Object.entries(held ?? {})) {
    if (value && typeof value === "object") {
      said[key] = value as Record<string, unknown>;
    }
  }
  return said;
}

function readBin(bytes: Uint8Array | undefined): BinFile {
  const held = bytes ? readJson(bytes) : undefined;
  const deleted: Record<string, Timestamp> = {};
  for (const [ulid, at] of Object.entries(held?.deleted ?? {})) {
    if (typeof at === "string") deleted[ulid] = at;
  }
  const retired = Array.isArray(held?.retired)
    ? (held.retired as unknown[]).flatMap((one) => asRetired(one) ?? [])
    : [];
  return { deleted, retired };
}

/** A retired address as the bin file has it — a bare address in one written
 *  before the note that spent it was kept beside it. */
function asRetired(held: unknown): RetiredAddress | undefined {
  if (typeof held === "string") return { address: held as Address };
  if (!held || typeof held !== "object") return undefined;
  const { address, note } = held as Record<string, unknown>;
  if (typeof address !== "string") return undefined;
  return {
    address: address as Address,
    ...(typeof note === "string" ? { note: note as OwnedRef } : {}),
  };
}

function writeJson(value: unknown): Uint8Array {
  return encodeText(`${JSON.stringify(value, null, 2)}\n`);
}
