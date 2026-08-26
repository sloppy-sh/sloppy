// A node's interior: an ordered stack of blocks.

import { z } from "zod";
import { OwnedEntitySchema, OwnedRefSchema } from "./common.js";

export const BlockTypeSchema = z.enum([
  "paragraph",
  "heading",
  "list",
  "todo",
  "code",
  "image",
  "ink",
  "embed",
]);
export type BlockType = z.infer<typeof BlockTypeSchema>;

export const BlockSchema = OwnedEntitySchema.extend({
  node: OwnedRefSchema,
  /**
   * Fractional index: a block is placed between its neighbours rather than at
   * an integer position, so moving one writes one row and leaves the rest of
   * the stack untouched. Ordered by `compareOrd`, never by parsing it.
   */
  ord: z.string().min(1),
  type: BlockTypeSchema,
  /** Markdown, carrying `:emoji:` and `::sticker::` shortcodes verbatim. */
  content: z.string().default(""),
  /**
   * Whatever this block's type needs beyond text — `InkBlockData` for `ink`,
   * nothing at all for `paragraph`. One opaque column rather than a column per
   * type: a new block kind is a value and a renderer, never a schema change,
   * and the renderer that owns the type owns the shape.
   */
  data: z.unknown().optional(),
});
export type Block = z.infer<typeof BlockSchema>;

/**
 * Order two fractional indices. Plain lexicographic comparison of the digits —
 * the property the index is generated to have — so an implementation that
 * changes the alphabet changes this and nothing else.
 */
export function compareOrd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Create a block. `after` names the block it follows, and the server derives
 * `ord` from that neighbour and the next one; absent, the block lands first.
 */
export const CreateBlockRequestSchema = z.object({
  node: OwnedRefSchema,
  after: OwnedRefSchema.optional(),
  type: BlockTypeSchema,
  content: z.string().default(""),
  data: z.unknown().optional(),
});
export type CreateBlockRequest = z.input<typeof CreateBlockRequestSchema>;

/** `after` absent leaves the position alone; `null` moves the block to the top. */
export const UpdateBlockRequestSchema = z.object({
  after: OwnedRefSchema.nullable().optional(),
  type: BlockTypeSchema.optional(),
  content: z.string().optional(),
  data: z.unknown().optional(),
});
export type UpdateBlockRequest = z.input<typeof UpdateBlockRequestSchema>;
