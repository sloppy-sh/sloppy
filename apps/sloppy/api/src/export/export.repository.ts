// The reads a copy of somebody's own writing is walked by.

import { Injectable } from "@nestjs/common";
import {
  type Block,
  BlockSchema,
  type DidSyr,
  type Node,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

/** Where a page of sections left off: sections are read across a run of notes,
 *  ordered by the note and then the section's place in it. */
export interface BlockCursor {
  node: OwnedRef;
  ord: string;
}

/** The keyset a page of notes is read on, as the clause and the variables it
 *  binds: every note has a reference, and not every note has an address. */
function pageOn(
  did: DidSyr,
  graph: OwnedRef,
  from: OwnedRef | undefined,
  limit: number,
) {
  return {
    after: from === undefined ? "" : " AND id > $from",
    vars: {
      did,
      graph,
      limit,
      from: from && recordIdFromOwnedRef("node", from),
    },
  };
}

@Injectable()
export class ExportRepository {
  constructor(private readonly db: DbService) {}

  /** The live notes of one graph, in reference order, after `from`. */
  async notesIn(
    did: DidSyr,
    graph: OwnedRef,
    from: OwnedRef | undefined,
    limit: number,
  ): Promise<Node[]> {
    const { after, vars } = pageOn(did, graph, from, limit);
    const [rows] = await this.query(
      `SELECT * FROM node
         WHERE created_by = $did AND graph = $graph AND deleted_at = NONE${after}
         ORDER BY id LIMIT $limit`,
      vars,
    );
    return rows.map((row) => parseNode(row));
  }

  /** The same run, as the reference alone, which is also the next page's key. */
  async noteRefsIn(
    did: DidSyr,
    graph: OwnedRef,
    from: OwnedRef | undefined,
    limit: number,
  ): Promise<OwnedRef[]> {
    const { after, vars } = pageOn(did, graph, from, limit);
    const [rows] = await this.query<{ id: RecordId }>(
      `SELECT id FROM node
         WHERE created_by = $did AND graph = $graph AND deleted_at = NONE${after}
         ORDER BY id LIMIT $limit`,
      vars,
    );
    return rows.map((row) => ownedRefFrom(row.id));
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
