// A change offered on a note somebody else owns, and never landed on it —
// docs/ARCHITECTURE.md § "Whose writing a note carries".

import { BlockViewSchema } from "./api.js";
import { NodeAppearanceSchema, WrittenAppearanceSchema } from "./appearance.js";
import {
  DidSyrSchema,
  OwnedEntitySchema,
  OwnedRefSchema,
  TimestampSchema,
} from "./common.js";
import { BlockDocumentSchema } from "./document.js";
import { TagsSchema } from "./tag.js";
import { z } from "zod";

/**
 * One offer, standing until the owner takes it in or turns it down. It carries
 * the note's WRITING and nothing about its place: a contributor does not move,
 * renumber or re-parent a note they do not own.
 *
 * `created_by` is the note's OWNER, the way `comment_pointer`'s is — these rows
 * are theirs to read and theirs to purge — and `by` is who offered it.
 */
export const AmendmentSchema = OwnedEntitySchema.extend({
  note: OwnedRefSchema,
  by: DidSyrSchema,
  /** When the person offering it last wrote it. The row's own stamps are the
   *  store's; this is the one that travels in a file and in an archive. */
  at: TimestampSchema,
  /** What they said about the offer. Absent is one offered with nothing said. */
  message: z.string().max(2048).optional(),
  title: z.string().max(512).default(""),
  tags: TagsSchema.default([]),
  /** Absent is an offer that leaves the note's look alone. */
  appearance: NodeAppearanceSchema.optional(),
});
export type Amendment = z.infer<typeof AmendmentSchema>;

/** The offer with the sections it proposes, in the order they read. */
export const AmendmentViewSchema = AmendmentSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
  blocks: z.array(BlockViewSchema),
});
export type AmendmentView = z.infer<typeof AmendmentViewSchema>;

/**
 * Offer a change on somebody else's note. Offering again on a note you already
 * have an offer standing on writes that one rather than stacking a second.
 *
 * Every field is the note's writing as the proposer would have it, whole: the
 * offer replaces what the note says rather than describing a delta, because
 * what the owner is shown is the two of them side by side.
 */
export const ProposeAmendmentRequestSchema = z.strictObject(
  {
    note: OwnedRefSchema,
    message: z.string().max(2048).optional(),
    title: z.string().max(512).default(""),
    tags: TagsSchema.default([]),
    appearance: WrittenAppearanceSchema.optional(),
    blocks: z.array(
      z.strictObject({
        /** The section of the note this one stands for, kept as it is or
         *  rewritten. Absent is a section the offer adds. */
        ref: OwnedRefSchema.optional(),
        document: BlockDocumentSchema,
      }),
    ),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type ProposeAmendmentRequest = z.input<
  typeof ProposeAmendmentRequestSchema
>;
