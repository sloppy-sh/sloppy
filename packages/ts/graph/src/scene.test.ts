import { describe, expect, it } from "vitest";
import { dashSegments } from "./scene.js";

describe("a dashed link", () => {
  it("reaches the far note however long it is", () => {
    // The cap is a cost bound, not a length bound: a link across the whole
    // graph still has to land on the note at the other end.
    for (const length of [50, 500, 5_000, 50_000]) {
      const drawn = dashSegments(length, 9);
      expect(drawn.length, `${length} drew nothing`).toBeGreaterThan(0);
      expect(drawn.length, `${length} drew too many`).toBeLessThanOrEqual(60);
      expect(drawn[drawn.length - 1].to, `${length} stopped short`).toBeCloseTo(
        length,
        5,
      );
      expect(drawn[0].from, `${length} started late`).toBe(0);
    }
  });

  it("draws nothing across a distance too short to see", () => {
    expect(dashSegments(0.5, 9)).toEqual([]);
  });
});
