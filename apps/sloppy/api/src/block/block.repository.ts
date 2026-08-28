// The `block` table — a node's interior, ordered by a fractional index.
// docs/ARCHITECTURE.md § "Data model".

import { Injectable } from "@nestjs/common";
import {
  type Block,
  BlockSchema,
  compareOrd,
  type OwnedRef,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import { DbService } from "../db/db.service";
import { replacement } from "../node/patch";

const PATCHABLE = ["ord", "content"] as const;

export type BlockPatch = Partial<Pick<Block, (typeof PATCHABLE)[number]>>;

@Injectable()
export class BlockRepository {
  constructor(private readonly db: DbService) {}

  /** In `ord` order, sorted here rather than by the server so the ordering the
   *  stack renders in is the one `compareOrd` defines. */
  async listByNode(node: OwnedRef): Promise<Block[]> {
    const [rows] = await this.query("SELECT * FROM block WHERE node = $node", {
      node,
    });
    return rows
      .map((row) => BlockSchema.parse(row))
      .sort((a, b) => compareOrd(a.ord, b.ord));
  }

  async find(did: string, ref: OwnedRef): Promise<Block | null> {
    const [rows] = await this.query(
      "SELECT * FROM block WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("block", ref), did },
    );
    const row = rows[0];
    return row === undefined ? null : BlockSchema.parse(row);
  }

  async insert(block: Block): Promise<Block> {
    const { id, ...content } = block;
    const [rows] = await this.query(
      "CREATE $id CONTENT $content RETURN AFTER",
      {
        id,
        content,
      },
    );
    return BlockSchema.parse(rows[0]);
  }

  async patch(
    did: string,
    ref: OwnedRef,
    changes: BlockPatch,
  ): Promise<Block | null> {
    const set = replacement(PATCHABLE, changes);
    const [rows] = await this.query(
      `UPDATE $id SET ${set.clause} WHERE created_by = $did RETURN AFTER`,
      { id: recordIdFromOwnedRef("block", ref), did, ...set.vars },
    );
    const row = rows[0];
    return row === undefined ? null : BlockSchema.parse(row);
  }

  async remove(did: string, ref: OwnedRef): Promise<void> {
    await this.db.handle.query(
      "DELETE block WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("block", ref), did },
    );
  }

  private query(
    sql: string,
    vars: Record<string, unknown>,
  ): Promise<[unknown[]]> {
    return this.db.handle.query<[unknown[]]>(sql, vars);
  }
}
