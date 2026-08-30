import { describe, expect, it } from "vitest";
import {
  LOOK_RING_AT,
  LOOK_RING_DASHES,
  LOOK_RING_DUTY,
  LOOK_RING_WIDTH,
  PREVIEW_AT,
} from "./model.js";
import {
  dashSegments,
  EDGE_RING_AT,
  EDGE_RING_WIDTH,
  looksDrawn,
} from "./scene.js";

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

// DESIGN.md § "The mark": the look goes first as the mark gets small, and it
// holds through a margin so a mark drifting across the line does not strobe.
describe("a look on a mark too small to carry it", () => {
  it("is dropped, and comes back once the mark has room again", () => {
    expect(looksDrawn(2, false)).toBe(false);
    expect(looksDrawn(40, false)).toBe(true);
  });

  it("hangs on below the line it needed to appear", () => {
    const appears = [...Array(200).keys()]
      .map((tenths) => tenths / 10)
      .find((radius) => looksDrawn(radius, false)) as number;
    expect(looksDrawn(appears - 0.1, false)).toBe(false);
    expect(looksDrawn(appears - 0.1, true)).toBe(true);
    expect(looksDrawn(0, true)).toBe(false);
  });
});

// DESIGN.md § "The mark": provenance keeps the mark's own edge and a look draws
// INSIDE it, so the two separate by radius. Both may be broken — a pulled draft
// is two dashed rings — and they only read as two facts while they do not touch.
describe("the bands drawn on one mark", () => {
  const heaviest = LOOK_RING_WIDTH.heavy / 2;

  it("keeps the heaviest look clear of the provenance edge", () => {
    expect(LOOK_RING_AT + heaviest).toBeLessThan(
      EDGE_RING_AT - EDGE_RING_WIDTH / 2,
    );
  });

  it("keeps the picture clear of the heaviest look", () => {
    expect(PREVIEW_AT).toBeLessThan(LOOK_RING_AT - heaviest);
  });

  // A ring wider than the mark it is inside has stopped being a ring.
  it("keeps every weight inside the mark", () => {
    for (const [weight, width] of Object.entries(LOOK_RING_WIDTH)) {
      expect(LOOK_RING_AT - width / 2, weight).toBeGreaterThan(0);
    }
  });

  // A gap the stroke can close is a draft that reads as a note somebody
  // weighted, which is the one thing the broken ring exists to say apart.
  it("leaves a broken ring a gap wider than its heaviest stroke", () => {
    const turn = (2 * Math.PI * LOOK_RING_AT) / LOOK_RING_DASHES;
    expect(turn * (1 - LOOK_RING_DUTY)).toBeGreaterThan(LOOK_RING_WIDTH.heavy);
  });
});
