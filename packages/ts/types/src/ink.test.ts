import { describe, expect, it } from "vitest";
import { InkElementDataSchema, readsAsInk } from "./ink.js";

const STROKES = [{ points: [{ x: 1, y: 2, t: 0 }], width: 2 }];

const drawing = (extra: Record<string, unknown> = {}) => ({
  strokes: STROKES,
  width: 400,
  height: 120,
  ...extra,
});

describe("a drawing's description", () => {
  it("is read back as it was written", () => {
    const read = InkElementDataSchema.parse(
      drawing({ description: "the two axes, crossing" }),
    );
    expect(read.description).toBe("the two axes, crossing");
  });

  it("leaves a drawing written before anyone could describe one readable", () => {
    expect(readsAsInk(drawing())).toBe(true);
    expect(InkElementDataSchema.parse(drawing()).description).toBeUndefined();
  });

  it("reads an undescribed drawing the editor wrote down", () => {
    expect(readsAsInk(drawing({ description: null }))).toBe(true);
  });

  it("is words, so a drawing carrying anything else is not one", () => {
    expect(readsAsInk(drawing({ description: 12 }))).toBe(false);
  });
});
