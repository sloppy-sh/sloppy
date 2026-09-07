// DESIGN.md § "The wallpaper" claims the floors hold over ANY picture, and this
// is what holds them: the ground under a mark is then a band rather than one
// colour, so every fill is measured against both ends of it — the darkest and
// the lightest pixel a picture can put there — at the strongest picture the
// theme will carry.
//
// The sweep is over generated theme ends as well as the shipped five, because
// what is claimed is a property of the derivation and not of five tables.

import { TAG_HUE_SLOTS } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  apart,
  contrastRatio,
  fromSrgb8,
  type Oklch,
  parseCssColor,
  toSrgb8,
} from "./color.js";
import {
  buildPalette,
  DIM_FLOOR,
  groundBand,
  LABEL_FLOOR,
  MARK_FLOOR,
  paperCeiling,
  type PaletteTokens,
  SLOTS_KEPT,
} from "./palette.js";

/** The ends `app.css` ships, in the theme order DESIGN.md § Theme lists. */
const shipped: { name: string; ink: string; paper: string; facetL: number }[] =
  [
    {
      name: "paper",
      ink: "oklch(0.26 0.015 70)",
      paper: "oklch(0.972 0.006 85)",
      facetL: 0.61,
    },
    {
      name: "graphite",
      ink: "oklch(0.905 0.006 250)",
      paper: "oklch(0.215 0.008 260)",
      facetL: 0.54,
    },
    {
      name: "light",
      ink: "oklch(0.145 0 0)",
      paper: "oklch(1 0 0)",
      facetL: 0.61,
    },
    {
      name: "dark",
      ink: "oklch(0.985 0 0)",
      paper: "oklch(0.145 0 0)",
      facetL: 0.54,
    },
    {
      name: "contrast",
      ink: "oklch(0.13 0 0)",
      paper: "oklch(0.99 0 0)",
      facetL: 0.61,
    },
  ];

function generated(): typeof shipped {
  const out: typeof shipped = [];
  for (let inkL = 0; inkL <= 1.0001; inkL += 0.1) {
    for (let paperL = 0; paperL <= 1.0001; paperL += 0.1) {
      if (
        contrastRatio(
          { l: inkL, c: 0.02, h: 70 },
          { l: paperL, c: 0.006, h: 85 },
        ) < LABEL_FLOOR
      ) {
        continue;
      }
      out.push({
        name: `ink ${inkL.toFixed(1)} on paper ${paperL.toFixed(1)}`,
        ink: `oklch(${inkL} 0.02 70)`,
        paper: `oklch(${paperL} 0.006 85)`,
        facetL: inkL < paperL ? 0.61 : 0.54,
      });
    }
  }
  return out;
}

function tokensOf(theme: (typeof shipped)[number]): PaletteTokens {
  return {
    ink: theme.ink,
    paper: theme.paper,
    hues: TAG_HUE_SLOTS.map(
      (_, at) => `oklch(${theme.facetL} 0.13 ${25 + at * 45})`,
    ),
  };
}

const themes = [...shipped, ...generated()];

describe("what a ground can carry", () => {
  for (const theme of shipped) {
    it(`is a picture somebody can actually see on ${theme.name}`, () => {
      expect(paperCeiling(tokensOf(theme))).toBeGreaterThan(0.15);
    });
  }

  // Two things end a ground — the ink the canvas letters in, and the slots the
  // reader's question is asked in — and the ceiling is where the first of them
  // gives. So both hold there, and one of them is AT its floor: a ceiling with
  // room under both would be a picture the theme could carry and does not.
  //
  // "At its floor" and not "and a stronger one fails", because separation is not
  // a smooth function of strength — the slots are found by bisection and drawn
  // to 8 bits, so it steps, and a picture a thousandth stronger can land back
  // above the line while the trend is well under it.
  const NEARLY = 1.05;

  for (const theme of themes) {
    it(`is the most ${theme.name} answers over`, () => {
      const tokens = tokensOf(theme);
      const ceiling = paperCeiling(tokens);
      const ink = parseCssColor(tokens.ink) as Oklch;
      const paper = parseCssColor(tokens.paper) as Oklch;
      const floor = separation(buildPalette(tokens, 0)) * SLOTS_KEPT;

      const lettered = Math.min(
        ...groundBand(paper, ceiling).map((ground) =>
          contrastRatio(ink, ground),
        ),
      );
      const asked = separation(buildPalette(tokens, ceiling));
      expect(lettered).toBeGreaterThanOrEqual(LABEL_FLOOR - 1e-6);
      expect(asked).toBeGreaterThanOrEqual(floor - 1e-6);

      if (ceiling < 1) {
        expect(
          lettered <= LABEL_FLOOR * NEARLY || asked <= floor * NEARLY,
          `${theme.name} stops short of what it can carry`,
        ).toBe(true);
      }
    });
  }
});

describe("a mark drawn over a picture", () => {
  for (const theme of themes) {
    const tokens = tokensOf(theme);
    const paper = parseCssColor(tokens.paper) as Oklch;

    it(`keeps its floor on any pixel, at any strength, on ${theme.name}`, () => {
      for (const presence of strengths(paperCeiling(tokens))) {
        const palette = buildPalette(tokens, presence);
        for (const ground of groundBand(paper, presence)) {
          for (const mark of marks(palette)) {
            expect(
              contrastRatio(rgb(mark), ground),
              `${theme.name} at ${presence.toFixed(3)}`,
            ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-6);
          }
        }
      }
    });

    // The generations a picture pushes onto the floor sit there together, and
    // each is found by its own bisection — so two of them agree to that search's
    // precision rather than exactly, which is what the slack is.
    it(`goes on receding with depth on ${theme.name}`, () => {
      for (const presence of strengths(paperCeiling(tokens))) {
        const palette = buildPalette(tokens, presence);
        const ground = groundBand(paper, presence);
        let previous = Number.POSITIVE_INFINITY;
        for (let depth = 1; depth <= palette.generations; depth++) {
          const ratio = Math.min(
            ...ground.map((g) => contrastRatio(rgb(palette.depth(depth)), g)),
          );
          expect(ratio, `${theme.name} depth ${depth}`).toBeLessThanOrEqual(
            previous + 0.05,
          );
          previous = ratio;
        }
      }
    });
  }
});

// DESIGN.md § Hue: the slots are the reader's own question, and they have to
// survive any picture. A slot moves in LIGHTNESS to clear its floor and in
// nothing else, so eight questions stay eight answers.
describe("the reader's tags over a picture", () => {
  for (const theme of themes) {
    const tokens = tokensOf(theme);

    it(`keeps most of what tells them apart on ${theme.name}`, () => {
      const plain = separation(buildPalette(tokens, 0));
      for (const presence of strengths(paperCeiling(tokens))) {
        expect(
          separation(buildPalette(tokens, presence)),
          `${theme.name} at ${presence.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(plain * SLOTS_KEPT - 1e-6);
      }
    });

    // Within what the round trip through 8 bits and back out of gamut spends —
    // a hue moved by a couple of degrees is the same answer, and the separation
    // above is what says the eight are still eight.
    it(`spends lightness and no hue on ${theme.name}`, () => {
      const plain = buildPalette(tokens, 0);
      const shaded = buildPalette(tokens, paperCeiling(tokens));
      for (const slot of TAG_HUE_SLOTS) {
        const before = rgb(plain.tag(slot));
        const after = rgb(shaded.tag(slot));
        if (before.c < 1e-3 || after.c < 1e-3) continue;
        expect(
          Math.abs(after.h - before.h),
          `${theme.name} slot ${slot}`,
        ).toBeLessThan(3);
      }
    });
  }
});

// DESIGN.md § Hue dims a note carrying none of the selected tags, and holds it
// at DIM_FLOOR against the ground it lands on. Over a picture that ground is the
// band, so the recession is found against the band — which is what stops a
// wallpaper taking the unselected graph off the page.
describe("a dimmed note over a picture", () => {
  for (const theme of themes) {
    const tokens = tokensOf(theme);
    const paper = parseCssColor(tokens.paper) as Oklch;

    it(`stays on the page on any pixel, at any strength, on ${theme.name}`, () => {
      for (const presence of strengths(paperCeiling(tokens))) {
        const palette = buildPalette(tokens, presence);
        for (const ground of groundBand(paper, presence)) {
          for (const mark of marks(palette)) {
            expect(
              contrastRatio(
                over(rgb(mark), ground, palette.unselectedAlpha(mark)),
                ground,
              ),
              `${theme.name} at ${presence.toFixed(3)}`,
            ).toBeGreaterThanOrEqual(DIM_FLOOR - 1e-6);
          }
        }
      }
    });
  }

  // The loudest generation dimmed and a slot sitting exactly on the mark floor
  // are two ways of arriving at 3:1, so on the dark ends of one theme they meet
  // — 1.004 at the closest, over a narrow stretch of the travel. What is held is
  // the order a reader can see; half a percent of a contrast ratio is not it.
  const TOUCHING = 1.01;

  // The shipped ends and not the generated sweep: on ends no theme declares —
  // ink and paper at opposite corners — a dimmed mark is already loud with no
  // picture under it.
  for (const theme of shipped) {
    it(`never out-reads a note the tags lit on ${theme.name}`, () => {
      const tokens = tokensOf(theme);
      const paper = parseCssColor(tokens.paper) as Oklch;
      for (const presence of strengths(paperCeiling(tokens))) {
        const palette = buildPalette(tokens, presence);
        for (const ground of groundBand(paper, presence)) {
          const lit = Math.min(
            ...TAG_HUE_SLOTS.map((slot) =>
              contrastRatio(rgb(palette.tag(slot)), ground),
            ),
          );
          for (let depth = 1; depth <= palette.generations; depth++) {
            const fill = palette.depth(depth);
            const dimmed = over(
              rgb(fill),
              ground,
              palette.unselectedAlpha(fill),
            );
            expect(
              contrastRatio(dimmed, ground),
              `${theme.name} depth ${depth} at ${presence.toFixed(3)}`,
            ).toBeLessThan(lit * TOUCHING);
          }
        }
      }
    });
  }
});

/** The plain theme, the picture the ground opens on, and the strongest it
 *  carries — plus the middle, which is where a reader leaves the control. */
function strengths(ceiling: number): number[] {
  return [0, ceiling * 0.25, ceiling * 0.5, ceiling];
}

function over(mark: Oklch, ground: Oklch, alpha: number): Oklch {
  const a = toSrgb8(mark);
  const b = toSrgb8(ground);
  return fromSrgb8(a.map((c, at) => c * alpha + b[at] * (1 - alpha)));
}

function rgb(packed: number): Oklch {
  return parseCssColor(`#${packed.toString(16).padStart(6, "0")}`) as Oklch;
}

/** Every fill the canvas puts on a mark: the ramp this ground carries and the
 *  eight hues a selection borrows. */
function marks(palette: ReturnType<typeof buildPalette>): number[] {
  return [
    ...Array.from({ length: palette.generations }, (_, at) =>
      palette.depth(at + 1),
    ),
    ...TAG_HUE_SLOTS.map((slot) => palette.tag(slot)),
  ];
}

/** The closest two slots this palette draws — what says the eight are eight. */
function separation(palette: ReturnType<typeof buildPalette>): number {
  const drawn = TAG_HUE_SLOTS.map((slot) => rgb(palette.tag(slot)));
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      closest = Math.min(closest, apart(drawn[i], drawn[j]));
    }
  }
  return closest;
}
