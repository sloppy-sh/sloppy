// Where the ground's lattice falls for a viewport, and how heavily it is inked.
// DESIGN.md § "The ground" is the doc of record — it is paper, not a feature, so
// it carries no hue and never a weight of its own. `ground-layer.ts` draws it.

export const GRAPH_GROUNDS = ["none", "dots", "lines"] as const;
export type GraphGround = (typeof GRAPH_GROUNDS)[number];

/** A ground there is something to draw for. */
export type Paper = Exclude<GraphGround, "none">;

/** Screen pixels the lattice never draws closer together than. Below it the
 *  world period doubles, which is what keeps a field of thousands of marks off
 *  a moiré ground. */
export const GROUND_MIN_STEP = 32;

/** The tightest cut of the pattern's cell, in CSS pixels: two lattice steps, so
 *  one cell carries the point the coarse lattice keeps and the three the fine
 *  one adds. */
export const CELL = GROUND_MIN_STEP * 2;

/**
 * Cuts of the pattern per kind, one per band of the octave the lattice's period
 * opens across. A tiled fill's scale would otherwise carry the mark's size along
 * with that period, so each cut holds the same mark in a wider cell instead, and
 * a fill is laid down at {@link GroundTiling.mark} — about 1:1.
 */
export const STAMPS = 8;

/** Ink's share. A dot covers a small fraction of what a rule does, so it takes
 *  more of it to read as the same weight of ground. */
const ALPHA: Record<Paper, number> = {
  dots: 0.28,
  lines: 0.1,
};

/** How the ground's ink grows as its period closes: a lattice of points
 *  quadruples its count over the band, a ruled one doubles its length. The
 *  half-step marks fade in at exactly that rate, which is what holds the ink
 *  flat across the band and through the doubling that ends it. */
const SPREAD: Record<Paper, number> = {
  dots: 2,
  lines: 1,
};

export interface GroundTiling {
  /** The cell's side on screen, in CSS pixels: two lattice steps. */
  cell: number;
  /** Where the cell holding the world origin starts on screen. */
  offsetX: number;
  offsetY: number;
  /** How much of the half-step lattice is drawn, 0 to 1. */
  fine: number;
  /** Which cut of the pattern the fills are taken from, 0 to {@link STAMPS} - 1. */
  stamp: number;
  /** What the tiled fill is scaled by, and so what a mark comes out at as a
   *  multiple of its drawn size: one, but for the width of a band. */
  mark: number;
  /** The alpha the lattice is drawn at. Ink is alpha over area, and a cut leaves
   *  the mark a few percent off the size it is drawn at, so taking that back out
   *  of the alpha is what makes the ground's weight the same at every scale
   *  rather than merely close to it. */
  weight: number;
}

/**
 * Where the lattice falls for a viewport, in screen coordinates. `cell` stays
 * within [2, 4) × {@link GROUND_MIN_STEP} at every scale, which is the whole of
 * the aliasing guarantee.
 */
export function groundTiling(
  x: number,
  y: number,
  scale: number,
  kind: Paper,
): GroundTiling {
  const step = 2 ** Math.ceil(Math.log2(GROUND_MIN_STEP / scale)) * scale;
  const cell = step * 2;
  // Sweeps [1, 2): the period doubles the moment it would leave that band.
  const open = cell / CELL;
  const stamp = Math.min(
    STAMPS - 1,
    Math.max(0, Math.floor(Math.log2(open) * STAMPS)),
  );
  const spread = SPREAD[kind];
  const mark = open / stampScale(stamp);
  return {
    cell,
    offsetX: wrap(x - cell / 4, cell),
    offsetY: wrap(y - cell / 4, cell),
    fine: (open ** spread - 1) / (2 ** spread - 1),
    stamp,
    mark,
    weight: ALPHA[kind] / mark ** spread,
  };
}

/** How much wider a cut's cell is than the tightest: the middle of the band it
 *  covers, so a fill drawn from it is scaled by at most half a band. */
export function stampScale(stamp: number): number {
  return 2 ** ((stamp + 0.5) / STAMPS);
}

function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}
