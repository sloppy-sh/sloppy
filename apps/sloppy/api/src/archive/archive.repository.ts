// The reads an import is checked against, and the one write it lands as.

import { Injectable } from "@nestjs/common";
import {
  type Block,
  type DidSyr,
  type Node,
  type NodeAlias,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  recordIdFromOwnedRef,
  type RetiredAddress,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

/** A graph as an import leaves it: the notes that were there, everything the
 *  archive brings, and the addresses the departing notes take with them. */
export interface GraphWrite {
  /** Every note the graph held, whose sections go with them. */
  going: readonly OwnedRef[];
  nodes: readonly Node[];
  blocks: readonly Block[];
  aliases: readonly NodeAlias[];
  retiring: readonly RetiredAddress[];
}

@Injectable()
export class ArchiveRepository {
  constructor(private readonly db: DbService) {}

  /** Every note of one graph, the deleted ones included: an import replaces the
   *  graph, so a note in the bin is part of what it replaces. */
  async notesIn(did: DidSyr, graph: OwnedRef): Promise<Node[]> {
    const [rows] = await this.query(
      "SELECT * FROM node WHERE created_by = $did AND graph = $graph",
      { did, graph },
    );
    return rows.map((row) => parseNode(row));
  }

  /** Of the notes arriving, the ones this person already keeps somewhere other
   *  than the graph the archive is landing in. */
  async heldOutside(
    did: DidSyr,
    graph: OwnedRef,
    refs: readonly OwnedRef[],
  ): Promise<OwnedRef[]> {
    if (refs.length === 0) return [];
    const [rows] = await this.query<RecordId>(
      `SELECT VALUE id FROM node
         WHERE created_by = $did AND graph != $graph AND id IN $ids`,
      {
        did,
        graph,
        ids: refs.map((ref) => recordIdFromOwnedRef("node", ref)),
      },
    );
    return rows.map(ownedRefFrom);
  }

  /**
   * The graph as the archive has it, in one transaction: what was there goes
   * and what arrived lands, so a refusal anywhere leaves the graph as it was
   * rather than half replaced.
   */
  async replace(
    did: DidSyr,
    graph: OwnedRef,
    write: GraphWrite,
  ): Promise<void> {
    const rows = [
      ["retired_address", write.retiring],
      ["node", write.nodes],
      ["block", write.blocks],
      ["node_alias", write.aliases],
    ] as const;
    const statements = [
      "BEGIN TRANSACTION;",
      ...(write.going.length > 0
        ? ["DELETE block WHERE created_by = $did AND node IN $going;"]
        : []),
      "DELETE node_alias WHERE created_by = $did AND graph = $graph;",
      "DELETE node WHERE created_by = $did AND graph = $graph;",
      ...rows
        .filter(([, held]) => held.length > 0)
        .map(([table]) => `INSERT INTO ${table} $${table};`),
      "COMMIT TRANSACTION;",
    ];
    await this.db.handle.query(statements.join("\n"), {
      did,
      graph,
      going: [...write.going],
      retired_address: [...write.retiring],
      node: [...write.nodes],
      block: [...write.blocks],
      node_alias: [...write.aliases],
    });
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
