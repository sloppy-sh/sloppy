// DESIGN.md § "Contrast is measured, not assumed" applies to the ramps this
// file builds as much as to the tokens they are built from: every mark on a
// ramp is a graphical object carrying meaning alone, so every mark owes 3:1.
// The sweep is over generated theme ends rather than a handful of hand-picked
// pairs, because the ramp is a function and a function is what has to hold.

import { describe, expect, it } from "vitest";
import { contrastRatio, type Oklch, parseCssColor, toOklab } from "./color.js";
import { buildPalette, DEPTH_STEPS, MARK_FLOOR } from "./palette.js";

const themes: { name: string; ink: string; paper: string }[] = [
  { name: "paper", ink: "oklch(0.21 0.01 60)", paper: "oklch(0.98 0.006 85)" },
  {
    name: "graphite",
    ink: "oklch(0.92 0.004 80)",
    paper: "oklch(0.2 0.004 80)",
  },
  { name: "light", ink: "oklch(0.14 0 0)", paper: "oklch(1 0 0)" },
  { name: "dark", ink: "oklch(0.98 0 0)", paper: "oklch(0.12 0 0)" },
  { name: "contrast", ink: "oklch(0 0 0)", paper: "oklch(1 0 0)" },
];

const facets = Array.from(
  { length: 8 },
  (_, slot) => `oklch(0.61 0.13 ${25 + slot * 45})`,
);

/** Ends a theme could plausibly declare, swept rather than enumerated. */
function generatedThemes(): { name: string; ink: string; paper: string }[] {
  const out: { name: string; ink: string; paper: string }[] = [];
  for (let inkL = 0; inkL <= 1.0001; inkL += 0.1) {
    for (let paperL = 0; paperL <= 1.0001; paperL += 0.1) {
      const ink = { l: inkL, c: 0.02, h: 70 };
      const paper = { l: paperL, c: 0.006, h: 85 };
      if (contrastRatio(ink, paper) < 4.5) continue;
      out.push({
        name: `ink ${inkL.toFixed(1)} on paper ${paperL.toFixed(1)}`,
        ink: `oklch(${inkL} 0.02 70)`,
        paper: `oklch(${paperL} 0.006 85)`,
      });
    }
  }
  return out;
}

describe("the depth ramp", () => {
  for (const theme of [...themes, ...generatedThemes()]) {
    it(`keeps every generation legible on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, facets });
      const paper = parseCssColor(theme.paper)!;
      for (let depth = 1; depth <= DEPTH_STEPS + 1; depth++) {
        expect(
          contrastRatio(rgb(palette.depth(depth)), paper),
          `depth ${depth}`,
        ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-9);
      }
    });

    it(`recedes with every generation on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, facets });
      const paper = parseCssColor(theme.paper)!;
      let previous = Number.POSITIVE_INFINITY;
      for (let depth = 1; depth <= DEPTH_STEPS + 1; depth++) {
        const ratio = contrastRatio(rgb(palette.depth(depth)), paper);
        expect(ratio, `depth ${depth}`).toBeLessThanOrEqual(previous + 1e-9);
        previous = ratio;
      }
    });
  }

  it("stops ramping past the bound rather than fading away", () => {
    const palette = buildPalette({ ...themes[0], facets });
    expect(palette.depth(DEPTH_STEPS + 1)).toBe(palette.depth(40));
  });
});

describe("facet ramps", () => {
  const palette = buildPalette({ ...themes[0], facets });
  const paper = parseCssColor(themes[0].paper)!;

  it("keeps every value on a ramp legible", () => {
    for (let slot = 1; slot <= 8; slot++) {
      for (const count of [1, 2, 3, 5, 8, 12]) {
        for (let index = 0; index < count; index++) {
          expect(
            contrastRatio(rgb(palette.facet(slot as 1, index, count)), paper),
            `slot ${slot} value ${index}/${count}`,
          ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-9);
        }
      }
    }
  });

  it("gives each value on a ramp its own colour", () => {
    for (let slot = 1; slot <= 8; slot++) {
      for (const count of [2, 3, 5, 6, 8, 12, 20]) {
        const seen = new Set<number>();
        for (let index = 0; index < count; index++) {
          seen.add(palette.facet(slot as 1, index, count));
        }
        expect(seen.size, `slot ${slot}, ${count} values`).toBe(count);
      }
    }
  });

  // A ramp whose steps have converged passes every contrast check and has
  // quietly stopped being a language — the same failure DESIGN.md § Hue names
  // for the slots, one level down.
  it("keeps adjacent values a readable step apart", () => {
    for (let slot = 1; slot <= 8; slot++) {
      for (const count of [2, 3, 5, 8, 12]) {
        for (let index = 1; index < count; index++) {
          const gap = oklabDistance(
            rgb(palette.facet(slot as 1, index - 1, count)),
            rgb(palette.facet(slot as 1, index, count)),
          );
          expect(gap, `slot ${slot}, value ${index}/${count}`).toBeGreaterThan(
            0.03,
          );
        }
      }
    }
  });

  // The dimension owns the hue and the value owns a place on it, so two values
  // of one dimension have to read as siblings rather than as separate answers.
  it("keeps one dimension's values on one hue", () => {
    for (let slot = 1; slot <= 8; slot++) {
      const hues = Array.from(
        { length: 6 },
        (_, index) => rgb(palette.facet(slot as 1, index, 6)).h,
      );
      const spread = Math.max(...hues) - Math.min(...hues);
      expect(spread, `slot ${slot}`).toBeLessThan(12);
    }
  });

  it("keeps two dimensions apart", () => {
    const first = palette.facet(1, 0, 3);
    for (let slot = 2; slot <= 8; slot++) {
      expect(palette.facet(slot as 2, 0, 3)).not.toBe(first);
    }
  });
});

describe("a theme whose tokens have not resolved", () => {
  it("draws the graph in ink rather than in a palette of its own", () => {
    const palette = buildPalette({ ink: "", paper: "", facets: [] });
    expect(palette.facet(3, 1, 4)).toBe(palette.depth(1));
    expect(
      contrastRatio(rgb(palette.depth(1)), rgb(palette.paper)),
    ).toBeGreaterThan(MARK_FLOOR);
  });
});

function rgb(packed: number): Oklch {
  const hex = packed.toString(16).padStart(6, "0");
  return parseCssColor(`#${hex}`)!;
}

function oklabDistance(a: Oklch, b: Oklch): number {
  const p = toOklab(a);
  const q = toOklab(b);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}
