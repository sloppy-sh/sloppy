// The figure has to be the same figure on every peer and it has to have room
// in every one of its regions — a lens with no area is a combination of tags a
// reader can select and then find nowhere to stand. DESIGN.md § "Sets — the
// tags as places".

import { describe, expect, it, vi } from "vitest";
import {
  inBox,
  inShape,
  namePoint,
  regionAt,
  SETS_DIAGRAMS_MOST,
  setsDiagram,
  shapeOutline,
} from "./geometry.js";

const counts = Array.from({ length: SETS_DIAGRAMS_MOST }, (_, at) => at + 1);

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

    it(`holds every shape of ${count} inside the diagram's box`, () => {
      for (const shape of diagram.shapes) {
        for (const at of shapeOutline(shape, 72)) {
          expect(inBox(diagram.box, at)).toBe(true);
        }
      }
    });
  }

  it("draws no shape and one region where nothing is selected", () => {
    const diagram = setsDiagram(0);
    expect(diagram.shapes).toHaveLength(0);
    expect(diagram.regions.map((region) => region.id)).toEqual([0]);
    expect(diagram.regions[0].area).toBeGreaterThan(0);
  });

  // Two peers reading the same selection draw the same figure, so the
  // measurement cannot depend on anything but the count — measured again from a
  // fresh module rather than read back off the one that is held.
  it("measures the same figure every time it is measured", async () => {
    vi.resetModules();
    const again = await import("./geometry.js");
    for (const count of [0, ...counts]) {
      expect(again.setsDiagram(count)).toEqual(setsDiagram(count));
    }
  });
});
