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
import {
  contrastRatio,
  parseCssColor,
  toOklab,
  toSrgb8,
  over,
  type Oklch,
} from "./color.js";
import { DRAWN_SETS_MOST } from "./contract.js";
import {
  buildPalette,
  DEPTH_SEPARATION,
  DEPTH_STEPS,
  DIM_FLOOR,
  DIM_RECESSION,
  groundBand,
  LABEL_FLOOR,
  MARK_FLOOR,
  paperCeiling,
  SETS_TINT,
  setsBand,
  setsCeiling,
} from "./palette.js";

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
      for (let depth = 1; depth <= palette.generations; depth++) {
        expect(
          contrastRatio(rgb(palette.depth(depth)), paper),
          `depth ${depth}`,
        ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-9);
      }
    });

    // Ordered AND apart. A ramp that has run out of range still passes a
    // "never louder than the one before it" reading with three identical greys
    // at the bottom, and the channel has stopped answering there — DESIGN.md
    // § Lightness, where the distance is the one the tag slots owe.
    it(`recedes a visible step every generation on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, hues });
      const paper = parseCssColor(theme.paper)!;
      let previous = Number.POSITIVE_INFINITY;
      for (let depth = 1; depth <= palette.generations; depth++) {
        const fill = rgb(palette.depth(depth));
        const ratio = contrastRatio(fill, paper);
        expect(ratio, `depth ${depth}`).toBeLessThanOrEqual(previous + 1e-9);
        previous = ratio;
        if (depth === 1) continue;
        expect(
          oklabDistance(rgb(palette.depth(depth - 1)), fill),
          `depth ${depth - 1} against ${depth}`,
        ).toBeGreaterThanOrEqual(DEPTH_SEPARATION - 1e-3);
      }
    });

    // As many as the range holds and not fewer: a theme that stops short of the
    // bound has to be one where the next step would not have been visible.
    it(`carries as many generations as ${theme.name} holds apart`, () => {
      const palette = buildPalette({ ...theme, hues });
      expect(palette.generations).toBeLessThanOrEqual(DEPTH_STEPS + 1);
      if (palette.generations === DEPTH_STEPS + 1) return;
      const range = oklabDistance(
        rgb(palette.depth(1)),
        rgb(palette.depth(palette.generations)),
      );
      expect(range / palette.generations).toBeLessThan(DEPTH_SEPARATION);
    });
  }

  it("carries the whole ramp on every theme that ships", () => {
    for (const theme of themes) {
      const palette = buildPalette({ ...theme, hues });
      expect(palette.generations, theme.name).toBe(DEPTH_STEPS + 1);
    }
  });

  it("stops ramping past the bound rather than fading away", () => {
    const palette = buildPalette({ ...themes[0], hues });
    expect(palette.depth(palette.generations)).toBe(palette.depth(40));
  });
});

// DESIGN.md § Hue: a note carrying none of the selected tags recedes, and does
// not leave. What holds the second half is the floor: the recession stops at
// DIM_FLOOR against the ground, so the deep end of the ramp — which is already
// at the mark floor — is still on the page while a question is up.
describe("a note the selected tags leave out", () => {
  for (const theme of [...themes, ...generatedThemes()]) {
    it(`stays on the page at every generation on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, hues });
      const paper = parseCssColor(theme.paper)!;
      for (const fill of marks(palette)) {
        expect(
          contrastRatio(
            over(rgb(fill), paper, palette.unselectedAlpha(fill)),
            paper,
          ),
          `fill ${fill.toString(16)}`,
        ).toBeGreaterThanOrEqual(DIM_FLOOR - 1e-6);
      }
    });

    // The same share for every mark that can afford it, and more only where the
    // floor took it: a mark keeps extra exactly when the plain share would have
    // dropped it under DIM_FLOOR, so nothing recedes less than it had to.
    it(`recedes by the same share wherever it can on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, hues });
      const paper = parseCssColor(theme.paper)!;
      for (const fill of marks(palette)) {
        const where = `fill ${fill.toString(16)}`;
        const share = palette.unselectedAlpha(fill);
        const plain = contrastRatio(
          over(rgb(fill), paper, DIM_RECESSION),
          paper,
        );
        expect(share, where).toBeGreaterThanOrEqual(DIM_RECESSION);
        expect(share, where).toBeLessThan(1);
        if (plain >= DIM_FLOOR + 1e-6) expect(share, where).toBe(DIM_RECESSION);
      }
    });
  }

  // The share is the amount a dim is worth, and a theme with room takes exactly
  // it — a floor that had lifted every mark would have replaced the recession
  // rather than bounded it.
  it("gives up the whole share on every theme that ships", () => {
    for (const theme of themes) {
      const palette = buildPalette({ ...theme, hues });
      const shares = marks(palette).map((fill) =>
        palette.unselectedAlpha(fill),
      );
      expect(Math.min(...shares), theme.name).toBe(DIM_RECESSION);
    }
  });

  // The mark a reader's question lit is the loudest thing on the canvas, and a
  // dim that reads as loudly as one has answered nothing.
  it("never reads as loudly as a note the tags lit", () => {
    for (const theme of themes) {
      const palette = buildPalette({ ...theme, hues });
      const paper = parseCssColor(theme.paper)!;
      const lit = Math.min(
        ...marks(palette).map((fill) => contrastRatio(rgb(fill), paper)),
      );
      for (const fill of marks(palette)) {
        expect(
          contrastRatio(
            over(rgb(fill), paper, palette.unselectedAlpha(fill)),
            paper,
          ),
          `${theme.name} fill ${fill.toString(16)}`,
        ).toBeLessThan(lit);
      }
    }
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

// DESIGN.md § "The mark" draws a look's ring INSIDE the mark, so what it has to
// stand out against is the mark's own fill rather than the page. A ring that has
// sunk into its own mark is a channel that has quietly stopped saying anything.
//
// The condition every fill on this canvas already meets is 3:1 against the
// paper: the ramp is held to it above, and `token-contrast.test.ts` holds the
// slot hues to it where they are declared. That is what is swept here, so a
// theme is measured on the fills it could actually ship rather than on a hue
// borrowed from another one.
describe("the ring a look draws", () => {
  for (const theme of [...themes, ...generatedThemes()]) {
    it(`stays legible on every fill a mark carries on ${theme.name}`, () => {
      const palette = buildPalette({ ...theme, hues });
      const paper = rgb(palette.paper);
      const fills = [...marks(palette), palette.paper].filter(
        (fill) =>
          fill === palette.paper ||
          contrastRatio(rgb(fill), paper) >= MARK_FLOOR - 1e-9,
      );
      expect(fills.length).toBeGreaterThan(palette.generations);
      for (const fill of fills) {
        expect(
          contrastRatio(rgb(palette.lookRing(fill)), rgb(fill)),
          `fill ${fill.toString(16)}`,
        ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-9);
      }
    });
  }

  // DESIGN.md § "A note's look never uses colour": the ring is shape, and the
  // hue it is drawn over is the reader's question, not the author's answer.
  it("spends no hue of its own, whatever it is drawn on", () => {
    const palette = buildPalette({ ...themes[0], hues });
    const ends = new Set([palette.ink, palette.paper]);
    for (const slot of TAG_HUE_SLOTS) {
      expect(ends.has(palette.lookRing(palette.tag(slot)))).toBe(true);
    }
  });
});

// DESIGN.md § "Sets — the tags as places": a region is a wash the marks stand
// ON, so what a mark owes is owed against the ground that wash makes — every
// stack of them the figure can draw, up to the cap. The alpha is what gives to
// pass; the floors do not move.
describe("a mark standing inside the drawn sets", () => {
  const washed = (theme: (typeof themes)[number], sets: number) => {
    const palette = buildPalette({ ...theme, hues }, 0, sets);
    return {
      palette,
      grounds: setsBand(
        { ...theme, hues },
        parseCssColor(theme.paper) as Oklch,
        sets,
        palette.setsWash,
      ),
    };
  };

  for (const theme of [...themes, ...generatedThemes()]) {
    it(`carries its meaning on every stack of washes on ${theme.name}`, () => {
      for (let sets = 1; sets <= DRAWN_SETS_MOST; sets++) {
        const { palette, grounds } = washed(theme, sets);
        expect(grounds).toHaveLength(
          palette.setsWash > 0 ? 2 ** (sets + 1) - 1 : 0,
        );
        for (const ground of grounds) {
          for (const fill of marks(palette)) {
            expect(
              contrastRatio(rgb(fill), ground),
              `${sets} washes, fill ${fill.toString(16)}`,
            ).toBeGreaterThanOrEqual(MARK_FLOOR - 1e-9);
          }
        }
      }
    });

    // The set names and the marks' captions are small text lettered in the
    // canvas's own ink, so what they owe is LABEL_FLOOR over every ground a
    // wash can lay under them: the paper, every stack of washes, and both ends
    // of the band a wallpaper at its ceiling makes.
    it(`letters above the small-text floor under every wash on ${theme.name}`, () => {
      const tokens = { ...theme, hues };
      const ink = parseCssColor(theme.ink) as Oklch;
      const paper = parseCssColor(theme.paper) as Oklch;
      for (const presence of [0, paperCeiling(tokens)]) {
        for (let sets = 1; sets <= DRAWN_SETS_MOST; sets++) {
          const { setsWash } = buildPalette(tokens, presence, sets);
          for (const under of groundBand(paper, presence)) {
            const grounds = [under, ...setsBand(tokens, under, sets, setsWash)];
            for (const ground of grounds) {
              expect(
                contrastRatio(ink, ground),
                `${sets} washes over a picture at ${presence.toFixed(3)}`,
              ).toBeGreaterThanOrEqual(LABEL_FLOOR - 1e-9);
            }
          }
        }
      }
    });

    it(`stays on the page where the tags leave it out on ${theme.name}`, () => {
      for (let sets = 1; sets <= DRAWN_SETS_MOST; sets++) {
        const { palette, grounds } = washed(theme, sets);
        for (const ground of grounds) {
          for (const fill of marks(palette)) {
            expect(
              contrastRatio(
                over(rgb(fill), ground, palette.unselectedAlpha(fill)),
                ground,
              ),
              `${sets} washes, fill ${fill.toString(16)}`,
            ).toBeGreaterThanOrEqual(DIM_FLOOR - 1e-6);
          }
        }
      }
    });
  }

  // What bounds the wash: as many of them stacked as the figure draws places
  // still have to leave a theme every generation it carries on the plain paper.
  // A louder wash buys nothing and costs the lightness channel.
  it("leaves every theme its whole ramp under as many washes as it draws", () => {
    for (const theme of themes) {
      const plain = buildPalette({ ...theme, hues });
      const under = buildPalette({ ...theme, hues }, 0, DRAWN_SETS_MOST);
      expect(under.setsWash, theme.name).toBe(SETS_TINT);
      expect(under.generations, theme.name).toBe(plain.generations);
    }
  });

  // The wash is the one thing that gives, down to the hairlines alone: a
  // reader with a picture up has not asked for a quieter wallpaper by selecting
  // a tag, and the picture's own ceiling is where it was. The same theme with
  // nothing up still washes the whole of SETS_TINT, above.
  it("comes down where a picture at its ceiling leaves it no room", () => {
    const narrowed = themes.filter((theme) => {
      const tokens = { ...theme, hues };
      return (
        setsCeiling(tokens, DRAWN_SETS_MOST, paperCeiling(tokens)) < SETS_TINT
      );
    });
    expect(narrowed.length).toBeGreaterThan(0);
  });

  // The band was measured off this colour, so the region has to be drawn in it:
  // a wash drawn in anything else is a floor measured against a ground the
  // canvas does not have.
  it("washes in the hue the band was measured from", () => {
    const palette = buildPalette({ ...themes[0], hues }, 0, DRAWN_SETS_MOST);
    const paper = parseCssColor(themes[0].paper) as Oklch;
    const [one] = setsBand({ ...themes[0], hues }, paper, 1, palette.setsWash);
    expect(
      toSrgb8(over(rgb(palette.setsFill(1)), paper, palette.setsWash)),
    ).toEqual(toSrgb8(one));
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

/** Every fill the canvas puts on a mark: the ramp this theme carries and the
 *  eight hues a selection borrows. */
function marks(palette: ReturnType<typeof buildPalette>): number[] {
  return [
    ...Array.from({ length: palette.generations }, (_, at) =>
      palette.depth(at + 1),
    ),
    ...TAG_HUE_SLOTS.map((slot) => palette.tag(slot)),
  ];
}

function oklabDistance(a: Oklch, b: Oklch): number {
  const p = toOklab(a);
  const q = toOklab(b);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}
