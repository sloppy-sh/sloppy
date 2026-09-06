// The four tables a held region is made of — `pull`, `pull_member`,
// `pulled_node` and `pulled_block`. docs/ARCHITECTURE.md § "Federating the
// graph" holds the row shapes and what a refresh and a drop must each take.
//
// `created_by` on every one of them is the READER: they own the copy.

import { Injectable } from "@nestjs/common";
import {
  type DidSyr,
  type OwnedRef,
  type Pull,
  type PulledBlock,
  PulledBlockSchema,
  type PulledNode,
  PullSchema,
  createOwnedRecordId,
  compareOrd,
  nowIso,
  ownedRefFrom,
  parsePulledNode,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import { wordsOf } from "../block/text";
import { DbService } from "../db/db.service";

/** A row as an answer states it. What the reader stamps on it — who holds the
 *  copy and when it arrived — is this repository's. */
type Held<T> = Omit<T, "id" | "created_by" | "created_at" | "updated_at">;

export interface HeldPage {
  /** `source_graph` is narrowed to required: it is half of what an address is
   *  unique under here, and a row written without it is one the unique index
   *  cannot constrain at all. */
  nodes: readonly (Held<PulledNode> & { source_graph: OwnedRef })[];
  blocks: readonly Held<PulledBlock>[];
}

export type RegionTerms = Held<Pull>;

@Injectable()
export class PullRepository {
  constructor(private readonly db: DbService) {}

  async listPulls(reader: DidSyr): Promise<Pull[]> {
    const [rows] = await this.query(
      "SELECT * FROM pull WHERE created_by = $reader ORDER BY updated_at DESC",
      { reader },
    );
    return rows.map((row) => PullSchema.parse(row));
  }

  async findPull(reader: DidSyr, ref: OwnedRef): Promise<Pull | null> {
    const [rows] = await this.query(
      "SELECT * FROM pull WHERE id = $id AND created_by = $reader",
      { id: recordIdFromOwnedRef("pull", ref), reader },
    );
    return rows[0] === undefined ? null : PullSchema.parse(rows[0]);
  }

  /**
   * The region row a run writes into: one per reader and publication, so
   * pulling the same publication again refreshes the region rather than growing
   * a second beside it. Where it is already there it comes back untouched — it
   * still describes the copy the reader is holding until {@link settleRegion}
   * says the refresh reached the last page.
   */
  async openRegion(reader: DidSyr, region: RegionTerms): Promise<Pull> {
    const [held] = await this.query(
      "SELECT * FROM pull WHERE created_by = $reader AND publication = $publication",
      { reader, publication: region.publication },
    );
    if (held[0] !== undefined) return PullSchema.parse(held[0]);

    const at = nowIso();
    const [written] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      {
        id: createOwnedRecordId("pull", reader),
        content: {
          created_by: reader,
          ...region,
          created_at: at,
          updated_at: at,
        },
      },
    );
    return PullSchema.parse(written[0]);
  }

  /** A refresh that reached the last page: the snapshot the copy is now of, and
   *  `updated_at` as the moment it was last made whole. */
  async settleRegion(pull: Pull, region: RegionTerms): Promise<Pull> {
    const [written] = await this.query(
      `UPDATE $id SET version = $version, root_address = $address,
         graph = $graph, comments = $comments, source_url = $url,
         updated_at = $at RETURN AFTER`,
      {
        id: pull.id,
        version: region.version,
        address: region.root_address,
        graph: region.graph,
        comments: region.comments,
        url: region.source_url,
        at: nowIso(),
      },
    );
    return PullSchema.parse(written[0]);
  }

  /**
   * One page of an answer, written under the reader's name.
   *
   * Held rows the page replaces go first, and a note the author now addresses
   * differently goes with them — `pulled_node` is UNIQUE on the author, their
   * graph and the address, and an author who deletes a branch's first child and
   * writes a new one hands out an address the reader is still holding.
   *
   * The region's own membership is written before the notes it serves. A run
   * that fails between the two leaves a region saying it serves a note that is
   * not here, which the next refresh settles; the other order leaves a note no
   * region serves, which nothing but the reader's own erasure would ever reach.
   */
  async writePage(
    reader: DidSyr,
    author: DidSyr,
    pull: OwnedRef,
    page: HeldPage,
  ): Promise<void> {
    const at = nowIso();
    const sources = page.nodes.map((node) => node.source);
    const addresses = page.nodes.map((node) => node.address);

    if (addresses.length > 0) {
      // Bound to the graph the region came from, or the drop takes a copy the
      // reader holds for a region that never served it.
      const [taken] = await this.query<OwnedRef>(
        `SELECT VALUE source FROM pulled_node
           WHERE created_by = $reader AND source_did = $author
             AND source_graph = $graph AND address IN $addresses`,
        { reader, author, graph: page.nodes[0].source_graph, addresses },
      );
      await this.forget(
        reader,
        taken.filter((source) => !sources.includes(source)),
      );
    }

    const statements: string[] = [];
    if (sources.length > 0) {
      statements.push(
        `DELETE pull_member WHERE created_by = $reader AND pull = $pull AND source IN $sources;`,
        "INSERT INTO pull_member $members;",
        "DELETE pulled_block WHERE created_by = $reader AND node IN $sources;",
        "DELETE pulled_node WHERE created_by = $reader AND source IN $sources;",
        "INSERT INTO pulled_node $nodes;",
      );
    }
    if (page.blocks.length > 0) {
      statements.push("INSERT INTO pulled_block $blocks;");
    }
    if (statements.length === 0) return;

    await this.db.handle.query(statements.join("\n"), {
      reader,
      pull,
      sources,
      members: sources.map((source) => ({
        id: createOwnedRecordId("pull_member", reader),
        created_by: reader,
        pull,
        source,
        created_at: at,
        updated_at: at,
      })),
      nodes: page.nodes.map((node) => ({
        id: createOwnedRecordId("pulled_node", reader),
        created_by: reader,
        ...node,
        created_at: at,
        updated_at: at,
      })),
      blocks: page.blocks.map((block) => ({
        id: createOwnedRecordId("pulled_block", reader),
        created_by: reader,
        ...block,
        // Derived on arrival the way a section of one's own is, so a search
        // reaches a note the reader is holding.
        text: wordsOf(block.content),
        created_at: at,
        updated_at: at,
      })),
    });
  }

  /** Every note a region serves, which is what a refresh sweeps against. */
  async served(reader: DidSyr, pull: OwnedRef): Promise<OwnedRef[]> {
    const [rows] = await this.query<OwnedRef>(
      "SELECT VALUE source FROM pull_member WHERE created_by = $reader AND pull = $pull",
      { reader, pull },
    );
    return rows;
  }

  /**
   * Notes a region stops serving. They leave the reader's store only where no
   * surviving region serves them — two regions of one author's graph share
   * their notes, and letting one go is not letting the other go.
   */
  async release(
    reader: DidSyr,
    pull: OwnedRef,
    sources: readonly OwnedRef[],
  ): Promise<void> {
    if (sources.length === 0) return;
    await this.db.handle.query(
      `DELETE pull_member WHERE created_by = $reader AND pull = $pull AND source IN $sources;`,
      { reader, pull, sources },
    );
    const [stillServed] = await this.query<OwnedRef>(
      "SELECT VALUE source FROM pull_member WHERE created_by = $reader AND source IN $sources",
      { reader, sources },
    );
    const orphaned = sources.filter((source) => !stillServed.includes(source));
    await this.forget(reader, orphaned);
  }

  /** The region row itself, once what it served has been let go. */
  async closeRegion(reader: DidSyr, pull: Pull): Promise<void> {
    await this.db.handle.query(
      "DELETE pull WHERE id = $id AND created_by = $reader",
      { id: pull.id, reader },
    );
  }

  async nodesBySource(
    reader: DidSyr,
    sources: readonly OwnedRef[],
  ): Promise<PulledNode[]> {
    if (sources.length === 0) return [];
    const [rows] = await this.query(
      "SELECT * FROM pulled_node WHERE created_by = $reader AND source IN $sources",
      { reader, sources },
    );
    return rows.map(parsePulledNode);
  }

  /** A held note's stack, in `ord` order — sorted here rather than by the
   *  server, so the order is the one `compareOrd` defines. */
  async blocksOf(reader: DidSyr, node: OwnedRef): Promise<PulledBlock[]> {
    const [rows] = await this.query(
      "SELECT * FROM pulled_block WHERE created_by = $reader AND node = $node",
      { reader, node },
    );
    return rows
      .map((row) => PulledBlockSchema.parse(row))
      .sort((a, b) => compareOrd(a.ord, b.ord));
  }

  /** A note and its interior leave together; a block outliving its note is
   *  unreachable. */
  private async forget(
    reader: DidSyr,
    sources: readonly OwnedRef[],
  ): Promise<void> {
    if (sources.length === 0) return;
    await this.db.handle.query(
      `DELETE pull_member WHERE created_by = $reader AND source IN $sources;
       DELETE pulled_block WHERE created_by = $reader AND node IN $sources;
       DELETE pulled_node WHERE created_by = $reader AND source IN $sources;`,
      { reader, sources },
    );
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}

/** The reference a `pull` row is cited by. */
export function pullRef(pull: Pull): OwnedRef {
  return ownedRefFrom(pull.id);
}
