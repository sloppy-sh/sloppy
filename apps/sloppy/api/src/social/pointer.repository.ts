// Pointers left at a note author's instance: that somebody said something, and
// where to read it. The words are never here — docs/ARCHITECTURE.md
// § "Federating the graph".
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
} from "@sloppy/types";
import { DbService } from "../db/db.service";

@Injectable()
export class PointerRepository {
  constructor(private readonly db: DbService) {}

  /** Every voice that has left a pointer on one of the author's notes. */
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
   * twice is the same pointer. `null` where a bound refuses it, which is not an
   * error the depositor is owed an explanation for.
   */
  async leave(pointer: {
    author: DidSyr;
    note: OwnedRef;
    voice: DidSyr;
    where: string;
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
    const [onNote] = await this.query(
      "SELECT count() AS held FROM comment_pointer WHERE created_by = $author AND note = $note GROUP ALL",
      { author: pointer.author, note: pointer.note },
    );
    const [byVoice] = await this.query(
      `SELECT count() AS held FROM comment_pointer
         WHERE created_by = $author AND note = $note AND voice = $voice GROUP ALL`,
      { author: pointer.author, note: pointer.note, voice: pointer.voice },
    );
    const heldOnNote = (onNote[0] as { held?: number } | undefined)?.held ?? 0;
    const heldByVoice =
      (byVoice[0] as { held?: number } | undefined)?.held ?? 0;
    if (heldOnNote >= POINTERS_PER_NOTE || heldByVoice >= POINTERS_PER_VOICE) {
      return null;
    }
    const at = nowIso();
    const [made] = await this.query(
      `CREATE comment_pointer CONTENT {
         created_by: $author, created_at: $at, updated_at: $at,
         note: $note, voice: $voice, where: $where, comment_id: $comment
       }`,
      {
        author: pointer.author,
        at,
        note: pointer.note,
        voice: pointer.voice,
        where: pointer.where,
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
   */
  async admitsAnswers(author: DidSyr, note: OwnedRef): Promise<boolean> {
    const [rows] = await this.query(
      `SELECT count() AS held FROM snapshot_node
         WHERE created_by = $author AND source = $note
           AND version IN (
             SELECT VALUE id FROM publication_version WHERE created_by = $author
               AND publication IN (
                 SELECT VALUE id FROM publication
                   WHERE created_by = $author AND comments = 'anyone'
               )
           )
         GROUP ALL`,
      { author, note },
    );
    return ((rows[0] as { held?: number } | undefined)?.held ?? 0) > 0;
  }

  /** Nothing is left to say something about, so nothing points at it. */
  async forgetNote(author: DidSyr, note: OwnedRef): Promise<void> {
    await this.query(
      "DELETE comment_pointer WHERE created_by = $author AND note = $note",
      { author, note },
    );
  }

  private query<T = Record<string, unknown>>(
    sql: string,
    vars: Record<string, unknown>,
  ) {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
