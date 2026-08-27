import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  mixOklab,
  parseCssColor,
  raiseToFloor,
  toRgb24,
  toSrgb8,
} from "./color.js";

describe("parseCssColor", () => {
  // Whichever space a token was authored in is the space getComputedStyle hands
  // back, so every notation `app.css` can produce has to arrive intact.
  it("reads the notations a computed style can hand back", () => {
    const cases: [string, [number, number, number]][] = [
      ["oklch(0.6 0.13 25)", toSrgb8({ l: 0.6, c: 0.13, h: 25 })],
      ["oklch(60% 0.13 25)", toSrgb8({ l: 0.6, c: 0.13, h: 25 })],
      ["rgb(255, 0, 0)", [255, 0, 0]],
      ["rgb(255 0 0 / 0.5)", [255, 0, 0]],
      ["#ff0000", [255, 0, 0]],
      ["#f00", [255, 0, 0]],
      ["color(srgb 1 0 0)", [255, 0, 0]],
    ];
    for (const [text, expected] of cases) {
      const parsed = parseCssColor(text);
      expect(parsed, text).not.toBeNull();
      expect(toSrgb8(parsed!), text).toEqual(expected);
    }
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const text of ["", "rebeccapurple", "var(--x)", "hsl(1 2% 3%)"]) {
      expect(parseCssColor(text), text).toBeNull();
    }
  });

  it("round-trips sRGB through OKLCH", () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 85) {
          const hex = `#${[r, g, b].map(byte).join("")}`;
          expect(toSrgb8(parseCssColor(hex)!), hex).toEqual([r, g, b]);
        }
      }
    }
  });
});

describe("contrastRatio", () => {
  it("agrees with WCAG at the ends", () => {
    const black = parseCssColor("#000000")!;
    const white = parseCssColor("#ffffff")!;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });
});

describe("raiseToFloor", () => {
  const paper = parseCssColor("#ffffff")!;
  const ink = parseCssColor("#1a1a1a")!;

  it("leaves a colour that already clears the floor alone", () => {
    expect(raiseToFloor(ink, paper, ink, 3)).toEqual(ink);
  });

  it("pulls a faded mark back until it clears", () => {
    const faded = mixOklab(ink, paper, 0.95);
    expect(contrastRatio(faded, paper)).toBeLessThan(3);
    const raised = raiseToFloor(faded, paper, ink, 3);
    expect(contrastRatio(raised, paper)).toBeGreaterThanOrEqual(3);
  });

  it("is total: an anchor that cannot clear the floor is still answered", () => {
    const pale = parseCssColor("#f4f4f4")!;
    expect(raiseToFloor(pale, paper, pale, 3)).toEqual(pale);
  });
});

describe("toRgb24", () => {
  it("packs the bytes pixi takes", () => {
    expect(toRgb24(parseCssColor("#123456")!)).toBe(0x123456);
  });
});

function byte(value: number): string {
  return value.toString(16).padStart(2, "0");
}
