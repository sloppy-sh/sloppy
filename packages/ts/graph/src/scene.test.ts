import { describe, expect, it } from "vitest";
import { drawnNodes } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { applyLod } from "./lod.js";
import {
  buildModel,
  LOOK_RING_AT,
  LOOK_RING_DASHES,
  LOOK_RING_DUTY,
  LOOK_RING_WIDTH,
  PREVIEW_AT,
} from "./model.js";
import { buildPalette } from "./palette.js";
import {
  dashSegments,
  EDGE_RING_AT,
  EDGE_RING_WIDTH,
  looksDrawn,
} from "./scene.js";
import { type Bounds, Viewport } from "./viewport.js";

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

/**
 * The smallest mark drawn, in CSS pixels, at the view a graph of `total` notes
 * opens on: a phone, and the whole field framed the way `mount.ts` frames it
 * while the layout settles. Measured at the seeds, which are the shape the
 * addresses fix — the settle only resolves the crowding around them.
 */
function smallestOnAPhone(total: number): number {
  const corpus = makeCorpus({ total });
  const lod = applyLod(corpus.nodes, new Set(), undefined);
  const model = buildModel(drawnNodes(corpus.nodes, lod.collapsed), {
    selection: [],
    palette: buildPalette({ ink: "#000", paper: "#fff", hues: [] }),
  });

  let field: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let smallest = Number.POSITIVE_INFINITY;
  model.graph.forEachNode((_ref, mark) => {
    field = {
      minX: Math.min(field.minX, mark.x - mark.radius),
      minY: Math.min(field.minY, mark.y - mark.radius),
      maxX: Math.max(field.maxX, mark.x + mark.radius),
      maxY: Math.max(field.maxY, mark.y + mark.radius),
    };
    smallest = Math.min(smallest, mark.radius);
  });

  const viewport = new Viewport();
  viewport.fit(field, 390, 740);
  return smallest * viewport.scale;
}

// The threshold is only worth what it does at the view a reader actually gets,
// and a graph opens framed whole on the narrowest screen Sloppy runs on. What
// the smallest mark is drawn at there is what decides the figure.
describe("a look at the view a graph opens on", () => {
  it("is drawn on every mark, up to a field of a few hundred notes", () => {
    for (const total of [12, 40, 200]) {
      expect(looksDrawn(smallestOnAPhone(total), false), `${total}`).toBe(true);
    }
  });

  // DESIGN.md § "The mark" spends the look first rather than last, so a field
  // too big to draw one is the case it was written for — and a pinch is what
  // brings it back.
  it("goes once the whole field will not hold it, and a pinch returns it", () => {
    const smallest = smallestOnAPhone(2400);
    expect(looksDrawn(smallest, false)).toBe(false);
    expect(looksDrawn(smallest * 2, false)).toBe(true);
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
