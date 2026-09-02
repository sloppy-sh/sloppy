// What people say back: comments and reactions on a note.
//
// Every one of these records belongs to the identity store of whoever wrote it,
// never to Sloppy — AI.md § "Sloppy's Vocabulary Stays Out of the Identity
// Store". `syr.ts` speaks the dialect those stores answer in; these are the
// shapes Sloppy's own API hands a surface, already resolved to something it can
// draw.
//
// Discovery is per-identity and pull-only, so what a reader sees on a note is
// what the identities they follow have written on it. docs/ARCHITECTURE.md
// § "Federating the graph" carries what that means for the product.

import { z } from "zod";
import { DidSyrSchema, OwnedRefSchema, TimestampSchema } from "./common.js";
import { CustomEmojiSchema } from "./emoji.js";

/**
 * One comment on a note.
 *
 * `comment_id` is opaque and only meaningful to the store that issued it — a
 * peer's store mints ids its own way, so nothing here parses one.
 */
export const NoteCommentSchema = z.object({
  comment_id: z.string().min(1),
  author: DidSyrSchema,
  node: OwnedRefSchema,
  /**
   * The comment this answers; absent at the top of a thread. A reader can hold
   * a reply whose parent they cannot see, because they reach only what the
   * identities they follow wrote — so a `reply_to` that resolves to nothing is
   * an ordinary state of a thread rather than a missing row.
   */
  reply_to: z.string().min(1).optional(),
  content: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type NoteComment = z.infer<typeof NoteCommentSchema>;

export const NOTE_COMMENT_MAX = 4000;

export const CreateNoteCommentRequestSchema = z.object({
  node: OwnedRefSchema,
  content: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(NOTE_COMMENT_MAX, "That is longer than a comment can be. Trim it."),
  reply_to: z.string().min(1).optional(),
});
export type CreateNoteCommentRequest = z.input<
  typeof CreateNoteCommentRequestSchema
>;

const reactionIdentity = {
  /** Opaque, like a comment's. */
  reaction_id: z.string().min(1),
  author: DidSyrSchema,
  node: OwnedRefSchema,
};

/**
 * What somebody reacted with: a character off their keyboard, or an entry in
 * an identity's emoji catalog. Keyed by which, so a third kind is a member here
 * rather than a field every other reaction leaves empty.
 */
export const NoteReactionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("character"),
    ...reactionIdentity,
    character: z.string().min(1),
  }),
  z.object({
    kind: z.literal("emoji"),
    ...reactionIdentity,
    emoji: CustomEmojiSchema,
  }),
]);
export type NoteReaction = z.infer<typeof NoteReactionSchema>;

/**
 * React to a note. An `emoji` reaction names a catalog entry and never an
 * address, for the reason `CreateEmojiRequest` names an upload: the picture is
 * read back out of the store that holds it, so a caller cannot have this
 * instance mint a durable public link for a URL of their choosing.
 */
export const CreateNoteReactionRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("character"),
    node: OwnedRefSchema,
    character: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal("emoji"),
    node: OwnedRefSchema,
    emoji_id: z.string().min(1),
  }),
]);
export type CreateNoteReactionRequest = z.input<
  typeof CreateNoteReactionRequestSchema
>;
