// The `whereabouts` table: one row per person, holding what they say about
// where their graph is served. docs/ARCHITECTURE.md § "Where a person's graph
// is".
//
// `created_by` is the SUBJECT of the declaration and not whoever served it: the
// row says where THEY are, so nobody writes anybody else's.

import { Injectable } from "@nestjs/common";
import {
  type DeclaredWhereabouts,
  DeclaredWhereaboutsSchema,
  type Principal,
  type SetWhereaboutsRequest,
  createOwnedRecordId,
  nowIso,
} from "@sloppy/types";
import { DbService } from "../db/db.service";

@Injectable()
export class WhereaboutsRepository {
  constructor(private readonly db: DbService) {}

  /** `null` is somebody who has declared nothing here, which is what an
   *  instance keeping none of their words has to answer. */
  async find(principal: Principal): Promise<DeclaredWhereabouts | null> {
    const [rows] = await this.query(
      "SELECT * FROM whereabouts WHERE created_by = $principal LIMIT 1",
      { principal },
    );
    return rows[0] === undefined
      ? null
      : DeclaredWhereaboutsSchema.parse(rows[0]);
  }

  /** Declaring again moves them: one row per person, so the second saying
   *  replaces the first rather than standing beside it. */
  async write(
    principal: Principal,
    said: SetWhereaboutsRequest,
  ): Promise<DeclaredWhereabouts> {
    const at = nowIso();
    const held = await this.find(principal);
    const [written] = held
      ? await this.query(
          `UPDATE $id SET domain = $domain, instance = $instance,
             updated_at = $at RETURN AFTER`,
          { id: held.id, domain: said.domain, instance: said.instance, at },
        )
      : await this.query("CREATE $id CONTENT $content RETURN AFTER", {
          id: createOwnedRecordId("whereabouts", principal),
          content: {
            created_by: principal,
            ...said,
            created_at: at,
            updated_at: at,
          },
        });
    return DeclaredWhereaboutsSchema.parse(written[0]);
  }

  async erase(principal: Principal): Promise<void> {
    await this.db.handle.query(
      "DELETE whereabouts WHERE created_by = $principal",
      { principal },
    );
  }

  private query<T = unknown>(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[T[]]> {
    return this.db.handle.query<[T[]]>(sql, vars);
  }
}
