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
const VISIBLE = /^(?:[\u200c\u200d]|[^\p{Cc}\p{Cf}\p{Cs}])+$/u;

// A tag holds spaces — `machine learning` is one tag, and Enter is what ends it.
// But a run of them, or a tab, would make two tags nobody could tell apart, so
// the run collapses before anything compares them.
const RUN_OF_SPACE = /\s+/gu;

/**
 * One tag, in the form it will be compared in — so `Biology`, `biology`, a
 * `réveil` whose accent arrived decomposed, and `machine  learning` typed with
 * two spaces are each one set rather than several a reader cannot tell apart.
 */
export const TagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .normalize("NFC")
  .transform((tag) => tag.replace(RUN_OF_SPACE, " "))
  .pipe(
    z
      .string()
      .min(1, "A tag needs at least one character.")
      .max(TAG_MAX_LENGTH, `A tag is at most ${TAG_MAX_LENGTH} characters.`)
      .regex(VISIBLE, "A tag cannot hold hidden characters."),
  );
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

/**
 * The hue slots a selected tag borrows, drawn as `--facet-1 … --facet-8` in
 * `@sloppy/ui`'s `app.css`. DESIGN.md § "Hue — the tags you selected, and only
 * those" is the contract, and `token-contrast.test.ts` holds this list against
 * the stylesheet's.
 */
export const TAG_HUE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type TagHueSlot = (typeof TAG_HUE_SLOTS)[number];

/**
 * The slot each tag borrows, from a selection in the order it was selected. A
 * tag absent from the map is not selected, and draws no hue at all.
 */
export function assignTagHueSlots(
  selection: readonly Tag[],
): Map<Tag, TagHueSlot> {
  const slots = new Map<Tag, TagHueSlot>();
  for (const tag of selection) {
    if (!slots.has(tag)) {
      slots.set(tag, TAG_HUE_SLOTS[slots.size % TAG_HUE_SLOTS.length]);
    }
  }
  return slots;
}
