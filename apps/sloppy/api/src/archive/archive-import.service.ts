// A graph somebody brings in from a folder of their own —
// docs/ARCHITECTURE.md § "A graph on disk". `@sloppy/vault` reads the files and
// re-keys them; everything here is what that means for the graph they keep.

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  type ArchivePreview,
  type BlockDocument,
  citedUploads,
  createOwnedRecordId,
  type DidSyr,
  entityView,
  type GraphOwnership,
  type GraphVouching,
  type GraphView,
  type ImportConflict,
  type ImportResolution,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_NOTES,
  type Node,
  type OwnedRef,
  ownedRefFrom,
  UNNAMED_GRAPH_ULID,
} from "@sloppy/types";
import {
  amendmentAt,
  type ArchiveManifest,
  decodeText,
  type EmojiDrawing,
  GRAPH_FILE,
  inkAt,
  manifest,
  noteAt,
  readGraphFile,
  type PictureSize,
  PICTURES_FILE,
  readPicturesFile,
  rekey,
  unpack,
  uploadAt,
  type Vault,
  vaultDifference,
  VaultFormatError,
  type VaultNote,
  vaultToAmendment,
  vaultToNote,
} from "@sloppy/vault";
import { AmendmentRepository } from "../amendment/amendment.repository";
import { refuseWithoutIdentityStore } from "../node/request";
import { AssetLinks } from "../media/asset-link";
import { MediaService } from "../media/media.service";
import { GraphRepository } from "../node/graph.repository";
import { GraphService } from "../node/graph.service";
import { NodeService } from "../node/node.service";
import { SerialQueue } from "../node/serial-queue";
import { PublicationService } from "../publication/publication.service";
import { type Delegation, SyrService } from "../syr/syr.service";
import { ArchiveExportService } from "./archive-export.service";
import {
  addressesLedBy,
  type ArrivingAmendment,
  type GraphNow,
  type Kept,
  type MergeRefusal,
  mergeRefusal,
  mergeRows,
  offeredRows,
  placed,
  type Repeat,
  repeated,
  retiring,
  rowsFor,
} from "./arriving";
import { ArchiveRepository } from "./archive.repository";
import {
  called,
  conflictsBetween,
  settled,
  type TwoCopies,
  unanswered,
} from "./merging";
import { mimeForExtension, rewriteUploads } from "./uploads";

const NOT_A_GRAPH = "This file isn't a Sloppy graph.";

/** An archive opened: what it says about itself, and what it holds under the
 *  identity taking it in. */
interface Opened {
  said: ArchiveManifest;
  /** Re-keyed already. The ULID half of every ref is kept, which is what makes
   *  a second import of one graph a settling of it. */
  vault: Vault;
  notes: VaultNote[];
  /** What is standing offered on those notes, which rides in an archive the way
   *  the notes do. */
  offers: ArrivingAmendment[];
  /** What the graph gates the notes written in it by, absent where the archive
   *  does not say — which reads as open. */
  ownership?: GraphOwnership;
  /** Whose writing it takes, absent where the archive does not say — which
   *  reads as asking nobody to be vouched. */
  vouching?: GraphVouching;
  /** Where this graph lands, and whether that graph is already here — in which
   *  case the two copies are merged rather than one written over the other. */
  graph: OwnedRef;
  replaces: boolean;
}

@Injectable()
export class ArchiveImportService {
  /** One import at a time per person: an import reads the graph it is about to
   *  write and then writes it, and two of them would each write over what the
   *  other read. */
  private readonly importing = new SerialQueue();
  private readonly logger = new Logger(ArchiveImportService.name);

  constructor(
    private readonly graphs: GraphService,
    private readonly names: GraphRepository,
    private readonly rows: ArchiveRepository,
    private readonly offers: AmendmentRepository,
    private readonly out: ArchiveExportService,
    private readonly notes: NodeService,
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
    const copies = opened.replaces
      ? await this.between(did, opened, catalog)
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
      ...(opened.said.offers > 0 ? { offers: opened.said.offers } : {}),
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
      merges: copies !== undefined,
      conflicts: copies ? conflictsBetween(copies) : [],
    };
  }

  /** The graph as it stands here and as the archive has it, read as the same
   *  kind of thing so the two can be compared at all. */
  private async between(
    did: DidSyr,
    opened: Opened,
    catalog: ReadonlyMap<string, EmojiDrawing>,
  ): Promise<TwoCopies> {
    const live = await this.out.vaultOf(did, opened.graph);
    return {
      mine: byRef(readNotes(live, catalog)),
      theirs: byRef(opened.notes),
      difference: vaultDifference(live, opened.vault),
    };
  }

  /** The graph written: a new one, or the copy of one this person already keeps
   *  settled into it. The rows land whole or not at all.
   *
   *  `settle` is what the person chose between the two copies. */
  async write(
    delegation: Delegation,
    did: DidSyr,
    bytes: Uint8Array,
    settle: readonly ImportResolution[] = [],
  ): Promise<GraphView> {
    const catalog = await this.catalog(delegation);
    const opened = await this.open(bytes, did, catalog);
    if (!opened.replaces) {
      if (settle.length > 0) {
        throw new BadRequestException(
          "This file opens a graph of its own, so there is nothing to choose between. Bring it in again without choosing.",
        );
      }
      return this.importing.run(did, () => this.land(delegation, did, opened));
    }
    return this.importing.run(did, () =>
      this.notes.merging(did, () =>
        this.settle(delegation, did, opened, catalog, settle),
      ),
    );
  }

  /**
   * The two copies of one graph settled into one: what only the archive has
   * arrives, what only this graph has stays, and what they disagree about is
   * written the way the person chose. Nothing is written until every
   * disagreement is answered.
   */
  private async settle(
    delegation: Delegation,
    did: DidSyr,
    opened: Opened,
    catalog: ReadonlyMap<string, EmojiDrawing>,
    chose: readonly ImportResolution[],
  ): Promise<GraphView> {
    const copies = await this.between(did, opened, catalog);
    const conflicts = conflictsBetween(copies);
    const missing = unanswered(conflicts, chose);
    if (missing.length > 0) throw notSettled(missing, copies);

    const arriving = opened.notes.map((note) => note.ref);
    const elsewhere = await this.rows.heldOutside(did, opened.graph, arriving);
    if (elsewhere.length > 0) throw alreadyHere(elsewhere.length);

    const sent = new Map<string, string>();
    try {
      const here = drawnAlready(copies.mine);
      await this.carryPictures(delegation, opened, sent, here);
      const pictures = new Map<string, string>([
        ...[...here].map((name): [string, string] => [name, `${did}/${name}`]),
        ...sent,
      ]);
      const notes = placed(
        settled(copies, conflicts, chose).map((note) => ({
          ...note,
          sections: note.sections.map((section) => ({
            ...section,
            content: rewriteUploads(section.content, pictures),
          })),
        })),
      );
      const held = await this.rows.notesIn(did, opened.graph);
      const now: GraphNow = {
        arriving: settling(copies, conflicts),
        held,
        aliases: await this.rows.aliasesIn(did, opened.graph),
        retired: await this.rows.retiredIn(did, opened.graph),
        offers: await this.offers.listOn(
          did,
          held.map((note) => ownedRefFrom(note.id)),
        ),
      };
      const cannot = mergeRefusal(notes, now);
      if (cannot) throw unwritable(cannot);
      await this.rows.merge(
        did,
        opened.graph,
        mergeRows(
          did,
          opened.graph,
          notes,
          now,
          offering(opened.offers, pictures),
        ),
      );
    } catch (err) {
      await this.unsend(delegation, sent);
      throw refused(err);
    }
    const graph = await this.names.find(did, opened.graph);
    if (!graph) throw new BadRequestException("That graph is not here.");
    return entityView(graph);
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
        amendments: offeredRows(
          did,
          offering(opened.offers, sent),
          new Set(arriving),
        ),
      });
    } catch (err) {
      await this.unsend(delegation, sent);
      throw refused(err);
    }
    return entityView(
      await this.names.name(
        did,
        opened.graph,
        opened.said.name,
        opened.ownership,
        opened.vouching,
      ),
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
    if (!delegation) refuseWithoutIdentityStore();
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
    const settings = settingsOf(moved);
    return {
      said,
      vault: moved,
      notes,
      offers: readAmendments(moved, emoji),
      ...settings,
      graph: graph.ref,
      replaces: graph.replaces,
    };
  }

  /**
   * Which graph this archive lands in. The same ULID is the same graph, which
   * is what makes taking one out and putting it back a settling of that graph
   * rather than a second copy of everything — the graph somebody started with
   * included, since that one now has a ulid of its own.
   *
   * An archive taken out before every graph had one names the ulid no graph
   * anybody keeps is ever at, so it opens a graph of its own instead.
   */
  private async landing(
    did: DidSyr,
    ulid: string,
  ): Promise<{ ref: OwnedRef; replaces: boolean }> {
    if (ulid === UNNAMED_GRAPH_ULID) {
      return {
        ref: ownedRefFrom(createOwnedRecordId("graph", did)),
        replaces: false,
      };
    }
    const ref: OwnedRef = `${did}/${ulid}`;
    return { ref, replaces: await this.graphs.holds(did, ref) };
  }

  /**
   * The pictures the archive carries, put into the importer's own store under
   * their own identity, keyed by what the archive calls them. A file nothing
   * the archive carries draws is left where it is, and so is one `already`
   * names, which the graph being merged into is drawing already.
   */
  private async carryPictures(
    delegation: Delegation,
    opened: Opened,
    into: Map<string, string>,
    already: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const drawn = new Set(drawnIn(opened).flatMap(citedUploads));
    for (const [path, bytes] of opened.vault) {
      const name = uploadAt(path);
      if (name === undefined || !drawn.has(name) || into.has(name)) continue;
      if (already.has(name)) continue;
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

/** What a markdown file in a vault is read beside: the strokes of the drawings
 *  in it, and how big each picture it draws is. */
function beside(vault: Vault): {
  ink: Map<string, Record<string, unknown>>;
  pictures: ReadonlyMap<string, PictureSize>;
} {
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
  return { ink, pictures: held ? readPicturesFile(held) : new Map() };
}

/** Every note file the vault holds, read with the sidecars beside it. */
export function readNotes(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing> = new Map(),
): VaultNote[] {
  const sidecars = beside(vault);
  const notes: VaultNote[] = [];
  for (const [path, bytes] of vault) {
    if (noteAt(path) === undefined) continue;
    try {
      notes.push(
        vaultToNote({ markdown: decodeText(bytes), ...sidecars, emoji }),
      );
    } catch (err) {
      throw refused(err);
    }
  }
  return notes;
}

/** Every offered change the vault holds, read the way its notes are. One whose
 *  file cannot be read as an offer costs that offer and the import nothing. */
export function readAmendments(
  vault: Vault,
  emoji: ReadonlyMap<string, EmojiDrawing> = new Map(),
): ArrivingAmendment[] {
  const sidecars = beside(vault);
  const offers: ArrivingAmendment[] = [];
  for (const [path, bytes] of vault) {
    const ulid = amendmentAt(path);
    if (ulid === undefined) continue;
    try {
      offers.push({
        ulid,
        ...vaultToAmendment({
          markdown: decodeText(bytes),
          ...sidecars,
          emoji,
        }),
      });
    } catch {
      // A file in `amendments/` that is not one costs that offer and leaves
      // the graph arriving whole.
    }
  }
  return offers;
}

/** Every document an archive's files are drawn into: its notes' sections and
 *  the ones standing offered on them. */
function drawnIn(opened: Opened): BlockDocument[] {
  return [
    ...opened.notes.flatMap((note) =>
      note.sections.map((section) => section.content),
    ),
    ...opened.offers.flatMap((offer) =>
      offer.sections.map((section) => section.content),
    ),
  ];
}

/** The offers with their sections drawing the pictures this store now holds. */
function offering(
  offers: readonly ArrivingAmendment[],
  pictures: ReadonlyMap<string, string>,
): ArrivingAmendment[] {
  return offers.map((offer) => ({
    ...offer,
    sections: offer.sections.map((section) => ({
      ...section,
      content: rewriteUploads(section.content, pictures),
    })),
  }));
}

/** What `graph.json` says the graph gates its notes by, and asks of a writer.
 *  An archive that says neither leaves both as the landing graph has them. */
function settingsOf(vault: Vault): {
  ownership?: GraphOwnership;
  vouching?: GraphVouching;
} {
  const said = vault.get(GRAPH_FILE);
  if (!said) return {};
  try {
    const { ownership, vouching } = readGraphFile(said);
    return {
      ...(ownership === undefined ? {} : { ownership }),
      ...(vouching === undefined ? {} : { vouching }),
    };
  } catch {
    return {};
  }
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

function byRef(notes: readonly VaultNote[]): Map<OwnedRef, VaultNote> {
  return new Map(notes.map((note) => [note.ref, note]));
}

/** The notes a merge writes whatever else it finds: the ones only the archive
 *  has, and the ones the person settled between. Every other note the graph
 *  keeps is written only where the merge moved it or took its number. */
function settling(
  copies: TwoCopies,
  conflicts: readonly ImportConflict[],
): Set<OwnedRef> {
  const writing = new Set<OwnedRef>(
    [...copies.theirs.keys()].filter((ref) => !copies.mine.has(ref)),
  );
  for (const conflict of conflicts) {
    writing.add(conflict.ref);
    if (conflict.other) writing.add(conflict.other);
  }
  return writing;
}

/** The pictures the graph already draws, under the names a vault gives them.
 *  Somebody else's picture keeps its own name in a vault and is not one. */
function drawnAlready(notes: ReadonlyMap<OwnedRef, VaultNote>): Set<string> {
  const drawn = new Set<string>();
  for (const note of notes.values()) {
    for (const section of note.sections) {
      for (const upload of citedUploads(section.content)) {
        if (!upload.includes("/")) drawn.add(upload);
      }
    }
  }
  return drawn;
}

/** A merge nobody finished choosing about, refused with what is still to
 *  choose. */
function notSettled(
  missing: readonly ImportConflict[],
  copies: TwoCopies,
): BadRequestException {
  const asking = missing.map((conflict) =>
    conflict.kind === "address"
      ? `which note keeps ${conflict.address}`
      : `which copy of ${called(copies.mine.get(conflict.ref) ?? { title: "" })} to keep`,
  );
  return new BadRequestException(
    `Nothing has been brought in: you have not said ${listed(asking)}. Choose, and bring the graph in again.`,
  );
}

/** What a settled merge would still put two notes at one number for, take a
 *  number this graph spent for, or take a number off the note it leads to. */
function unwritable(found: MergeRefusal): BadRequestException {
  if (found.what === "twice") {
    return new BadRequestException(
      `Nothing has been brought in: ${found.notes.map(called).join(" and ")} would both be numbered ${found.address}. Choose again, so that one of them keeps it.`,
    );
  }
  if (found.what === "led") {
    return new BadRequestException(
      `Nothing has been brought in: ${found.address} still leads to ${called(found.to)}, so ${called(found.note)} cannot arrive at it. Change that number in the file, or take it off, and bring the graph in again.`,
    );
  }
  return new BadRequestException(
    `Nothing has been brought in: you have used ${found.address} before, so ${called(found.note)} cannot arrive at it. Change that number in the file, or take it off, and bring the graph in again.`,
  );
}

/** A few things named in a row, and how many more there are. */
function listed(said: readonly string[]): string {
  const first = said.slice(0, 3);
  const rest = said.length - first.length;
  const naming =
    first.length > 1
      ? `${first.slice(0, -1).join(", ")} or ${first[first.length - 1]}`
      : first[0];
  return rest > 0 ? `${naming}, and ${rest} more` : naming;
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
