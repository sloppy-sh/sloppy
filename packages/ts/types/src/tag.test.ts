import { describe, expect, it } from "vitest";
import { MAX_TAGS_PER_NODE, TAG_MAX_LENGTH, TagsSchema } from "./tag.js";

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

  it("refuse anything that is not one word", () => {
    for (const written of ["two words", "tab\tbed", "line\nbreak", "   ", ""]) {
      expect(TagsSchema.safeParse([written]).success, written).toBe(false);
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
});
