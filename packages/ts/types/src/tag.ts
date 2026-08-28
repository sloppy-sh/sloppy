// The tag axis: a tag is a string on a note, and nothing declares it first.
// AI.md § "Two orthogonal axes".

import { z } from "zod";

/** Long enough for a compound word, short enough to draw as a chip. */
export const TAG_MAX_LENGTH = 64;

/**
 * A note with more tags than this has stopped classifying anything, and the row
 * is read whole on every graph load.
 */
export const MAX_TAGS_PER_NODE = 32;

/**
 * One tag, normalized: surrounding space is dropped, case is folded away, and
 * no whitespace survives inside — so a tag is always one token, and `Biology`
 * and `biology` are the same set rather than two a reader cannot tell apart.
 */
export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "A tag needs at least one character.")
  .max(TAG_MAX_LENGTH, `A tag is at most ${TAG_MAX_LENGTH} characters.`)
  .regex(/^[^\s\p{Cc}]+$/u, "A tag is one word, with no spaces in it.");
export type Tag = z.infer<typeof TagSchema>;

/**
 * A note's tags as a SET: duplicates collapse, and the order is alphabetical
 * rather than the order they were typed. Two notes carrying the same tags
 * therefore hold byte-identical arrays — which matters because the array is
 * inside the payload a node is signed over.
 */
export const TagsSchema = z
  .array(TagSchema)
  .max(MAX_TAGS_PER_NODE, `A note carries at most ${MAX_TAGS_PER_NODE} tags.`)
  .transform((tags) => [...new Set(tags)].sort());
export type Tags = z.infer<typeof TagsSchema>;
