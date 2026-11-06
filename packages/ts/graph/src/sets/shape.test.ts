// A mark is held clear of an outline by how far it stands from it, so on an
// ellipse that distance has to be the true one wherever a mark's reach is in
// question — measured here against the outline itself.

import { describe, expect, it } from "vitest";
import {
  gapOf,
  gaugeOf,
  inShape,
  type SetsOutline,
  shapeBounds,
  shapeOutline,
} from "./shape.js";

const SHAPES: SetsOutline[] = [
  { cx: 0, cy: 0, r: 120, stretch: 1, turn: 0 },
  { cx: 40, cy: -30, r: 150, stretch: 1.6, turn: 0.4 },
  { cx: -80, cy: 60, r: 90, stretch: 2, turn: -1.2 },
];

const REACH = 25;

/** The least distance from a point to a dense run of the outline. */
function measured(shape: SetsOutline, x: number, y: number): number {
  let least = Number.POSITIVE_INFINITY;
  for (const at of shapeOutline(shape, 6000)) {
    least = Math.min(least, Math.hypot(at.x - x, at.y - y));
  }
  return least;
}

describe("how far a point stands from a shape", () => {
  for (const [which, shape] of SHAPES.entries()) {
    const box = shapeBounds(shape);
    const points = Array.from({ length: 21 * 21 }, (_unused, at) => ({
      x:
        box.minX -
        REACH * 2 +
        ((at % 21) / 20) * (box.maxX - box.minX + REACH * 4),
      y:
        box.minY -
        REACH * 2 +
        (Math.floor(at / 21) / 20) * (box.maxY - box.minY + REACH * 4),
    }));

    it(`agrees with the outline near it, on shape ${which}`, () => {
      const gap = gapOf(shape, REACH);
      let near = 0;
      for (const at of points) {
        const found = gap(at.x, at.y);
        if (Math.abs(found) > REACH * 2) continue;
        near += 1;
        expect(Math.abs(found), `${at.x}, ${at.y}`).toBeCloseTo(
          measured(shape, at.x, at.y),
          0,
        );
        expect(found <= 0, `${at.x}, ${at.y}`).toBe(inShape(shape, at));
      }
      expect(near).toBeGreaterThan(20);
    });

    it(`says inside where the shape is, on shape ${which}`, () => {
      const gauge = gaugeOf(shape);
      for (const at of points) {
        expect(gauge(at.x, at.y) <= 0).toBe(inShape(shape, at));
      }
    });

    it(`boxes the whole outline, on shape ${which}`, () => {
      for (const at of shapeOutline(shape, 360)) {
        expect(at.x).toBeGreaterThanOrEqual(box.minX - 1e-9);
        expect(at.x).toBeLessThanOrEqual(box.maxX + 1e-9);
        expect(at.y).toBeGreaterThanOrEqual(box.minY - 1e-9);
        expect(at.y).toBeLessThanOrEqual(box.maxY + 1e-9);
      }
    });
  }
});
