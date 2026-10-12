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
  SETS_NOTE_AREA,
  SETS_STEP,
  setsFigure,
  setsRadii,
  setsUnitArea,
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
  it("gives every note of a figure the same share of the paper", () => {
    for (const counts of [[1], [3, 5], [1, 40, 137], [12, 300, 600]]) {
      const unit = setsUnitArea(counts);
      for (const [at, r] of setsRadii(counts).entries()) {
        expect((Math.PI * r ** 2) / unit, `${counts} at ${at}`).toBeCloseTo(
          counts[at],
          6,
        );
      }
    }
  });

  // Two counts that came out the same width would draw a containment as one
  // disc over another, and leave every note of the wider set outside every set
  // there is — which is why a count is drawn at the figure's own unit and never
  // floored one disc at a time.
  it("draws no two counts the same width, however few either holds", () => {
    for (let notes = 1; notes < 60; notes++) {
      const [narrow, wide] = setsRadii([notes, notes + 1]);
      expect(wide, `${notes} against one more`).toBeGreaterThan(narrow);
      expect((wide ** 2 - narrow ** 2) / narrow ** 2).toBeCloseTo(1 / notes, 6);
    }
  });

  it("draws even the narrowest set a disc with room beside its name", () => {
    const floor = setsRadii([1])[0];
    expect(floor).toBeGreaterThan(SETS_STEP * 2);
    for (const counts of [[1], [3, 5], [40, 200], [7, 7, 7, 300]]) {
      const least = Math.min(...setsRadii(counts));
      expect(least, `${counts}`).toBeGreaterThanOrEqual(floor - 1e-9);
    }
  });

  // The unit rises exactly as far as the narrowest set needs and no further,
  // so a figure whose sets all hold twelve notes or more is drawn at the floor.
  it("raises the unit by what the narrowest set asks of it", () => {
    expect(setsUnitArea([12])).toBe(SETS_NOTE_AREA);
    expect(setsUnitArea([12, 90])).toBe(SETS_NOTE_AREA);
    expect(setsUnitArea([4, 90])).toBeCloseTo(SETS_NOTE_AREA * 3, 9);
    expect(setsUnitArea([1, 90])).toBeCloseTo(SETS_NOTE_AREA * 12, 9);
  });

  it("draws each set of a figure at the area its own count asks for", () => {
    const notesOf = (shape: { r: number }, unit: number) =>
      (Math.PI * shape.r ** 2) / unit;
    const even = chain(5, 60, 12);
    for (const shape of apart(even)) {
      expect(notesOf(shape, setsUnitArea(even.counts))).toBeCloseTo(60, 6);
    }
    const uneven = ask([[1, 2, 3], range(0, 80), range(0, 300)], 0);
    const unit = setsUnitArea(uneven.counts);
    const drawn = apart(uneven).map((shape) => notesOf(shape, unit));
    expect(drawn[0]).toBeCloseTo(3, 6);
    expect(drawn[1]).toBeCloseTo(80, 6);
    expect(drawn[2]).toBeCloseTo(300, 6);
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
  const covers = (asked: SetsAsk) => {
    const [a, b] = apart(asked);
    return (
      lensArea(a.r, b.r, Math.hypot(a.cx - b.cx, a.cy - b.cy)) /
      setsUnitArea(asked.counts)
    );
  };

  it("covers two sets of each other by what the two share", () => {
    for (const share of [10, 30, 55]) {
      expect(
        covers(ask([range(0, 80), range(80 - share, 160 - share)])),
      ).toBeCloseTo(share, 1);
    }
  });

  // A field of five notes is the common case for a new graph, and the figure
  // says as much there as it does of three hundred.
  it("covers two small sets of each other by what the two share", () => {
    expect(
      covers(
        ask(
          [
            [1, 2, 3, 4, 5],
            [4, 5, 6],
          ],
          0,
        ),
      ),
    ).toBeCloseTo(2, 1);
    expect(
      covers(
        ask(
          [
            [1, 2],
            [2, 3, 4],
          ],
          0,
        ),
      ),
    ).toBeCloseTo(1, 1);
  });

  // Two circles standing clear of each other say the two sets have nothing in
  // common, which is the one thing the figure must not say about sets that do
  // share notes — so that is what the fit spends its budget on first, and the
  // areas come second. Eight circles cannot cross in every way eight tags do.
  it("draws a lens for every pair of sets that shares a note", () => {
    for (const [name, asked] of [
      ["eight in a chain", chain(DRAWN_SETS_MOST, 40, 9)],
      ["eight from three pools", pooled([3, 3, 2], 600)],
      ["eight from two pools", pooled([5, 3], 400)],
      ["five from two pools", pooled([2, 3], 200)],
    ] as const) {
      const shapes = apart(asked);
      const count = asked.counts.length;
      let sharing = 0;
      for (let a = 0; a < count; a++) {
        for (let b = a + 1; b < count; b++) {
          if ((asked.shared[a * count + b] ?? 0) === 0) continue;
          sharing += 1;
          expect(
            lensArea(
              shapes[a].r,
              shapes[b].r,
              Math.hypot(
                shapes[a].cx - shapes[b].cx,
                shapes[a].cy - shapes[b].cy,
              ),
            ),
            `${a} and ${b} of ${name}`,
          ).toBeGreaterThan(0);
        }
      }
      expect(sharing, name).toBeGreaterThan(count / 2);
    }
  });

  it("keeps two sets sharing nothing clear where no pair wants the room", () => {
    for (const [count, size] of [
      [2, 1],
      [2, 50],
      [3, 50],
      [5, 1],
      [5, 50],
    ]) {
      const drawn = apart(
        ask(
          Array.from({ length: count }, (_unused, at) =>
            range(at * size, size),
          ),
          0,
        ),
      );
      for (let a = 0; a < count; a++) {
        expect(drawn[a].r, `${a} of ${count}`).toBeGreaterThan(0);
        for (let b = a + 1; b < count; b++) {
          expect(
            Math.hypot(drawn[a].cx - drawn[b].cx, drawn[a].cy - drawn[b].cy),
            `${a} and ${b} of ${count} of ${size}`,
          ).toBeGreaterThanOrEqual(drawn[a].r + drawn[b].r - 1e-6);
        }
      }
    }
  });

  // However few notes either set holds. The crescent round the nested set is
  // where the notes outside it stand, and the figure has to draw that
  // combination rather than leaving them nowhere.
  it("nests a set every note of which carries another, with a crescent left", () => {
    for (const [held, holding] of [
      [1, 2],
      [3, 5],
      [11, 12],
      [40, 200],
    ]) {
      const asked = ask([range(0, holding), range(0, held)], 0);
      const figure = setsFigure(asked);
      const [big, small] = figure.shapes;
      const between = Math.hypot(big.cx - small.cx, big.cy - small.cy);
      const where = `${held} of ${holding}`;
      expect(small.r, where).toBeLessThan(big.r);
      expect(between, where).toBeLessThanOrEqual(big.r - small.r + 1e-6);
      expect(between, where).toBeGreaterThan(0);
      expect(
        (Math.PI * (big.r ** 2 - small.r ** 2)) / setsUnitArea(asked.counts),
        where,
      ).toBeCloseTo(holding - held, 6);
      expect(
        figure.regions.map((region) => region.id),
        where,
      ).toEqual([0, 0b01, 0b11]);
    }
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
});

/** An ask whose tags come in pools of mutually exclusive ones — a note carries
 *  one tag of each pool — which is the shape a field's own tags come in. */
function pooled(sizes: readonly number[], notes: number): SetsAsk {
  const sets: number[][] = [];
  for (const [pool, size] of sizes.entries()) {
    for (let tag = 0; tag < size; tag++) {
      sets.push(
        range(0, notes).filter((note) => (note + pool * 3) % size === tag),
      );
    }
  }
  return ask(sets, 0);
}

function range(from: number, length: number): number[] {
  return Array.from({ length }, (_unused, at) => from + at);
}
