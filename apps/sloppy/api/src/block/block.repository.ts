// The `block` table — a node's interior, ordered by a fractional index.
// docs/ARCHITECTURE.md § "Data model".

import { Injectable } from "@nestjs/common";
import {
  type Block,
  BlockSchema,
  compareOrd,
  type OwnedRef,
  OwnedRefSchema,
  recordIdFromOwnedRef,
} from "@sloppy/types";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { replacement } from "../node/patch";

const PATCHABLE = ["ord", "content"] as const;

/** How many references one `IN` carries. */
const PER_STATEMENT = 500;

export type BlockPatch = Partial<Pick<Block, (typeof PATCHABLE)[number]>>;

/**
 * A row read only for what its writing NAMES, which is why `content` is taken
 * as stored rather than validated: writing kept before a block held the
 * editor's own document is a bare string, and deriving what a note cites must
 * step over one of those rather than stop at it. Everything that renders or
 * publishes a block still reads it through `BlockSchema`.
 */
const StoredSchema = z.object({
  node: OwnedRefSchema,
  ord: z.string().min(1),
  content: z.unknown(),
});
export type StoredBlock = z.infer<typeof StoredSchema>;

@Injectable()
export class BlockRepository {
  constructor(private readonly db: DbService) {}

  /** In `ord` order, sorted here rather than by the server so the ordering the
   *  stack renders in is the one `compareOrd` defines. */
  /** One note's stack, as stored — see {@link StoredSchema}. */
  async storedByNode(node: OwnedRef): Promise<StoredBlock[]> {
    const [rows] = await this.query("SELECT * FROM block WHERE node = $node", {
      node,
    });
    return rows
      .map((row) => StoredSchema.parse(row))
      .sort((a, b) => compareOrd(a.ord, b.ord));
  }

  /** The same for several notes at once — see {@link StoredSchema}. */
  async storedByNodes(
    nodes: readonly OwnedRef[],
  ): Promise<Map<OwnedRef, StoredBlock[]>> {
    const stacks = new Map<OwnedRef, StoredBlock[]>();
    if (nodes.length === 0) return stacks;
    const [rows] = await this.query(
      "SELECT * FROM block WHERE node IN $nodes",
      { nodes: [...nodes] },
    );
    for (const row of rows) {
      const block = StoredSchema.parse(row);
      const held = stacks.get(block.node);
      if (held) held.push(block);
      else stacks.set(block.node, [block]);
    }
    for (const stack of stacks.values()) {
      stack.sort((a, b) => compareOrd(a.ord, b.ord));
    }
    return stacks;
  }

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

  /** Which of these notes have had a section written in since a moment. The
   *  refs alone: a section's document is what makes reading a whole branch
   *  expensive, and none of them is read here. */
  async writtenSince(
    did: string,
    nodes: readonly OwnedRef[],
    since: string,
  ): Promise<Set<OwnedRef>> {
    const written = new Set<OwnedRef>();
    for (let at = 0; at < nodes.length; at += PER_STATEMENT) {
      const [rows] = await this.db.handle.query<[OwnedRef[]]>(
        `SELECT VALUE node FROM block
           WHERE created_by = $did AND node IN $nodes AND updated_at > $since`,
        { did, nodes: nodes.slice(at, at + PER_STATEMENT), since },
      );
      for (const node of rows) written.add(node);
    }
    return written;
  }

  /** Which note holds this block, `null` where the caller has no such block. A
   *  section's document is what makes reading one expensive, and none of it is
   *  read here. */
  async nodeOf(did: string, ref: OwnedRef): Promise<OwnedRef | null> {
    const [rows] = await this.db.handle.query<[OwnedRef[]]>(
      "SELECT VALUE node FROM block WHERE id = $id AND created_by = $did",
      { id: recordIdFromOwnedRef("block", ref), did },
    );
    return rows[0] ?? null;
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
