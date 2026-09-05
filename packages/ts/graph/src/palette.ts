// The canvas's colours as numbers. DESIGN.md § "The graph's colour language" is
// the doc of record: lightness carries depth, hue carries the tags the reader
// selected, and form — which `scene.ts` draws — carries provenance.
//
// The tokens are `app.css`'s. Nothing here holds a copy of one: a slot that does
// not resolve draws in the depth ramp instead, so a theme that has not loaded
// yet renders the graph monochrome rather than in a palette this file invented.

import { TAG_HUE_SLOTS, type TagHueSlot } from "@sloppy/types";
import {
  apart,
  clamp,
  contrastRatio,
  fromSrgb8,
  intoGamut,
  mixOklab,
  type Oklch,
  parseCssColor,
  raiseToFloor,
  shadeToFloor,
  toRgb24,
  toSrgb8,
} from "./color.js";

/** DESIGN.md § Lightness bounds the ramp here; deeper collapses anyway. */
export const DEPTH_STEPS = 6;

/** DESIGN.md § "Contrast is measured": a node fill carries meaning alone. */
export const MARK_FLOOR = 3;

/** The floor small text owes, which on this canvas is the address and title
 *  beside a mark — DESIGN.md § "Contrast is measured". */
export const LABEL_FLOOR = 4.5;

/** The share of what tells the tag slots apart that a ground must leave them —
 *  DESIGN.md § "The wallpaper", where the number is argued. */
export const SLOTS_KEPT = 0.9;

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
  /** What a person put together — `links` and `references` alike — drawn above
   *  the tree because it crosses it. DESIGN.md § Edges. */
  connection: number;
  connectionAlpha: number;
  /** Under {@link runAlphaWhileSelecting} and over
   *  {@link edgeAlphaWhileSelecting}: a zoom clamps the three widths together,
   *  and the order is what is left to tell the solid lines apart. */
  connectionAlphaWhileSelecting: number;
}

const TOKENS = [
  "--graph-ink",
  "--graph-paper",
  ...TAG_HUE_SLOTS.map((slot) => `--facet-${slot}`),
];

/** Read the theme's graph tokens off an element. Call this on theme change and
 *  cache what it returns — DESIGN.md § Lightness says why, and `scene.ts` is
 *  what would otherwise pay for it every frame. */
export function readPaletteTokens(element: Element): PaletteTokens {
  const computed = getComputedStyle(element);
  const [ink, paper, ...hues] = TOKENS.map((token) =>
    computed.getPropertyValue(token),
  );
  return { ink, paper, hues };
}

export function readPalette(element: Element, presence = 0): GraphPalette {
  return buildPalette(readPaletteTokens(element), presence);
}

/**
 * The grounds a picture at `presence` can put under a mark: the theme's paper
 * with the darkest and the lightest pixel a picture may hold showing through
 * it. Mixed on the bytes, which is where a screen lays the scrim over the
 * picture. `presence` 0 is the plain theme — one ground, the paper itself.
 */
export function groundBand(paper: Oklch, presence: number): readonly Oklch[] {
  if (presence <= 0) return [paper];
  const bytes = toSrgb8(paper);
  const showing = (pixel: number): Oklch =>
    fromSrgb8(bytes.map((c) => c * (1 - presence) + pixel * presence));
  return [showing(0), showing(255)];
}

/** Strengths the ceiling is walked up in, before it refines the one that gave. */
const CEILING_STEPS = 50;

/**
 * How much of a picture this ground can carry, 0–1. Two things end it — the ink
 * the canvas letters in falling under {@link LABEL_FLOOR} over the worst pixel a
 * picture may hold, and the tag slots closing to {@link SLOTS_KEPT} of what
 * tells them apart on the plain theme — and this is whichever comes first.
 * `wallpaper.test.ts` holds both, and every mark above {@link MARK_FLOOR}.
 *
 * DESIGN.md § "The wallpaper" is the doc of record.
 */
export function paperCeiling(tokens: PaletteTokens): number {
  const ink = parseCssColor(tokens.ink) ?? UNTHEMED_INK;
  const paper = parseCssColor(tokens.paper) ?? UNTHEMED_PAPER;
  const away = ink.l < paper.l ? 0 : 1;
  const plain = separation(shadedSlots(tokens.hues, [paper], away));
  const holds = (presence: number): boolean => {
    const band = groundBand(paper, presence);
    return (
      band.every((ground) => contrastRatio(ink, ground) >= LABEL_FLOOR) &&
      separation(shadedSlots(tokens.hues, band, away)) >= plain * SLOTS_KEPT
    );
  };
  if (!holds(0)) return 0;

  // Walked up rather than bisected: what a picture costs the slots steps rather
  // than crosses cleanly, so a stronger picture can land back over the line. The
  // ceiling is the first strength that gives, not the last one that holds.
  let lo = 0;
  let hi = 1;
  for (let step = 1; step <= CEILING_STEPS; step++) {
    const at = step / CEILING_STEPS;
    if (!holds(at)) {
      hi = at;
      break;
    }
    lo = at;
  }
  if (lo === hi) return lo;

  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (holds(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The colour each slot draws in over `ground` — its own hue, moved in
 *  lightness alone until it clears {@link MARK_FLOOR}, as the canvas hands it
 *  over. `null` where the theme has no such token. */
function shadedSlots(
  hues: readonly string[],
  ground: readonly Oklch[],
  away: number,
): (Oklch | null)[] {
  return TAG_HUE_SLOTS.map((_, at) => {
    const token = parseCssColor(hues[at] ?? "");
    if (token === null) return null;
    const shaded = shadeToFloor(intoGamut(token), ground, away, MARK_FLOOR);
    return fromSrgb8(toSrgb8(shaded));
  });
}

/** The closest two slots, which is what says the eight are still eight.
 *  Infinite where fewer than two of them resolve. */
function separation(slots: readonly (Oklch | null)[]): number {
  const drawn = slots.filter((slot): slot is Oklch => slot !== null);
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      closest = Math.min(closest, apart(drawn[i], drawn[j]));
    }
  }
  return closest;
}

export interface PaletteTokens {
  ink: string;
  paper: string;
  /** `--facet-1 …`, in {@link TAG_HUE_SLOTS} order. */
  hues: readonly string[];
}

/**
 * {@link readPalette} without a DOM, so the ramp is testable.
 *
 * `presence` is how much of a picture is showing under the field — 0 is the
 * plain theme. Above it the floors are measured against the band that picture
 * can make rather than against the paper alone, so what is drawn stays legible
 * on the ground it is actually on; DESIGN.md § "The wallpaper" says what that
 * costs the depth ramp, and {@link paperCeiling} is what bounds it.
 */
export function buildPalette(
  tokens: PaletteTokens,
  presence = 0,
): GraphPalette {
  const ink = parseCssColor(tokens.ink) ?? UNTHEMED_INK;
  const paper = parseCssColor(tokens.paper) ?? UNTHEMED_PAPER;
  const ground = groundBand(paper, presence);
  // The lightness a slot moves toward to clear its floor: away from the paper,
  // so a light theme's marks darken and a dark theme's lighten.
  const away = ink.l < paper.l ? 0 : 1;

  const generations = Array.from({ length: DEPTH_STEPS + 1 }, (_, step) =>
    raiseToFloor(
      mixOklab(ink, paper, step / (DEPTH_STEPS + 1)),
      ground,
      ink,
      MARK_FLOOR,
    ),
  );
  const depthRamp = generations.map(toRgb24);
  const depth = (at: number): number =>
    depthRamp[clamp(Math.round(at) - 1, 0, DEPTH_STEPS)];

  // A slot moves in lightness alone: the hue IS the reader's question, and eight
  // of them pulled toward one anchor converge into one answer.
  const slotColours = shadedSlots(tokens.hues, ground, away);
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
    connection: inkRgb,
    connectionAlpha: 0.34,
    connectionAlphaWhileSelecting: 0.12,
  };
}
