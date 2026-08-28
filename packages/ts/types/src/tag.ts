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

// The zero-width joiner and non-joiner sit inside a word in Persian and inside
// a single emoji, so they are the two invisibles a tag may carry; the rest of
// them only make two tags a reader cannot tell apart.
const ONE_VISIBLE_WORD = /^(?:[\u200c\u200d]|[^\s\p{Cc}\p{Cf}\p{Cs}])+$/u;

/**
 * One tag, in the form it will be compared in — so `Biology`, `biology`, and a
 * `réveil` whose accent arrived decomposed are one set rather than several a
 * reader cannot tell apart.
 */
export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .normalize("NFC")
  .min(1, "A tag needs at least one character.")
  .max(TAG_MAX_LENGTH, `A tag is at most ${TAG_MAX_LENGTH} characters.`)
  .regex(ONE_VISIBLE_WORD, "A tag is one word, with no spaces in it.");
export type Tag = z.infer<typeof TagSchema>;

/**
 * A note's tags as a SET: duplicates collapse, and the order is alphabetical
 * rather than the order they were typed. Two notes carrying the same tags
 * therefore hold byte-identical arrays — which matters because the array is
 * inside the payload a node is signed over.
 */
export const TagsSchema = z
  .array(TagSchema)
  .transform((tags) => [...new Set(tags)].sort())
  .refine(
    (tags) => tags.length <= MAX_TAGS_PER_NODE,
    `A note carries at most ${MAX_TAGS_PER_NODE} tags.`,
  );
export type Tags = z.infer<typeof TagsSchema>;
