import { describe, expect, it } from "vitest";
import { GROUND_MIN_STEP, groundTiling } from "./ground.js";
import { MAX_SCALE, MIN_SCALE } from "./viewport.js";

/** Every scale the canvas can be at, and then some either side. */
const scales = Array.from(
  { length: 2_000 },
  (_unused, step) =>
    (MIN_SCALE / 4) * ((MAX_SCALE * 4) / (MIN_SCALE / 4)) ** (step / 1_999),
);

describe("the ground's lattice", () => {
  it("never draws closer together than the bound, at any scale", () => {
    for (const scale of scales) {
      const { cell } = groundTiling(0, 0, scale);
      expect(cell / 2, `at ${scale}`).toBeGreaterThanOrEqual(
        GROUND_MIN_STEP - 1e-9,
      );
      expect(cell / 2, `at ${scale}`).toBeLessThan(GROUND_MIN_STEP * 2 + 1e-9);
    }
  });

  // What makes it a ground rather than a texture: a point sits on a world
  // coordinate, so panning two screens left says so and a zoom keeps the point
  // the reader was looking at.
  it("keeps a point on the world origin, wherever the viewport is", () => {
    for (const scale of [MIN_SCALE, 0.3, 1, 2.4, MAX_SCALE]) {
      for (const [x, y] of [
        [0, 0],
        [17.5, -812.25],
        [-4_000, 9_999],
      ]) {
        const at = groundTiling(x, y, scale);
        const offBy = (screen: number, from: number): number => {
          const gap = (screen - (from + at.cell / 4)) / at.cell;
          return Math.abs(gap - Math.round(gap)) * at.cell;
        };
        expect(offBy(x, at.offsetX), `${x} at ${scale}`).toBeLessThan(1e-6);
        expect(offBy(y, at.offsetY), `${y} at ${scale}`).toBeLessThan(1e-6);
      }
    }
  });

  it("puts the offset inside the cell it repeats over", () => {
    for (const scale of [MIN_SCALE, 0.7, MAX_SCALE]) {
      for (const x of [-5_003.5, -1, 0, 1, 5_003.5]) {
        const at = groundTiling(x, x, scale);
        expect(at.offsetX).toBeGreaterThanOrEqual(0);
        expect(at.offsetX).toBeLessThan(at.cell);
      }
    }
  });

  /**
   * The half-step lattice fades out exactly as fast as its points would have
   * closed up, so the doubling that keeps the ground legible cannot be seen
   * happening. Alpha-weighted marks per unit area: one point per cell always
   * drawn, three more per cell at whatever the fade has reached.
   */
  it("hands over to the coarser lattice without a step", () => {
    const density = (scale: number): number => {
      const { cell, fine } = groundTiling(0, 0, scale);
      return (1 + 3 * fine) / cell ** 2;
    };
    for (const scale of scales) {
      const before = density(scale);
      const after = density(scale * 1.001);
      expect(Math.abs(after - before) / before, `across ${scale}`).toBeLessThan(
        0.01,
      );
    }
  });

  it("draws the whole lattice at the open end of the band and none of it at the tight end", () => {
    // A scale where the step has just doubled, and one where it is about to.
    expect(groundTiling(0, 0, GROUND_MIN_STEP / 16).fine).toBe(0);
    expect(groundTiling(0, 0, (GROUND_MIN_STEP / 16) * 0.999).fine).toBe(1);
  });
});
