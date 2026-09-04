// Pointers left at a note author's instance: that somebody said something about
// one of their notes. The words are never here, and neither is the store that
// holds them — docs/ARCHITECTURE.md § "Federating the graph".
//
// `created_by` is the note's AUTHOR, the person the pointer was left for.

import { Injectable } from "@nestjs/common";
import {
  type DidSyr,
  type OwnedRef,
  POINTERS_PER_NOTE,
  POINTERS_PER_VOICE,
  PublicationSchema,
  nowIso,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import type { RecordId } from "surrealdb";
import { DbService } from "../db/db.service";

/** How many pointers one voice holds on one note. */
interface Crowd {
  voice: DidSyr;
  held: number;
}

@Injectable()
export class PointerRepository {
  constructor(private readonly db: DbService) {}

  /**
   * The voices that have answered one of the author's notes, in the order they
   * first did, at most `take` of them. Distinct rather than one row per
   * pointer: a store is asked once for a voice however many times that voice
   * answered, so this is the count that decides what a read costs.
   */
  async voicesOn(
    author: DidSyr,
    note: OwnedRef,
    take: number,
  ): Promise<DidSyr[]> {
    const [rows] = await this.query<DidSyr>(
      `SELECT VALUE voice FROM comment_pointer
         WHERE created_by = $author AND note = $note
         ORDER BY created_at ASC LIMIT $rows`,
      { author, note, rows: POINTERS_PER_NOTE },
    );
    return [...new Set(rows)].slice(0, take);
  }

  /**
   * Leaves one, or leaves the row that is already there — the same pointer
   * twice is the same pointer. A full note keeps what it holds and takes no
   * more, which the depositor is not told either way.
   */
  async leave(pointer: {
    author: DidSyr;
    note: OwnedRef;
    voice: DidSyr;
    comment_id: string;
  }): Promise<void> {
    const [standing] = await this.query(
      `SELECT * FROM comment_pointer
         WHERE created_by = $author AND voice = $voice AND comment_id = $comment`,
      {
        author: pointer.author,
        voice: pointer.voice,
        comment: pointer.comment_id,
      },
    );
    if (standing[0] !== undefined) return;
    const crowd = await this.crowdOn(pointer.author, pointer.note);
    const held = crowd.find((one) => one.voice === pointer.voice)?.held ?? 0;
    if (held >= POINTERS_PER_VOICE) return;
    if (crowd.reduce((sum, one) => sum + one.held, 0) >= POINTERS_PER_NOTE) {
      return;
    }
    const at = nowIso();
    await this.query(
      `CREATE comment_pointer CONTENT {
         created_by: $author, created_at: $at, updated_at: $at,
         note: $note, voice: $voice, comment_id: $comment
       } RETURN NONE`,
      {
        author: pointer.author,
        at,
        note: pointer.note,
        voice: pointer.voice,
        comment: pointer.comment_id,
      },
    );
  }

  /**
   * Where to resolve a voice claiming to have answered this note, or `null`
   * where the note takes no answers at all. It is the instance the author's own
   * identity answered from when they published, which is the one party to a
   * deposit that is not the depositor.
   *
   * Membership is asked of `snapshot_node` rather than worked out from the
   * address, because a snapshot IS the set of notes it copied — and the ruling
   * is that the snapshot being read answers, so a note inside two of them is
   * admitted if any one of them says so.
   *
   * Asked from the note outwards: what a note is carried by is a handful of
   * versions however long the author's chain is.
   */
  async answersFrom(author: DidSyr, note: OwnedRef): Promise<string | null> {
    const [carriedBy] = await this.query<OwnedRef>(
      "SELECT VALUE version FROM snapshot_node WHERE created_by = $author AND source = $note",
      { author, note },
    );
    const versions = this.recordIds("publication_version", carriedBy);
    if (versions.length === 0) return null;

    const [of] = await this.query<OwnedRef>(
      "SELECT VALUE publication FROM publication_version WHERE created_by = $author AND id IN $versions",
      { author, versions },
    );
    const publications = this.recordIds("publication", of);
    if (publications.length === 0) return null;

    const [rows] = await this.query(
      `SELECT * FROM publication
         WHERE created_by = $author AND comments = 'anyone' AND id IN $publications`,
      { author, publications },
    );
    const inviting = rows.map((row) => PublicationSchema.parse(row));
    return inviting.find((one) => one.identity_store)?.identity_store ?? null;
  }

  private async crowdOn(author: DidSyr, note: OwnedRef): Promise<Crowd[]> {
    const [rows] = await this.query<Crowd>(
      `SELECT voice, count() AS held FROM comment_pointer
         WHERE created_by = $author AND note = $note
         GROUP BY voice`,
      { author, note },
    );
    return rows;
  }

  private recordIds(table: string, refs: readonly OwnedRef[]): RecordId[] {
    return [...new Set(refs)].map((ref) => recordIdFromOwnedRef(table, ref));
  }

  private query<T = Record<string, unknown>>(
    sql: string,
    vars: Record<string, unknown>,
  ) {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
