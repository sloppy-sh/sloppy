// Voices somebody will not be shown. `created_by` is the person doing the
// refusing, and a row decides what this instance assembles for them alone —
// docs/ARCHITECTURE.md § "Federating the graph".

import { Injectable } from "@nestjs/common";
import {
  createOwnedRecordId,
  type DidSyr,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
  type Principal,
  type RefusedVoice,
  RefusedVoiceSchema,
} from "@sloppy/types";
import { DbService } from "../db/db.service";

/** A voice refused, and where: `note` absent refuses it everywhere its owner
 *  reads. */
export interface Refusal {
  voice: DidSyr;
  note?: OwnedRef;
}

/** A blanket refusal has no note at all, so the pair is matched against an
 *  absent column rather than against a value. */
function onNote(refusal: Refusal): string {
  return refusal.note === undefined ? "note = NONE" : "note = $note";
}

@Injectable()
export class RefusalRepository {
  constructor(private readonly db: DbService) {}

  /** Everything this person has refused, blanket and per note together. */
  async listRefusals(owner: Principal): Promise<RefusedVoice[]> {
    const [rows] = await this.query(
      "SELECT * FROM refused_voice WHERE created_by = $owner ORDER BY created_at ASC",
      { owner },
    );
    return rows.map((row) => RefusedVoiceSchema.parse(row));
  }

  /**
   * The refusal that pair already made, or a new one — the pair IS the row, so
   * refusing the same voice on the same note twice is one refusal.
   */
  async refuse(owner: Principal, refusal: Refusal): Promise<RefusedVoice> {
    const [standing] = await this.query(
      `SELECT * FROM refused_voice
         WHERE created_by = $owner AND voice = $voice AND ${onNote(refusal)}`,
      { owner, voice: refusal.voice, note: refusal.note },
    );
    if (standing[0] !== undefined) return RefusedVoiceSchema.parse(standing[0]);

    const at = nowIso();
    const [written] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      {
        id: createOwnedRecordId("refused_voice", owner),
        content: {
          created_by: owner,
          voice: refusal.voice,
          ...(refusal.note === undefined ? {} : { note: refusal.note }),
          created_at: at,
          updated_at: at,
        },
      },
    );
    return RefusedVoiceSchema.parse(written[0]);
  }

  /** Takes back the refusal that pair made, and says nothing where there was
   *  none. */
  async allow(owner: Principal, refusal: Refusal): Promise<void> {
    await this.query(
      `DELETE refused_voice
         WHERE created_by = $owner AND voice = $voice AND ${onNote(refusal)}`,
      { owner, voice: refusal.voice, note: refusal.note },
    );
  }

  private query<T = Record<string, unknown>>(
    sql: string,
    vars: Record<string, unknown>,
  ) {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}

/** The reference a `refused_voice` row is cited by. */
export function refusalRef(row: RefusedVoice): OwnedRef {
  return ownedRefFrom(row.id);
}

/** Whether refusals their owner made reach one voice while they read one note —
 *  the blanket ones and the ones made on that note, as one answer. */
export function refuses(
  refusals: readonly RefusedVoice[],
  voice: DidSyr,
  note?: OwnedRef,
): boolean {
  return refusals.some(
    (one) =>
      one.voice === voice && (one.note === undefined || one.note === note),
  );
}
