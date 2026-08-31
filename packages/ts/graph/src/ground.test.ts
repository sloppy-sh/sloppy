import { describe, expect, it } from "vitest";
import {
  GROUND_MIN_STEP,
  type GroundTiling,
  groundTiling,
  STAMPS,
} from "./ground.js";
import { MAX_SCALE, MIN_SCALE } from "./viewport.js";

/** Every scale the canvas can be at, and then some either side. */
const scales = Array.from(
  { length: 2_000 },
  (_unused, step) =>
    (MIN_SCALE / 4) * ((MAX_SCALE * 4) / (MIN_SCALE / 4)) ** (step / 1_999),
);

const papers = ["dots", "lines"] as const;

describe("the ground's lattice", () => {
  it("never draws closer together than the bound, at any scale", () => {
    for (const scale of scales) {
      const { cell } = groundTiling(0, 0, scale, "dots");
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
        const at = groundTiling(x, y, scale, "dots");
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
        const at = groundTiling(x, x, scale, "lines");
        expect(at.offsetX).toBeGreaterThanOrEqual(0);
        expect(at.offsetX).toBeLessThan(at.cell);
      }
    }
  });

  /**
   * The fill's scale carries the lattice's period, and would carry the mark's
   * size with it — a dot sweeping 1.1px to 2.2px and snapping back once an
   * octave, which is the doubling made plainly visible. The cut the fill is
   * taken from cancels it to within half a band.
   */
  it("holds a mark at the size it is drawn at, at every scale", () => {
    const band = 2 ** (1 / (2 * STAMPS));
    // DESIGN.md § "The ground" quotes the figure this bounds.
    expect(band).toBeLessThan(1.05);
    for (const kind of papers) {
      for (const scale of scales) {
        const { mark } = groundTiling(0, 0, scale, kind);
        expect(mark, `${kind} at ${scale}`).toBeGreaterThan(1 / band - 1e-9);
        expect(mark, `${kind} at ${scale}`).toBeLessThan(band + 1e-9);
      }
    }
  });

  /**
   * The figure DESIGN.md § "The ground" quotes for the hand-over. Ink per unit
   * area is alpha over the mark's own area: one mark per cell always drawn and
   * 2^spread - 1 more at whatever the fade has reached, over a cell that is a
   * length for rules and an area for dots. It does not move — not across the
   * band, not through the doubling that ends it, and not over a cut.
   */
  it("lays the same ink down at every scale, mark size included", () => {
    for (const kind of papers) {
      const spread = kind === "dots" ? 2 : 1;
      const ink = (at: GroundTiling): number =>
        (at.weight * at.mark ** spread * (1 + (2 ** spread - 1) * at.fine)) /
        at.cell ** spread;
      const seen = scales.map((scale) => ink(groundTiling(0, 0, scale, kind)));

      expect(Math.max(...seen) / Math.min(...seen), kind).toBeLessThan(
        1 + 1e-9,
      );
    }
  });

  it("draws none of the half-step lattice just after a doubling, and all but a sliver just before", () => {
    for (const kind of papers) {
      // A scale where the step has just doubled, and one where it is about to.
      expect(groundTiling(0, 0, GROUND_MIN_STEP / 16, kind).fine).toBe(0);
      expect(
        groundTiling(0, 0, (GROUND_MIN_STEP / 16) * 0.999, kind).fine,
        kind,
      ).toBeGreaterThan(0.99);
    }
  });
});
