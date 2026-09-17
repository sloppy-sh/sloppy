// The `node` table. docs/ARCHITECTURE.md § "Data model" holds the row shape and
// the reasoning behind the indexes these reads are written against.

import { Injectable } from "@nestjs/common";
import {
  type Address,
  compareAddresses,
  createOwnedRecordId,
  type DidSyr,
  graphOf,
  type Node,
  type NodeAlias,
  type NodeAppearance,
  nowIso,
  orderSiblings,
  ownedRefFrom,
  type OwnedRef,
  parseNode,
  type RetiredAddress,
  recordIdFromOwnedRef,
  type TagCount,
  TagCountSchema,
  withAuthor,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";
import { replacement } from "./patch";

const PATCHABLE = [
  "title",
  "tags",
  "links",
  "appearance",
  "owner",
  "authors",
  "checked",
] as const;

/** A column whose write records that somebody READ the note rather than changed
 *  it, so the row keeps the `updated_at` it had — the note surface reads that
 *  column to say whether a published branch has changed, and a confirmation
 *  never reaches a reader. */
const UNMOVING = ["checked"] as const;

/**
 * A note its author has not deleted, and its opposite. Every read but the two
 * that assign an address is scoped by the first: a deleted note keeps its row so
 * it can be put back, and nothing else may find it there — AI.md § "The
 * Genealogy Is the Protocol".
 */
const THERE = "deleted_at = NONE";
const GONE = "deleted_at != NONE";

/** How a graph holds an address: a note is at it, a note in the bin is, a note
 *  was carried away from it, or a note spent it and has gone. */
export type AddressHold = "live" | "deleted" | "moved" | "retired";

/**
 * A note in the bin giving its address to whoever asked for it — AI.md § "The
 * Genealogy Is the Protocol". `alias` is what keeps the address leading to it,
 * absent where the graph already holds one at that address: the index allows
 * one, and the note that left first is who it leads to.
 *
 * The write that takes the address applies this in the same transaction, so an
 * address given up with nobody taking it cannot happen.
 */
export interface AddressYield {
  from: Node;
  alias?: NodeAlias;
}

function yielded(giving: readonly AddressYield[]): {
  statements: string[];
  vars: Record<string, unknown>;
} {
  if (giving.length === 0) return { statements: [], vars: {} };
  const aliases = giving.flatMap((one) => (one.alias ? [one.alias] : []));
  return {
    statements: [
      ...(aliases.length === 0
        ? []
        : ["INSERT INTO node_alias $yieldAliases;"]),
      `UPDATE $yielding SET address = NONE, updated_at = $at
         WHERE created_by = $did RETURN NONE;`,
    ],
    vars: { yieldAliases: aliases, yielding: giving.map((one) => one.from.id) },
  };
}

/** An address inside the graph that spent it: two graphs of one person
 *  each hold a `1`. */
function placeOf(row: Pick<RetiredAddress, "graph" | "address">): string {
  return `${row.graph}\u0000${row.address}`;
}

/** The row that outlives a note, so its address is never assigned twice. A note
 *  its author left unaddressed spends nothing and leaves none. */
function retire(node: Node, address: Address): RetiredAddress {
  const now = nowIso();
  return {
    id: createOwnedRecordId("retired_address", node.created_by),
    created_by: node.created_by,
    graph: graphOf(node),
    ...(node.parent ? { parent: node.parent } : {}),
    address,
    note: ownedRefFrom(node.id),
    created_at: now,
    updated_at: now,
  };
}

/**
 * The same row for an address a move left behind, once the note it led to is
 * purged: there is nothing left for it to resolve to, and the number stays
 * spent.
 */
function retireAlias(alias: NodeAlias): RetiredAddress {
  const now = nowIso();
  return {
    id: createOwnedRecordId("retired_address", alias.created_by),
    created_by: alias.created_by,
    graph: alias.graph,
    ...(alias.parent ? { parent: alias.parent } : {}),
    address: alias.address,
    note: alias.note,
    created_at: now,
    updated_at: now,
  };
}

/**
 * What a bulk act may write. A title is not one of them: an act says what a set
 * of notes have in common, and no two notes share a title. `authors` is here
 * for the service rather than for a request, exactly as it is on
 * {@link NodePatch}: an act is a write, and a write joins whoever made it.
 */
const BULK_WRITABLE = ["tags", "appearance", "authors"] as const;

/** What a PATCH may carry; the immutable columns are absent by type. A `null`
 *  clears its column — see {@link replacement}.
 *
 * `authors` is here for the service rather than for a request: no request
 * names it, and what writes it is {@link withAuthor} over the note that was
 * there. */
export type NodePatch = Partial<
  Pick<Node, "title" | "tags" | "links" | "authors" | "checked">
> & {
  appearance?: NodeAppearance | null;
  /** Who gates the note's writing; `null` takes the gate off. */
  owner?: DidSyr | null;
};

export type NodeBulkPatch = Partial<Pick<Node, "tags" | "authors">> & {
  appearance?: NodeAppearance | null;
};

@Injectable()
export class NodeRepository {
  constructor(private readonly db: DbService) {}

  /** The branches one graph opens. */
  async roots(did: string, graph: OwnedRef): Promise<Node[]> {
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
   * The run includes the addresses of notes that are gone and the ones a move
   * left behind: an address is assigned once in a graph and never again, so a
   * retired or aliased one still stands between the run and the address after
   * it. Both are read by the parent they hung under, which a move gives a
   * different address — `nextChildAddress` drops what that leaves in the run.
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
    const [taken, retired, aliased] = await this.db.handle.query<
      [(string | null | undefined)[], string[], string[]]
    >(
      `${held};
       SELECT VALUE address FROM retired_address
         WHERE created_by = $did AND graph = $graph AND ${under};
       SELECT VALUE address FROM node_alias
         WHERE created_by = $did AND graph = $graph AND ${under};`,
      {
        did,
        graph,
        origin: parent?.origin,
        depth: parent === null ? undefined : parent.depth + 1,
        parent: parent === null ? undefined : ownedRefFrom(parent.id),
      },
    );
    return [
      ...taken.filter(
        (address): address is string => typeof address === "string",
      ),
      ...retired,
      ...aliased,
    ];
  }

  /**
   * Whether one graph has ever assigned this address, and what has become of
   * the note that took it — `null` where the graph has never assigned it. A
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
    const [held, deleted, retired, aliased] = await this.db.handle.query<
      [string[], string[], string[], string[]]
    >(
      `SELECT VALUE address ${at} AND deleted_at = NONE LIMIT 1;
       SELECT VALUE address ${at} AND deleted_at != NONE LIMIT 1;
       SELECT VALUE address FROM retired_address
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;
       SELECT VALUE address FROM node_alias
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;`,
      { did, graph, address },
    );
    if (held.length > 0) return "live";
    if (deleted.length + retired.length > 0) return "deleted";
    return aliased.length > 0 ? "moved" : null;
  }

  /** Which of these addresses the graph has already spent, in one read:
   *  {@link addressTaken}'s question asked of many at once. */
  async addressesSpent(
    did: string,
    graph: OwnedRef,
    addresses: readonly Address[],
  ): Promise<Set<Address>> {
    if (addresses.length === 0) return new Set();
    const within = `WHERE created_by = $did AND graph = $graph
         AND address IN $addresses`;
    const [held, retired, aliased] = await this.db.handle.query<
      [Address[], Address[], Address[]]
    >(
      `SELECT VALUE address FROM node ${within};
       SELECT VALUE address FROM retired_address ${within};
       SELECT VALUE address FROM node_alias ${within};`,
      { did, graph, addresses: [...addresses] },
    );
    return new Set([...held, ...retired, ...aliased]);
  }

  /**
   * The same question with the note named: how the graph holds this address,
   * and which note it still leads to where one is there. `null` where the graph
   * has never assigned it.
   *
   * A retired address answers `deleted` beside the note that spent it, whose
   * row has gone: that note, arriving again, is the one thing that may write
   * the number, and a row from before the column names nobody and is refused to
   * everyone. What this is for that {@link addressTaken} is not: a person
   * writing an address on the note that already carries it, on the note it was
   * moved away from, or on the note that spent it, is not taking anybody's
   * address.
   */
  async addressLeadsTo(
    did: string,
    graph: OwnedRef,
    address: Address,
  ): Promise<{ hold: AddressHold; note?: OwnedRef } | null> {
    const at = `FROM node
         WHERE created_by = $did AND graph = $graph AND address = $address`;
    const [held, deleted, retired, aliased] = await this.db.handle.query<
      [RecordId[], RecordId[], { note?: OwnedRef }[], OwnedRef[]]
    >(
      `SELECT VALUE id ${at} AND deleted_at = NONE LIMIT 1;
       SELECT VALUE id ${at} AND deleted_at != NONE LIMIT 1;
       SELECT note FROM retired_address
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;
       SELECT VALUE note FROM node_alias
         WHERE created_by = $did AND graph = $graph AND address = $address
         LIMIT 1;`,
      { did, graph, address },
    );
    if (held[0] !== undefined) {
      return { hold: "live", note: ownedRefFrom(held[0]) };
    }
    if (deleted[0] !== undefined) {
      return { hold: "deleted", note: ownedRefFrom(deleted[0]) };
    }
    if (retired[0] !== undefined) {
      const spent = retired[0].note;
      return spent === undefined
        ? { hold: "retired" }
        : { hold: "retired", note: spent };
    }
    return aliased[0] === undefined
      ? null
      : { hold: "moved", note: aliased[0] };
  }

  /**
   * The label a person wrote on one note, `undefined` where they took it off.
   * `leaving` is the address it had, which keeps leading to it; an alias at the
   * address it TAKES goes, because the note is at that address again rather
   * than away from it.
   *
   * One transaction, for the reason a move is one: a row re-addressed without
   * its alias written is a citation that has stopped resolving.
   */
  async writeAddress(
    did: string,
    node: Node,
    address: Address | undefined,
    leaving: NodeAlias | null,
    giving: readonly AddressYield[] = [],
  ): Promise<Node | null> {
    const ref = ownedRefFrom(node.id);
    const gives = yielded(giving);
    const statements = ["BEGIN TRANSACTION;", ...gives.statements];
    if (leaving) statements.push("INSERT INTO node_alias $leaving;");
    if (address !== undefined) {
      statements.push(
        `DELETE node_alias WHERE created_by = $did AND graph = $graph
           AND address = $address AND note = $note;`,
      );
    }
    statements.push(
      `UPDATE $id SET address = ${address === undefined ? "NONE" : "$address"},
         updated_at = $at WHERE created_by = $did RETURN NONE;`,
      "COMMIT TRANSACTION;",
    );
    await this.db.handle.query(statements.join("\n"), {
      did,
      id: node.id,
      note: ref,
      graph: graphOf(node),
      address,
      leaving,
      at: nowIso(),
      ...gives.vars,
    });
    return this.find(did, ref);
  }

  /** Which of these addresses the graph already leads back by.
   *  `node_alias_owner_graph_address` holds one alias per address, so a note
   *  leaving one of these leaves nothing behind. */
  async addressesLedBack(
    did: string,
    graph: OwnedRef,
    addresses: readonly Address[],
  ): Promise<Set<Address>> {
    if (addresses.length === 0) return new Set();
    const [rows] = await this.db.handle.query<[Address[]]>(
      `SELECT VALUE address FROM node_alias
         WHERE created_by = $did AND graph = $graph AND address IN $addresses`,
      { did, graph, addresses: [...addresses] },
    );
    return new Set(rows);
  }

  async insert(
    node: Node,
    giving: readonly AddressYield[] = [],
  ): Promise<Node> {
    const { id, ...content } = node;
    if (giving.length === 0) {
      const [rows] = await this.query(
        "CREATE $id CONTENT $content RETURN AFTER",
        { id, content },
      );
      return parseNode(rows[0]);
    }
    const gives = yielded(giving);
    await this.db.handle.query(
      [
        "BEGIN TRANSACTION;",
        ...gives.statements,
        "CREATE $id CONTENT $content RETURN NONE;",
        "COMMIT TRANSACTION;",
      ].join("\n"),
      { did: node.created_by, id, content, at: nowIso(), ...gives.vars },
    );
    const written = await this.find(node.created_by, ownedRefFrom(id));
    if (!written) throw new Error("the note was not written");
    return written;
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
    return this.set(PATCHABLE, did, ref, changes, UNMOVING);
  }

  /**
   * The writer joined to what a note's writing carries, where the note is open
   * and they are not in it yet — {@link withAuthor} is that rule, and this
   * writes what it answers. `updated_at` stays where it is: the write that
   * called this is what moved the note, and it records that itself.
   */
  async joinAuthors(did: DidSyr, note: Node): Promise<void> {
    const joined = withAuthor(note, did);
    if (joined === note) return;
    await this.query(
      "UPDATE $id SET authors = $authors WHERE created_by = $did RETURN NONE",
      {
        id: note.id,
        did,
        authors: [...(joined.authors ?? [])],
      },
    );
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

  /** Every note of theirs that is in one graph and still there. Refs alone: a
   *  whole row is what makes reading a graph expensive, and none of one is read
   *  here. */
  async notesIn(did: string, graph: OwnedRef): Promise<OwnedRef[]> {
    const [ids] = await this.query<RecordId>(
      `SELECT VALUE id FROM node
         WHERE created_by = $did AND graph = $graph AND ${THERE}`,
      { did, graph },
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
    unmoving: readonly Extract<keyof T, string>[] = [],
  ): Promise<Node | null> {
    const set = replacement(columns, changes, unmoving);
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
   * The same, with the notes their author has deleted among them — what a move
   * carries. A deleted one left where it was would sit under an address no note
   * is at; docs/ARCHITECTURE.md § "The genealogy and the address".
   */
  async carried(did: string, root: Node): Promise<Node[]> {
    return this.kin(
      root,
      `SELECT * FROM node
         WHERE created_by = $did AND origin = $origin AND depth >= $depth`,
      { did, origin: root.origin, depth: root.depth },
    );
  }

  /**
   * A note carried somewhere else with everything under it: every row at the
   * address the move gives it, and a `node_alias` for each address left behind.
   * An alias at an address a note LANDS on goes, as it does when the address is
   * written by hand: the note is at that address again rather than away from it.
   *
   * One transaction, because the two halves are one fact: a row re-addressed
   * without its alias written is a citation that has stopped resolving, and an
   * alias written without the row is an address leading to a note that is
   * still at it.
   */
  async move(
    did: string,
    landed: readonly Node[],
    aliases: readonly NodeAlias[],
    giving: readonly AddressYield[] = [],
  ): Promise<void> {
    const gives = yielded(giving);
    const statements = ["BEGIN TRANSACTION;", ...gives.statements];
    const vars: Record<string, unknown> = {
      did,
      aliases: [...aliases],
      at: nowIso(),
      ...gives.vars,
    };
    for (const [slot, node] of landed.entries()) {
      if (node.address === undefined) continue;
      statements.push(
        `DELETE node_alias WHERE created_by = $did AND graph = $graph${slot}
           AND address = $address${slot} AND note = $note${slot};`,
      );
      vars[`graph${slot}`] = graphOf(node);
      vars[`address${slot}`] = node.address;
      vars[`note${slot}`] = ownedRefFrom(node.id);
    }
    statements.push("INSERT INTO node_alias $aliases;");
    for (const [slot, node] of landed.entries()) {
      statements.push(
        `UPDATE $id${slot} SET
           address = ${node.address === undefined ? "NONE" : `$address${slot}`},
           depth = $depth${slot},
           origin = $origin${slot},
           parent = ${node.parent ? `$parent${slot}` : "NONE"},
           updated_at = $at
           WHERE created_by = $did RETURN NONE;`,
      );
      vars[`id${slot}`] = node.id;
      if (node.address !== undefined) vars[`address${slot}`] = node.address;
      vars[`depth${slot}`] = node.depth;
      vars[`origin${slot}`] = node.origin;
      if (node.parent) vars[`parent${slot}`] = node.parent;
    }
    statements.push("COMMIT TRANSACTION;");
    await this.db.handle.query(statements.join("\n"), vars);
  }

  /** The addresses each of these notes was at before it was moved, in address
   *  order; a note that has never been moved is absent. */
  async aliasesOf(
    did: string,
    graph: OwnedRef,
    notes: readonly OwnedRef[],
  ): Promise<Map<OwnedRef, Address[]>> {
    if (notes.length === 0) return new Map();
    const [rows] = await this.query<{ note: OwnedRef; address: Address }>(
      `SELECT note, address FROM node_alias
         WHERE created_by = $did AND graph = $graph AND note IN $notes`,
      { did, graph, notes: [...notes] },
    );
    const by = new Map<OwnedRef, Address[]>();
    for (const row of rows) {
      by.set(row.note, [...(by.get(row.note) ?? []), row.address]);
    }
    for (const held of by.values()) held.sort(compareAddresses);
    return by;
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
   * what other people offered for it and left pointing at it, and the note.
   * Each address stays
   * behind in a `retired_address` row, because the graph has assigned it and
   * nothing may assign it again — except one another note is at, which belongs
   * to that note and is still its own to take back — AI.md § "The Genealogy Is
   * the Protocol".
   */
  async purgeExpired(did: string, before: string): Promise<void> {
    const going = await this.read(
      `SELECT * FROM node
         WHERE created_by = $did AND ${GONE} AND deleted_at < $before`,
      { did, before },
    );
    if (going.length === 0) return;
    const refs = going.map((node) => ownedRefFrom(node.id));
    const ids = going.map((node) => node.id);
    const [aliases] = await this.db.handle.query<[NodeAlias[]]>(
      "SELECT * FROM node_alias WHERE created_by = $did AND note IN $refs;",
      { did, refs },
    );
    const spent = [
      ...going.flatMap((node) =>
        node.address === undefined ? [] : [retire(node, node.address)],
      ),
      ...aliases.map(retireAlias),
    ];
    const led = await this.addressesLedBy(did, spent, ids);
    await this.db.handle.query(
      `INSERT INTO retired_address $retired;
       DELETE node_alias WHERE created_by = $did AND note IN $refs;
       DELETE block WHERE created_by = $did AND node IN $refs;
       DELETE comment_pointer WHERE created_by = $did AND node IN $refs;
       DELETE amendment WHERE created_by = $did AND note IN $refs;
       DELETE node WHERE id IN $ids;`,
      {
        did,
        retired: spent.filter((row) => !led.has(placeOf(row))),
        refs,
        ids,
      },
    );
  }

  /** Which of these addresses a note this purge is leaving behind is at,
   *  whether that note is there or in the bin: a note waiting to be put back
   *  has not given its number up, and the purge of another note may not spend
   *  it. */
  private async addressesLedBy(
    did: string,
    spent: readonly RetiredAddress[],
    going: readonly RecordId[],
  ): Promise<Set<string>> {
    if (spent.length === 0) return new Set();
    const at = await this.read(
      `SELECT * FROM node
         WHERE created_by = $did AND address IN $addresses
           AND id NOT IN $going`,
      {
        did,
        addresses: spent.map((row) => row.address),
        going: [...going],
      },
    );
    return new Set(
      at.flatMap((node) =>
        node.address === undefined
          ? []
          : [placeOf({ graph: graphOf(node), address: node.address })],
      ),
    );
  }

  /** Everybody holding a note deleted before `before`, which is who a sweep of
   *  the window has anything to do for. */
  async authorsPast(before: string): Promise<string[]> {
    const [rows] = await this.query<{ created_by: string }>(
      `SELECT created_by FROM node
         WHERE ${GONE} AND deleted_at < $before
         GROUP BY created_by`,
      { before },
    );
    return rows.map((row) => row.created_by);
  }

  /**
   * The tags carried inside ONE graph, most-used first, ties alphabetical —
   * what the rail beside a canvas drawing that graph is a legend for. Counted
   * from the notes on every call because that is where a tag lives: there is no
   * row to keep in step, and so no way for the count to be wrong.
   */
  async tagCounts(did: string, graph: OwnedRef): Promise<TagCount[]> {
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

  /**
   * A read of one tree, cut to `root` and what sprang from it. The cut is the
   * parent chain rather than the addresses, because a person writes their own
   * addresses and a subtree is what a note springs out of.
   */
  private async kin(
    root: Node,
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<Node[]> {
    const rows = await this.read(sql, vars);
    const byRef = new Map(rows.map((node) => [ownedRefFrom(node.id), node]));
    const under = new Set<string>([ownedRefFrom(root.id)]);
    const springsFromRoot = (node: Node): boolean => {
      const chain: string[] = [];
      let walk: Node | undefined = node;
      while (walk !== undefined) {
        const ref = ownedRefFrom(walk.id);
        if (under.has(ref)) break;
        // Our own rows cannot hold a cycle — a move refuses one — but a walk
        // that trusted that would hang rather than answer.
        if (chain.includes(ref)) return false;
        chain.push(ref);
        walk = walk.parent === undefined ? undefined : byRef.get(walk.parent);
      }
      if (walk === undefined) return false;
      for (const ref of chain) under.add(ref);
      return true;
    };
    return rows.filter(springsFromRoot);
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
    const parsed = rows.map(parseNode);
    return orderSiblings(
      parsed.map((node) => ({
        ref: ownedRefFrom(node.id),
        address: node.address,
        created_at: node.created_at,
        node,
      })),
    ).map((one) => one.node);
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
