// Pointers left at a note author's instance: that somebody said something about
// one of their notes. The words are never here, and neither is the store that
// holds them — docs/ARCHITECTURE.md § "Federating the graph".
//
// `created_by` is the note's AUTHOR, the person the pointer was left for.

import { Injectable } from "@nestjs/common";
import {
  type CommentPointer,
  CommentPointerSchema,
  type DidSyr,
  type OwnedRef,
  POINTERS_PER_NOTE,
  POINTERS_PER_VOICE,
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

  /** Every pointer left on one of the author's notes, oldest first. */
  async pointersOn(author: DidSyr, note: OwnedRef): Promise<CommentPointer[]> {
    const [rows] = await this.query(
      `SELECT * FROM comment_pointer
         WHERE created_by = $author AND note = $note
         ORDER BY created_at ASC`,
      { author, note },
    );
    return rows.map((row) => CommentPointerSchema.parse(row));
  }

  /**
   * Leaves one, or leaves the row that is already there — the same pointer
   * twice is the same pointer. A full note makes room rather than refusing:
   * `null` only where this voice already holds as many as one voice may.
   */
  async leave(pointer: {
    author: DidSyr;
    note: OwnedRef;
    voice: DidSyr;
    comment_id: string;
  }): Promise<CommentPointer | null> {
    const [standing] = await this.query(
      `SELECT * FROM comment_pointer
         WHERE created_by = $author AND voice = $voice AND comment_id = $comment`,
      {
        author: pointer.author,
        voice: pointer.voice,
        comment: pointer.comment_id,
      },
    );
    if (standing[0] !== undefined) {
      return CommentPointerSchema.parse(standing[0]);
    }
    const crowd = await this.crowdOn(pointer.author, pointer.note);
    const held = (of: DidSyr) =>
      crowd.find((one) => one.voice === of)?.held ?? 0;
    if (held(pointer.voice) >= POINTERS_PER_VOICE) return null;
    const onNote = crowd.reduce((sum, one) => sum + one.held, 0);
    if (onNote >= POINTERS_PER_NOTE && !(await this.makeRoom(pointer, crowd))) {
      return null;
    }
    const at = nowIso();
    const [made] = await this.query(
      `CREATE comment_pointer CONTENT {
         created_by: $author, created_at: $at, updated_at: $at,
         note: $note, voice: $voice, comment_id: $comment
       }`,
      {
        author: pointer.author,
        at,
        note: pointer.note,
        voice: pointer.voice,
        comment: pointer.comment_id,
      },
    );
    return made[0] === undefined ? null : CommentPointerSchema.parse(made[0]);
  }

  /**
   * Whether one of the author's own snapshots both holds this note and admits
   * answers. Membership is asked of `snapshot_node` rather than worked out from
   * the address, because a snapshot IS the set of notes it copied — and the
   * ruling is that the snapshot being read answers, so a note inside two of
   * them is admitted if any one of them says so.
   *
   * Asked from the note outwards: what a note is carried by is a handful of
   * versions however long the author's chain is.
   */
  async admitsAnswers(author: DidSyr, note: OwnedRef): Promise<boolean> {
    const [carriedBy] = await this.query<OwnedRef>(
      "SELECT VALUE version FROM snapshot_node WHERE created_by = $author AND source = $note",
      { author, note },
    );
    const versions = this.recordIds("publication_version", carriedBy);
    if (versions.length === 0) return false;

    const [of] = await this.query<OwnedRef>(
      "SELECT VALUE publication FROM publication_version WHERE created_by = $author AND id IN $versions",
      { author, versions },
    );
    const publications = this.recordIds("publication", of);
    if (publications.length === 0) return false;

    const [rows] = await this.query(
      `SELECT count() AS held FROM publication
         WHERE created_by = $author AND comments = 'anyone' AND id IN $publications
         GROUP ALL`,
      { author, publications },
    );
    return ((rows[0] as { held?: number } | undefined)?.held ?? 0) > 0;
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

  /**
   * Drops the oldest pointer of whichever voice holds the most of this note, so
   * a voice holding one is never the one that pays for a newcomer. `false`
   * where there was nothing to drop, which leaves the note as it stands.
   */
  private async makeRoom(
    pointer: { author: DidSyr; note: OwnedRef },
    crowd: readonly Crowd[],
  ): Promise<boolean> {
    const greediest = crowd.reduce<Crowd | undefined>(
      (most, one) => (most === undefined || one.held > most.held ? one : most),
      undefined,
    );
    if (greediest === undefined) return false;
    const [oldest] = await this.query<RecordId>(
      `SELECT VALUE id FROM comment_pointer
         WHERE created_by = $author AND note = $note AND voice = $voice
         ORDER BY created_at ASC LIMIT 1`,
      { author: pointer.author, note: pointer.note, voice: greediest.voice },
    );
    if (oldest[0] === undefined) return false;
    await this.query("DELETE $dropped", { dropped: oldest[0] });
    return true;
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
