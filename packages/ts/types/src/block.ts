// A node's interior: an ordered stack of blocks. A block is a section somebody
// added deliberately, and it holds however many elements they write into it —
// docs/ARCHITECTURE.md § "Blocks and ink".

import { z } from "zod";
import { OwnedEntitySchema, OwnedRefSchema } from "./common.js";
import { BlockDocumentSchema, emptyDocument } from "./document.js";

export const BlockSchema = OwnedEntitySchema.extend({
  node: OwnedRefSchema,
  /**
   * Fractional index: a block is placed between its neighbours rather than at
   * an integer position, so moving one writes one row and leaves the rest of
   * the stack untouched. Ordered by `compareOrd`, never by parsing it.
   */
  ord: z.string().min(1),
  /** The whole section, as the editor wrote it. */
  content: BlockDocumentSchema.default(emptyDocument),
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
 * Create a block — the only way a section comes into being, and never as a side
 * effect of typing. `after` names the block it follows, and the server derives
 * `ord` from that neighbour and the next one; absent, the block lands first.
 */
export const CreateBlockRequestSchema = z.object({
  node: OwnedRefSchema,
  after: OwnedRefSchema.optional(),
  content: BlockDocumentSchema.default(emptyDocument),
});
export type CreateBlockRequest = z.input<typeof CreateBlockRequestSchema>;

/** `after` absent leaves the position alone; `null` moves the block to the top. */
export const UpdateBlockRequestSchema = z.object({
  after: OwnedRefSchema.nullable().optional(),
  content: BlockDocumentSchema.optional(),
});
export type UpdateBlockRequest = z.input<typeof UpdateBlockRequestSchema>;
