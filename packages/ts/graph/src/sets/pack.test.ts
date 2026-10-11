// Where a note stands is a function of the notes, the drawn tags and the zoom
// and of nothing else, so two devices reading the same selection stand the same
// marks in the same places. That is what is held here, over generated runs of
// notes rather than over a handful of hand-placed ones.

import type { Address, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { DRAWN_SETS_MOST } from "../contract.js";
import { mulberry32 } from "../corpus.test-support.js";
import { regionAt, setsDiagram } from "./geometry.js";
import {
  drawnSetsOf,
  latticeIn,
  membershipOf,
  packSets,
  regionCapacity,
  retagInto,
  SETS_STEP,
  setsDropAt,
  type SetsNote,
  setsSpacing,
  setsSpacingTier,
  standingOrder,
} from "./pack.js";

const HOME = "did:syr:zHome" as OwnedRef;
const AWAY = "did:syr:zAway" as OwnedRef;
const TAGS = ["biology", "seed", "question", "working", "spare"] as Tag[];

function note(
  serial: number,
  tags: readonly Tag[],
  graph = HOME,
  address?: string,
): SetsNote {
  return {
    ref: `${graph}/${serial.toString(36).padStart(26, "0")}` as OwnedRef,
    graph,
    tags,
    ...(address === undefined ? {} : { address: address as Address }),
    created_at: `2026-01-01T00:00:${String(serial % 60).padStart(2, "0")}.000Z`,
  };
}

/** A field of notes drawn from the tag pool, the same every run. */
function field(count: number, seed: number): SetsNote[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_unused, at) =>
    note(
      at,
      TAGS.filter(() => random() < 0.45),
      HOME,
      `1a${at + 1}`,
    ),
  );
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let at = out.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1));
    [out[at], out[swap]] = [out[swap], out[at]];
  }
  return out;
}

const packed = (notes: readonly SetsNote[], selection: readonly Tag[]) =>
  packSets({
    notes,
    fields: [],
    selection,
    spacing: SETS_STEP,
    most: 4000,
    gutter: 900,
  });

describe("the tags a selection draws", () => {
  it("takes the first few in selection order and dedupes them", () => {
    expect(drawnSetsOf([...TAGS, TAGS[0]])).toEqual(
      TAGS.slice(0, DRAWN_SETS_MOST),
    );
    expect(drawnSetsOf([TAGS[1], TAGS[1], TAGS[0]])).toEqual([
      TAGS[1],
      TAGS[0],
    ]);
  });

  it("reads a note's region off the drawn tags alone", () => {
    const drawn = TAGS.slice(0, 3);
    expect(membershipOf([TAGS[0], TAGS[2], TAGS[4]], drawn)).toBe(0b101);
    expect(membershipOf([TAGS[4]], drawn)).toBe(0);
    expect(membershipOf(drawn, drawn)).toBe(0b111);
  });
});

describe("the order notes stand in inside a region", () => {
  const drawn = [TAGS[0]];

  it("stands the ones carrying the same undrawn tags together", () => {
    const seeded = note(1, [TAGS[0], TAGS[1]], HOME, "1a");
    const plain = note(2, [TAGS[0]], HOME, "1b");
    const alsoSeeded = note(3, [TAGS[0], TAGS[1]], HOME, "1c");

    const order = standingOrder([plain, alsoSeeded, seeded], drawn);

    expect(order.map((entry) => entry.address)).toEqual(["1b", "1a", "1c"]);
  });

  it("reads each group as a run: addresses first, then as written", () => {
    const unnumbered = note(9, [TAGS[0]]);
    const later = note(2, [TAGS[0]], HOME, "1b");
    const earlier = note(3, [TAGS[0]], HOME, "1a");

    const order = standingOrder([unnumbered, later, earlier], drawn);

    expect(order.map((entry) => entry.address)).toEqual([
      "1a",
      "1b",
      undefined,
    ]);
  });
});

describe("the lattice a region is packed on", () => {
  for (const count of [1, 2, 3, 4]) {
    const diagram = setsDiagram(count);

    it(`stands every mark inside its own region of ${count}`, () => {
      for (const region of diagram.regions) {
        for (const at of latticeIn(region, diagram, SETS_STEP, 24)) {
          expect(regionAt(diagram.shapes, at)).toBe(region.id);
        }
      }
    });

    it(`never stands two marks of ${count} within one step`, () => {
      for (const region of diagram.regions) {
        const points = latticeIn(region, diagram, SETS_STEP, 60);
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            expect(
              Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
              `region ${region.id.toString(2)}`,
            ).toBeGreaterThanOrEqual(SETS_STEP - 1e-6);
          }
        }
      }
    });
  }

  it("grows the spacing as the field is zoomed out, and never shrinks it", () => {
    expect(setsSpacing(1)).toBe(SETS_STEP);
    expect(setsSpacingTier(1)).toBe(0);
    let previous = SETS_STEP;
    for (const scale of [0.5, 0.25, 0.12, 0.06]) {
      const spacing = setsSpacing(scale);
      expect(spacing).toBeGreaterThanOrEqual(previous);
      previous = spacing;
    }
    expect(setsSpacing(0.06)).toBeGreaterThan(SETS_STEP);
  });
});

describe("packing a field", () => {
  const notes = field(300, 20261011);
  const selection = TAGS.slice(0, 3);

  it("stands each mark in the region of the drawn tags it carries", () => {
    const { marks, drawn } = packed(notes, selection);
    const diagram = setsDiagram(drawn.tags.length);
    for (const mark of marks) {
      if (mark.holds.length > 0) continue;
      const held = notes.find((entry) => entry.ref === mark.ref) as SetsNote;
      expect(mark.region).toBe(membershipOf(held.tags, drawn.tags));
      expect(regionAt(diagram.shapes, { x: mark.x, y: mark.y })).toBe(
        mark.region,
      );
    }
  });

  it("answers for every note exactly once", () => {
    const { marks } = packed(notes, selection);
    const answered = marks.flatMap((mark) => [mark.ref, ...mark.holds]);
    expect(new Set(answered).size).toBe(notes.length);
    expect(answered).toHaveLength(notes.length);
  });

  it("stands the same marks in the same places whatever order it is handed", () => {
    const first = packed(notes, selection);
    for (const seed of [1, 7, 4201, 99991]) {
      const again = packed(shuffled(notes, seed), selection);
      expect(again.marks).toEqual(first.marks);
      expect(again.drawn.tags).toEqual(first.drawn.tags);
      expect([...again.drawn.standing]).toEqual([...first.drawn.standing]);
    }
  });

  it("stands the same marks for every count of drawn sets", () => {
    for (let count = 0; count <= DRAWN_SETS_MOST; count++) {
      const tags = TAGS.slice(0, count);
      const first = packed(notes, tags);
      const again = packed(shuffled(notes, 31 + count), tags);
      expect(again.marks, `${count} drawn`).toEqual(first.marks);
    }
  });

  it("never stands two marks of a region within one step", () => {
    const { marks } = packed(notes, selection);
    const byRegion = new Map<number, typeof marks>();
    for (const mark of marks) {
      byRegion.set(mark.region, [...(byRegion.get(mark.region) ?? []), mark]);
    }
    for (const held of byRegion.values()) {
      for (let i = 0; i < held.length; i++) {
        for (let j = i + 1; j < held.length; j++) {
          expect(
            Math.hypot(held[i].x - held[j].x, held[i].y - held[j].y),
          ).toBeGreaterThanOrEqual(SETS_STEP - 1e-6);
        }
      }
    }
  });

  // The count is bounded everywhere else on this canvas and it is bounded here.
  it("folds a region there is no room in into one mark that counts it", () => {
    const { marks, drawn } = packSets({
      notes,
      fields: [],
      selection,
      spacing: SETS_STEP * 8,
      most: 4000,
      gutter: 900,
    });
    const diagram = setsDiagram(drawn.tags.length);
    expect(drawn.folds.size).toBeGreaterThan(0);
    for (const mark of marks) {
      const region = diagram.regions.find(
        (at) => at.id === mark.region,
      ) as (typeof diagram.regions)[number];
      if (mark.holds.length === 0) continue;
      expect(drawn.folds.has(mark.ref)).toBe(true);
      expect(mark.x).toBe(region.centre.x);
      expect(mark.y).toBe(region.centre.y);
      expect(mark.holds.length + 1).toBeGreaterThan(
        regionCapacity(region, SETS_STEP * 8),
      );
    }
  });

  it("holds the whole canvas under the count it was given", () => {
    const { marks } = packSets({
      notes,
      fields: [],
      selection,
      spacing: SETS_STEP,
      most: 40,
      gutter: 900,
    });
    expect(marks.length).toBeLessThanOrEqual(40 + 2 ** selection.length);
  });

  // With nothing drawn there is no question to stand the notes inside, so the
  // one mark that says how many there are is the whole of the reading.
  it("folds everything into one mark where nothing is selected", () => {
    const { marks, drawn } = packed(notes, []);
    expect(marks).toHaveLength(1);
    expect(marks[0].region).toBe(0);
    expect(marks[0].holds).toHaveLength(notes.length - 1);
    expect(drawn.tags).toEqual([]);
  });

  it("draws each graph its own diagram, side by side", () => {
    const both = [
      ...field(60, 5),
      ...field(60, 6).map((entry) => ({
        ...entry,
        graph: AWAY,
        ref: `${AWAY}/${entry.ref.split("/")[1]}` as OwnedRef,
      })),
    ];
    const { marks, drawn } = packSets({
      notes: both,
      fields: [HOME, AWAY],
      selection,
      spacing: SETS_STEP,
      most: 4000,
      gutter: 900,
    });
    expect(drawn.fields.map((one) => one.ref)).toEqual([HOME, AWAY]);
    expect(drawn.fields[0].dx).toBe(0);
    expect(drawn.fields[1].dx).toBeGreaterThan(0);
    const home = marks.filter((mark) => mark.field === 0);
    const away = marks.filter((mark) => mark.field === 1);
    expect(home.length).toBeGreaterThan(0);
    expect(away.length).toBeGreaterThan(0);
    expect(Math.max(...home.map((mark) => mark.x))).toBeLessThan(
      Math.min(...away.map((mark) => mark.x)),
    );
  });
});

describe("where a drop lands", () => {
  const notes = field(120, 7);
  const selection = TAGS.slice(0, 2);

  it("reads the region a world point falls in", () => {
    const { drawn } = packed(notes, selection);
    const field0 = drawn.fields[0];
    for (const region of field0.regions) {
      expect(
        setsDropAt(drawn, {
          x: region.centre.x + field0.dx,
          y: region.centre.y + field0.dy,
        }),
      ).toEqual({ field: 0, region: region.id });
    }
  });

  it("names the drawn tags of the region and leaves the rest alone", () => {
    const { drawn } = packed(notes, selection);
    const outside = note(1, [TAGS[4]]);

    expect(retagInto(drawn, [outside], 0b11)).toEqual({
      notes: [outside.ref],
      into: selection,
      outOf: [],
    });
    expect(retagInto(drawn, [outside], 0b01)).toEqual({
      notes: [outside.ref],
      into: [selection[0]],
      outOf: [selection[1]],
    });
  });

  it("says nothing about a note already standing where it was dropped", () => {
    const { drawn } = packed(notes, selection);
    const already = note(1, [selection[0], TAGS[4]]);
    expect(retagInto(drawn, [already], 0b01)).toBeNull();
    expect(retagInto(drawn, [already], 0b11)).toEqual({
      notes: [already.ref],
      into: selection,
      outOf: [],
    });
  });

  it("reports only the notes a drop would actually move", () => {
    const { drawn } = packed(notes, selection);
    const already = note(1, [selection[0]]);
    const moving = note(2, []);
    expect(retagInto(drawn, [already, moving], 0b01)).toEqual({
      notes: [moving.ref],
      into: [selection[0]],
      outOf: [selection[1]],
    });
  });

  it("reports nothing at all where no set is drawn", () => {
    const { drawn } = packed(notes, []);
    expect(retagInto(drawn, [note(1, [TAGS[0]])], 0)).toBeNull();
  });
});
