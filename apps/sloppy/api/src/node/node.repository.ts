// The `node` table. docs/ARCHITECTURE.md § "Data model" holds the row shape and
// the reasoning behind the indexes these reads are written against.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  compareAddresses,
  homeGraphRef,
  isAncestorAddress,
  type Node,
  type NodeAppearance,
  ownedRefFrom,
  type OwnedRef,
  parseNode,
  recordIdFromOwnedRef,
  type TagCount,
  TagCountSchema,
} from "@sloppy/types";
import { DbService } from "../db/db.service";
import { replacement } from "./patch";

const PATCHABLE = ["title", "tags", "links", "appearance"] as const;

/**
 * What a bulk act may write. A title is not one of them: an act says what a set
 * of notes have in common, and no two notes share a title.
 */
const BULK_WRITABLE = ["tags", "appearance"] as const;

/** What a PATCH may carry; the immutable columns are absent by type. A `null`
 *  clears its column — see {@link replacement}. */
export type NodePatch = Partial<Pick<Node, "title" | "tags" | "links">> & {
  appearance?: NodeAppearance | null;
};

export type NodeBulkPatch = Partial<Pick<Node, "tags">> & {
  appearance?: NodeAppearance | null;
};

@Injectable()
export class NodeRepository {
  constructor(private readonly db: DbService) {}

  /** The branches one graph opens, the caller's home graph where none is
   *  named. */
  async roots(
    did: string,
    graph: OwnedRef = homeGraphRef(did),
  ): Promise<Node[]> {
    return this.read(
      `SELECT * FROM node
         WHERE created_by = $did AND graph = $graph AND parent = NONE`,
      { did, graph },
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
   * branches of `graph` when there is no parent — which is why a graph is asked
   * for beside the parent that would otherwise name one.
   *
   * Children are read through the tree-and-level index rather than through
   * `parent`: measured on 3.1.3, an equality on `parent` bound as a parameter
   * is left as a filter over the whole owner, while `origin` and `depth` fold
   * into the index access.
   */
  async childAddresses(
    did: string,
    parent: Node | null,
    graph: OwnedRef,
  ): Promise<Address[]> {
    if (parent === null) {
      const [rows] = await this.query<string>(
        `SELECT VALUE address FROM node
           WHERE created_by = $did AND graph = $graph AND parent = NONE`,
        { did, graph },
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

  /** Whether one graph already holds this address. Another graph of the same
   *  person holding it is not this question. */
  async addressTaken(
    did: string,
    graph: OwnedRef,
    address: Address,
  ): Promise<boolean> {
    const [rows] = await this.query<string>(
      `SELECT VALUE address FROM node
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1`,
      { did, graph, address },
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

  /** Of the notes named, the ones this person actually owns. */
  async many(did: string, refs: readonly OwnedRef[]): Promise<Node[]> {
    if (refs.length === 0) return [];
    return this.read(
      "SELECT * FROM node WHERE id IN $ids AND created_by = $did",
      { ids: refs.map((ref) => recordIdFromOwnedRef("node", ref)), did },
    );
  }

  patch(did: string, ref: OwnedRef, changes: NodePatch): Promise<Node | null> {
    return this.set(PATCHABLE, did, ref, changes);
  }

  /**
   * One act's writes, each note taking its own value — the tag arithmetic is
   * per note, so there is a value per row rather than one for the set. A note
   * whose row is gone by the time the write lands is absent from the answer.
   */
  async patchAll(
    did: string,
    changes: ReadonlyMap<OwnedRef, NodeBulkPatch>,
  ): Promise<Node[]> {
    const written = await Promise.all(
      [...changes].map(([ref, patch]) =>
        this.set(BULK_WRITABLE, did, ref, patch),
      ),
    );
    return written.filter((node): node is Node => node !== null);
  }

  private async set<T extends object>(
    columns: readonly Extract<keyof T, string>[],
    did: string,
    ref: OwnedRef,
    changes: T,
  ): Promise<Node | null> {
    const set = replacement(columns, changes);
    // The owner is part of the statement, not a check on what comes back: a
    // reference names its owner, so anybody could otherwise write a row by
    // asking for it by name.
    const [rows] = await this.query(
      `UPDATE $id SET ${set.clause} WHERE created_by = $did RETURN AFTER`,
      { id: recordIdFromOwnedRef("node", ref), did, ...set.vars },
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

  /** A node leaves with its interior and with what other people left pointing
   *  at it; either one outliving the note is unreachable. */
  async remove(did: string, nodes: readonly Node[]): Promise<void> {
    if (nodes.length === 0) return;
    await this.db.handle.query(
      `DELETE block WHERE created_by = $did AND node IN $refs;
       DELETE comment_pointer WHERE created_by = $did AND note IN $refs;
       DELETE node WHERE id IN $ids;`,
      {
        did,
        refs: nodes.map((node) => ownedRefFrom(node.id)),
        ids: nodes.map((node) => node.id),
      },
    );
  }

  /**
   * The owner's tags, most-used first, ties alphabetical. Counted from the
   * notes on every call because that is where a tag lives: there is no row to
   * keep in step, and so no way for the count to be wrong.
   */
  /** The tags carried inside ONE graph, which is what the rail beside a canvas
   *  drawing that graph is a legend for. */
  async tagCounts(
    did: string,
    graph: OwnedRef = homeGraphRef(did),
  ): Promise<TagCount[]> {
    const [rows] = await this.query<TagCount>(
      `SELECT tags AS tag, count() AS notes
         FROM (SELECT tags FROM node
                 WHERE created_by = $did AND graph = $graph
                   AND array::len(tags ?? []) > 0
                 SPLIT tags)
         GROUP BY tag ORDER BY notes DESC, tag ASC`,
      { did, graph },
    );
    return rows.map((row) => TagCountSchema.parse(row));
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
