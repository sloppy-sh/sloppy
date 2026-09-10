// A graph somebody brings in from a folder of their own —
// docs/ARCHITECTURE.md § "A graph on disk". `@sloppy/vault` reads the files and
// re-keys them; everything here is what that means for the graph they keep.

import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type ArchivePreview,
  type BlockDocument,
  citedUploads,
  type DidSyr,
  entityView,
  type GraphView,
  type ImportResolution,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_NOTES,
  type Node,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import {
  type ArchiveManifest,
  decodeText,
  type EmojiDrawing,
  inkAt,
  manifest,
  noteAt,
  type PictureSize,
  PICTURES_FILE,
  readPicturesFile,
  rekey,
  unpack,
  uploadAt,
  type Vault,
  VaultFormatError,
  type VaultNote,
  vaultToNote,
} from "@sloppy/vault";
import { AssetLinks } from "../media/asset-link";
import { MediaService } from "../media/media.service";
import { GraphRepository } from "../node/graph.repository";
import { GraphService } from "../node/graph.service";
import { SerialQueue } from "../node/serial-queue";
import { PublicationService } from "../publication/publication.service";
import { type Delegation, SyrService } from "../syr/syr.service";
import {
  addressesLedBy,
  type Kept,
  placed,
  type Repeat,
  repeated,
  retiring,
  rowsFor,
} from "./arriving";
import { ArchiveRepository } from "./archive.repository";
import { mimeForExtension, rewriteUploads } from "./uploads";

const NOT_A_GRAPH = "This file isn't a Sloppy graph.";

/** An archive opened: what it says about itself, and what it holds under the
 *  identity taking it in. */
interface Opened {
  said: ArchiveManifest;
  /** Re-keyed already. The ULID half of every ref is kept, which is what makes
   *  a second import a replace. */
  vault: Vault;
  notes: VaultNote[];
  /** Where this graph lands, and whether that graph is already here. */
  graph: OwnedRef;
  replaces: boolean;
}

@Injectable()
export class ArchiveImportService {
  /** One import at a time per person: an import reads the graph it is about to
   *  replace and then replaces it, and two of them would each replace what the
   *  other read. */
  private readonly importing = new SerialQueue();
  private readonly logger = new Logger(ArchiveImportService.name);

  constructor(
    private readonly graphs: GraphService,
    private readonly names: GraphRepository,
    private readonly rows: ArchiveRepository,
    private readonly media: MediaService,
    private readonly syr: SyrService,
    private readonly links: AssetLinks,
    private readonly publications: PublicationService,
  ) {}

  /** What would arrive, before anything is written. */
  async preview(
    delegation: Delegation,
    did: DidSyr,
    bytes: Uint8Array,
  ): Promise<ArchivePreview> {
    const catalog = await this.catalog(delegation);
    const opened = await this.open(bytes, did, catalog);
    const documents = opened.notes.flatMap((note) =>
      note.sections.map((section) => section.content),
    );
    return {
      format: opened.said.format,
      graph: opened.said.graph,
      name: opened.said.name,
      owner: opened.said.owner,
      notes: opened.notes.length,
      pictures: [...opened.vault.keys()].filter(
        (path) => uploadAt(path) !== undefined,
      ).length,
      missing_emoji: missingEmoji(documents, catalog),
      collisions: await this.rows.heldOutside(
        did,
        opened.graph,
        opened.notes.map((note) => note.ref),
      ),
      replaces: opened.replaces,
      replacing: opened.replaces
        ? await this.rows.countIn(did, opened.graph)
        : 0,
      merges: false,
      conflicts: [],
    };
  }

  /** The graph written: a new one, or the one this archive was last taken out
   *  of. The rows land whole or not at all; what the departing notes were
   *  publishing comes down before them and does not go back up.
   *
   *  `settle` is what the person chose between the two copies. A preview here
   *  answers no conflicts, so anything chosen was chosen about a graph this
   *  instance is not the one holding. */
  async write(
    delegation: Delegation,
    did: DidSyr,
    bytes: Uint8Array,
    settle: readonly ImportResolution[] = [],
  ): Promise<GraphView> {
    if (settle.length > 0) {
      throw new BadRequestException(
        "This copy of Sloppy brings a graph in whole. Bring it in again without choosing between the two copies.",
      );
    }
    const opened = await this.open(bytes, did, await this.catalog(delegation));
    return this.importing.run(did, () => this.land(delegation, did, opened));
  }

  private async land(
    delegation: Delegation,
    did: DidSyr,
    opened: Opened,
  ): Promise<GraphView> {
    const arriving = opened.notes.map((note) => note.ref);
    const elsewhere = await this.rows.heldOutside(did, opened.graph, arriving);
    if (elsewhere.length > 0) throw alreadyHere(elsewhere.length);

    const going = await this.rows.notesIn(did, opened.graph);
    const led = await this.rows.aliasesIn(did, opened.graph);
    const sent = new Map<string, string>();
    try {
      await this.carryPictures(delegation, opened, sent);
      const notes = placed(
        opened.notes.map((note) => ({
          ...note,
          sections: note.sections.map((section) => ({
            ...section,
            content: rewriteUploads(section.content, sent),
          })),
        })),
      );
      const kept = new Map<OwnedRef, Kept>(
        going.map((note) => [ownedRefFrom(note.id), note]),
      );
      await this.takeDownDeparting(delegation, did, going, new Set(arriving));
      await this.rows.replace(did, opened.graph, {
        going: [...kept.keys()],
        ...rowsFor(did, opened.graph, notes, kept),
        retiring: retiring(
          did,
          opened.graph,
          going,
          led,
          addressesLedBy(notes),
        ),
      });
    } catch (err) {
      await this.unsend(delegation, sent);
      throw refused(err);
    }
    return entityView(
      await this.names.name(did, opened.graph, opened.said.name),
    );
  }

  /**
   * What the notes leaving this graph were publishing comes down first, the way
   * it does when their author deletes them: a chain nobody can reach a note
   * through is one a peer keeps pulling.
   */
  private async takeDownDeparting(
    delegation: Delegation | undefined,
    did: DidSyr,
    going: readonly Node[],
    staying: ReadonlySet<OwnedRef>,
  ): Promise<void> {
    const leaving = going
      .map((note) => ownedRefFrom(note.id))
      .filter((ref) => !staying.has(ref));
    if (leaving.length === 0) return;
    const chains = await this.publications.rootedIn(did, new Set(leaving));
    if (chains.length === 0) return;
    if (!delegation) throw new UnauthorizedException("Sign in to continue.");
    for (const chain of chains) {
      await this.publications.remove(delegation, chain);
    }
  }

  /**
   * The archive read and put under the importer's own identity. Nothing here
   * writes: the preview and the import answer for the same archive.
   */
  private async open(
    bytes: Uint8Array,
    did: DidSyr,
    emoji: ReadonlyMap<string, EmojiDrawing>,
  ): Promise<Opened> {
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new BadRequestException(
        `That file is too big. The limit here is ${megabytes(MAX_ARCHIVE_BYTES)}.`,
      );
    }
    let said: ArchiveManifest;
    try {
      said = manifest(bytes);
    } catch (err) {
      throw refused(err);
    }
    if (said.notes > MAX_ARCHIVE_NOTES) {
      throw new BadRequestException(
        `That graph has more notes than can arrive at once. The limit here is ${MAX_ARCHIVE_NOTES.toLocaleString("en-US")} notes.`,
      );
    }
    let vault: Vault;
    try {
      vault = unpack(bytes);
    } catch (err) {
      throw refused(err);
    }
    const moved = rekey(vault, said.owner, did);
    const notes = readNotes(moved, emoji);
    const twice = repeated(notes);
    if (twice) throw repeats(twice);
    const graph = await this.landing(did, said.graph);
    return {
      said,
      vault: moved,
      notes,
      graph: graph.ref,
      replaces: graph.replaces,
    };
  }

  /**
   * Which graph this archive lands in. The same ULID is the same graph, which
   * is what makes taking one out and putting it back a settling of that graph
   * rather than a second copy of everything — the graph somebody started with
   * included, since that one now has a ulid of its own.
   */
  private async landing(
    did: DidSyr,
    ulid: string,
  ): Promise<{ ref: OwnedRef; replaces: boolean }> {
    const ref: OwnedRef = `${did}/${ulid}`;
    return { ref, replaces: await this.graphs.holds(did, ref) };
  }

  /**
   * The pictures the archive carries, put into the importer's own store under
   * their own identity, keyed by what the notes in the archive call them. A
   * file nothing in the notes draws is left where it is.
   */
  private async carryPictures(
    delegation: Delegation,
    opened: Opened,
    into: Map<string, string>,
  ): Promise<void> {
    const drawn = new Set(
      opened.notes.flatMap((note) =>
        note.sections.flatMap((section) => citedUploads(section.content)),
      ),
    );
    for (const [path, bytes] of opened.vault) {
      const name = uploadAt(path);
      if (name === undefined || !drawn.has(name) || into.has(name)) continue;
      const mimeType = mimeForExtension(path.slice(path.lastIndexOf(".") + 1));
      if (mimeType === undefined) continue;
      const stored = await this.media.store(delegation, {
        role: "block",
        filename: path.slice(path.lastIndexOf("/") + 1),
        mimeType,
        bytes,
      });
      into.set(name, stored.upload_id);
    }
  }

  /** What a refused import put in the person's store, taken back out. */
  private async unsend(
    delegation: Delegation,
    sent: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const uploadId of sent.values()) {
      await this.media
        .removeOwnPicture(delegation, uploadId)
        .catch((err: unknown) =>
          this.logger.warn(`A refused import left a picture behind: ${err}`),
        );
    }
  }

  /** How the importer's own catalog draws each shortcode. A note arriving with
   *  one this catalog lacks keeps the shortcode and renders as it. */
  private async catalog(
    delegation: Delegation,
  ): Promise<Map<string, EmojiDrawing>> {
    const drawn = new Map<string, EmojiDrawing>();
    for (const entry of await this.syr.listOwnEmoji(delegation)) {
      drawn.set(entry.shortcode, { src: this.links.to(entry.url) });
    }
    return drawn;
  }
}

/** Every note file the vault holds, read with the sidecars beside it. */
export function readNotes(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing> = new Map(),
): VaultNote[] {
  const ink = new Map<string, Record<string, unknown>>();
  for (const [path, bytes] of vault) {
    const stem = inkAt(path);
    if (stem === undefined || !path.endsWith(".ink.json")) continue;
    try {
      const held = JSON.parse(decodeText(bytes)) as unknown;
      if (held && typeof held === "object") {
        ink.set(stem, held as Record<string, unknown>);
      }
    } catch {
      // A drawing whose strokes cannot be read costs the drawing its strokes
      // and the note nothing else.
    }
  }
  const held = vault.get(PICTURES_FILE);
  const pictures: ReadonlyMap<string, PictureSize> = held
    ? readPicturesFile(held)
    : new Map();

  const notes: VaultNote[] = [];
  for (const [path, bytes] of vault) {
    if (noteAt(path) === undefined) continue;
    try {
      notes.push(
        vaultToNote({ markdown: decodeText(bytes), ink, pictures, emoji }),
      );
    } catch (err) {
      throw refused(err);
    }
  }
  return notes;
}

/** The shortcodes the arriving notes are written with that this catalog has no
 *  picture for. */
export function missingEmoji(
  documents: readonly BlockDocument[],
  catalog: ReadonlyMap<string, EmojiDrawing>,
): string[] {
  const missing = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const held of value) walk(held);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const held = value as { type?: unknown; attrs?: { name?: unknown } };
    const name = held.attrs?.name;
    if (held.type === "emoji" && typeof name === "string" && !catalog.has(name))
      missing.add(name);
    for (const inside of Object.values(value)) walk(inside);
  };
  walk(documents);
  return [...missing];
}

function alreadyHere(count: number): BadRequestException {
  return new BadRequestException(
    count === 1
      ? "One of these notes is already in another of your graphs, so this cannot arrive as a graph of its own. Take that note out first, or import this somewhere else."
      : `${count} of these notes are already in another of your graphs, so this cannot arrive as a graph of its own. Take those notes out first, or import this somewhere else.`,
  );
}

function called(note: VaultNote): string {
  const title = note.title.trim();
  return title ? `“${title}”` : "a note you have not titled";
}

function repeats(found: Repeat): BadRequestException {
  const naming = found.notes.map(called).join(" and ");
  if (found.what === "address") {
    return new BadRequestException(
      `Two notes in this graph are numbered ${found.address} — ${naming}. A number belongs to one note, so change one of them or take it off.`,
    );
  }
  if (found.what === "note") {
    return new BadRequestException(
      `This graph holds one note twice — ${naming}. Take one of them out and try again.`,
    );
  }
  return new BadRequestException(
    `The same section is in this graph twice, in ${naming}. Take one of them out and try again.`,
  );
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** An archive nobody can read is refused in the words the reader gave. */
function refused(err: unknown): unknown {
  return err instanceof VaultFormatError
    ? new BadRequestException(err.message || NOT_A_GRAPH)
    : err;
}
