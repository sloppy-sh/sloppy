// DESIGN.md § "Contrast is measured, not assumed" applies to the depth ramp
// this file builds as much as to the tokens it is built from: every mark on it
// is a graphical object carrying meaning alone, so every mark owes 3:1. The
// sweep is over generated theme ends rather than a handful of hand-picked
// pairs, because the ramp is a function and a function is what has to hold.
//
// The slot hues owe the same, and are measured where they are declared —
// `token-contrast.test.ts` in `@sloppy/ui`. What is held here is that this file
// hands a slot back the token it was given, so those two agree.

import { TAG_HUE_SLOTS } from "@sloppy/types";
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

const hues = TAG_HUE_SLOTS.map((_, at) => `oklch(0.61 0.13 ${25 + at * 45})`);

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
      const palette = buildPalette({ ...theme, hues });
      const paper = parseCssColor(theme.paper)!;
      for (let depth = 1; depth <= DEPTH_STEPS + 1; depth++) {
        expect(
          contrastRatio(rgb(palette.depth(depth)), paper),
          `depth ${depth}`,
        ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-9);
      }
    });

    it(`recedes with every generation on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, hues });
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
    const palette = buildPalette({ ...themes[0], hues });
    expect(palette.depth(DEPTH_STEPS + 1)).toBe(palette.depth(40));
  });
});

describe("the hue a selected tag borrows", () => {
  const palette = buildPalette({ ...themes[0], hues });

  // DESIGN.md § Hue: "the legend and the canvas cannot disagree about which
  // colour answers which question." A slot shows its token rather than a colour
  // derived from it, so a chip painted `var(--facet-n)` and the notes it stands
  // for are the same answer — the ONLY thing given up is chroma sRGB cannot
  // hold, which is the give the browser takes on the chip too.
  it("shows the token, spending only the chroma sRGB cannot hold", () => {
    TAG_HUE_SLOTS.forEach((slot, at) => {
      const token = parseCssColor(hues[at])!;
      const shown = rgb(palette.tag(slot));
      expect(shown.l, `slot ${slot} lightness`).toBeCloseTo(token.l, 2);
      expect(shown.h, `slot ${slot} hue`).toBeCloseTo(token.h, 0);
      expect(shown.c, `slot ${slot} chroma`).toBeLessThanOrEqual(
        token.c + 1e-3,
      );
    });
  });

  // A ninth slot cannot exist, and asking for one must not draw a colour that
  // means something else.
  it("never invents a slot outside the eight", () => {
    const drawn = TAG_HUE_SLOTS.map((slot) => palette.tag(slot));
    expect(palette.tag(9 as (typeof TAG_HUE_SLOTS)[number])).toBe(drawn.at(-1));
    expect(palette.tag(0 as (typeof TAG_HUE_SLOTS)[number])).toBe(drawn[0]);
  });

  it("keeps every slot apart from every other", () => {
    for (let i = 0; i < TAG_HUE_SLOTS.length; i++) {
      for (let j = i + 1; j < TAG_HUE_SLOTS.length; j++) {
        expect(
          oklabDistance(
            rgb(palette.tag(TAG_HUE_SLOTS[i])),
            rgb(palette.tag(TAG_HUE_SLOTS[j])),
          ),
          `slots ${TAG_HUE_SLOTS[i]} and ${TAG_HUE_SLOTS[j]}`,
        ).toBeGreaterThanOrEqual(0.03);
      }
    }
  });
});

describe("a theme whose tokens have not resolved", () => {
  it("draws the graph in ink rather than in a palette of its own", () => {
    const palette = buildPalette({ ink: "", paper: "", hues: [] });
    expect(palette.tag(3)).toBe(palette.depth(1));
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
