// The figure has to be the same figure on every peer, it has to say by its
// sizes what the counts say, and it has to leave every region it draws room to
// stand in. DESIGN.md § "Sets — the tags as places".

import { describe, expect, it, vi } from "vitest";
import { DRAWN_SETS_MOST } from "../contract.js";
import {
  inBox,
  inShape,
  lensArea,
  lensDistance,
  namePoint,
  regionAt,
  type SetsAsk,
  SETS_LEAST_NOTES,
  SETS_NOTE_AREA,
  setsFigure,
  setsRadiusFor,
  shapeBounds,
  shapeOutline,
} from "./geometry.js";

/** An ask built from the note sets each drawn tag carries, which is the one
 *  place a count and a shared count can disagree. */
function ask(sets: readonly (readonly number[])[], outside = 20): SetsAsk {
  const count = sets.length;
  const held = sets.map((notes) => new Set(notes));
  const shared = new Array<number>(count * count).fill(0);
  for (let a = 0; a < count; a++) {
    for (let b = 0; b < count; b++) {
      if (a === b) continue;
      shared[a * count + b] = [...held[a]].filter((note) =>
        held[b].has(note),
      ).length;
    }
  }
  return { counts: held.map((one) => one.size), shared, outside };
}

/** `count` sets of `size` notes each, overlapping their neighbour by `share`. */
function chain(count: number, size: number, share: number): SetsAsk {
  return ask(
    Array.from({ length: count }, (_unused, at) =>
      Array.from({ length: size }, (_u, note) => at * (size - share) + note),
    ),
  );
}

const apart = (ask: SetsAsk) => setsFigure(ask).shapes;

describe("how wide a set is drawn", () => {
  it("gives every note the same share of the paper", () => {
    for (const notes of [SETS_LEAST_NOTES, 40, 137, 900]) {
      const area = Math.PI * setsRadiusFor(notes) ** 2;
      expect(area / SETS_NOTE_AREA).toBeCloseTo(notes, 6);
    }
    // Twice the notes is twice the area, which is √2 the width.
    expect(setsRadiusFor(600) / setsRadiusFor(300)).toBeCloseTo(Math.SQRT2, 12);
  });

  it("draws a set under the floor at the floor, so its name fits beside it", () => {
    for (const notes of [0, 1, 5, SETS_LEAST_NOTES]) {
      expect(setsRadiusFor(notes)).toBe(setsRadiusFor(SETS_LEAST_NOTES));
    }
    expect(setsRadiusFor(SETS_LEAST_NOTES + 1)).toBeGreaterThan(
      setsRadiusFor(SETS_LEAST_NOTES),
    );
  });

  it("draws each set at the area its own count asks for", () => {
    const drawn = apart(chain(5, 60, 12));
    for (const shape of drawn) {
      expect((Math.PI * shape.r ** 2) / SETS_NOTE_AREA).toBeCloseTo(60, 6);
    }
    const uneven = apart(ask([[1, 2, 3], range(0, 80), range(0, 300)], 0));
    expect(
      (Math.PI * uneven[2].r ** 2) / (Math.PI * uneven[1].r ** 2),
    ).toBeCloseTo(300 / 80, 6);
  });
});

describe("how far apart two discs are asked to stand", () => {
  it("inverts the area two discs cover of each other", () => {
    for (const [ra, rb] of [
      [100, 100],
      [240, 90],
      [57, 311],
    ]) {
      for (const share of [0.05, 0.2, 0.5, 0.85]) {
        const want = share * Math.PI * Math.min(ra, rb) ** 2;
        const found = lensDistance(ra, rb, want);
        expect(lensArea(ra, rb, found) / want).toBeCloseTo(1, 6);
      }
    }
  });

  it("stands two discs sharing nothing just touching", () => {
    expect(lensDistance(120, 300, 0)).toBe(420);
    expect(lensArea(120, 300, 420)).toBe(0);
  });

  it("stands a disc the other holds whole just inside it", () => {
    const whole = Math.PI * 120 ** 2;
    expect(lensDistance(120, 300, whole)).toBe(180);
    expect(lensArea(120, 300, 180)).toBeCloseTo(whole, 9);
  });
});

describe("the figure a field's notes draw", () => {
  for (const [name, asked] of [
    ["one set", ask([range(0, 40)])],
    ["two sets sharing some", ask([range(0, 40), range(25, 70)])],
    ["three in a chain", chain(3, 50, 14)],
    ["five sharing nothing", ask([[1], [2], [3], [4], [5]], 0)],
    ["eight in a chain", chain(DRAWN_SETS_MOST, 40, 9)],
  ] as const) {
    const figure = setsFigure(asked);

    it(`draws a disc per set of ${name}`, () => {
      expect(figure.shapes).toHaveLength(asked.counts.length);
      for (const shape of figure.shapes) expect(shape.r).toBeGreaterThan(0);
    });

    it(`leaves every region it draws of ${name} room to stand in`, () => {
      expect(figure.regions.length).toBeGreaterThan(0);
      expect(figure.regions[0].id).toBe(0);
      for (const region of figure.regions) {
        const where = `region ${region.id.toString(2)}`;
        expect(region.area, where).toBeGreaterThan(0);
        expect(region.cover.length, where).toBeGreaterThan(0);
        // The centre is a point of the region and not merely near it, which is
        // what a fold stands on and what a lattice grows out from.
        expect(regionAt(figure.shapes, region.centre), where).toBe(region.id);
        expect(inBox(figure.box, region.centre), where).toBe(true);
      }
    });

    it(`covers each region of ${name} with its own cells alone`, () => {
      for (const region of figure.regions) {
        for (const box of region.cover) {
          const middle = {
            x: (box.minX + box.maxX) / 2,
            y: (box.minY + box.maxY) / 2,
          };
          expect(
            regionAt(figure.shapes, middle),
            `region ${region.id.toString(2)}`,
          ).toBe(region.id);
        }
      }
    });

    it(`writes each name of ${name} inside the set it names`, () => {
      for (const shape of figure.shapes) {
        expect(inShape(shape, namePoint(shape))).toBe(true);
      }
    });

    it(`boxes each disc of ${name} round its own outline`, () => {
      for (const shape of figure.shapes) {
        const box = shapeBounds(shape);
        for (const at of shapeOutline(shape, 180)) {
          expect(inBox(box, at)).toBe(true);
        }
        expect(box.maxX - box.minX).toBeCloseTo(shape.r * 2, 9);
      }
    });

    it(`holds every disc of ${name} inside the figure's box`, () => {
      for (const shape of figure.shapes) {
        for (const at of shapeOutline(shape, 72)) {
          expect(inBox(figure.box, at)).toBe(true);
        }
      }
    });
  }

  it("draws no disc and one region where no tag is drawn", () => {
    const figure = setsFigure({ counts: [], shared: [], outside: 300 });
    expect(figure.shapes).toHaveLength(0);
    expect(figure.regions.map((region) => region.id)).toEqual([0]);
    expect(figure.regions[0].area).toBeGreaterThan(0);
  });

  it("gives the notes outside every set room of their own", () => {
    const few = setsFigure(ask([range(0, 50)], 10));
    const many = setsFigure(ask([range(0, 50)], 600));
    const ring = (figure: typeof few) =>
      (figure.regions.find((region) => region.id === 0) as { area: number })
        .area;
    expect(ring(many)).toBeGreaterThan(ring(few) * 4);
  });
});

// What the figure is FOR: the sizes and the overlaps say what the counts say,
// so a reader reads the answer off the picture rather than off a legend.
describe("what the figure says about the counts", () => {
  it("covers two sets of each other by what the two share", () => {
    for (const share of [10, 30, 55]) {
      const [a, b] = apart(ask([range(0, 80), range(80 - share, 160 - share)]));
      const covered =
        lensArea(a.r, b.r, Math.hypot(a.cx - b.cx, a.cy - b.cy)) /
        SETS_NOTE_AREA;
      expect(covered).toBeCloseTo(share, 1);
    }
  });

  it("keeps two sets sharing nothing clear of each other", () => {
    for (const count of [2, 3, 5]) {
      const drawn = apart(
        ask(
          Array.from({ length: count }, (_unused, at) => range(at * 50, 50)),
          0,
        ),
      );
      for (let a = 0; a < count; a++) {
        for (let b = a + 1; b < count; b++) {
          expect(
            Math.hypot(drawn[a].cx - drawn[b].cx, drawn[a].cy - drawn[b].cy),
            `${a} and ${b} of ${count}`,
          ).toBeGreaterThanOrEqual(drawn[a].r + drawn[b].r - 1e-6);
        }
      }
    }
  });

  it("nests a set every note of which carries another inside it", () => {
    const [big, small] = apart(ask([range(0, 200), range(0, 40)], 0));
    const between = Math.hypot(big.cx - small.cx, big.cy - small.cy);
    expect(small.r).toBeLessThan(big.r);
    expect(between).toBeLessThanOrEqual(big.r - small.r + 1e-6);
  });

  it("draws the set more notes carry wider", () => {
    const drawn = apart(
      ask([range(0, 30), range(500, 90), range(900, 240)], 0),
    );
    expect(drawn[0].r).toBeLessThan(drawn[1].r);
    expect(drawn[1].r).toBeLessThan(drawn[2].r);
  });
});

// Two peers holding the same notes draw the same figure, so the fit cannot
// depend on anything but the ask — measured again from a fresh module rather
// than read back off the one that is held.
describe("the same ask drawn twice", () => {
  const asked = [
    chain(4, 70, 20),
    chain(DRAWN_SETS_MOST, 40, 9),
    ask([range(0, 200), range(0, 40), range(180, 60)], 75),
  ];

  it("draws the same figure to the last digit", async () => {
    vi.resetModules();
    const again = await import("./geometry.js");
    for (const one of asked) {
      expect(again.setsFigure(one)).toEqual(setsFigure(one));
    }
  });

  it("reads the same figure off an ask built in another order", () => {
    // The ask is a tuple of numbers; the same numbers are the same figure.
    for (const one of asked) {
      expect(setsFigure({ ...one, counts: [...one.counts] })).toEqual(
        setsFigure(one),
      );
    }
  });
});

function range(from: number, length: number): number[] {
  return Array.from({ length }, (_unused, at) => from + at);
}
