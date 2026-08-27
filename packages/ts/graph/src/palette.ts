// The canvas's colours as numbers. DESIGN.md § "The graph's colour language" is
// the doc of record: lightness carries depth, hue carries the active lens's
// facet values, and form — which `scene.ts` draws — carries provenance.
//
// The tokens are `app.css`'s. Nothing here holds a copy of one: a slot that does
// not resolve draws in the depth ramp instead, so a theme that has not loaded
// yet renders the graph monochrome rather than in a palette this file invented.

import { FACET_SLOT_COUNT, type FacetSlot } from "@sloppy/types";
import {
  clamp,
  contrastRatio,
  intoGamut,
  mixOklab,
  type Oklch,
  parseCssColor,
  raiseToFloor,
  toRgb24,
} from "./color.js";

/** DESIGN.md § Lightness bounds the ramp here; deeper collapses anyway. */
export const DEPTH_STEPS = 6;

/** DESIGN.md § "Contrast is measured": a node fill carries meaning alone. */
export const MARK_FLOOR = 3;

/**
 * Lightness across one slot's ramp, and the step it is built from. The step
 * clears the OKLab separation DESIGN.md § Hue sets for slots, so two values of
 * one dimension read as siblings without reading as the same answer.
 */
const VALUE_SPREAD = 0.36;
const VALUE_STEP = 0.09;

const UNTHEMED_INK: Oklch = { l: 0.15, c: 0, h: 0 };
const UNTHEMED_PAPER: Oklch = { l: 1, c: 0, h: 0 };

export interface GraphPalette {
  ink: number;
  paper: number;
  /** Genealogical fill for a node `depth` deep, a root being 1. */
  depth(depth: number): number;
  /**
   * The fill for one facet value: `slot` is the dimension's hue,
   * `index` its position among `count` values on that hue's ramp.
   */
  facet(slot: FacetSlot, index: number, count: number): number;
  /** A node whose labels leave the active lens's dimension unset. */
  unlabelled: number;
  /**
   * Genealogical edges draw {@link depth} at these alphas — DESIGN.md § Edges,
   * which also dims them further under a lens.
   */
  edgeAlpha: number;
  edgeAlphaUnderLens: number;
  /** Associative links, drawn above the tree because they cross it. */
  link: number;
  linkAlpha: number;
}

const TOKENS = [
  "--graph-ink",
  "--graph-paper",
  ...Array.from(
    { length: FACET_SLOT_COUNT },
    (_, slot) => `--facet-${slot + 1}`,
  ),
];

/**
 * Read the theme's graph tokens off an element and convert them once.
 *
 * Call this on theme change and cache what it returns — DESIGN.md § Lightness
 * says why, and `scene.ts` is what would otherwise pay for it every frame.
 */
export function readPalette(element: Element): GraphPalette {
  const computed = getComputedStyle(element);
  const [ink, paper, ...facets] = TOKENS.map((token) =>
    computed.getPropertyValue(token),
  );
  return buildPalette({ ink, paper, facets });
}

export interface PaletteTokens {
  ink: string;
  paper: string;
  facets: readonly string[];
}

/** {@link readPalette} without a DOM, so the ramps are testable. */
export function buildPalette(tokens: PaletteTokens): GraphPalette {
  const ink = parseCssColor(tokens.ink) ?? UNTHEMED_INK;
  const paper = parseCssColor(tokens.paper) ?? UNTHEMED_PAPER;

  const depthRamp = Array.from({ length: DEPTH_STEPS + 1 }, (_, step) =>
    toRgb24(
      raiseToFloor(
        mixOklab(ink, paper, step / (DEPTH_STEPS + 1)),
        paper,
        ink,
        MARK_FLOOR,
      ),
    ),
  );
  const depth = (at: number): number =>
    depthRamp[clamp(Math.round(at) - 1, 0, DEPTH_STEPS)];

  const facetRamps = Array.from({ length: FACET_SLOT_COUNT }, (_, slot) => {
    const base = parseCssColor(tokens.facets[slot] ?? "");
    return base === null ? null : rampFor(base, paper);
  });

  return {
    ink: toRgb24(ink),
    paper: toRgb24(paper),
    depth,
    facet: (slot, index, count) => {
      const ramp = facetRamps[clamp(slot - 1, 0, FACET_SLOT_COUNT - 1)];
      return ramp === null ? depth(1) : ramp(index, count);
    },
    // The mark furthest from the ink end, so a node the lens has nothing to say
    // about recedes without leaving the family the rest of the canvas is in.
    unlabelled: depthRamp[DEPTH_STEPS],
    edgeAlpha: 0.24,
    edgeAlphaUnderLens: 0.08,
    link: toRgb24(ink),
    linkAlpha: 0.34,
  };
}

/**
 * One hue's ramp. Values move in lightness alone: hue is the dimension's, so
 * two values on it must read as siblings rather than as separate answers.
 *
 * The ramp is fitted inside the lightness window that still clears the mark
 * floor rather than run past it and clamped back — clamping is how the pale end
 * of a ramp quietly becomes one colour wearing several meanings.
 */
function rampFor(
  base: Oklch,
  paper: Oklch,
): (index: number, count: number) => number {
  const toward = paper.l >= base.l ? 1 : -1;
  const pale = headroomToward(base, paper, toward);
  const deep = toward > 0 ? base.l - GAMUT_LOW : GAMUT_HIGH - base.l;
  const cache = new Map<string, number>();

  return (index, count) => {
    const key = `${index}/${count}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const wanted = Math.min(VALUE_SPREAD, VALUE_STEP * Math.max(count - 1, 0));
    const up = Math.min(wanted / 2, pale);
    const down = Math.min(wanted - up, Math.max(deep, 0));
    const span = up + down;
    const step = count > 1 ? (index / (count - 1)) * span - down : 0;
    const value = raiseToFloor(
      intoGamut({
        l: clamp(base.l + toward * step, GAMUT_LOW, GAMUT_HIGH),
        c: base.c,
        h: base.h,
      }),
      paper,
      intoGamut(base),
      MARK_FLOOR,
    );
    const rgb = toRgb24(intoGamut(value));
    cache.set(key, rgb);
    return rgb;
  };
}

const GAMUT_LOW = 0.05;
const GAMUT_HIGH = 0.98;

/** How far this hue can move toward the ground before it stops being a mark. */
function headroomToward(base: Oklch, paper: Oklch, toward: number): number {
  const limit = toward > 0 ? GAMUT_HIGH - base.l : base.l - GAMUT_LOW;
  const clears = (offset: number): boolean =>
    contrastRatio(intoGamut({ ...base, l: base.l + toward * offset }), paper) >=
    MARK_FLOOR;
  if (clears(limit)) return limit;
  let lo = 0;
  let hi = limit;
  for (let step = 0; step < 14; step++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
