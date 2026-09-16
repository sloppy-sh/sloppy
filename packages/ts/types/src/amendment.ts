// A change offered on a note somebody else owns, and never landed on it —
// docs/ARCHITECTURE.md § "Whose writing a note carries".

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
 * One section as the offer would have it, named by the ULID of the note section
 * it stands for. A ref the note has is that section kept or rewritten, one it
 * does not have is a section the offer adds, and a section of the note the offer
 * does not name is one it takes out — an offer proposes the note's body whole.
 */
export const AmendmentSectionSchema = z.object({
  ref: OwnedRefSchema,
  content: BlockDocumentSchema,
});
export type AmendmentSection = z.infer<typeof AmendmentSectionSchema>;

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
  /** The sections it proposes, in the order they read. They ride on the offer
   *  rather than in a table of their own: nothing reads one without the offer
   *  it belongs to, and the owner's purge that takes the offer takes its
   *  writing with it. */
  blocks: z.array(AmendmentSectionSchema).default([]),
});
export type Amendment = z.infer<typeof AmendmentSchema>;

export const AmendmentViewSchema = AmendmentSchema.omit({ id: true }).extend({
  ref: OwnedRefSchema,
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
    blocks: z.array(AmendmentSectionSchema),
  },
  { error: "Sloppy is out of date. Update it and try again." },
);
export type ProposeAmendmentRequest = z.input<
  typeof ProposeAmendmentRequestSchema
>;
