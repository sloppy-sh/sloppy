// One of somebody's graphs as the folder they could keep it in —
// docs/ARCHITECTURE.md § "A graph on disk". `@sloppy/vault` writes the files;
// everything here is the reading that fills them.

import { Injectable, Logger } from "@nestjs/common";
import {
  type Block,
  type BlockView,
  blockView,
  citedUploads,
  type DidSyr,
  entityView,
  type Node,
  type OwnedRef,
  ownedRefFrom,
  splitOwnedRef,
} from "@sloppy/types";
import {
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

@Injectable()
export class ArchiveExportService {
  private readonly logger = new Logger(ArchiveExportService.name);

  constructor(
    private readonly graphs: GraphService,
    private readonly nodes: NodeRepository,
    private readonly blocks: BlockRepository,
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
    const name = await this.nameOf(did, graph);
    const vault = await this.vault(delegation, did, graph, name);
    return { bytes: pack(vault), filename: fileName(name) };
  }

  private async nameOf(did: DidSyr, graph: OwnedRef): Promise<string> {
    const held = await this.graphs.list(did);
    return held.find((one) => one.ref === graph)?.title ?? "";
  }

  private async vault(
    delegation: Delegation,
    did: DidSyr,
    graph: OwnedRef,
    name: string,
  ): Promise<Vault> {
    const refs = (await this.nodes.notesIn(did, graph)).sort();
    const notes = (await this.nodes.many(did, refs)).sort(byRef);
    const aliases = await this.nodes.aliasesOf(did, graph, refs);
    const stacks = await this.blocks.listByNodes(refs);
    const carried = await this.carryPictures(delegation, notes, stacks);

    const vault: Vault = new Map();
    vault.set(
      GRAPH_FILE,
      graphFile({
        format: VAULT_FORMAT,
        graph: splitOwnedRef(graph).localId,
        name,
        owner: did,
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
    for (const [path, bytes] of carried.files) vault.set(path, bytes);
    if (pictures.size > 0) vault.set(PICTURES_FILE, picturesFile(pictures));
    for (const [path, bytes] of await this.carryEmoji(delegation, emoji)) {
      vault.set(path, bytes);
    }
    return vault;
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
    notes: readonly Node[],
    stacks: ReadonlyMap<OwnedRef, readonly Block[]>,
  ): Promise<CarriedPictures> {
    const carried: CarriedPictures = {
      named: new Map(),
      paths: new Map(),
      files: new Map(),
    };
    const wanted = new Set<string>();
    for (const note of notes) {
      for (const block of stacks.get(ownedRefFrom(note.id)) ?? []) {
        for (const upload of citedUploads(block.content)) wanted.add(upload);
      }
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
