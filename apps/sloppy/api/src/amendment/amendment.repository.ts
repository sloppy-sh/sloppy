// The `amendment` table: what has been offered on a note, and the one write
// taking an offer in lands as. docs/ARCHITECTURE.md § "Whose writing a note
// carries".

import { Injectable } from "@nestjs/common";
import {
  type Amendment,
  AmendmentSchema,
  type BlockDocument,
  type DidSyr,
  type NodeAppearance,
  nowIso,
  type OwnedRef,
  recordIdFromOwnedRef,
  type Tags,
} from "@sloppy/types";
import { wordsOf } from "../block/text";
import { DbService } from "../db/db.service";

/** One section of the note as the offer would have it, already placed. */
export interface SettledSection {
  ref: OwnedRef;
  content: BlockDocument;
  ord: string;
  /** Whether the note already holds this section, which decides whether the
   *  write keeps its `created_at` or mints one. */
  standing: boolean;
}

/** A note as taking one offer in leaves it, with the offer itself going. */
export interface Approval {
  offer: OwnedRef;
  note: OwnedRef;
  title: string;
  tags: Tags;
  /** Absent leaves the note's look as it is. */
  appearance?: NodeAppearance;
  contributors: DidSyr[];
  references: OwnedRef[];
  sections: SettledSection[];
  /** The note's sections the offer does not carry. */
  dropping: OwnedRef[];
}

@Injectable()
export class AmendmentRepository {
  constructor(private readonly db: DbService) {}

  /** What has been offered on one note, oldest first — the order it arrived
   *  in, which is the order every surface reads it in. */
  async listFor(did: DidSyr, note: OwnedRef): Promise<Amendment[]> {
    const [rows] = await this.query(
      `SELECT * FROM amendment
         WHERE created_by = $did AND note = $note ORDER BY created_at`,
      { did, note },
    );
    return rows.map((row) => AmendmentSchema.parse(row));
  }

  /** What is standing offered on any of these notes, in a settled order, so
   *  two reads of one graph answer the same way. */
  async listOn(did: DidSyr, notes: readonly OwnedRef[]): Promise<Amendment[]> {
    if (notes.length === 0) return [];
    const [rows] = await this.query(
      `SELECT * FROM amendment
         WHERE created_by = $did AND note IN $notes ORDER BY id`,
      { did, notes: [...notes] },
    );
    return rows.map((row) => AmendmentSchema.parse(row));
  }

  /** One offer, wherever it stands. The reference names the graph it is in, so
   *  the owner is part of the key rather than a check on what comes back. */
  async find(ref: OwnedRef): Promise<Amendment | null> {
    const [rows] = await this.query("SELECT * FROM amendment WHERE id = $id", {
      id: recordIdFromOwnedRef("amendment", ref),
    });
    return rows[0] === undefined ? null : AmendmentSchema.parse(rows[0]);
  }

  async remove(ref: OwnedRef): Promise<void> {
    await this.query("DELETE $id", {
      id: recordIdFromOwnedRef("amendment", ref),
    });
  }

  /**
   * The note's writing becomes the offer's, whole, and the offer goes — in one
   * transaction, so a note is never left holding half of one.
   *
   * `authors` is deliberately untouched: an owned note's authorship stays its
   * owner's, and taking an offer in adds a contributor.
   */
  async approve(did: DidSyr, taking: Approval): Promise<void> {
    const now = nowIso();
    const statements = [
      "BEGIN TRANSACTION;",
      `UPDATE $note SET title = $title, tags = $tags, contributors = $contributors,
         references = $references, updated_at = $now
         WHERE created_by = $did RETURN NONE;`,
      ...(taking.appearance === undefined
        ? []
        : [
            `UPDATE $note SET appearance = $appearance
               WHERE created_by = $did RETURN NONE;`,
          ]),
      ...(taking.dropping.length === 0
        ? []
        : ["DELETE block WHERE created_by = $did AND id IN $dropping;"]),
      ...taking.sections.map((section, at) =>
        section.standing
          ? `UPDATE $section${at} SET content = $content${at}, text = $text${at},
               ord = $ord${at}, node = $noteRef, updated_at = $now
               WHERE created_by = $did RETURN NONE;`
          : `CREATE $section${at} CONTENT {
               created_by: $did, node: $noteRef, ord: $ord${at},
               content: $content${at}, text: $text${at},
               created_at: $now, updated_at: $now
             } RETURN NONE;`,
      ),
      "DELETE $offer;",
      "COMMIT TRANSACTION;",
    ];
    await this.db.handle.query(statements.join("\n"), {
      did,
      now,
      offer: recordIdFromOwnedRef("amendment", taking.offer),
      note: recordIdFromOwnedRef("node", taking.note),
      noteRef: taking.note,
      title: taking.title,
      tags: [...taking.tags],
      contributors: [...taking.contributors],
      references: [...taking.references],
      appearance: taking.appearance,
      dropping: taking.dropping.map((ref) =>
        recordIdFromOwnedRef("block", ref),
      ),
      ...Object.fromEntries(
        taking.sections.flatMap((section, at) => [
          [`section${at}`, recordIdFromOwnedRef("block", section.ref)],
          [`content${at}`, section.content],
          [`text${at}`, wordsOf(section.content)],
          [`ord${at}`, section.ord],
        ]),
      ),
    });
  }

  private query(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[unknown[]]> {
    return this.db.handle.query<[unknown[]]>(sql, vars);
  }
}
