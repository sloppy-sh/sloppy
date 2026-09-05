// DESIGN.md § "A picture that takes turns": three transitions, and every one of
// them transform and opacity alone. The ground and a mark read this one model,
// so what is held here is what neither of them may spell differently.

import { PICTURE_TRANSITIONS } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { pictureStep, shownAt } from "./turn.js";

const ROLES = ["arriving", "leaving"] as const;
const STEPS = [0, 0.25, 0.5, 0.75, 1];

describe("how one picture gives way to the next", () => {
  it("arrives as the one before it leaves", () => {
    for (const at of STEPS) {
      expect(shownAt("arriving", at)).toBeCloseTo(
        shownAt("leaving", 1 - at),
        9,
      );
    }
    expect(shownAt("arriving", 0)).toBe(0);
    expect(shownAt("arriving", 1)).toBe(1);
    expect(shownAt("leaving", 1)).toBe(0);
  });

  // The opacity is what every transition spends, and it is a multiplier: a
  // picture somebody has quietened never pops to full strength half way through.
  it("settles every transition on the picture, untouched", () => {
    for (const transition of PICTURE_TRANSITIONS) {
      const settled = pictureStep(transition, "arriving", 1);
      expect(settled, transition).toEqual({ opacity: 1, shift: 0, scale: 1 });
    }
  });

  // A picture cropped to fill its layer covers it at scale 1 and at nothing
  // less, so a zoom that dipped below would show what is behind the picture.
  it("never draws a picture smaller than the space it fills", () => {
    for (const transition of PICTURE_TRANSITIONS) {
      for (const role of ROLES) {
        for (const at of STEPS) {
          const step = pictureStep(transition, role, shownAt(role, at));
          expect(step.scale, `${transition} ${role}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("moves the two ends of a slide opposite ways, and nothing else at all", () => {
    const arriving = pictureStep("slide", "arriving", 0);
    const leaving = pictureStep("slide", "leaving", 0);
    expect(arriving.shift).toBe(1);
    expect(leaving.shift).toBe(-1);
    expect(arriving.scale).toBe(1);

    for (const transition of ["fade", "zoom"] as const) {
      for (const role of ROLES) {
        expect(pictureStep(transition, role, 0).shift, transition).toBe(0);
      }
    }
    expect(pictureStep("zoom", "arriving", 0).scale).toBeGreaterThan(1);
    expect(pictureStep("fade", "arriving", 0).scale).toBe(1);
  });
});
