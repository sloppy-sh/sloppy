// The publication tables: the chain, the snapshots a version froze, and the
// copies a publication owns. docs/ARCHITECTURE.md § "Data model" holds the row
// shapes and the reasoning behind the indexes these reads are written against.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  compareAddresses,
  type OwnedRef,
  ownedRefFrom,
  type Publication,
  PublicationSchema,
  type PublicationVersion,
  PublicationVersionSchema,
  parseSnapshotNode,
  type PublishedVersion,
  recordIdFromOwnedRef,
  type SnapshotAsset,
  SnapshotAssetSchema,
  type SnapshotBlock,
  SnapshotBlockSchema,
  type SnapshotNode,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

/** How many references one `IN` carries. A sweep over a published branch is a
 *  run of these rather than one statement the length of somebody's graph. */
const PER_STATEMENT = 500;

/** How a version names the branch it is of, as its own copy of the root note
 *  has it. `address` is absent where its author gave the branch no number. */
export interface RootLabel {
  title: string;
  address?: Address;
}

/** One note as a version filed it, read for comparison rather than for
 *  serving. */
export interface FiledNote {
  source: OwnedRef;
  /** Where it sits in the version's walk of the branch, which is what a read of
   *  the version resumes after. */
  ord: string;
  address?: Address;
  title: string;
  tags: string[];
}

@Injectable()
export class PublicationRepository {
  constructor(private readonly db: DbService) {}

  async find(did: string, ref: OwnedRef): Promise<Publication | null> {
    const [rows] = await this.query(
      "SELECT * FROM publication WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("publication", ref), did },
    );
    return rows[0] === undefined ? null : PublicationSchema.parse(rows[0]);
  }

  async findByRoot(did: string, root: OwnedRef): Promise<Publication | null> {
    const [rows] = await this.query(
      "SELECT * FROM publication WHERE created_by = $did AND root = $root",
      { did, root },
    );
    return rows[0] === undefined ? null : PublicationSchema.parse(rows[0]);
  }

  /** Everything the caller publishes. Their own listing, so it is not paged: a
   *  person has one publication per branch they published. */
  async listOwn(did: string): Promise<Publication[]> {
    const [rows] = await this.query(
      "SELECT * FROM publication WHERE created_by = $did ORDER BY root_address",
      { did },
    );
    return rows.map((row) => PublicationSchema.parse(row));
  }

  /** Which of these notes this author has a publication rooted at. */
  async rootsAmong(
    did: string,
    notes: readonly OwnedRef[],
  ): Promise<Set<OwnedRef>> {
    const [rows] = await this.query<OwnedRef>(
      `SELECT VALUE root FROM publication
         WHERE created_by = $did AND root IN $notes`,
      { did, notes },
    );
    return new Set(rows);
  }

  /**
   * One page of what an identity publishes, in the order a run reads: the
   * branches carrying a label first, by label, then the rest by the note each
   * is rooted at. That note settles the order where two carry none, and the
   * pair is the cursor — a label alone is not, now that a person may publish as
   * many unnumbered branches as they like.
   */
  async page(
    did: string,
    after: { address?: Address; root?: OwnedRef } | undefined,
    limit: number,
  ): Promise<Publication[]> {
    const from =
      after === undefined
        ? ""
        : after.root === undefined
          ? // A cursor minted before a listing carried the note as well, which
            // was one publication per address and pages on that.
            ` AND (root_address > $after OR root_address = NONE)`
          : after.address === undefined
            ? " AND root_address = NONE AND root > $afterRoot"
            : ` AND (root_address > $after
                 OR (root_address = $after AND root > $afterRoot)
                 OR root_address = NONE)`;
    const [rows] = await this.query(
      `SELECT *, root_address = NONE AS unnumbered FROM publication
         WHERE created_by = $did${from}
         ORDER BY unnumbered, root_address, root LIMIT $limit`,
      { did, after: after?.address, afterRoot: after?.root, limit },
    );
    return rows.map((row) => PublicationSchema.parse(row));
  }

  async create(row: Publication): Promise<Publication> {
    const { id, ...content } = row;
    const [rows] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      {
        id,
        content,
      },
    );
    return PublicationSchema.parse(rows[0]);
  }

  /**
   * What a publish restates about the branch it is of: where the author's
   * identity answered from — `Publication.identity_store` says what that is
   * read for — and the label the root note carries now, absent where they have
   * taken it off.
   */
  async restate(
    did: string,
    ref: OwnedRef,
    now: { identityStore: string; address: Address | undefined },
    at: string,
  ): Promise<void> {
    await this.query(
      `UPDATE $id SET identity_store = $identityStore, root_address = $address,
         updated_at = $at
         WHERE created_by = $did RETURN NONE`,
      {
        id: recordIdFromOwnedRef("publication", ref),
        did,
        identityStore: now.identityStore,
        address: now.address,
        at,
      },
    );
  }

  /** The terms of a conversation, changed. It publishes nothing, so no version
   *  is written and the snapshots are untouched. */
  async setComments(
    did: string,
    ref: OwnedRef,
    comments: Publication["comments"],
    at: string,
  ): Promise<Publication | null> {
    const [rows] = await this.query(
      `UPDATE $id SET comments = $comments, updated_at = $at
         WHERE created_by = $did RETURN AFTER`,
      { id: recordIdFromOwnedRef("publication", ref), did, comments, at },
    );
    return rows[0] === undefined ? null : PublicationSchema.parse(rows[0]);
  }

  /** The newest version of each publication named, which is what a plain read
   *  of one answers with. A publication with none is absent: its first publish
   *  did not finish, and nothing serves it. */
  async latestOf(
    did: string,
    publications: readonly OwnedRef[],
  ): Promise<Map<OwnedRef, PublicationVersion>> {
    const latest = new Map<OwnedRef, PublicationVersion>();
    if (publications.length === 0) return latest;
    const [tops] = await this.query<{
      publication: OwnedRef;
      sequence: number;
    }>(
      `SELECT publication, math::max(sequence) AS sequence
         FROM publication_version
         WHERE created_by = $did AND publication IN $publications
         GROUP BY publication`,
      { did, publications: [...publications] },
    );
    if (tops.length === 0) return latest;
    const [rows] = await this.query(
      `SELECT * FROM publication_version
         WHERE created_by = $did AND publication IN $publications
           AND sequence IN $sequences`,
      {
        did,
        publications: tops.map((top) => top.publication),
        sequences: [...new Set(tops.map((top) => top.sequence))],
      },
    );
    const wanted = new Map(tops.map((top) => [top.publication, top.sequence]));
    for (const row of rows) {
      const version = PublicationVersionSchema.parse(row);
      if (wanted.get(version.publication) === version.sequence) {
        latest.set(version.publication, version);
      }
    }
    return latest;
  }

  /** One page of a chain, newest first. */
  async versionsPage(
    did: string,
    publication: OwnedRef,
    below: number | undefined,
    limit: number,
  ): Promise<PublicationVersion[]> {
    const from = below === undefined ? "" : " AND sequence < $below";
    const [rows] = await this.query(
      `SELECT * FROM publication_version
         WHERE created_by = $did AND publication = $publication${from}
         ORDER BY sequence DESC LIMIT $limit`,
      { did, publication, below, limit },
    );
    return rows.map((row) => PublicationVersionSchema.parse(row));
  }

  async findVersion(
    did: string,
    ref: OwnedRef,
  ): Promise<PublicationVersion | null> {
    const [rows] = await this.query(
      "SELECT * FROM publication_version WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("publication_version", ref), did },
    );
    return rows[0] === undefined
      ? null
      : PublicationVersionSchema.parse(rows[0]);
  }

  async versionRefs(
    did: string,
    publication: OwnedRef,
  ): Promise<{ ref: OwnedRef; id: RecordId }[]> {
    const [rows] = await this.query(
      `SELECT id FROM publication_version
         WHERE created_by = $did AND publication = $publication`,
      { did, publication },
    );
    return rows.map((row) => {
      const { id } = row as { id: RecordId };
      return { ref: ownedRefFrom(id), id };
    });
  }

  /** The number the next version of this chain takes. The unique index is what
   *  settles two publishes that read the same answer. */
  async nextSequence(did: string, publication: OwnedRef): Promise<number> {
    const [rows] = await this.query<number>(
      `SELECT VALUE sequence FROM publication_version
         WHERE created_by = $did AND publication = $publication
         ORDER BY sequence DESC LIMIT 1`,
      { did, publication },
    );
    return (rows[0] ?? 0) + 1;
  }

  /** The addresses each of these notes has been moved away from, in address
   *  order. */
  async aliasesOf(
    did: string,
    graph: OwnedRef,
    notes: readonly OwnedRef[],
  ): Promise<Map<OwnedRef, Address[]>> {
    const left = new Map<OwnedRef, Address[]>();
    for (const some of chunks(notes)) {
      const [rows] = await this.query<{ note: OwnedRef; address: Address }>(
        `SELECT note, address FROM node_alias
           WHERE created_by = $did AND graph = $graph AND note IN $notes`,
        { did, graph, notes: some },
      );
      for (const row of rows) {
        const held = left.get(row.note);
        if (held) held.push(row.address);
        else left.set(row.note, [row.address]);
      }
    }
    for (const addresses of left.values()) addresses.sort(compareAddresses);
    return left;
  }

  async addNodes(rows: readonly SnapshotNode[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.handle.query("INSERT INTO snapshot_node $rows", {
      rows: [...rows],
    });
  }

  async addBlocks(rows: readonly SnapshotBlock[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.handle.query("INSERT INTO snapshot_block $rows", {
      rows: [...rows],
    });
  }

  /** One run of a version's notes in the order it was written down — parents
   *  ahead of the notes that spring from them. */
  async nodesFrom(
    did: string,
    version: OwnedRef,
    after: string | undefined,
    limit: number,
  ): Promise<SnapshotNode[]> {
    const from = after === undefined ? "" : " AND ord > $after";
    const [rows] = await this.query(
      `SELECT * FROM snapshot_node
         WHERE created_by = $did AND version = $version${from}
         ORDER BY ord LIMIT $limit`,
      { did, version, after, limit },
    );
    return rows.map(parseSnapshotNode);
  }

  /**
   * What a version says about each of its notes, without the notes themselves:
   * enough to tell an author what their branch has gained, lost, renamed and
   * retagged since, and none of the writing, which is not comparable against a
   * draft (`UnpublishedChange` in `@sloppy/types`).
   */
  async notesIn(
    did: string,
    version: OwnedRef,
    after: string | undefined,
    limit: number,
  ): Promise<FiledNote[]> {
    const from = after === undefined ? "" : " AND ord > $after";
    const [rows] = await this.query<FiledNote>(
      `SELECT source, ord, address, node.title AS title, node.tags AS tags
         FROM snapshot_node
         WHERE created_by = $did AND version = $version${from}
         ORDER BY ord LIMIT $limit`,
      { did, version, after, limit },
    );
    return rows;
  }

  /** The rows one version holds for these notes, wherever it addresses them —
   *  what a comparison asks about a note the other version does not have where
   *  it is looking. */
  async nodesBySource(
    did: string,
    version: OwnedRef,
    sources: readonly OwnedRef[],
  ): Promise<SnapshotNode[]> {
    const found: SnapshotNode[] = [];
    for (const some of chunks(sources)) {
      const [rows] = await this.query(
        `SELECT * FROM snapshot_node
           WHERE created_by = $did AND version = $version AND source IN $sources`,
        { did, version, sources: some },
      );
      found.push(...rows.map(parseSnapshotNode));
    }
    return found;
  }

  /** The note a version has at one place in its walk — where a read resumes
   *  inside a stack that ran past a page. */
  async nodeAt(
    did: string,
    version: OwnedRef,
    ord: string,
  ): Promise<SnapshotNode | null> {
    const [rows] = await this.query(
      `SELECT * FROM snapshot_node
         WHERE created_by = $did AND version = $version AND ord = $ord`,
      { did, version, ord },
    );
    return rows[0] === undefined ? null : parseSnapshotNode(rows[0]);
  }

  /** The stacks of a run of notes. Bounded, and the caller is told when the
   *  bound was reached: the order here is by reference and the run it answers
   *  is by address, so a short answer says nothing about which notes are whole. */
  async blocksOf(
    did: string,
    version: OwnedRef,
    nodes: readonly OwnedRef[],
    limit: number,
  ): Promise<SnapshotBlock[]> {
    if (nodes.length === 0) return [];
    const [rows] = await this.query(
      `SELECT * FROM snapshot_block
         WHERE created_by = $did AND version = $version AND node IN $nodes
         ORDER BY node, ord LIMIT $limit`,
      { did, version, nodes: [...nodes], limit },
    );
    return rows.map((row) => SnapshotBlockSchema.parse(row));
  }

  /** The rest of one note's stack, for a note whose sections ran past a page. */
  async blocksAfter(
    did: string,
    version: OwnedRef,
    node: OwnedRef,
    ord: string,
    limit: number,
  ): Promise<SnapshotBlock[]> {
    const [rows] = await this.query(
      `SELECT * FROM snapshot_block
         WHERE created_by = $did AND version = $version AND node = $node
           AND ord > $ord
         ORDER BY ord LIMIT $limit`,
      { did, version, node, ord, limit },
    );
    return rows.map((row) => SnapshotBlockSchema.parse(row));
  }

  /** What each of these versions publishes under: the title and the label its
   *  own copy of the note the publication is rooted at was frozen with. */
  async rootLabels(
    did: string,
    of: readonly { version: OwnedRef; root: OwnedRef }[],
  ): Promise<Map<OwnedRef, RootLabel>> {
    const labels = new Map<OwnedRef, RootLabel>();
    if (of.length === 0) return labels;
    const [rows] = await this.query<{
      version: OwnedRef;
      source: OwnedRef;
      title: string;
      address?: Address;
    }>(
      `SELECT version, source, address, node.title AS title FROM snapshot_node
         WHERE created_by = $did AND version IN $versions
           AND source IN $roots`,
      {
        did,
        versions: of.map((one) => one.version),
        roots: [...new Set(of.map((one) => one.root))],
      },
    );
    const wanted = new Map(of.map((one) => [one.version, one.root]));
    for (const row of rows) {
      if (wanted.get(row.version) === row.source) {
        labels.set(row.version, {
          title: row.title,
          ...(row.address === undefined ? {} : { address: row.address }),
        });
      }
    }
    return labels;
  }

  /** What the author calls each of those notebooks. A graph with no row here
   *  has no name to send, which is the absent answer on the wire. */
  async graphTitles(
    did: string,
    graphs: readonly OwnedRef[],
  ): Promise<Map<OwnedRef, string>> {
    const named = new Map<OwnedRef, string>();
    const wanted = [...new Set(graphs)];
    if (wanted.length === 0) return named;
    const [rows] = await this.query<{ id: RecordId; title: string }>(
      "SELECT id, title FROM graph WHERE created_by = $did AND id IN $ids",
      {
        did,
        ids: wanted.map((ref) => recordIdFromOwnedRef("graph", ref)),
      },
    );
    for (const row of rows) named.set(ownedRefFrom(row.id), row.title);
    return named;
  }

  async assetsOf(did: string, publication: OwnedRef): Promise<SnapshotAsset[]> {
    const [rows] = await this.query(
      `SELECT * FROM snapshot_asset
         WHERE created_by = $did AND publication = $publication`,
      { did, publication },
    );
    return rows.map((row) => SnapshotAssetSchema.parse(row));
  }

  async addAsset(row: SnapshotAsset): Promise<void> {
    await this.query("CREATE $id CONTENT $content RETURN NONE", {
      id: row.id,
      content: rowOf(row),
    });
  }

  async removeAssets(ids: readonly RecordId[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.handle.query("DELETE $ids", { ids: [...ids] });
  }

  /**
   * The moment a version exists. Nothing serves a snapshot without this row, so
   * everything above is written before it and a publish that fails partway
   * leaves rows nobody can reach rather than half a version.
   *
   * The marks go in the same transaction because the two must not disagree:
   * `node.published` says a version carries the note (docs/ARCHITECTURE.md
   * § "Data model"), and a second statement could land without them.
   */
  async commit(work: {
    did: string;
    version: PublicationVersion;
    marking: readonly RecordId[];
  }): Promise<void> {
    const statements = ["BEGIN TRANSACTION;"];
    const vars: Record<string, unknown> = {
      did: work.did,
      versionId: work.version.id,
      version: rowOf(work.version),
    };
    statements.push("CREATE $versionId CONTENT $version;");
    for (const [at, marking] of chunks(work.marking).entries()) {
      statements.push(
        `UPDATE $marking${at} SET published = true WHERE created_by = $did RETURN NONE;`,
      );
      vars[`marking${at}`] = marking;
    }
    statements.push("COMMIT TRANSACTION;");
    await this.db.handle.query(statements.join("\n"), vars);
  }

  /**
   * A chain a first publish opened and did not fill, taken back down. The guard
   * is inside the statement rather than a read before it, because a second
   * publish of the same root shares this chain and may be writing under it: a
   * version or a copy is a claim on it, and either one keeps it.
   */
  async removeEmptyChain(did: string, ref: OwnedRef): Promise<void> {
    await this.db.handle.query(
      `DELETE publication WHERE id = $id AND created_by = $did
         AND array::len((SELECT VALUE id FROM publication_version
             WHERE created_by = $did AND publication = $publication)) = 0
         AND array::len((SELECT VALUE id FROM snapshot_asset
             WHERE created_by = $did AND publication = $publication)) = 0;`,
      { did, publication: ref, id: recordIdFromOwnedRef("publication", ref) },
    );
  }

  /** What a publish that failed leaves behind: rows under a version that was
   *  never written, so nothing was ever serving them. */
  async discardVersion(did: string, version: OwnedRef): Promise<void> {
    await this.db.handle.query(
      `DELETE snapshot_block WHERE created_by = $did AND version = $version;
       DELETE snapshot_node WHERE created_by = $did AND version = $version;`,
      { did, version },
    );
  }

  /** Every note the versions named carry, each once. */
  async sourcesIn(
    did: string,
    versions: readonly OwnedRef[],
  ): Promise<OwnedRef[]> {
    if (versions.length === 0) return [];
    const held = new Set<OwnedRef>();
    for (const some of chunks(versions)) {
      const [rows] = await this.query<OwnedRef>(
        `SELECT VALUE source FROM snapshot_node
           WHERE created_by = $did AND version IN $versions`,
        { did, versions: some },
      );
      for (const source of rows) held.add(source);
    }
    return [...held];
  }

  /** Of the notes named, the ones a version OTHER than those still carries —
   *  which is what a mark must survive on when a publication goes. */
  async carriedElsewhere(
    did: string,
    sources: readonly OwnedRef[],
    besides: readonly OwnedRef[],
  ): Promise<Set<OwnedRef>> {
    const carried = new Set<OwnedRef>();
    for (const some of chunks(sources)) {
      const [rows] = await this.query<OwnedRef>(
        `SELECT VALUE source FROM snapshot_node
           WHERE created_by = $did AND source IN $sources
             AND version NOT IN $besides`,
        { did, sources: some, besides: [...besides] },
      );
      for (const source of rows) carried.add(source);
    }
    return carried;
  }

  /**
   * A publication and everything under it, in one transaction: the marks it was
   * keeping, its versions, the notes and sections they froze, and the rows
   * pairing its copies with the pictures they were made from. The bytes are
   * gone before this runs — a row deleted while a public copy survived would
   * leave nothing pointing at it.
   */
  async removeChain(work: {
    did: string;
    publication: Publication;
    versions: readonly OwnedRef[];
    clearing: readonly RecordId[];
  }): Promise<void> {
    const statements = ["BEGIN TRANSACTION;"];
    const vars: Record<string, unknown> = {
      did: work.did,
      publication: ownedRefFrom(work.publication.id),
      publicationId: work.publication.id,
    };
    for (const [at, clearing] of chunks(work.clearing).entries()) {
      statements.push(
        `UPDATE $clearing${at} SET published = false WHERE created_by = $did RETURN NONE;`,
      );
      vars[`clearing${at}`] = clearing;
    }
    for (const [at, versions] of chunks(work.versions).entries()) {
      statements.push(
        `DELETE snapshot_block WHERE created_by = $did AND version IN $versions${at};`,
        `DELETE snapshot_node WHERE created_by = $did AND version IN $versions${at};`,
      );
      vars[`versions${at}`] = versions;
    }
    statements.push(
      "DELETE snapshot_asset WHERE created_by = $did AND publication = $publication;",
      "DELETE publication_version WHERE created_by = $did AND publication = $publication;",
      "DELETE $publicationId;",
      "COMMIT TRANSACTION;",
    );
    await this.db.handle.query(statements.join("\n"), vars);
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}

/** One version as everything that names one carries it. */
export function publicationVersion(row: PublicationVersion): PublishedVersion {
  return {
    ref: ownedRefFrom(row.id),
    sequence: row.sequence,
    published_at: row.created_at,
  };
}

function rowOf<T extends { id: RecordId }>(entity: T): Omit<T, "id"> {
  const { id: _key, ...content } = entity;
  return content;
}

function chunks<T>(all: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (let at = 0; at < all.length; at += PER_STATEMENT) {
    runs.push(all.slice(at, at + PER_STATEMENT));
  }
  return runs;
}
