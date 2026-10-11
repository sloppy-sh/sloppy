// The figure has to be the same figure on every peer and it has to have room
// in every one of its regions — a lens with no area is a combination of tags a
// reader can select and then find nowhere to stand. DESIGN.md § "Sets — the
// tags as places".

import { describe, expect, it, vi } from "vitest";
import { DRAWN_SETS_MOST } from "../contract.js";
import {
  inBox,
  inShape,
  namePoint,
  regionAt,
  SETS_FITS,
  setsDiagram,
  setsGrowth,
  shapeBounds,
  shapeOutline,
} from "./geometry.js";

const counts = Array.from({ length: DRAWN_SETS_MOST }, (_, at) => at + 1);

describe("the diagram each count of drawn sets draws", () => {
  for (const count of counts) {
    const diagram = setsDiagram(count);

    it(`draws ${count} shapes and every one of its regions`, () => {
      expect(diagram.shapes).toHaveLength(count);
      // Every combination of the drawn sets, and the region outside them all.
      expect(diagram.regions.map((region) => region.id)).toEqual(
        Array.from({ length: 2 ** count }, (_unused, id) => id),
      );
    });

    it(`leaves every region of ${count} room to stand in`, () => {
      for (const region of diagram.regions) {
        const where = `region ${region.id.toString(2)}`;
        expect(region.area, where).toBeGreaterThan(0);
        expect(region.cover.length, where).toBeGreaterThan(0);
        // The centre is a point of the region and not merely near it, which is
        // what a fold stands on and what a lattice grows out from.
        expect(regionAt(diagram.shapes, region.centre), where).toBe(region.id);
        expect(inBox(diagram.box, region.centre), where).toBe(true);
      }
    });

    it(`covers each region of ${count} with its own cells alone`, () => {
      for (const region of diagram.regions) {
        for (const box of region.cover) {
          const middle = {
            x: (box.minX + box.maxX) / 2,
            y: (box.minY + box.maxY) / 2,
          };
          expect(
            regionAt(diagram.shapes, middle),
            `region ${region.id.toString(2)}`,
          ).toBe(region.id);
        }
      }
    });

    it(`writes each name of ${count} inside the set it names`, () => {
      for (const shape of diagram.shapes) {
        expect(inShape(shape, namePoint(shape))).toBe(true);
      }
    });

    it(`boxes each shape of ${count} round its own outline`, () => {
      for (const shape of diagram.shapes) {
        const box = shapeBounds(shape);
        for (const at of shapeOutline(shape, 180)) {
          expect(inBox(box, at)).toBe(true);
        }
        expect(box.maxX - box.minX).toBeLessThanOrEqual(shape.rx * 2 + 1e-6);
      }
    });

    it(`holds every shape of ${count} inside the diagram's box`, () => {
      for (const shape of diagram.shapes) {
        for (const at of shapeOutline(shape, 72)) {
          expect(inBox(diagram.box, at)).toBe(true);
        }
      }
    });
  }

  // A tag past the count the figure draws colours its marks and draws no
  // region, which is only true while the two agree about the count.
  it("draws a shape for every set the contract says it draws", () => {
    expect(setsDiagram(DRAWN_SETS_MOST).shapes).toHaveLength(DRAWN_SETS_MOST);
    expect(setsDiagram(DRAWN_SETS_MOST + 1)).toEqual(
      setsDiagram(DRAWN_SETS_MOST),
    );
  });

  it("draws no shape and one region where nothing is selected", () => {
    const diagram = setsDiagram(0);
    expect(diagram.shapes).toHaveLength(0);
    expect(diagram.regions.map((region) => region.id)).toEqual([0]);
    expect(diagram.regions[0].area).toBeGreaterThan(0);
  });

  // A figure that cannot grow is a lens most of a graph's notes can never be
  // reached in: the shape is fixed, and the SIZE answers the count of notes on
  // the field — DESIGN.md § "Sets — the tags as places".
  describe("the size a field's own count draws the figure at", () => {
    it("draws the figure at its own size up to the count it holds", () => {
      expect(setsGrowth(0)).toBe(1);
      expect(setsGrowth(SETS_FITS)).toBe(1);
      for (const notes of [0, 1, SETS_FITS - 1, SETS_FITS]) {
        expect(setsDiagram(4, notes)).toEqual(setsDiagram(4));
      }
    });

    it("draws four times the notes twice the size, with four times the room", () => {
      for (const count of counts) {
        const some = setsDiagram(count, SETS_FITS);
        const many = setsDiagram(count, SETS_FITS * 4);
        expect(setsGrowth(SETS_FITS * 4)).toBeCloseTo(2, 12);
        expect(many.box.maxX - many.box.minX).toBeCloseTo(
          (some.box.maxX - some.box.minX) * 2,
          9,
        );
        for (const [at, region] of many.regions.entries()) {
          const held = some.regions[at];
          expect(region.id).toBe(held.id);
          expect(region.area).toBeCloseTo(held.area * 4, 6);
          expect(region.centre.x).toBeCloseTo(held.centre.x * 2, 9);
          expect(region.centre.y).toBeCloseTo(held.centre.y * 2, 9);
        }
      }
    });

    it("grows the shape and keeps it the same shape", () => {
      const grown = setsDiagram(4, SETS_FITS * 9);
      for (const [at, shape] of grown.shapes.entries()) {
        const held = setsDiagram(4).shapes[at];
        expect(shape.rotation).toBe(held.rotation);
        expect(shape.nameAt).toBe(held.nameAt);
        expect(shape.rx / shape.ry).toBeCloseTo(held.rx / held.ry, 12);
        expect(shape.rx).toBeCloseTo(held.rx * 3, 9);
      }
      for (const region of grown.regions) {
        expect(regionAt(grown.shapes, region.centre)).toBe(region.id);
      }
    });
  });

  // Two peers reading the same selection draw the same figure, so the
  // measurement cannot depend on anything but the count — measured again from a
  // fresh module rather than read back off the one that is held.
  it("measures the same figure every time it is measured", async () => {
    vi.resetModules();
    const again = await import("./geometry.js");
    for (const count of [0, ...counts]) {
      expect(again.setsDiagram(count)).toEqual(setsDiagram(count));
      expect(again.setsDiagram(count, 601)).toEqual(setsDiagram(count, 601));
    }
  });
});
