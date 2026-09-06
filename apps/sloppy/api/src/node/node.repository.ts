// The `node` table. docs/ARCHITECTURE.md § "Data model" holds the row shape and
// the reasoning behind the indexes these reads are written against.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  compareAddresses,
  createOwnedRecordId,
  graphOf,
  homeGraphRef,
  isAncestorAddress,
  type Node,
  type NodeAppearance,
  nowIso,
  ownedRefFrom,
  type OwnedRef,
  parseNode,
  type RetiredAddress,
  recordIdFromOwnedRef,
  type TagCount,
  TagCountSchema,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";
import { replacement } from "./patch";

const PATCHABLE = ["title", "tags", "links", "appearance"] as const;

/** How a graph holds an address: a note is at it, or one was and has gone. */
export type AddressHold = "live" | "deleted";

/** The row that outlives a note, so its address is never assigned twice. */
function retire(node: Node): RetiredAddress {
  const now = nowIso();
  return {
    id: createOwnedRecordId("retired_address", node.created_by),
    created_by: node.created_by,
    graph: graphOf(node),
    ...(node.parent ? { parent: node.parent } : {}),
    address: node.address,
    created_at: now,
    updated_at: now,
  };
}

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
   * Every address the children of `parent` have taken, or the branches of
   * `graph` where there is no parent — which is why a graph is asked for beside
   * the parent that would otherwise name one.
   *
   * The run includes the addresses of notes that are gone: an address is
   * assigned once in a graph and never again, so a retired one still stands
   * between the run and the address after it.
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
    const under = parent === null ? "parent = NONE" : "parent = $parent";
    const held =
      parent === null
        ? `SELECT VALUE address FROM node
             WHERE created_by = $did AND graph = $graph AND ${under}`
        : `SELECT VALUE address FROM node
             WHERE created_by = $did AND origin = $origin AND depth = $depth
               AND ${under}`;
    const [taken, retired] = await this.db.handle.query<[string[], string[]]>(
      `${held};
       SELECT VALUE address FROM retired_address
         WHERE created_by = $did AND graph = $graph AND ${under};`,
      {
        did,
        graph,
        origin: parent?.origin,
        depth: parent === null ? undefined : parent.depth + 1,
        parent: parent === null ? undefined : ownedRefFrom(parent.id),
      },
    );
    return [...taken, ...retired];
  }

  /**
   * Whether one graph has ever assigned this address, and whether the note that
   * took it is still there — `null` where the graph has never assigned it.
   * Another graph of the same person holding it is not this question.
   */
  async addressTaken(
    did: string,
    graph: OwnedRef,
    address: Address,
  ): Promise<AddressHold | null> {
    const [held, retired] = await this.db.handle.query<[string[], string[]]>(
      `SELECT VALUE address FROM node
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;
       SELECT VALUE address FROM retired_address
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;`,
      { did, graph, address },
    );
    if (held.length > 0) return "live";
    return retired.length > 0 ? "deleted" : null;
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
   * The notes a note's own writing names, as the server derived them — never
   * through {@link patch}, whose columns a request can name.
   *
   * `updated_at` is deliberately left where it was: the writing is what moved,
   * and its own row already records that. A derivation catching up with words
   * that were already there is not the note changing, and the note surface
   * reads this timestamp to say whether a published branch has.
   */
  async setReferences(
    did: string,
    ref: OwnedRef,
    references: readonly OwnedRef[],
  ): Promise<void> {
    await this.query(
      "UPDATE $id SET references = $references WHERE created_by = $did",
      {
        id: recordIdFromOwnedRef("node", ref),
        did,
        references: [...references],
      },
    );
  }

  /**
   * The same over a run of notes, and only for a note that still has none: a
   * block written into one between the read these were made from and this write
   * derives that note itself, off a newer stack, and that answer must stand.
   *
   * The notes that name nothing go in one statement, because most of a graph
   * names nothing and a round trip each is what makes sweeping one slow. No
   * owner is bound: every reference here was read off this instance's own rows
   * rather than asked for by a caller, and the key already names its owner.
   */
  async fillReferences(
    derived: ReadonlyMap<OwnedRef, readonly OwnedRef[]>,
  ): Promise<void> {
    const names =
      "UPDATE $id SET references = $references WHERE references = NONE";
    const nothing: RecordId[] = [];
    for (const [ref, references] of derived) {
      const id = recordIdFromOwnedRef("node", ref);
      if (references.length === 0) nothing.push(id);
      else await this.query(names, { id, references: [...references] });
    }
    if (nothing.length > 0) {
      await this.query(
        "UPDATE $ids SET references = [] WHERE references = NONE",
        { ids: nothing },
      );
    }
  }

  /** Up to `limit` notes nothing has derived `references` for yet, across every
   *  author this instance holds. Refs alone: a whole row is what makes reading a
   *  graph expensive, and none of one is read here. */
  async withoutReferences(limit: number): Promise<OwnedRef[]> {
    const [ids] = await this.query<RecordId>(
      "SELECT VALUE id FROM node WHERE references = NONE LIMIT $limit",
      { limit },
    );
    return ids.map(ownedRefFrom);
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

  /**
   * A node leaves with its interior and with what other people left pointing at
   * it; either one outliving the note is unreachable. Its address stays behind:
   * the graph has assigned it, and a `retired_address` row is what keeps it
   * from being assigned again — AI.md § "The Address Is the Protocol".
   */
  async remove(did: string, nodes: readonly Node[]): Promise<void> {
    if (nodes.length === 0) return;
    await this.db.handle.query(
      `INSERT INTO retired_address $retired;
       DELETE block WHERE created_by = $did AND node IN $refs;
       DELETE comment_pointer WHERE created_by = $did AND note IN $refs;
       DELETE node WHERE id IN $ids;`,
      {
        did,
        retired: nodes.map(retire),
        refs: nodes.map((node) => ownedRefFrom(node.id)),
        ids: nodes.map((node) => node.id),
      },
    );
  }

  /**
   * The tags carried inside ONE graph, most-used first, ties alphabetical —
   * what the rail beside a canvas drawing that graph is a legend for. Counted
   * from the notes on every call because that is where a tag lives: there is no
   * row to keep in step, and so no way for the count to be wrong.
   */
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
