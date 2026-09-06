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

/**
 * A note its author has not deleted, and its opposite. Every read but the two
 * that assign an address is scoped by the first: a deleted note keeps its row so
 * it can be put back, and nothing else may find it there — AI.md § "The Address
 * Is the Protocol".
 */
const THERE = "deleted_at = NONE";
const GONE = "deleted_at != NONE";

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
         WHERE created_by = $did AND graph = $graph AND parent = NONE
           AND ${THERE}`,
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
      `SELECT * FROM node
         WHERE created_by = $did AND origin = $origin${bound} AND ${THERE}`,
      { did, origin, maxDepth },
    );
  }

  async find(did: string, ref: OwnedRef): Promise<Node | null> {
    return this.one(
      `SELECT * FROM node WHERE id = $id AND created_by = $did AND ${THERE}`,
      { id: recordIdFromOwnedRef("node", ref), did },
    );
  }

  /** One note its author has deleted, whether or not they can still put it
   *  back. */
  async findDeleted(did: string, ref: OwnedRef): Promise<Node | null> {
    return this.one(
      `SELECT * FROM node WHERE id = $id AND created_by = $did AND ${GONE}`,
      { id: recordIdFromOwnedRef("node", ref), did },
    );
  }

  /** Every note of theirs that is deleted and still there to be put back. */
  async deletedNotes(did: string): Promise<Node[]> {
    return this.read(`SELECT * FROM node WHERE created_by = $did AND ${GONE}`, {
      did,
    });
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
   * took it is still there — `null` where the graph has never assigned it. A
   * note its author has deleted reads as `deleted` whether the row is still
   * there to be put back or has been retired. Another graph of the same person
   * holding the address is not this question.
   */
  async addressTaken(
    did: string,
    graph: OwnedRef,
    address: Address,
  ): Promise<AddressHold | null> {
    const at = `FROM node
         WHERE created_by = $did AND graph = $graph AND address = $address`;
    const [held, deleted, retired] = await this.db.handle.query<
      [string[], string[], string[]]
    >(
      `SELECT VALUE address ${at} AND deleted_at = NONE LIMIT 1;
       SELECT VALUE address ${at} AND deleted_at != NONE LIMIT 1;
       SELECT VALUE address FROM retired_address
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;`,
      { did, graph, address },
    );
    if (held.length > 0) return "live";
    return deleted.length + retired.length > 0 ? "deleted" : null;
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
      `SELECT * FROM node WHERE id IN $ids AND created_by = $did AND ${THERE}`,
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
      `SELECT VALUE id FROM node WHERE references = NONE AND ${THERE}
         LIMIT $limit`,
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
      `UPDATE $id SET ${set.clause}
         WHERE created_by = $did AND ${THERE} RETURN AFTER`,
      { id: recordIdFromOwnedRef("node", ref), did, ...set.vars },
    );
    const row = rows[0];
    return row === undefined ? null : parseNode(row);
  }

  /** `root` and everything that sprang from it, of the notes still there. */
  async subtree(did: string, root: Node): Promise<Node[]> {
    return this.kin(
      root,
      `SELECT * FROM node
         WHERE created_by = $did AND origin = $origin AND depth >= $depth
           AND ${THERE}`,
      { did, origin: root.origin, depth: root.depth },
    );
  }

  /**
   * A node and everything that sprang from it, put away rather than removed: it
   * keeps its row, its writing and its address, and no read but the ones that
   * assign an address finds it. {@link restore} is the way back and
   * {@link purgeExpired} is the end of the road.
   */
  async remove(did: string, nodes: readonly Node[]): Promise<void> {
    if (nodes.length === 0) return;
    await this.db.handle.query(
      `UPDATE block SET deleted_at = $at
         WHERE created_by = $did AND node IN $refs;
       UPDATE $ids SET deleted_at = $at WHERE created_by = $did;`,
      {
        did,
        at: nowIso(),
        refs: nodes.map((node) => ownedRefFrom(node.id)),
        ids: nodes.map((node) => node.id),
      },
    );
  }

  /**
   * `root` and what went with it, back where they were. Only what went in the
   * same act comes back: a note deleted before its parent was stays deleted,
   * and is its own branch to put back afterwards.
   */
  async restore(did: string, root: Node): Promise<void> {
    const at = root.deleted_at;
    if (at === undefined) return;
    const back = await this.stamped(did, root, at);
    await this.db.handle.query(
      `UPDATE block SET deleted_at = NONE
         WHERE created_by = $did AND node IN $refs AND deleted_at = $at;
       UPDATE $ids SET deleted_at = NONE WHERE created_by = $did;`,
      {
        did,
        at,
        refs: back.map((node) => ownedRefFrom(node.id)),
        ids: back.map((node) => node.id),
      },
    );
  }

  /** The notes of `root`'s subtree that went with it in one act. */
  private stamped(did: string, root: Node, at: string): Promise<Node[]> {
    return this.kin(
      root,
      `SELECT * FROM node
         WHERE created_by = $did AND origin = $origin AND depth >= $depth
           AND deleted_at = $at`,
      { did, origin: root.origin, depth: root.depth, at },
    );
  }

  /**
   * Everything of theirs deleted before `before`, gone for real: the writing,
   * what other people left pointing at it, and the note. Each address stays
   * behind in a `retired_address` row, because the graph has assigned it and
   * nothing may assign it again — AI.md § "The Address Is the Protocol".
   */
  async purgeExpired(did: string, before: string): Promise<void> {
    const going = await this.read(
      `SELECT * FROM node
         WHERE created_by = $did AND ${GONE} AND deleted_at < $before`,
      { did, before },
    );
    if (going.length === 0) return;
    await this.db.handle.query(
      `INSERT INTO retired_address $retired;
       DELETE block WHERE created_by = $did AND node IN $refs;
       DELETE comment_pointer WHERE created_by = $did AND note IN $refs;
       DELETE node WHERE id IN $ids;`,
      {
        did,
        retired: going.map(retire),
        refs: going.map((node) => ownedRefFrom(node.id)),
        ids: going.map((node) => node.id),
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
                 WHERE created_by = $did AND graph = $graph AND ${THERE}
                   AND array::len(tags ?? []) > 0
                 SPLIT tags)
         GROUP BY tag ORDER BY notes DESC, tag ASC`,
      { did, graph },
    );
    return rows.map((row) => TagCountSchema.parse(row));
  }

  /** A read of one tree, cut to `root` and what sprang from it. */
  private async kin(
    root: Node,
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<Node[]> {
    const rows = await this.read(sql, vars);
    return rows.filter(
      (node) =>
        node.address === root.address ||
        isAncestorAddress(root.address, node.address),
    );
  }

  private async one(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<Node | null> {
    const [rows] = await this.query(sql, vars);
    const row = rows[0];
    return row === undefined ? null : parseNode(row);
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
