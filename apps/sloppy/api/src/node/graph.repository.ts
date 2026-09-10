// The `graph` table: the name a person gives a notebook, and which one they
// started with. What a note belongs to is the ref.

import { Injectable } from "@nestjs/common";
import {
  createOwnedRecordId,
  type Graph,
  GraphSchema,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

@Injectable()
export class GraphRepository {
  constructor(private readonly db: DbService) {}

  /** Somebody's graphs, oldest first — the order they opened them in. */
  async list(did: string): Promise<Graph[]> {
    const [rows] = await this.query(
      "SELECT * FROM graph WHERE created_by = $did ORDER BY created_at, title",
      { did },
    );
    return rows.map((row) => GraphSchema.parse(row));
  }

  async find(did: string, ref: OwnedRef): Promise<Graph | null> {
    const [rows] = await this.query(
      "SELECT * FROM graph WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("graph", ref), did },
    );
    return rows[0] === undefined ? null : GraphSchema.parse(rows[0]);
  }

  async insert(did: string, title: string, home = false): Promise<Graph> {
    const now = nowIso();
    const [rows] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      {
        id: createOwnedRecordId("graph", did),
        content: {
          created_by: did,
          title,
          ...(home ? { home } : {}),
          created_at: now,
          updated_at: now,
        },
      },
    );
    return GraphSchema.parse(rows[0]);
  }

  /**
   * The graph somebody started with, or `null` where they have none yet. Read
   * through `graph_owner_home` rather than spelled from the identity: every
   * home graph has a ulid of its own — docs/ARCHITECTURE.md § "The genealogy
   * and the address". One per person is `graph_owner_home`'s rule; the order is
   * what makes a store defined before it answer the same graph every time.
   */
  async home(did: string): Promise<OwnedRef | null> {
    const [rows] = await this.query<{ id: RecordId }>(
      // created_at is selected because SurrealDB orders on the projection.
      `SELECT id, created_at FROM graph WHERE created_by = $did AND home = true
         ORDER BY created_at, id LIMIT 1`,
      { did },
    );
    return rows[0] === undefined ? null : ownedRefFrom(rows[0].id);
  }

  /**
   * Name a graph, whether or not it has a row yet. One statement rather than a
   * read and a write, because `created_at` is immutable and a whole-row save
   * would have to re-send it as a different moment.
   */
  async name(did: string, ref: OwnedRef, title: string): Promise<Graph> {
    return this.upsert(did, ref, title, "title = $title, updated_at = $now");
  }

  /** The name of a graph its owner has closed, gone. A note carries the ref
   *  rather than the row, so nothing here reaches what the graph held. */
  async remove(did: string, ref: OwnedRef): Promise<void> {
    await this.query("DELETE $id WHERE created_by = $did", {
      id: recordIdFromOwnedRef("graph", ref),
      did,
    });
  }

  private async upsert(
    did: string,
    ref: OwnedRef,
    title: string,
    onDuplicate: string,
  ): Promise<Graph> {
    const now = nowIso();
    const [rows] = await this.query(
      `INSERT INTO graph {
         id: $id, created_by: $did, title: $title,
         created_at: $now, updated_at: $now
       } ON DUPLICATE KEY UPDATE ${onDuplicate}`,
      { id: recordIdFromOwnedRef("graph", ref), did, title, now },
    );
    return GraphSchema.parse(rows[0]);
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
