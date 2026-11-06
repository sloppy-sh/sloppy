// Sloppy's own graph, read in the sets reading: eight sets crossing in pairs
// more than any eight discs can, which is the figure that once drew every set
// as a huge disc through one point and left a fold there no tap opened.
// DESIGN.md § "Sets — the tags as places".

import type { Address, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import { drawnSetsOf } from "../contract.js";
import { MIN_SCALE } from "../viewport.js";
import {
  inShape,
  namePoint,
  SETS_FIGURE_WIDEST,
  setsFigure,
  setsUnitArea,
} from "./geometry.js";
import {
  askOf,
  membershipOf,
  opensAt,
  packSets,
  SETS_STEP,
  type SetsNote,
  setsSpacing,
} from "./pack.js";
import { SLOPPY_TAGS } from "./sloppy-tags.test-support.js";

const GRAPH = "did:syr:zSloppy" as OwnedRef;

const notes: SetsNote[] = SLOPPY_TAGS.map(([ulid, address, tags]) => ({
  ref: `${GRAPH}/${ulid}` as OwnedRef,
  graph: GRAPH,
  tags: tags as Tag[],
  ...(address === null ? {} : { address: address as Address }),
  created_at: "2026-09-26T00:00:00.000Z",
}));

const drawn = drawnSetsOf([], notes);
const ask = askOf(notes, drawn);

const packedAt = (scale: number) =>
  packSets({
    notes,
    fields: [],
    selection: [],
    spacing: setsSpacing(scale),
    most: 4000,
    gutter: 900,
  });

describe("Sloppy's own graph in the sets reading", () => {
  it("draws eight sets, and asks for more than discs can cross", () => {
    expect(drawn).toHaveLength(8);
    const figure = setsFigure(ask);
    expect(figure.shapes.some((shape) => shape.stretch > 1)).toBe(true);
  });

  it("draws the same figure to the last digit", async () => {
    vi.resetModules();
    const again = await import("./geometry.js");
    expect(again.setsFigure(ask)).toEqual(setsFigure(ask));
  });

  it("draws the same shapes whichever order the sets are asked in", () => {
    const reversed = [...drawn].reverse();
    const forwards = setsFigure(ask).shapes;
    const backwards = setsFigure(askOf(notes, reversed)).shapes;
    for (const [at, shape] of forwards.entries()) {
      const { nameAt: _one, ...outline } = shape;
      const { nameAt: _two, ...other } = backwards[drawn.length - 1 - at];
      expect(other).toEqual(outline);
    }
  });

  it("keeps every shape the area its count asks for", () => {
    const unit = setsUnitArea(ask.counts);
    for (const [at, shape] of setsFigure(ask).shapes.entries()) {
      const along = shape.r * shape.stretch;
      const across = shape.r / shape.stretch;
      expect((Math.PI * along * across) / unit).toBeCloseTo(ask.counts[at], 6);
    }
  });

  it("crosses every pair of sets that shares a note", () => {
    const figure = setsFigure(ask);
    const count = drawn.length;
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        if (ask.shared[a * count + b] === 0) continue;
        const both = (1 << a) | (1 << b);
        expect(
          figure.regions.some((region) => (region.id & both) === both),
          `${drawn[a]} and ${drawn[b]}`,
        ).toBe(true);
      }
    }
  });

  it("writes each set's name inside its own shape", () => {
    for (const shape of setsFigure(ask).shapes) {
      expect(inShape(shape, namePoint(shape))).toBe(true);
    }
  });

  it("stands every note in a place of every set it carries", () => {
    const { drawn: packed } = packedAt(1);
    for (const note of notes) {
      const carries = membershipOf(note.tags, packed.tags);
      const stands = packed.standing.get(note.ref)?.region ?? -1;
      expect(stands & carries, note.address).toBe(carries);
    }
  });

  it("gives every note a mark of its own at full zoom", () => {
    const { marks } = packedAt(1);
    expect(marks.filter((mark) => mark.holds.length > 0)).toEqual([]);
    expect(marks).toHaveLength(notes.length);
  });

  it("draws a figure a reader sees whole well inside the width bound", () => {
    const field = packedAt(1).drawn.fields[0];
    const across = Math.max(
      field.box.maxX - field.box.minX,
      field.box.maxY - field.box.minY,
    );
    expect(across).toBeLessThan(SETS_FIGURE_WIDEST / 2);
  });

  // What a tap on a fold does is bring the canvas to the zoom `opensAt` names;
  // the pack at that zoom is what the reader then sees.
  it("opens every fold at the zoom a tap on it brings the canvas to", () => {
    const { marks, drawn: framed } = packedAt(MIN_SCALE);
    const folds = marks.filter((mark) => mark.holds.length > 0);
    expect(folds.length).toBeGreaterThan(0);
    const field = framed.fields[0];
    for (const fold of folds) {
      const region = field.regions.find(
        (at) => at.id === fold.region,
      ) as (typeof field.regions)[number];
      const scale = opensAt(field, region, fold.holds.length + 1, MIN_SCALE);
      const opened = packedAt(scale).marks.filter(
        (mark) => mark.region === fold.region,
      );
      expect(
        opened.every((mark) => mark.holds.length === 0),
        `region ${fold.region.toString(2)} at ${scale}`,
      ).toBe(true);
      expect(opened).toHaveLength(fold.holds.length + 1);
    }
  });

  it("stands its marks a lattice step apart at the floor", () => {
    const { marks } = packedAt(1);
    for (const [at, one] of marks.entries()) {
      for (const other of marks.slice(at + 1)) {
        expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeGreaterThan(
          SETS_STEP - 1e-6,
        );
      }
    }
  });
});
