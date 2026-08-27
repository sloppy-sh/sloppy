// The `label_dimension` table — the facet axis a lens switches between.
// docs/ARCHITECTURE.md § "Data model".

import { Injectable } from "@nestjs/common";
import {
  type LabelDimension,
  LabelDimensionSchema,
  nowIso,
  type OwnedRef,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import { DbService } from "../db/db.service";

export type LabelDimensionPatch = Partial<
  Pick<LabelDimension, "name" | "values" | "color_slot">
>;

@Injectable()
export class LabelRepository {
  constructor(private readonly db: DbService) {}

  /** In declaration order, which is what picks a hue slot for a dimension that
   *  names none — DESIGN.md § Hue. */
  async list(did: string): Promise<LabelDimension[]> {
    const [rows] = await this.query(
      "SELECT * FROM label_dimension WHERE created_by = $did ORDER BY created_at",
      { did },
    );
    return rows.map((row) => LabelDimensionSchema.parse(row));
  }

  async find(did: string, ref: OwnedRef): Promise<LabelDimension | null> {
    const [rows] = await this.query(
      "SELECT * FROM label_dimension WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("label_dimension", ref), did },
    );
    const row = rows[0];
    return row === undefined ? null : LabelDimensionSchema.parse(row);
  }

  async insert(dimension: LabelDimension): Promise<LabelDimension> {
    const { id, ...content } = dimension;
    const [rows] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      { id, content },
    );
    return LabelDimensionSchema.parse(rows[0]);
  }

  async patch(
    did: string,
    ref: OwnedRef,
    changes: LabelDimensionPatch,
  ): Promise<LabelDimension | null> {
    const [rows] = await this.query(
      "UPDATE $id MERGE $changes WHERE created_by = $did RETURN AFTER",
      {
        id: recordIdFromOwnedRef("label_dimension", ref),
        did,
        changes: { ...changes, updated_at: nowIso() },
      },
    );
    const row = rows[0];
    return row === undefined ? null : LabelDimensionSchema.parse(row);
  }

  async remove(did: string, ref: OwnedRef): Promise<void> {
    await this.db.handle.query(
      "DELETE label_dimension WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("label_dimension", ref), did },
    );
  }

  private query(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[unknown[]]> {
    return this.db.handle.query<[unknown[]]>(sql, vars);
  }
}
