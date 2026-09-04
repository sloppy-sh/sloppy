// What people say back: comments and reactions on a note.
//
// Every one of these records belongs to the identity store of whoever wrote it,
// never to Sloppy — AI.md § "Sloppy's Vocabulary Stays Out of the Identity
// Store". `syr.ts` speaks the dialect those stores answer in; these are the
// shapes Sloppy's own API hands a surface, already resolved to something it can
// draw.
//
// Discovery is per-identity and pull-only, so a reader reaches their own store
// and those of the identities they follow — and, for a note of their own, the
// stores of the voices a `CommentPointer` names, which is how somebody they do
// not follow can still reach them.
// docs/ARCHITECTURE.md § "Federating the graph" carries what that means for the
// product.

import { z } from "zod";
import {
  DidSyrSchema,
  OwnedEntitySchema,
  OwnedRefSchema,
  StoreRefSchema,
  TimestampSchema,
} from "./common.js";
import { CustomEmojiSchema } from "./emoji.js";

/**
 * One comment on a note.
 *
 * A comment lives in its author's store and is cited the way that store cites
 * it, `<did>:<local id>` — the same form a thread's ancestors are written in,
 * so `reply_to` compares to one directly.
 */
export const NoteCommentSchema = z.object({
  comment_id: StoreRefSchema,
  author: DidSyrSchema,
  node: OwnedRefSchema,
  /**
   * The comment this answers; absent at the top of a thread. A reader can hold
   * a reply whose parent they cannot see, because they reach only their own
   * store and those of the identities they follow — so a `reply_to` that
   * resolves to nothing is an ordinary state of a thread, not a missing row.
   */
  reply_to: StoreRefSchema.optional(),
  content: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  /**
   * Present when the author signed the comment through their own store. The
   * same rule a node's signature carries: a reader that cannot verify one still
   * renders the comment, and a reader that can, and finds it wrong, must not
   * present it as the author's. Absent is the ordinary case and says nothing
   * either way.
   */
  content_signature: z.string().optional(),
  signed_payload_json: z.string().optional(),
  signing_device_public_key: z.string().optional(),
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
  reply_to: StoreRefSchema.optional(),
});
export type CreateNoteCommentRequest = z.input<
  typeof CreateNoteCommentRequestSchema
>;

const reactionIdentity = {
  /** Cited the way a comment is, by the store that issued it. */
  reaction_id: StoreRefSchema,
  author: DidSyrSchema,
  node: OwnedRefSchema,
};

/**
 * What somebody reacted with: a character off their keyboard, or an entry in
 * an identity's emoji catalog. Keyed by which, so a third kind is a member here
 * rather than a field every other reaction leaves empty.
 *
 * No signature, unlike a comment: syr stores one on a reaction and its public
 * listing does not serve it, so a reader never receives one to check.
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

/**
 * That somebody said something about a note, left at the note author's instance
 * so they learn of it without having to follow whoever wrote it. Pull-only
 * federation has no relay and no firehose, so nothing else would tell an
 * instance that a stranger's comment now exists.
 *
 * **It carries no words, and it does not carry a place either.** A DID names a
 * person and never a place, so where that person's store answers is resolved by
 * the note author's own instance — a depositor who named the store would be
 * vouching for the identity they are claiming to be.
 *
 * **A row exists only where that store has already served the comment**, in
 * that name and about that note. A claim that does not check out is refused on
 * the way in rather than kept and dropped at every read, so a slot always holds
 * an answer somebody can be shown.
 *
 * `created_by` is the NOTE's author — the person it was left for, and the one
 * whose purge has to reach it.
 */
export const CommentPointerSchema = OwnedEntitySchema.extend({
  note: OwnedRefSchema,
  /** Who wrote it, as their own store served it back. */
  voice: DidSyrSchema,
  comment_id: StoreRefSchema,
});
export type CommentPointer = z.infer<typeof CommentPointerSchema>;

/** What `POST /nodes/{did}/{localId}/replies` binds. */
export const LeaveCommentPointerRequestSchema = z.object({
  voice: DidSyrSchema,
  comment_id: StoreRefSchema,
});
export type LeaveCommentPointerRequest = z.input<
  typeof LeaveCommentPointerRequestSchema
>;

/**
 * How many pointers one instance keeps for a note, how many of those any single
 * voice may account for, and how many stores reading the note will ask.
 *
 * `VOICES_PER_NOTE` is the one that bounds the WORK, and it is separate because
 * the other two do not imply it: a note may hold its whole allowance one
 * pointer per voice, and a read asks a store once per voice rather than once
 * per pointer. Past it, the voices that answered earliest are the ones read.
 *
 * A full note refuses what arrives next rather than dropping what it holds.
 * Nothing here decides who gets in — a pointer is kept only where the voice's
 * own store served the comment, so a slot cannot be taken by a claim that was
 * never true.
 */
export const POINTERS_PER_NOTE = 500;
export const POINTERS_PER_VOICE = 20;
export const VOICES_PER_NOTE = 50;
