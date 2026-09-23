// Pointers left at a note author's instance: that somebody said something about
// one of their notes. The words are never here, and neither is the store that
// holds them — docs/ARCHITECTURE.md § "Federating the graph".
//
// `created_by` is the note's AUTHOR, the person the pointer was left for. The
// one read owned by the READER instead is {@link PointerRepository.sourceOf},
// which is where they leave one.

import { Injectable } from "@nestjs/common";
import {
  type DidSyr,
  type OwnedRef,
  POINTERS_PER_NOTE,
  type Principal,
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

/** One note of the author's and the voices that answered it. */
export interface Answered {
  note: OwnedRef;
  voices: DidSyr[];
}

/**
 * How many pointers one read of {@link PointerRepository.answered} takes in.
 * A note holds at most `POINTERS_PER_NOTE` of them, so this bounds the work
 * rather than the list: past it, the notes answered earliest are the ones
 * named.
 */
const ANSWERED_POINTERS = 2_000;

/** What SurrealDB says when a UNIQUE index refuses a second row for one key. */
function alreadyThere(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes("comment_pointer_owner_voice_comment")
  );
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
    author: Principal,
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
   * Every note of this person's somebody has left a pointer on, and who left
   * one, in the order the first answer to each arrived.
   */
  async answered(author: Principal): Promise<Answered[]> {
    const [rows] = await this.query<{ note: OwnedRef; voice: DidSyr }>(
      `SELECT note, voice, created_at FROM comment_pointer
         WHERE created_by = $author
         ORDER BY created_at ASC LIMIT $rows`,
      { author, rows: ANSWERED_POINTERS },
    );
    const answered = new Map<OwnedRef, Answered>();
    for (const row of rows) {
      const held = answered.get(row.note);
      if (held === undefined) {
        answered.set(row.note, { note: row.note, voices: [row.voice] });
      } else if (!held.voices.includes(row.voice)) {
        held.voices.push(row.voice);
      }
    }
    return [...answered.values()];
  }

  /**
   * Where the region this reader holds a note in was read from — the instance
   * an answer to it is deposited at — or `null` where they hold no copy of it.
   * Two regions carrying one note were both read from its author's instance, so
   * either answers.
   */
  async sourceOf(reader: DidSyr, note: OwnedRef): Promise<string | null> {
    const [carriedBy] = await this.query<OwnedRef>(
      "SELECT VALUE pull FROM pull_member WHERE created_by = $reader AND source = $note",
      { reader, note },
    );
    const regions = this.recordIds("pull", carriedBy);
    if (regions.length === 0) return null;
    const [rows] = await this.query<{ source_url?: unknown }>(
      "SELECT source_url FROM pull WHERE created_by = $reader AND id IN $regions",
      { reader, regions },
    );
    const served = rows
      .map((row) => row.source_url)
      .find((url): url is string => typeof url === "string" && url !== "");
    return served ?? null;
  }

  /**
   * Leaves one, or leaves the row that is already there — the same pointer
   * twice is the same pointer. A full note keeps what it holds and takes no
   * more, which the depositor is not told either way.
   */
  async leave(pointer: {
    author: Principal;
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
    try {
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
    } catch (err) {
      // The standing read above is separated from this write by the outbound
      // check the caller ran, which is a store fetch and not an instant — so
      // two deposits of one claim can both find nothing and both write. The
      // index is what settles it, and the loser has nothing to report: the row
      // it wanted is there. Anything else is a real failure.
      if (!alreadyThere(err)) throw err;
    }
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
  async answersFrom(author: Principal, note: OwnedRef): Promise<string | null> {
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

  private async crowdOn(author: Principal, note: OwnedRef): Promise<Crowd[]> {
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
