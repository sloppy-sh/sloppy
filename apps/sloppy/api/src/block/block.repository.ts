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

  /**
   * The stacks of several notes at once, each in `ord` order. Publishing a
   * branch reads it a batch of notes at a time; one call per note would be one
   * round trip per note.
   */
  async listByNodes(
    nodes: readonly OwnedRef[],
  ): Promise<Map<OwnedRef, Block[]>> {
    const stacks = new Map<OwnedRef, Block[]>();
    if (nodes.length === 0) return stacks;
    const [rows] = await this.query(
      "SELECT * FROM block WHERE node IN $nodes",
      { nodes: [...nodes] },
    );
    for (const row of rows) {
      const block = BlockSchema.parse(row);
      const held = stacks.get(block.node);
      if (held) held.push(block);
      else stacks.set(block.node, [block]);
    }
    for (const stack of stacks.values()) {
      stack.sort((a, b) => compareOrd(a.ord, b.ord));
    }
    return stacks;
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
