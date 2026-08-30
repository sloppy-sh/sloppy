// The canvas's colours as numbers. DESIGN.md § "The graph's colour language" is
// the doc of record: lightness carries depth, hue carries the tags the reader
// selected, and form — which `scene.ts` draws — carries provenance.
//
// The tokens are `app.css`'s. Nothing here holds a copy of one: a slot that does
// not resolve draws in the depth ramp instead, so a theme that has not loaded
// yet renders the graph monochrome rather than in a palette this file invented.

import { TAG_HUE_SLOTS, type TagHueSlot } from "@sloppy/types";
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

const UNTHEMED_INK: Oklch = { l: 0.15, c: 0, h: 0 };
const UNTHEMED_PAPER: Oklch = { l: 1, c: 0, h: 0 };

export interface GraphPalette {
  ink: number;
  paper: number;
  /** Genealogical fill for a node `depth` deep, a root being 1. */
  depth(depth: number): number;
  /**
   * The hue a selected tag borrows, straight off the token a chip draws in —
   * so the rail's legend and the canvas cannot disagree. `token-contrast.test.ts`
   * in `@sloppy/ui` is what holds every slot above {@link MARK_FLOOR}.
   */
  tag(slot: TagHueSlot): number;
  /**
   * The ring a look draws inside a mark filled `fill`: whichever of ink and
   * paper stands out against it, so a look is never lost in its own mark.
   *
   * Answers the fills {@link depth} and {@link tag} hand out, plus {@link paper}
   * for a mark drawn hollow; any other fill is answered in ink.
   */
  lookRing(fill: number): number;
  /**
   * Genealogical edges draw {@link depth} at these alphas — DESIGN.md § Edges,
   * which dims them further while tags are selected.
   */
  edgeAlpha: number;
  edgeAlphaWhileSelecting: number;
  /** A note carrying none of the selected tags: its own fill, receded. */
  unselectedAlpha: number;
  /**
   * The run of consecutive addresses — DESIGN.md § Edges makes it the heaviest
   * line on the canvas, and dims it with the tree while tags are selected.
   */
  run: number;
  runAlpha: number;
  runAlphaWhileSelecting: number;
  /** Associative links, drawn above the tree because they cross it. */
  link: number;
  linkAlpha: number;
}

const TOKENS = [
  "--graph-ink",
  "--graph-paper",
  ...TAG_HUE_SLOTS.map((slot) => `--facet-${slot}`),
];

/**
 * Read the theme's graph tokens off an element and convert them once.
 *
 * Call this on theme change and cache what it returns — DESIGN.md § Lightness
 * says why, and `scene.ts` is what would otherwise pay for it every frame.
 */
export function readPalette(element: Element): GraphPalette {
  const computed = getComputedStyle(element);
  const [ink, paper, ...hues] = TOKENS.map((token) =>
    computed.getPropertyValue(token),
  );
  return buildPalette({ ink, paper, hues });
}

export interface PaletteTokens {
  ink: string;
  paper: string;
  /** `--facet-1 …`, in {@link TAG_HUE_SLOTS} order. */
  hues: readonly string[];
}

/** {@link readPalette} without a DOM, so the ramp is testable. */
export function buildPalette(tokens: PaletteTokens): GraphPalette {
  const ink = parseCssColor(tokens.ink) ?? UNTHEMED_INK;
  const paper = parseCssColor(tokens.paper) ?? UNTHEMED_PAPER;

  const generations = Array.from({ length: DEPTH_STEPS + 1 }, (_, step) =>
    raiseToFloor(
      mixOklab(ink, paper, step / (DEPTH_STEPS + 1)),
      paper,
      ink,
      MARK_FLOOR,
    ),
  );
  const depthRamp = generations.map(toRgb24);
  const depth = (at: number): number =>
    depthRamp[clamp(Math.round(at) - 1, 0, DEPTH_STEPS)];

  const slotColours = TAG_HUE_SLOTS.map((_, at) => {
    const token = parseCssColor(tokens.hues[at] ?? "");
    return token === null ? null : intoGamut(token);
  });
  const hues = slotColours.map((slot) =>
    slot === null ? null : toRgb24(slot),
  );

  const inkRgb = toRgb24(ink);
  const paperRgb = toRgb24(paper);
  const rings = new Map<number, number>();
  for (const fill of [...generations, ...slotColours, paper]) {
    if (fill === null) continue;
    rings.set(
      toRgb24(fill),
      contrastRatio(ink, fill) >= contrastRatio(paper, fill)
        ? inkRgb
        : paperRgb,
    );
  }

  return {
    ink: inkRgb,
    paper: paperRgb,
    depth,
    tag: (slot) => hues[clamp(slot - 1, 0, hues.length - 1)] ?? depth(1),
    lookRing: (fill) => rings.get(fill) ?? inkRgb,
    edgeAlpha: 0.24,
    edgeAlphaWhileSelecting: 0.08,
    unselectedAlpha: 0.34,
    run: inkRgb,
    runAlpha: 0.55,
    runAlphaWhileSelecting: 0.18,
    link: inkRgb,
    linkAlpha: 0.34,
  };
}
