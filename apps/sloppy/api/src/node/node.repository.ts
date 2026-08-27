// The `node` table. docs/ARCHITECTURE.md § "Data model" holds the row shape and
// the reasoning behind the indexes these reads are written against.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  compareAddresses,
  isAncestorAddress,
  type LabelSet,
  type Node,
  nowIso,
  ownedRefFrom,
  type OwnedRef,
  parseNode,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

/** What `UPDATE … MERGE` may carry; the immutable columns are absent by type. */
export type NodePatch = Partial<Pick<Node, "title" | "labels" | "links">>;

@Injectable()
export class NodeRepository {
  constructor(private readonly db: DbService) {}

  async roots(did: string): Promise<Node[]> {
    return this.read(
      "SELECT * FROM node WHERE created_by = $did AND parent = NONE",
      { did },
    );
  }

  /**
   * One tree, optionally cut off past `maxDepth` levels — the level-of-detail
   * read `node_owner_origin_depth` exists for.
   */
  async region(
    did: string,
    origin: OwnedRef,
    maxDepth?: number,
  ): Promise<Node[]> {
    const bound = maxDepth == null ? "" : " AND depth <= $maxDepth";
    return this.read(
      `SELECT * FROM node WHERE created_by = $did AND origin = $origin${bound}`,
      { did, origin, maxDepth },
    );
  }

  async find(did: string, ref: OwnedRef): Promise<Node | null> {
    const [rows] = await this.query(
      "SELECT * FROM node WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("node", ref), did },
    );
    const row = rows[0];
    return row === undefined ? null : parseNode(row);
  }

  /**
   * The addresses already taken among the children of `parent`, or among the
   * roots when it is absent.
   *
   * Children are read through the tree-and-level index rather than through
   * `parent`: measured on 3.1.3, an equality on `parent` bound as a parameter
   * is left as a filter over the whole owner, while `origin` and `depth` fold
   * into the index access.
   */
  async childAddresses(did: string, parent: Node | null): Promise<Address[]> {
    if (parent === null) {
      const [rows] = await this.query<string>(
        "SELECT VALUE address FROM node WHERE created_by = $did AND parent = NONE",
        { did },
      );
      return rows;
    }
    const [rows] = await this.query<string>(
      `SELECT VALUE address FROM node
         WHERE created_by = $did AND origin = $origin AND depth = $depth
           AND parent = $parent`,
      {
        did,
        origin: parent.origin,
        depth: parent.depth + 1,
        parent: ownedRefFrom(parent.id),
      },
    );
    return rows;
  }

  async addressTaken(did: string, address: Address): Promise<boolean> {
    const [rows] = await this.query<string>(
      "SELECT VALUE address FROM node WHERE created_by = $did AND address = $address LIMIT 1",
      { did, address },
    );
    return rows.length > 0;
  }

  async insert(node: Node): Promise<Node> {
    const { id, ...content } = node;
    const [rows] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      { id, content },
    );
    return parseNode(rows[0]);
  }

  async patch(
    did: string,
    ref: OwnedRef,
    changes: NodePatch,
  ): Promise<Node | null> {
    // The owner is part of the statement, not a check on what comes back: a
    // reference names its owner, so anybody could otherwise write a row by
    // asking for it by name.
    const [rows] = await this.query(
      "UPDATE $id MERGE $changes WHERE created_by = $did RETURN AFTER",
      {
        id: recordIdFromOwnedRef("node", ref),
        did,
        changes: { ...changes, updated_at: nowIso() },
      },
    );
    const row = rows[0];
    return row === undefined ? null : parseNode(row);
  }

  /** `root` and everything that sprang from it. */
  async subtree(did: string, root: Node): Promise<Node[]> {
    const kin = await this.read(
      "SELECT * FROM node WHERE created_by = $did AND origin = $origin AND depth >= $depth",
      { did, origin: root.origin, depth: root.depth },
    );
    return kin.filter(
      (node) =>
        node.address === root.address ||
        isAncestorAddress(root.address, node.address),
    );
  }

  /** A node and its interior leave together; a block outliving its node is unreachable. */
  async remove(did: string, nodes: readonly Node[]): Promise<void> {
    if (nodes.length === 0) return;
    await this.db.handle.query(
      `DELETE block WHERE created_by = $did AND node IN $refs;
       DELETE node WHERE id IN $ids;`,
      {
        did,
        refs: nodes.map((node) => ownedRefFrom(node.id)),
        ids: nodes.map((node) => node.id),
      },
    );
  }

  async carryingDimension(did: string, name: string): Promise<Node[]> {
    return this.read(
      "SELECT * FROM node WHERE created_by = $did AND labels[$name] != NONE",
      { did, name },
    );
  }

  async countCarryingValues(
    did: string,
    name: string,
    values: readonly string[],
  ): Promise<number> {
    if (values.length === 0) return 0;
    const [rows] = await this.query<{ n: number }>(
      "SELECT count() AS n FROM node WHERE created_by = $did AND labels[$name] IN $values GROUP ALL",
      { did, name, values },
    );
    return rows[0]?.n ?? 0;
  }

  async replaceLabels(
    updates: readonly { id: RecordId; labels: LabelSet }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.handle.query(
      "FOR $update IN $updates { UPDATE $update.id SET labels = $update.labels, updated_at = $now; };",
      { updates, now: nowIso() },
    );
  }

  private async read(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<Node[]> {
    const [rows] = await this.query(sql, vars);
    return rows
      .map(parseNode)
      .sort((a, b) => compareAddresses(a.address, b.address));
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
