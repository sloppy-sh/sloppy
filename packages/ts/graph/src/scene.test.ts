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
  PREVIEW_SPAN,
} from "./model.js";
import { buildPalette } from "./palette.js";
import {
  CHOSEN_BAND,
  dashSegments,
  EDGE_RING_AT,
  EDGE_RING_WIDTH,
  FILL_AT,
  liftInk,
  type LiftBand,
  liftOf,
  looksDrawn,
  PICK_GAP,
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

// DESIGN.md § "The mark": how much of the mark a picture takes is its author's
// to choose, and what bounds it is what it leaves — the band of fill the
// reader's own selection speaks in, the edge that is provenance's, and the
// author's own ring, which is drawn over a picture rather than beside it.
describe("a picture at every size its author may ask for", () => {
  const sizes = Object.entries(PREVIEW_SPAN);
  const rings = Object.entries(LOOK_RING_WIDTH);

  // Where the fill is last visible, which is not the mark's radius: the disc
  // stops short of it, and a published note's ink edge is drawn over the
  // outside of what is left. A pulled mark is hollow, so its hue is the dashed
  // edge and a picture takes none of it.
  const fillEndsAt = {
    own: FILL_AT,
    published: EDGE_RING_AT - EDGE_RING_WIDTH / 2,
  };

  // The anchor, not the alias: every note already carrying a picture keeps the
  // mark it has only because this number does not move.
  it("covers what it always has where nobody chose a size", () => {
    expect(PREVIEW_SPAN.small).toBe(0.42);
  });

  it("leaves the hue a band wider than the heaviest ring a look can draw", () => {
    for (const [size, at] of sizes) {
      for (const [provenance, ends] of Object.entries(fillEndsAt)) {
        expect(ends - at, `${size} on a ${provenance} note`).toBeGreaterThan(
          LOOK_RING_WIDTH.heavy,
        );
      }
    }
  });

  it("never reaches the mark's own edge, which is provenance's", () => {
    for (const [size, at] of sizes) {
      expect(at, size).toBeLessThan(EDGE_RING_AT - EDGE_RING_WIDTH / 2);
    }
  });

  // A rim that stops under the ring is framed by it, and one well inside it is
  // a circle of its own. A rim a hair from either edge of the ring is neither:
  // the two read as one thick edge instead of two facts.
  it("ends under the author's ring or well inside it, never alongside", () => {
    for (const [size, at] of sizes) {
      for (const [weight, width] of rings) {
        const clear = Math.max(
          LOOK_RING_AT - width / 2 - at,
          at - (LOOK_RING_AT + width / 2),
        );
        expect(
          clear <= 0 || clear >= LOOK_RING_WIDTH.hairline / 2,
          `${size} ends alongside a ${weight} ring`,
        ).toBe(true);
      }
    }
  });
});

// DESIGN.md § "The mark": the paper under a mark carries whether its note is
// open, and it is one channel at two strengths rather than two channels.
describe("the lift under an open note", () => {
  const LEAF = 9;
  const open = liftOf(LEAF, false, 1);
  const active = liftOf(LEAF, true, 1);
  const reachOf = (bands: LiftBand[]) =>
    Math.max(...bands.map((band) => band.at + band.width / 2));

  it("spreads past the mark and stops, at both strengths", () => {
    for (const [strength, bands] of [
      ["open", open],
      ["being read", active],
    ] as const) {
      expect(reachOf(bands), strength).toBeGreaterThan(LEAF);
      expect(liftInk(bands, reachOf(bands) * 1.01), strength).toBe(0);
      expect(liftInk(bands, LEAF), strength).toBeGreaterThan(0.2);
    }
  });

  // Which of the two a mark wears has to be answerable without a second mark
  // beside it to compare against, so they separate in reach AND in ink.
  it("tells the note being read from one merely open", () => {
    expect(liftInk(active, LEAF)).toBeGreaterThan(liftInk(open, LEAF) * 1.5);
    expect(reachOf(active) - LEAF).toBeGreaterThan(
      (reachOf(open) - LEAF) * 1.3,
    );
  });

  // The crowded case: a mark open AND chosen AND heavily ringed AND wearing a
  // picture AND pulled, on a graph with tags selected. The chosen band is the
  // only other thing drawn OUTSIDE the mark, so it is the one a lift could
  // drown; everything an author spends is inside it.
  it("leaves the chosen band reading as a band", () => {
    const band = LEAF + PICK_GAP + CHOSEN_BAND / 2;
    expect(liftInk(active, band)).toBeLessThan(0.9 / 3);
  });

  // Rings, not a disc: a pulled mark is drawn hollow, and a lift that filled it
  // would make provenance read as own — PRODUCT.md principle 4.
  it("lays nothing inside the mark, where a pulled one shows paper", () => {
    for (const at of [0, LEAF * EDGE_RING_AT, LEAF * LOOK_RING_AT, LEAF * 0.99])
      expect(liftInk(active, at), `${at}`).toBe(0);
  });

  // The look goes first as a mark shrinks; the lift is at the other end of that
  // order with the orbit and the provenance edge, because a reader hunting the
  // note they are reading across a field they zoomed out of is who it is for —
  // so what it spreads has a floor measured on the SCREEN, not in the field.
  it("stays findable on a mark drawn at half a pixel", () => {
    const scale = 1 / 18;
    expect(LEAF * scale).toBeLessThan(1);
    for (const [strength, wearing] of [
      ["open", false],
      ["being read", true],
    ] as const) {
      const bands = liftOf(LEAF, wearing, scale);
      const spread = (reachOf(bands) - LEAF) * scale;
      expect(spread, strength).toBeGreaterThan(4);
      expect(liftInk(bands, LEAF), strength).toBeCloseTo(
        liftInk(liftOf(LEAF, wearing, 1), LEAF),
        6,
      );
    }
  });

  // The floor only ever widens the spread: at the view a note is read at, the
  // lift is the mark's own size and the geometry above is what holds.
  it("is the mark's own size wherever the mark has room", () => {
    for (const scale of [1, 2, 8]) {
      expect(reachOf(liftOf(LEAF, true, scale)), `${scale}`).toBeCloseTo(
        reachOf(active),
        6,
      );
    }
  });
});
