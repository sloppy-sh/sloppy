// One of somebody's graphs as the folder they could keep it in —
// docs/ARCHITECTURE.md § "A graph on disk". `@sloppy/vault` writes the files;
// everything here is the reading that fills them.

import { Injectable, Logger } from "@nestjs/common";
import {
  type Address,
  type Amendment,
  type AmendmentView,
  type Block,
  type BlockDocument,
  type BlockView,
  blockView,
  citedUploads,
  type DidSyr,
  entityView,
  type GraphView,
  type Node,
  type OwnedRef,
  ownedRefFrom,
  splitOwnedRef,
} from "@sloppy/types";
import {
  amendmentToVault,
  type EmojiDrawing,
  emojiPath,
  GRAPH_FILE,
  graphFile,
  mediaPath,
  noteToVault,
  pack,
  type PictureSize,
  PICTURES_FILE,
  picturesFile,
  type Vault,
  VAULT_FORMAT,
} from "@sloppy/vault";
import { AmendmentRepository } from "../amendment/amendment.repository";
import { BlockRepository } from "../block/block.repository";
import { AppConfigService } from "../config/app-config.service";
import { MediaService, roleLimits } from "../media/media.service";
import { readRemotePicture } from "../media/remote-fetch";
import { GraphService } from "../node/graph.service";
import { NodeRepository } from "../node/node.repository";
import { type Delegation, SyrService } from "../syr/syr.service";
import { extensionFor, rewriteUploads } from "./uploads";

/** A name a vault reads back off a path. The media and emoji layouts both name
 *  a file after the thing it holds, so anything else stays out of one. */
const PLAIN_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** The pictures a vault carries, and what the notes in it call them. */
interface CarriedPictures {
  /** Each upload the notes name, under the name the vault gives it. */
  named: Map<string, string>;
  /** Where each of those names' bytes are in the vault. */
  paths: Map<string, string>;
  files: Map<string, Uint8Array>;
}

/** One graph's rows, read once and written into a vault twice over. */
interface GraphRows {
  refs: OwnedRef[];
  notes: Node[];
  aliases: ReadonlyMap<OwnedRef, Address[]>;
  stacks: ReadonlyMap<OwnedRef, readonly Block[]>;
  /** What is standing offered on those notes, so a graph handed over with
   *  offers on it loses none of them. */
  offers: Amendment[];
}

@Injectable()
export class ArchiveExportService {
  private readonly logger = new Logger(ArchiveExportService.name);

  constructor(
    private readonly graphs: GraphService,
    private readonly nodes: NodeRepository,
    private readonly blocks: BlockRepository,
    private readonly offers: AmendmentRepository,
    private readonly media: MediaService,
    private readonly syr: SyrService,
    private readonly config: AppConfigService,
  ) {}

  /** One graph as an archive, and what to call the file it arrives as. */
  async archive(
    delegation: Delegation,
    did: DidSyr,
    graph: OwnedRef,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    await this.graphs.requireHeld(did, graph);
    const held = await this.held(did, graph);
    const rows = await this.read(did, graph);
    const carried = await this.carryPictures(delegation, rows);
    const written = this.write(did, graph, held, rows, carried);
    for (const [path, bytes] of await this.carryEmoji(
      delegation,
      written.emoji,
    )) {
      written.vault.set(path, bytes);
    }
    return {
      bytes: pack(written.vault),
      filename: fileName(held?.title ?? ""),
    };
  }

  /**
   * One graph as the vault a merge reads the copy already here out of: the
   * files an archive of it would carry, without the pictures' bytes. Every
   * picture is still linked by the name a vault gives it, which is what the
   * two copies of one graph are compared by —
   * docs/ARCHITECTURE.md § "A graph on disk".
   */
  async vaultOf(did: DidSyr, graph: OwnedRef): Promise<Vault> {
    const rows = await this.read(did, graph);
    return this.write(
      did,
      graph,
      await this.held(did, graph),
      rows,
      pictureNames(did, rows),
    ).vault;
  }

  private async held(
    did: DidSyr,
    graph: OwnedRef,
  ): Promise<GraphView | undefined> {
    return (await this.graphs.list(did)).find((one) => one.ref === graph);
  }

  private async read(did: DidSyr, graph: OwnedRef): Promise<GraphRows> {
    const refs = (await this.nodes.notesIn(did, graph)).sort();
    return {
      refs,
      notes: (await this.nodes.many(did, refs)).sort(byRef),
      aliases: await this.nodes.aliasesOf(did, graph, refs),
      stacks: await this.blocks.listByNodes(refs),
      offers: await this.offers.listOn(did, refs),
    };
  }

  private write(
    did: DidSyr,
    graph: OwnedRef,
    held: GraphView | undefined,
    rows: GraphRows,
    carried: CarriedPictures,
  ): { vault: Vault; emoji: ReadonlyMap<string, EmojiDrawing> } {
    const { notes, aliases, stacks } = rows;
    const vault: Vault = new Map();
    vault.set(
      GRAPH_FILE,
      graphFile({
        format: VAULT_FORMAT,
        graph: splitOwnedRef(graph).localId,
        name: held?.title ?? "",
        owner: did,
        ...(held?.ownership === undefined ? {} : { ownership: held.ownership }),
        ...(held?.vouching === undefined ? {} : { vouching: held.vouching }),
      }),
    );
    let pictures: ReadonlyMap<string, PictureSize> = new Map();
    let emoji: ReadonlyMap<string, EmojiDrawing> = new Map();
    for (const note of notes) {
      const ref = ownedRefFrom(note.id);
      const sections = (stacks.get(ref) ?? []).map(
        (block): BlockView => ({
          ...blockView(block),
          content: rewriteUploads(block.content, carried.named),
        }),
      );
      const written = noteToVault(
        entityView(note),
        aliases.get(ref) ?? [],
        sections,
        { media: carried.paths, pictures, emoji },
      );
      for (const [path, bytes] of written.files) vault.set(path, bytes);
      pictures = written.pictures;
      emoji = written.emoji;
    }
    for (const offer of rows.offers) {
      const written = amendmentToVault(offeredAs(offer, carried.named), {
        media: carried.paths,
        pictures,
        emoji,
      });
      for (const [path, bytes] of written.files) vault.set(path, bytes);
      pictures = written.pictures;
      emoji = written.emoji;
    }
    for (const [path, bytes] of carried.files) vault.set(path, bytes);
    if (pictures.size > 0) vault.set(PICTURES_FILE, picturesFile(pictures));
    return { vault, emoji };
  }

  /**
   * The bytes behind every picture the notes draw, read out of the person's own
   * store rather than from any address a reader could hand us.
   *
   * A picture whose bytes are no longer there keeps its link in the note and
   * carries no file, which is what a vault somebody has edited by hand also
   * reads as.
   */
  private async carryPictures(
    delegation: Delegation,
    rows: GraphRows,
  ): Promise<CarriedPictures> {
    const carried: CarriedPictures = {
      named: new Map(),
      paths: new Map(),
      files: new Map(),
    };
    const wanted = new Set<string>();
    for (const document of drawnIn(rows)) {
      for (const upload of citedUploads(document)) wanted.add(upload);
    }
    for (const upload of [...wanted].sort()) {
      const name = vaultName(upload, delegation.did);
      if (name === undefined || carried.paths.has(name)) continue;
      try {
        const picture = await this.media.readOwnPicture(
          delegation,
          upload,
          "block",
        );
        const path = mediaPath(name, extensionFor(picture.mimeType));
        carried.named.set(upload, name);
        carried.paths.set(name, path);
        carried.files.set(path, picture.bytes);
      } catch (err) {
        this.logger.warn(`A picture stayed out of an archive: ${said(err)}`);
      }
    }
    return carried;
  }

  /**
   * The pictures behind the `:shortcode:`s the notes are written with, where
   * this instance holds the identity itself. An identity kept somewhere else
   * keeps its catalog too, and the shortcode resolves against that catalog
   * wherever the graph is read.
   */
  private async carryEmoji(
    delegation: Delegation,
    emoji: ReadonlyMap<string, EmojiDrawing>,
  ): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    const drawn = [...emoji]
      .filter(([name, drawing]) => drawing.src && PLAIN_NAME.test(name))
      .map(([name]) => name)
      .sort();
    if (!this.config.localIdpEnabled || drawn.length === 0) return files;

    const limits = roleLimits("emoji");
    const catalog = await this.syr.listOwnEmoji(delegation);
    for (const shortcode of drawn) {
      const entry = catalog.find((one) => one.shortcode === shortcode);
      if (!entry) continue;
      try {
        const picture = await readRemotePicture(entry.url, {
          allowPrivate: !this.config.isProduction,
          publicUrl: this.config.publicUrl,
          maxBytes: limits.maxBytes,
          mimeTypes: limits.mimeTypes,
        });
        files.set(
          emojiPath(shortcode, extensionFor(picture.mimeType)),
          picture.bytes,
        );
      } catch (err) {
        this.logger.warn(`An emoji stayed out of an archive: ${said(err)}`);
      }
    }
    return files;
  }
}

/** What a vault calls each picture these notes draw, with nothing read out of
 *  the store: the names alone are what a merge compares two copies by. */
function pictureNames(did: DidSyr, rows: GraphRows): CarriedPictures {
  const named = new Map<string, string>();
  for (const document of drawnIn(rows)) {
    for (const upload of citedUploads(document)) {
      const name = vaultName(upload, did);
      if (name !== undefined) named.set(upload, name);
    }
  }
  return { named, paths: new Map(), files: new Map() };
}

/** Every document a graph's files are written from: its notes' sections and
 *  the ones standing offered on them. */
function drawnIn(rows: GraphRows): BlockDocument[] {
  return [
    ...[...rows.stacks.values()].flatMap((stack) =>
      stack.map((block) => block.content),
    ),
    ...rows.offers.flatMap((offer) =>
      offer.blocks.map((section) => section.content),
    ),
  ];
}

/** One offer as the vault writes it, its sections drawing the pictures the
 *  vault carries rather than the ones the store holds. */
function offeredAs(
  offer: Amendment,
  named: ReadonlyMap<string, string>,
): AmendmentView {
  const view = entityView(offer);
  return {
    ...view,
    blocks: view.blocks.map((section) => ({
      ...section,
      content: rewriteUploads(section.content, named),
    })),
  };
}

/**
 * What one upload's file is called inside a vault: the local half of the id,
 * the other half being the identity the archive is leaving. Absent where the
 * picture is somebody else's, or where the name would not read back off a path.
 */
export function vaultName(uploadId: string, owner: string): string | undefined {
  const cut = uploadId.lastIndexOf("/");
  if (cut < 1 || uploadId.slice(0, cut) !== owner) return undefined;
  const name = uploadId.slice(cut + 1);
  return PLAIN_NAME.test(name) ? name : undefined;
}

/** The graph's name and the day, so a folder of archives reads as a shelf. */
export function fileName(name: string, at: Date = new Date()): string {
  const called = name
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${called === "" ? "graph" : called} ${at.toISOString().slice(0, 10)}.sloppy`;
}

function byRef(a: Node, b: Node): number {
  const left = ownedRefFrom(a.id);
  const right = ownedRefFrom(b.id);
  return left < right ? -1 : left > right ? 1 : 0;
}

function said(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
