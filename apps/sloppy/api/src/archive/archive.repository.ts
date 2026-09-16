// The reads an import is checked against, and the one write it lands as.

import { Injectable } from "@nestjs/common";
import {
  type Amendment,
  AmendmentSchema,
  type Block,
  type DidSyr,
  type Node,
  type NodeAlias,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  parseNode,
  recordIdFromOwnedRef,
  type RetiredAddress,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";
import type { MergeWrite } from "./arriving";

/** A graph as an import leaves it: the notes that were there, everything the
 *  archive brings, and the addresses the departing notes take with them. */
export interface GraphWrite {
  /** Every note the graph held, whose sections go with them. */
  going: readonly OwnedRef[];
  nodes: readonly Node[];
  blocks: readonly Block[];
  aliases: readonly NodeAlias[];
  retiring: readonly RetiredAddress[];
  /** What the archive says is standing offered on the notes it brings. The
   *  graph's own offers go with the notes they stood on. */
  amendments: readonly Amendment[];
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

  /** How many notes one graph holds, the deleted ones included: what a replace
   *  takes with it. */
  async countIn(did: DidSyr, graph: OwnedRef): Promise<number> {
    const [[held]] = await this.query<number>(
      "SELECT VALUE count() FROM node WHERE created_by = $did AND graph = $graph GROUP ALL",
      { did, graph },
    );
    return held ?? 0;
  }

  /** Every address one graph leads its notes back by. A replace takes them all,
   *  so the ones it does not bring back are the graph's to retire. */
  async aliasesIn(did: DidSyr, graph: OwnedRef): Promise<NodeAlias[]> {
    const [rows] = await this.query<NodeAlias>(
      "SELECT * FROM node_alias WHERE created_by = $did AND graph = $graph",
      { did, graph },
    );
    return rows;
  }

  /** Every number one graph has spent and retired, each with the note that
   *  spent it where the row carries one. */
  async retiredIn(did: DidSyr, graph: OwnedRef): Promise<RetiredAddress[]> {
    const [rows] = await this.query<RetiredAddress>(
      "SELECT * FROM retired_address WHERE created_by = $did AND graph = $graph",
      { did, graph },
    );
    return rows;
  }

  /** What is standing offered on any of these notes. */
  async amendmentsOn(
    did: DidSyr,
    notes: readonly OwnedRef[],
  ): Promise<Amendment[]> {
    if (notes.length === 0) return [];
    const [rows] = await this.query(
      "SELECT * FROM amendment WHERE created_by = $did AND note IN $notes",
      { did, notes: [...notes] },
    );
    return rows.map((row) => AmendmentSchema.parse(row));
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
      ["amendment", write.amendments],
    ] as const;
    const arriving = new Set(write.nodes.map((node) => ownedRefFrom(node.id)));
    const gone = write.going.filter((ref) => !arriving.has(ref));
    const notes = [...new Set([...write.going, ...arriving])];
    const statements = [
      "BEGIN TRANSACTION;",
      ...(write.going.length > 0
        ? ["DELETE block WHERE created_by = $did AND node IN $going;"]
        : []),
      ...(gone.length > 0
        ? ["DELETE comment_pointer WHERE created_by = $did AND node IN $gone;"]
        : []),
      ...(notes.length > 0
        ? ["DELETE amendment WHERE created_by = $did AND note IN $notes;"]
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
      gone,
      notes,
      retired_address: [...write.retiring],
      node: [...write.nodes],
      block: [...write.blocks],
      node_alias: [...write.aliases],
      amendment: [...write.amendments],
    });
  }

  /**
   * The two copies of one graph settled into one, in a transaction: only the
   * notes the merge writes are touched, so a note the graph holds and the
   * archive does not — the ones in the bin included — is where it was.
   */
  async merge(did: DidSyr, graph: OwnedRef, write: MergeWrite): Promise<void> {
    const ids = write.writing.map((ref) => recordIdFromOwnedRef("node", ref));
    const yielding = write.yielding.map((ref) =>
      recordIdFromOwnedRef("node", ref),
    );
    const rows = [
      ["node", write.nodes],
      ["block", write.blocks],
      ["node_alias", write.aliases],
      ["amendment", write.amendments],
    ] as const;
    const unsettling = write.unsettling.map((ref) =>
      recordIdFromOwnedRef("amendment", ref),
    );
    const statements = [
      "BEGIN TRANSACTION;",
      ...(unsettling.length > 0
        ? ["DELETE amendment WHERE created_by = $did AND id IN $unsettling;"]
        : []),
      ...(write.writing.length > 0
        ? ["DELETE block WHERE created_by = $did AND node IN $writing;"]
        : []),
      ...(write.dropping.length > 0
        ? [
            `DELETE node_alias WHERE created_by = $did AND graph = $graph
               AND address IN $dropping;`,
          ]
        : []),
      ...(yielding.length > 0
        ? [
            `UPDATE node SET address = NONE, updated_at = $at
               WHERE created_by = $did AND id IN $yielding RETURN NONE;`,
          ]
        : []),
      ...(write.writing.length > 0
        ? ["DELETE node WHERE created_by = $did AND id IN $ids;"]
        : []),
      ...rows
        .filter(([, held]) => held.length > 0)
        .map(([table]) => `INSERT INTO ${table} $${table};`),
      "COMMIT TRANSACTION;",
    ];
    await this.db.handle.query(statements.join("\n"), {
      did,
      graph,
      ids,
      yielding,
      unsettling,
      at: nowIso(),
      writing: [...write.writing],
      dropping: [...write.dropping],
      node: [...write.nodes],
      block: [...write.blocks],
      node_alias: [...write.aliases],
      amendment: [...write.amendments],
    });
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
