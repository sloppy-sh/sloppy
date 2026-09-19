// Publishing: taking a copy of a branch as it stands, and taking one down.
// docs/ARCHITECTURE.md § "Federating the graph" and § "Pictures".

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  type Address,
  type Block,
  citedNotes,
  citedUploads,
  createOwnedRecordId,
  DEFAULT_COMMENT_ACCESS,
  entityView,
  graphOf,
  isInSubtree,
  looksReaching,
  type Node,
  noteLabel,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  type Publication,
  type PublicationVersion,
  type PublicationView,
  parseSnapshotNode,
  type PublishedVersion,
  recordIdFromOwnedRef,
  type SnapshotAsset,
  type SnapshotBlock,
  SnapshotBlockSchema,
  type SnapshotNode,
  type SyrEmoji,
  type UnpublishedChange,
  type UnpublishedChanges,
  type UpdatePublicationRequest,
  compareAddresses,
  MAX_UNPUBLISHED_CHANGES,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { BlockRepository } from "../block/block.repository";
import { MediaService } from "../media/media.service";
import { NodeRepository } from "../node/node.repository";
import { SerialQueue } from "../node/serial-queue";
import { type Delegation, SyrService } from "../syr/syr.service";
import {
  publicationVersion,
  type FiledNote,
  PublicationRepository,
} from "./publication.repository";
import {
  citedEmoji,
  inPreorder,
  ordAt,
  publishedDocument,
  publishedNodeOf,
  type Snapshotted,
} from "./snapshot";

/** How much of a branch is held in memory at once. A published branch is
 *  written a run of notes at a time, sections and all. */
const NOTES_PER_BATCH = 100;
/** How many pictures are copied at once. The bytes pass through this instance,
 *  so the bound is what one publish may hold and what it may ask of a store. */
const COPIES_AT_ONCE = 4;
/** How many of a version's notes one read of what it filed takes. */
const NOTES_PER_PAGE = 1000;

@Injectable()
export class PublicationService {
  private readonly logger = new Logger(PublicationService.name);
  /** One act on a branch at a time. Publishing and taking down both move the
   *  copies a publication owns, so steps that interleave would have one taking
   *  back what the other has written a version around. */
  private readonly acts = new SerialQueue();

  constructor(
    private readonly publications: PublicationRepository,
    private readonly nodes: NodeRepository,
    private readonly blocks: BlockRepository,
    private readonly media: MediaService,
    private readonly syr: SyrService,
  ) {}

  async list(did: string): Promise<PublicationView[]> {
    const rows = await this.publications.listOwn(did);
    const latest = await this.publications.latestOf(
      did,
      rows.map((row) => ownedRefFrom(row.id)),
    );
    return rows.flatMap((row) => {
      const version = latest.get(ownedRefFrom(row.id));
      return version === undefined ? [] : [viewOf(row, version)];
    });
  }

  /** Which of these notes a publication of their own is rooted at, which
   *  publishing sends another version of rather than opening a chain. */
  async rootedAmong(
    did: string,
    notes: readonly OwnedRef[],
  ): Promise<Set<OwnedRef>> {
    if (notes.length === 0) return new Set();
    return this.publications.rootsAmong(did, notes);
  }

  /** The caller's publications rooted at one of these notes, by their own refs —
   *  what a branch about to go is still putting out. */
  async rootedIn(
    did: string,
    notes: ReadonlySet<OwnedRef>,
  ): Promise<OwnedRef[]> {
    if (notes.size === 0) return [];
    const mine = await this.publications.listOwn(did);
    return mine
      .filter((row) => notes.has(row.root))
      .map((row) => ownedRefFrom(row.id));
  }

  async versions(
    did: string,
    ref: OwnedRef,
    limit: number,
  ): Promise<PublishedVersion[]> {
    const publication = await this.publications.find(did, ref);
    if (!publication) throw gone();
    const rows = await this.publications.versionsPage(
      did,
      ref,
      undefined,
      limit,
    );
    return rows.map(publicationVersion);
  }

  /**
   * What the branch has done since its newest version went out, for the person
   * about to publish it again. Not a comparison of the writing and deliberately
   * not — `UnpublishedChange` in `@sloppy/types` carries why, and what is
   * answered instead.
   */
  async unpublished(did: string, ref: OwnedRef): Promise<UnpublishedChanges> {
    const publication = await this.publications.find(did, ref);
    if (!publication) throw gone();
    const version = (await this.publications.latestOf(did, [ref])).get(ref);
    if (version === undefined) throw gone();
    const since = publicationVersion(version);

    const root = await this.nodes.find(did, publication.root);
    const branch = root ? await this.nodes.subtree(did, root) : [];
    const now = new Map(branch.map((node) => [ownedRefFrom(node.id), node]));
    const published = await this.publishedNotes(did, since.ref);
    const both = [...published.keys()].filter((note) => now.has(note));
    const written = await this.blocks.writtenSince(
      did,
      both,
      since.published_at,
    );

    const changes: UnpublishedChange[] = [];
    for (const [note, node] of now) {
      const before = published.get(note);
      if (before === undefined) {
        changes.push(gainedOrLost(note, node.address, node.title, "added"));
        continue;
      }
      const moved = whatMoved(before, node, written.has(note));
      if (moved) changes.push(moved);
    }
    for (const [note, before] of published) {
      if (now.has(note)) continue;
      changes.push(gainedOrLost(note, before.address, before.title, "removed"));
    }
    changes.sort((a, b) => {
      if (a.address === undefined || b.address === undefined) {
        return (
          (a.address === undefined ? 1 : 0) - (b.address === undefined ? 1 : 0)
        );
      }
      return compareAddresses(a.address, b.address);
    });

    return {
      publication: ref,
      since,
      changes: changes.slice(0, MAX_UNPUBLISHED_CHANGES),
      total: changes.length,
    };
  }

  /** Every note one version filed, by the note it was copied from. */
  private async publishedNotes(
    did: string,
    version: OwnedRef,
  ): Promise<Map<OwnedRef, FiledNote>> {
    const held = new Map<OwnedRef, FiledNote>();
    let after: string | undefined;
    for (;;) {
      const page = await this.publications.notesIn(
        did,
        version,
        after,
        NOTES_PER_PAGE,
      );
      for (const note of page) held.set(note.source, note);
      if (page.length < NOTES_PER_PAGE) return held;
      after = page[page.length - 1].ord;
    }
  }

  async setComments(
    did: string,
    ref: OwnedRef,
    request: UpdatePublicationRequest,
  ): Promise<PublicationView> {
    const written = await this.publications.setComments(
      did,
      ref,
      request.comments,
      nowIso(),
    );
    if (!written) throw gone();
    const latest = await this.publications.latestOf(did, [ref]);
    const version = latest.get(ref);
    if (version === undefined) throw gone();
    return viewOf(written, version);
  }

  /**
   * A branch as it stands right now, copied into a version of its own. The
   * version row is written last and in one transaction with the marks it sets:
   * nothing serves a snapshot without it, so a publish that fails partway
   * leaves rows nobody can reach and takes its copies back down.
   */
  publish(
    delegation: Delegation,
    request: { root: OwnedRef },
  ): Promise<PublicationView> {
    return this.acts.run(request.root, () =>
      this.snapshot(delegation, request),
    );
  }

  private async snapshot(
    delegation: Delegation,
    request: { root: OwnedRef },
  ): Promise<PublicationView> {
    const did = delegation.did;
    const root = await this.nodes.find(did, request.root);
    if (!root) throw new NotFoundException("That note is not here.");

    const { publication, opened } = await this.chainFor(delegation, root);
    const chain = ownedRefFrom(publication.id);
    const id = createOwnedRecordId("publication_version", did);
    // The number a version of this chain would take next, read before any bytes
    // go public: a publish elsewhere that commits while this one runs takes that
    // number, which is how the undo learns its copies are now that version's.
    const opening = await this.publications.nextSequence(did, chain);

    const copies = new Copies(await this.publications.assetsOf(did, chain));
    let version: PublicationVersion;
    try {
      const marking = await this.freeze(delegation, {
        root,
        version: ownedRefFrom(id),
        chain,
        copies,
      });
      // Read again rather than reused: taking the number late leaves a publish
      // in another process racing this one over a moment instead of over a
      // whole branch, and the unique index settles whichever still collide.
      const now = nowIso();
      version = {
        id,
        created_by: did,
        publication: chain,
        sequence: await this.publications.nextSequence(did, chain),
        created_at: now,
        updated_at: now,
      };
      await this.publications.commit({ did, version, marking });
    } catch (err) {
      await this.undo(
        delegation,
        { version: ownedRefFrom(id), chain, opened, opening },
        copies,
      );
      throw err;
    }
    return viewOf(publication, version);
  }

  /**
   * A publication and everything under it. The act fails if the store will not
   * let a copy go, rather than reporting a take-down to somebody whose picture
   * is still public.
   */
  async remove(delegation: Delegation, ref: OwnedRef): Promise<void> {
    const publication = await this.publications.find(delegation.did, ref);
    if (!publication) return;
    await this.acts.run(publication.root, () =>
      this.takeDown(delegation, publication),
    );
  }

  private async takeDown(
    delegation: Delegation,
    publication: Publication,
  ): Promise<void> {
    const did = delegation.did;
    const ref = ownedRefFrom(publication.id);
    const assets = await this.publications.assetsOf(did, ref);
    await inRuns(assets, COPIES_AT_ONCE, (asset) =>
      this.media.removePublishedCopy(delegation, asset.public_upload),
    );

    const versions = (await this.publications.versionRefs(did, ref)).map(
      (version) => version.ref,
    );
    const sources = await this.publications.sourcesIn(did, versions);
    const elsewhere = await this.publications.carriedElsewhere(
      did,
      sources,
      versions,
    );
    await this.publications.removeChain({
      did,
      publication,
      versions,
      clearing: sources
        .filter((source) => !elsewhere.has(source))
        .map((source) => recordIdFromOwnedRef("node", source)),
    });
  }

  /**
   * The chain this root publishes into, created on the first publish and before
   * any bytes go public. That order is what makes a publish recoverable: a
   * process that dies partway leaves no version, so nothing serves the branch,
   * but this row still owns the copies that attempt made — and publishing the
   * root again finds it, reuses them, and completes.
   *
   * `opened` says this publish is the one that created it, which is what lets
   * the undo take it back down.
   */
  private async chainFor(
    delegation: Delegation,
    root: Node,
  ): Promise<{ publication: Publication; opened: boolean }> {
    const did = delegation.did;
    const store = delegation.syr_instance_url;
    const ref = ownedRefFrom(root.id);
    const now = nowIso();
    const held = await this.publications.findByRoot(did, ref);
    if (held) {
      // The label follows the note: a person who renumbers the note a branch is
      // rooted at is cited by the new number from the next publish on.
      if (held.identity_store !== store || held.root_address !== root.address) {
        await this.publications.restate(
          did,
          ref,
          { identityStore: store, address: root.address },
          now,
        );
      }
      return {
        publication: {
          ...held,
          identity_store: store,
          root_address: root.address,
        },
        opened: false,
      };
    }
    try {
      const made = await this.publications.create({
        id: createOwnedRecordId("publication", did),
        created_by: did,
        root: ref,
        ...(root.address === undefined ? {} : { root_address: root.address }),
        graph: root.graph,
        comments: DEFAULT_COMMENT_ACCESS,
        identity_store: store,
        created_at: now,
        updated_at: now,
      });
      return { publication: made, opened: true };
    } catch (err) {
      // Two publishes of one root race here, and the unique index settles it.
      const won = await this.publications.findByRoot(did, ref);
      if (!won) throw err;
      return { publication: won, opened: false };
    }
  }

  /** Every note of the branch and every section of each, copied under the new
   *  version, and the notes whose mark the commit is about to set. */
  private async freeze(
    delegation: Delegation,
    into: {
      root: Node;
      version: OwnedRef;
      chain: OwnedRef;
      copies: Copies;
    },
  ): Promise<RecordId[]> {
    const did = delegation.did;
    const branch = inPreorder(
      into.root,
      await this.nodes.subtree(did, into.root),
    );
    const region = {
      root: ownedRefFrom(into.root.id),
      ...(into.root.address === undefined
        ? {}
        : { address: into.root.address }),
      graph: graphOf(into.root),
    };
    const carried = new Set(branch.map((node) => ownedRefFrom(node.id)));
    const reach = new Reach(carried, this.nodes, did);
    const catalog = new Catalog(this.syr, delegation);

    for (let at = 0; at < branch.length; at += NOTES_PER_BATCH) {
      const batch = branch.slice(at, at + NOTES_PER_BATCH);
      const stacks = await this.blocks.listByNodes(
        batch.map((node) => ownedRefFrom(node.id)),
      );
      await reach.learn(cited(batch, stacks));
      const emoji = await this.copyCited(
        delegation,
        into,
        catalog,
        batch,
        stacks,
      );
      await this.write(did, into, region, reach, emoji, batch, stacks, at);
    }
    return branch.filter((node) => !node.published).map((node) => node.id);
  }

  private async write(
    did: string,
    into: { version: OwnedRef; copies: Copies },
    region: { root: OwnedRef; address?: Address; graph: OwnedRef },
    reach: Reach,
    emoji: ReadonlyMap<string, string>,
    batch: readonly Node[],
    stacks: ReadonlyMap<OwnedRef, Block[]>,
    /** Where the first of this run sits in the version's walk of the branch. */
    from: number,
  ): Promise<void> {
    const held = snapshotted(into.copies, emoji, reach);
    const left = await this.publications.aliasesOf(
      did,
      region.graph,
      batch.map((node) => ownedRefFrom(node.id)),
    );
    const within = region.address;
    const now = nowIso();
    const nodes: SnapshotNode[] = [];
    const blocks: SnapshotBlock[] = [];
    for (const [at, node] of batch.entries()) {
      const source = ownedRefFrom(node.id);
      nodes.push(
        parseSnapshotNode({
          id: createOwnedRecordId("snapshot_node", did),
          created_by: did,
          version: into.version,
          source,
          ...(node.address === undefined ? {} : { address: node.address }),
          ord: ordAt(from + at),
          node: publishedNodeOf(node, region, {
            links: node.links.filter((target) => reach.holds(target)),
            edges: looksReaching(node.edges, (to) => reach.holds(to)),
            // A region its author gave no number opens no run of addresses for
            // an address left behind to lie inside, so none of them travels.
            aliases:
              within === undefined
                ? []
                : (left.get(source) ?? []).filter((was) =>
                    isInSubtree(within, was),
                  ),
          }),
          created_at: now,
          updated_at: now,
        }),
      );
      for (const block of stacks.get(source) ?? []) {
        blocks.push(
          SnapshotBlockSchema.parse({
            id: createOwnedRecordId("snapshot_block", did),
            created_by: did,
            version: into.version,
            source: ownedRefFrom(block.id),
            node: source,
            ord: block.ord,
            content: publishedDocument(block.content, held),
            created_at: now,
            updated_at: now,
          }),
        );
      }
    }
    await this.publications.addNodes(nodes);
    await this.publications.addBlocks(blocks);
  }

  /**
   * The publication's own copy of everything this run of notes draws, and where
   * each shortcode in it now draws from. A copy is made once per publication, so
   * publishing again sends nothing that was sent before — `snapshot_asset` is
   * the pairing, and one read of it answers "already copied?" for the whole
   * branch.
   */
  private async copyCited(
    delegation: Delegation,
    into: { chain: OwnedRef; copies: Copies },
    catalog: Catalog,
    batch: readonly Node[],
    stacks: ReadonlyMap<OwnedRef, Block[]>,
  ): Promise<Map<string, string>> {
    const wanted = new Map<
      string,
      { note: string; source: () => Promise<Picture> }
    >();
    const drawn = new Map<string, string>();
    for (const node of batch) {
      for (const block of stacks.get(ownedRefFrom(node.id)) ?? []) {
        for (const uploadId of citedUploads(block.content)) {
          if (into.copies.of(uploadId) !== undefined) continue;
          wanted.set(uploadId, {
            note: noteLabel(node),
            source: () =>
              this.media.ownStoredPicture(delegation, uploadId, "block"),
          });
        }
        for (const shortcode of citedEmoji(block.content)) {
          const entry = await catalog.of(shortcode);
          if (entry === undefined) continue;
          const id = entryId(entry);
          drawn.set(shortcode.toLowerCase(), id);
          if (into.copies.of(id) !== undefined) continue;
          wanted.set(id, {
            note: noteLabel(node),
            source: async () => ({
              url: entry.url,
              filename: entry.shortcode,
            }),
          });
        }
      }
    }

    await inRuns([...wanted], COPIES_AT_ONCE, async ([sourceId, asked]) => {
      const copy = await this.media.copyForPublication(
        delegation,
        await asked.source().catch((err: unknown) => {
          throw missing(err) ? notInTheLibrary(asked.note) : err;
        }),
      );
      const now = nowIso();
      const made: SnapshotAsset = {
        id: createOwnedRecordId("snapshot_asset", delegation.did),
        created_by: delegation.did,
        publication: into.chain,
        source_upload: sourceId,
        public_upload: copy.upload_id,
        created_at: now,
        updated_at: now,
      };
      // The bytes are public from the line above, so the undo is told about
      // them before anything else can fail: a copy the pairing row was refused
      // for is still a copy this publish made.
      into.copies.add(made);
      await this.publications.addAsset(made);
    });

    return new Map(
      [...drawn].flatMap(([shortcode, id]) => {
        const copy = into.copies.of(id);
        return copy === undefined ? [] : [[shortcode, copy] as const];
      }),
    );
  }

  /**
   * What a publish that failed leaves: nothing readable, no picture made public
   * by an act that did not finish, and — where this publish opened the chain —
   * no chain either.
   *
   * Two things hold a copy in place against that. A store that will not let one
   * go keeps its pairing row, and the row keeps the chain: it is a copy this
   * publication still owns rather than bytes nothing points at, and taking the
   * publication down is what reaches it. And a version another publish
   * committed while this one ran was written around these copies.
   */
  private async undo(
    delegation: Delegation,
    of: {
      version: OwnedRef;
      chain: OwnedRef;
      opened: boolean;
      opening: number;
    },
    copies: Copies,
  ): Promise<void> {
    if (await this.stillOurs(delegation.did, of)) {
      for (const asset of copies.made) {
        try {
          await this.media.removePublishedCopy(delegation, asset.public_upload);
          await this.publications.removeAssets([asset.id]);
        } catch (err) {
          this.logger.error(
            `A copy made for ${asset.publication} outlived the publish that made it: ${reason(err)}`,
          );
        }
      }
    }
    try {
      await this.publications.discardVersion(delegation.did, of.version);
      if (of.opened) {
        await this.publications.removeEmptyChain(delegation.did, of.chain);
      }
    } catch (err) {
      this.logger.error(`${of.version} left rows behind: ${reason(err)}`);
    }
  }

  /**
   * Whether the copies this publish made are still nobody else's to keep. A
   * version another publish committed while this one ran cites them and cannot
   * be edited, so taking them back would leave a peer reading a note whose
   * pictures are gone.
   */
  private async stillOurs(
    did: string,
    of: { chain: OwnedRef; opening: number },
  ): Promise<boolean> {
    try {
      // Below it where the whole chain went down meanwhile, which took the
      // copies with it.
      return (
        (await this.publications.nextSequence(did, of.chain)) <= of.opening
      );
    } catch (err) {
      // Unanswered is not "nobody else's", so the copies stay with the chain.
      this.logger.error(
        `What ${of.chain} owns could not be read back: ${reason(err)}`,
      );
      return false;
    }
  }
}

interface Picture {
  url: string;
  filename: string;
}

/** The copies a publication holds, as one publish sees them. */
class Copies {
  readonly made: SnapshotAsset[] = [];
  private readonly held = new Map<string, string>();

  constructor(rows: readonly SnapshotAsset[]) {
    for (const row of rows) this.held.set(row.source_upload, row.public_upload);
  }

  of(sourceId: string): string | undefined {
    return this.held.get(sourceId);
  }

  add(row: SnapshotAsset): void {
    this.held.set(row.source_upload, row.public_upload);
    this.made.push(row);
  }
}

/**
 * Which notes a published section may name: the ones this version carries, and
 * the ones a version somewhere already carried when this one was made. Anything
 * else is a note nobody published, and a citation of one carries neither the
 * note nor the title it was cited under.
 */
class Reach {
  private readonly asked = new Map<OwnedRef, boolean>();

  constructor(
    private readonly carried: ReadonlySet<OwnedRef>,
    private readonly nodes: NodeRepository,
    private readonly did: string,
  ) {}

  holds(note: OwnedRef): boolean {
    return this.carried.has(note) || this.asked.get(note) === true;
  }

  async learn(named: readonly OwnedRef[]): Promise<void> {
    const unknown = named.filter(
      (note) => !this.carried.has(note) && !this.asked.has(note),
    );
    if (unknown.length === 0) return;
    // A note somebody else wrote is not among these: `many` reads the caller's
    // own, so it stays unreachable and its citation is withheld.
    const found = await this.nodes.many(this.did, unknown);
    const published = new Set(
      found
        .filter((node) => node.published)
        .map((node) => ownedRefFrom(node.id)),
    );
    for (const note of unknown) this.asked.set(note, published.has(note));
  }
}

/** The author's own emoji, read once per publish and only where a section draws
 *  one. A note's shortcodes resolve against their catalog and nobody else's. */
class Catalog {
  private entries: Map<string, SyrEmoji> | undefined;

  constructor(
    private readonly syr: SyrService,
    private readonly delegation: Delegation,
  ) {}

  async of(shortcode: string): Promise<SyrEmoji | undefined> {
    if (this.entries === undefined) {
      const held = await this.syr.listOwnEmoji(this.delegation);
      this.entries = new Map(
        held.map((entry) => [entry.shortcode.toLowerCase(), entry]),
      );
    }
    return this.entries.get(shortcode.toLowerCase());
  }
}

/** What the walk in `snapshot.ts` asks after, answered from what this publish
 *  holds. */
function snapshotted(
  copies: Copies,
  emoji: ReadonlyMap<string, string>,
  reach: Reach,
): Snapshotted {
  return {
    copyOf: (uploadId) => copies.of(uploadId),
    emojiOf: (shortcode) => emoji.get(shortcode.toLowerCase()),
    reaches: (note) => reach.holds(note),
  };
}

/**
 * The pairing key a copy is filed under: what the author's own note cites the
 * picture BY. That is an upload for a picture and a catalog entry for an emoji,
 * and both are `<did>/<local id>` under the author.
 */
function entryId(entry: SyrEmoji): string {
  return `${entry.did}/${entry.local_id}`;
}

function cited(
  batch: readonly Node[],
  stacks: ReadonlyMap<OwnedRef, Block[]>,
): OwnedRef[] {
  const named = new Set<OwnedRef>();
  for (const node of batch) {
    for (const target of node.links) named.add(target);
    for (const look of node.edges ?? []) named.add(look.to);
    for (const block of stacks.get(ownedRefFrom(node.id)) ?? []) {
      for (const target of citedNotes(block.content)) named.add(target);
    }
  }
  return [...named];
}

/** A note the branch gained or lost: the whole of it moved, so nothing beneath
 *  the change is worth naming. */
function gainedOrLost(
  note: OwnedRef,
  address: Address | undefined,
  title: string,
  change: UnpublishedChange["change"],
): UnpublishedChange {
  return {
    note,
    ...(address === undefined ? {} : { address }),
    title,
    change,
    tags_gained: [],
    tags_lost: [],
    written: false,
  };
}

/** What one note has done since the version filed it, or `null` where it has
 *  done nothing a person can be told about without opening a section. */
function whatMoved(
  before: FiledNote,
  node: Node,
  written: boolean,
): UnpublishedChange | null {
  const gained = node.tags.filter((tag) => !before.tags.includes(tag));
  const lost = before.tags.filter((tag) => !node.tags.includes(tag));
  const renamed = before.title !== node.title;
  const carried = before.address !== node.address;
  if (
    !written &&
    !renamed &&
    !carried &&
    gained.length === 0 &&
    lost.length === 0
  ) {
    return null;
  }
  return {
    note: ownedRefFrom(node.id),
    ...(node.address === undefined ? {} : { address: node.address }),
    title: node.title,
    change: "changed",
    ...(carried && before.address !== undefined
      ? { was_at: before.address }
      : {}),
    ...(renamed ? { was_titled: before.title } : {}),
    tags_gained: gained,
    tags_lost: lost,
    written,
  };
}

/** A publication as its author reads it. `identity_store` is how this instance
 *  places a voice somebody claims to be, and stays on the row. */
function viewOf(
  row: Publication,
  version: PublicationVersion,
): PublicationView {
  const { identity_store: _store, ...view } = entityView(row);
  return { ...view, latest: publicationVersion(version) };
}

/**
 * `work`, a few at a time. A run finishes before a failure in it is thrown, so
 * an act that has to undo what it did knows everything it did — a copy landing
 * after the undo had already run would be a picture left public by a publish
 * that failed.
 */
async function inRuns<T>(
  all: readonly T[],
  atOnce: number,
  work: (one: T) => Promise<unknown>,
): Promise<void> {
  for (let at = 0; at < all.length; at += atOnce) {
    const run = await Promise.allSettled(all.slice(at, at + atOnce).map(work));
    const failed = run.find((one) => one.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function gone(): NotFoundException {
  return new NotFoundException("That is not published.");
}

/** A note cannot be published around a picture there is nothing to copy from,
 *  and the address is what tells somebody which note to open. */
function notInTheLibrary(note: string): BadRequestException {
  return new BadRequestException(
    `A picture in ${note} is not in your library. Take it out of the note and publish again.`,
  );
}

function missing(err: unknown): boolean {
  return (
    err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND
  );
}
