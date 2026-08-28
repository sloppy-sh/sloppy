import { describe, expect, it } from "vitest";
import {
  assignTagHueSlots,
  MAX_TAGS_PER_NODE,
  TAG_HUE_SLOTS,
  TAG_MAX_LENGTH,
  TagsSchema,
} from "./tag.js";

const VOCABULARY = [
  "biology",
  "cities",
  "seed",
  "question",
  "source-needed",
  "réveil",
  "日本語",
  "x",
];

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Every non-empty subset of the vocabulary, so the claims below are over the
 *  whole space rather than a few hand-picked sets. */
const SUBSETS = Array.from({ length: 2 ** VOCABULARY.length - 1 }, (_, mask) =>
  VOCABULARY.filter((_tag, bit) => (mask + 1) & (1 << bit)),
);

describe("a note's tags", () => {
  it("reach the same array however they were typed", () => {
    // The array is inside the payload a node is signed over, so two authors
    // holding the same tags must hold the same bytes.
    for (const [index, subset] of SUBSETS.entries()) {
      const canonical = TagsSchema.parse(subset);
      const scrambled = shuffled(subset, index + 1).flatMap((tag) => [
        `  ${tag} `,
        tag.toUpperCase(),
      ]);
      expect(TagsSchema.parse(scrambled), subset.join(",")).toEqual(canonical);
    }
  });

  it("keep every distinct tag, and only once each", () => {
    for (const subset of SUBSETS) {
      const parsed = TagsSchema.parse(subset);
      expect(parsed).toEqual(
        [...new Set(subset.map((t) => t.toLowerCase()))].sort(),
      );
    }
  });

  it("settle in one pass", () => {
    for (const subset of SUBSETS) {
      const once = TagsSchema.parse(subset);
      expect(TagsSchema.parse(once)).toEqual(once);
    }
  });

  it("reach the same array however the accent was typed", () => {
    // macOS hands back decomposed text from the filesystem and from some input
    // methods while most keyboards produce composed text, so the same word
    // arrives spelled two ways from one person on one device.
    const composed = "r\u00e9veil";
    const decomposed = "re\u0301veil";
    expect(composed).not.toEqual(decomposed);
    expect(TagsSchema.parse([decomposed])).toEqual([composed]);
    expect(TagsSchema.parse([composed, decomposed])).toHaveLength(1);
  });

  it("hold a tag that is more than one word", () => {
    expect(TagsSchema.parse(["machine learning"])).toEqual([
      "machine learning",
    ]);
    // A run of space, a tab and a newline all read as the one space a person
    // meant, so what they typed twice is one tag and not two.
    for (const written of [
      "machine  learning",
      "machine\tlearning",
      "machine\nlearning",
    ]) {
      expect(TagsSchema.parse([written]), written).toEqual([
        "machine learning",
      ]);
    }
    expect(TagsSchema.parse([" padded "])).toEqual(["padded"]);
  });

  it("refuse what a reader could not tell apart", () => {
    for (const written of [
      "   ",
      "",
      // Invisible, and so a tag that reads as `biology` and matches nothing.
      "bio\u200blogy",
      "bio\u2060logy",
    ]) {
      expect(TagsSchema.safeParse([written]).success, written).toBe(false);
    }
  });

  it("keep the joiners that sit inside a word", () => {
    // Persian writes one word across a non-joiner, and an emoji family is one
    // glyph across joiners.
    for (const written of [
      "\u0645\u06cc\u200c\u0631\u0648\u062f",
      "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}",
    ]) {
      expect(TagsSchema.safeParse([written]).success, written).toBe(true);
    }
  });

  it("refuse a tag or a set past its bound", () => {
    expect(TagsSchema.parse(["x".repeat(TAG_MAX_LENGTH)])).toHaveLength(1);
    expect(TagsSchema.safeParse(["x".repeat(TAG_MAX_LENGTH + 1)]).success).toBe(
      false,
    );

    const many = Array.from({ length: MAX_TAGS_PER_NODE }, (_, i) => `t${i}`);
    expect(TagsSchema.parse(many)).toHaveLength(MAX_TAGS_PER_NODE);
    expect(TagsSchema.safeParse([...many, "one-too-many"]).success).toBe(false);
  });

  it("count the bound against the note, not against what was typed", () => {
    // A picker hands back what a person typed; the duplicates it did not fold
    // away must not spend the note's budget.
    const distinct = Array.from(
      { length: MAX_TAGS_PER_NODE },
      (_, i) => `t${i}`,
    );
    const typed = [...distinct, ...distinct.map((tag) => tag.toUpperCase())];
    expect(TagsSchema.parse(typed)).toHaveLength(MAX_TAGS_PER_NODE);
  });
});

describe("the hue a selected tag borrows", () => {
  it("hands the slots out in selection order, and starts over past the last", () => {
    const selection = Array.from(
      { length: TAG_HUE_SLOTS.length * 3 + 1 },
      (_, i) => `t${i}`,
    );
    const slots = assignTagHueSlots(selection);
    for (const [at, tag] of selection.entries()) {
      expect(slots.get(tag), tag).toBe(
        TAG_HUE_SLOTS[at % TAG_HUE_SLOTS.length],
      );
    }
  });

  it("spends one slot on a tag however often the selection names it", () => {
    const slots = assignTagHueSlots(["biology", "seed", "biology", "question"]);
    expect([...slots]).toEqual([
      ["biology", TAG_HUE_SLOTS[0]],
      ["seed", TAG_HUE_SLOTS[1]],
      ["question", TAG_HUE_SLOTS[2]],
    ]);
  });

  it("has no slot for a tag nobody selected", () => {
    expect(assignTagHueSlots([]).size).toBe(0);
    expect(assignTagHueSlots(["biology"]).get("seed")).toBeUndefined();
  });
});
