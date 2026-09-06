// The reads a copy of somebody's own writing is walked by: one graph's notes at
// a time, then the sections of those notes, each page keyed off the last row of
// the one before it so nothing holds the whole graph.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  type Block,
  BlockSchema,
  type DidSyr,
  type Node,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

/** Where a page of sections left off: sections are read across a run of notes,
 *  ordered by the note and then the section's place in it. */
export interface BlockCursor {
  node: OwnedRef;
  ord: string;
}

@Injectable()
export class ExportRepository {
  constructor(private readonly db: DbService) {}

  /**
   * The live notes of one graph, in address order, after `from`. Ordered by the
   * column `node_owner_graph_address` is keyed on, and unique within the graph,
   * so a page picks up exactly where the last one stopped.
   */
  async notesIn(
    did: DidSyr,
    graph: OwnedRef,
    from: Address | undefined,
    limit: number,
  ): Promise<Node[]> {
    const after = from === undefined ? "" : " AND address > $from";
    const [rows] = await this.query(
      `SELECT * FROM node
         WHERE created_by = $did AND graph = $graph AND deleted_at = NONE${after}
         ORDER BY address LIMIT $limit`,
      { did, graph, from, limit },
    );
    return rows.map((row) => parseNode(row));
  }

  /**
   * The same run, as the reference and the key of the next page alone. The
   * sections of a graph are read a page of notes at a time, and by then the
   * notes have been written out and let go of.
   */
  async noteRefsIn(
    did: DidSyr,
    graph: OwnedRef,
    from: Address | undefined,
    limit: number,
  ): Promise<{ ref: OwnedRef; address: Address }[]> {
    const after = from === undefined ? "" : " AND address > $from";
    const [rows] = await this.query<{ id: RecordId; address: Address }>(
      `SELECT id, address FROM node
         WHERE created_by = $did AND graph = $graph AND deleted_at = NONE${after}
         ORDER BY address LIMIT $limit`,
      { did, graph, from, limit },
    );
    return rows.map((row) => ({
      ref: ownedRefFrom(row.id),
      address: row.address,
    }));
  }

  /** The live sections of a run of notes, in stack order within each note. */
  async blocksOf(
    did: DidSyr,
    nodes: readonly OwnedRef[],
    from: BlockCursor | undefined,
    limit: number,
  ): Promise<Block[]> {
    if (nodes.length === 0) return [];
    const after =
      from === undefined
        ? ""
        : " AND (node > $fromNode OR (node = $fromNode AND ord > $fromOrd))";
    const [rows] = await this.query(
      `SELECT * FROM block
         WHERE created_by = $did AND node IN $nodes AND deleted_at = NONE${after}
         ORDER BY node, ord LIMIT $limit`,
      {
        did,
        nodes: [...nodes],
        fromNode: from?.node,
        fromOrd: from?.ord,
        limit,
      },
    );
    return rows.map((row) => BlockSchema.parse(row));
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
