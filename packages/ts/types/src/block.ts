// A node's interior: an ordered stack of blocks. A block is a section somebody
// added deliberately, and it holds however many elements they write into it —
// docs/ARCHITECTURE.md § "Blocks and ink".

import { z } from "zod";
import {
  OwnedEntitySchema,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
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
  /**
   * The section's own words, plain, derived from `content` and rewritten
   * whenever it changes — what a search of somebody's writing reads. Absent is
   * a section nothing has derived them for, and every reader takes that as no
   * words to find. Derived means the server alone writes it:
   * docs/ARCHITECTURE.md § "Data model".
   */
  text: z.string().optional(),
  /** When it went with the note that holds it. Absent is a section that is
   *  there, which is every one stored before a note could be put back. */
  deleted_at: TimestampSchema.optional(),
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

/**
 * `after` absent leaves the position alone; `null` moves the block to the top.
 *
 * `node` absent leaves the block in the note it is already in. Given, it names
 * the note the block belongs to after the write — which must be the writer's
 * own, and is refused otherwise — and the block leaves the stack it was in.
 * `after` then names a section of THAT note; `null` or absent puts it at the
 * top, since a block arriving has no position there to leave alone.
 *
 * `expects` is the `updated_at` the writer last read off this section. Absent
 * asks for no precondition and overwrites whatever is there; a value that does
 * not match the row the write lands on means the section was written somewhere
 * else in between, and the write is refused rather than taking that writing
 * with it.
 */
export const UpdateBlockRequestSchema = z.object({
  node: OwnedRefSchema.optional(),
  after: OwnedRefSchema.nullable().optional(),
  content: BlockDocumentSchema.optional(),
  expects: TimestampSchema.optional(),
});
export type UpdateBlockRequest = z.input<typeof UpdateBlockRequestSchema>;
