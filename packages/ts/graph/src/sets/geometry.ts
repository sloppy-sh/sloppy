// The figure a sets reading stands its marks inside: a disc per drawn set,
// sized by the notes carrying its tag and placed so that what two discs share
// is what the two sets share. DESIGN.md § "Sets — the tags as places" is the
// doc of record.
//
// A REGION is a bitmask over the drawn sets: bit `1 << i` is the i-th drawn
// tag, in drawing order, and 0 is outside every one of them.
//
// Nothing here reads a clock or a random number, because two peers holding the
// same notes have to draw the same figure to the last digit.

import { MARK_SCALE_MAX } from "@sloppy/types";
import { LEAF_RADIUS } from "../model.js";
import type { Bounds, Point } from "../viewport.js";

/**
 * How far apart the lattice stands two marks at full zoom, in world units: the
 * widest a leaf mark can be drawn at either side of the gap and a hair over, so
 * no two marks touch however large their authors sized them.
 */
export const SETS_STEP = Math.ceil(LEAF_RADIUS * MARK_SCALE_MAX * 2 + 6);

/** One cell of that lattice, in square world units — what `regionCapacity`
 *  divides a region's area by. */
const SETS_CELL = SETS_STEP * SETS_STEP * (Math.sqrt(3) / 2);

/**
 * The least paper one note's share of a set is drawn on, in square world units,
 * which {@link setsUnitArea} raises for a figure that needs more: three lattice
 * cells rather than one, because a region keeps a whole mark clear of its
 * outline and the fit approximates the overlaps rather than hitting them. At
 * three, a region sized by its own count keeps about twice the room its notes
 * need (`pack.test.ts`), and the slivers where several sets cross fold by
 * capacity as a crowd does anywhere else.
 */
export const SETS_NOTE_AREA = SETS_CELL * 3;

/**
 * The least paper a drawn set is given, in square world units: twelve notes'
 * share at the smallest unit, which is a disc a tag's name fits inside.
 */
export const SETS_SET_LEAST = SETS_NOTE_AREA * 12;

/** The least room the ring outside every set is given, in world units. */
const OUTSIDE_LEAST = SETS_STEP * 3;

/** The grid each region's extent, centre and cover are measured on. */
const GRID = 320;

/** How far inside a set's outline its name is written, in world units. */
const NAME_INSET = 26;

/** Directions a candidate placement is tried in round an already-placed set. */
const FIT_TURNS = 72;

/** The budget the fit spends walking down the overlap error. */
const FIT_STEPS = 160;

/**
 * How far one set reaches into another it shares notes with, at the least, in
 * world units: a lens with room for a mark rather than two outlines grazing.
 * Never asked of a pair whose shared count wants a shallower lens than this.
 */
const MEET_LEAST = SETS_STEP;

/**
 * What a pair that shares notes costs the fit per world unit it stands short of
 * meeting, against an area error counted in notes: high enough that no figure
 * drawing two such sets clear of each other is ever the cheaper one, because
 * two outlines standing clear say the two sets share nothing.
 */
const MEET_WEIGHT = 1e6;

/** How far a step is halved before the fit takes the error it has. */
const FIT_BACKTRACKS = 14;

/** One of the discs a figure is drawn from, in world units relative to the
 *  figure's centre. */
export interface SetsShape {
  cx: number;
  cy: number;
  r: number;
  /** Which way out of its own centre this set's name is written, in radians. */
  nameAt: number;
}

/** One combination of the drawn sets, and the room it has. */
export interface SetsRegion {
  /** The bitmask over the drawn sets; 0 is outside every one of them. */
  id: number;
  /**
   * The point of the region furthest from anything that is not it — where a
   * fold for this region stands, and the point a lattice grows out from.
   */
  centre: Point;
  /** How much of the figure's box the region covers, in square world units. */
  area: number;
  /** What a tap on this region's fold frames. */
  bounds: Bounds;
  /**
   * Axis-aligned rectangles covering the region, one per run of grid cells.
   * What a drop lights: a region is an intersection of discs and has no outline
   * of its own to stroke.
   */
  cover: readonly Bounds[];
}

export interface SetsDiagram {
  shapes: readonly SetsShape[];
  /**
   * Every region the figure actually draws, `0` first and then by rising
   * bitmask. A combination with no area here is a combination the fit left
   * without one, and {@link SetsRegion} says nothing about it — `regionFor` in
   * `pack.ts` is where a note carrying it stands instead.
   */
  regions: readonly SetsRegion[];
  /** The figure's own box: the discs plus the ring outside them. */
  box: Bounds;
}

/**
 * What a field asks its figure for: how many of its notes carry each drawn
 * tag, how many carry each pair of them, and how many carry none.
 */
export interface SetsAsk {
  /** Notes carrying each drawn tag, in drawing order. Its length is how many
   *  sets the figure draws. */
  counts: readonly number[];
  /** Notes carrying both of a pair, at `a * counts.length + b` for every `a`
   *  and `b`. Read above the diagonal alone. */
  shared: readonly number[];
  /** Notes carrying none of the drawn tags, which is the ring's own share. */
  outside: number;
}

/**
 * How much paper one note's share of a set is drawn on, in square world units:
 * the figure's own unit, raised until the FEWEST notes any one of its sets
 * holds reach {@link SETS_SET_LEAST}. Raising the unit of the whole figure
 * rather than flooring the small discs is what keeps every area in the ratio
 * its count is in, so a set another one holds whole is always the narrower of
 * the two and nests inside it with a crescent left for the notes it does not
 * hold.
 */
export function setsUnitArea(counts: readonly number[]): number {
  let least = Number.POSITIVE_INFINITY;
  for (const count of counts) {
    if (count > 0 && count < least) least = count;
  }
  if (!Number.isFinite(least)) return SETS_NOTE_AREA;
  return Math.max(SETS_NOTE_AREA, SETS_SET_LEAST / least);
}

/**
 * How wide each drawn set is drawn, in world units, in drawing order: its own
 * count at the figure's unit, which the narrowest set of the figure raises
 * until it is a disc with its own name in it. Every width is a count, because
 * a field draws a circle for a tag its notes carry and for no other.
 */
export function setsRadii(counts: readonly number[]): number[] {
  const unit = setsUnitArea(counts);
  return counts.map((count) => Math.sqrt((unit * count) / Math.PI));
}

/** How much of each other two discs cover. */
export function lensArea(ra: number, rb: number, apart: number): number {
  const least = Math.min(ra, rb);
  if (apart <= Math.abs(ra - rb)) return Math.PI * least * least;
  if (apart >= ra + rb) return 0;
  const a = Math.acos((apart * apart + ra * ra - rb * rb) / (2 * apart * ra));
  const b = Math.acos((apart * apart + rb * rb - ra * ra) / (2 * apart * rb));
  return (
    ra * ra * (a - Math.sin(a) * Math.cos(a)) +
    rb * rb * (b - Math.sin(b) * Math.cos(b))
  );
}

/** How far apart two discs stand to cover `area` of each other: the widest such
 *  distance, so two sets one of which holds the other draw as tangent inside
 *  rather than concentric. */
export function lensDistance(ra: number, rb: number, area: number): number {
  const least = Math.min(ra, rb);
  if (area >= Math.PI * least * least) return Math.abs(ra - rb);
  if (area <= 0) return ra + rb;
  let lo = Math.abs(ra - rb);
  let hi = ra + rb;
  for (let step = 0; step < 48; step++) {
    const mid = (lo + hi) / 2;
    if (lensArea(ra, rb, mid) >= area) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The figure a field's own notes draw, held against the ask it was measured
 *  from: a zoom repacks the marks without moving a disc. */
export function setsFigure(ask: SetsAsk): SetsDiagram {
  const key = `${ask.counts.join(",")}|${ask.shared.join(",")}|${ask.outside}`;
  const found = held.get(key);
  if (found !== undefined) return found;
  const made = measure(fitShapes(ask), ask.outside, setsUnitArea(ask.counts));
  // Every write into a note is a new ask, so what is held has to be bounded.
  if (held.size >= FIGURES_HELD) {
    for (const stale of [...held.keys()].slice(
      0,
      held.size - FIGURES_HELD + 1,
    )) {
      held.delete(stale);
    }
  }
  held.set(key, made);
  return made;
}

/** Room for every field a canvas draws at once, and for the ask each of them
 *  had before the last write. */
const FIGURES_HELD = 16;

const held = new Map<string, SetsDiagram>();

/** Whether a point is inside one disc. */
export function inShape(shape: SetsShape, at: Point): boolean {
  const dx = at.x - shape.cx;
  const dy = at.y - shape.cy;
  return dx * dx + dy * dy <= shape.r * shape.r;
}

/** The region a point stands in, as a bitmask over `shapes`. */
export function regionAt(shapes: readonly SetsShape[], at: Point): number {
  let mask = 0;
  for (const [bit, shape] of shapes.entries()) {
    if (inShape(shape, at)) mask |= 1 << bit;
  }
  return mask;
}

/** Whether a point is inside the box a figure's regions are measured over. */
export function inBox(box: Bounds, at: Point): boolean {
  return (
    at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY
  );
}

/** Where one set's name is written: the point its outline reaches at
 *  {@link SetsShape.nameAt}, pulled inside by {@link NAME_INSET}. */
export function namePoint(shape: SetsShape): Point {
  const reach = Math.max(shape.r - NAME_INSET, 0);
  return {
    x: shape.cx + reach * Math.cos(shape.nameAt),
    y: shape.cy + reach * Math.sin(shape.nameAt),
  };
}

/** The box one disc fills, in figure coordinates — what holds a set's name
 *  inside the set it names. */
export function shapeBounds(shape: SetsShape): Bounds {
  return {
    minX: shape.cx - shape.r,
    maxX: shape.cx + shape.r,
    minY: shape.cy - shape.r,
    maxY: shape.cy + shape.r,
  };
}

/** One disc's outline as a closed run of points, which is how it is drawn. */
export function shapeOutline(shape: SetsShape, steps = 180): Point[] {
  return Array.from({ length: steps }, (_unused, step) => {
    const turn = (step / steps) * Math.PI * 2;
    return {
      x: shape.cx + shape.r * Math.cos(turn),
      y: shape.cy + shape.r * Math.sin(turn),
    };
  });
}

/**
 * How much of each other two sets are asked to cover, in square world units:
 * the paper their shared notes ask for, so the lens says what the shared count
 * says. Every set is drawn at the same unit, so a set every note of which
 * carries the other asks for exactly the smaller disc and nests whole.
 */
function targetAreas(ask: SetsAsk, unit: number): number[] {
  const count = ask.counts.length;
  const target = new Array<number>(count * count).fill(0);
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const want = (ask.shared[a * count + b] ?? 0) * unit;
      target[a * count + b] = want;
      target[b * count + a] = want;
    }
  }
  return target;
}

/** The discs a field's ask draws, placed and then walked down the error in the
 *  overlaps they ask for. */
function fitShapes(ask: SetsAsk): SetsShape[] {
  const count = ask.counts.length;
  const unit = setsUnitArea(ask.counts);
  const radii = setsRadii(ask.counts);
  const target = targetAreas(ask, unit);
  const apart = target.map((area, at) =>
    lensDistance(radii[Math.floor(at / count)], radii[at % count], area),
  );
  const meet = meetBy(radii, target, apart, count);
  const at = settle(
    radii,
    target,
    meet,
    place(radii, apart, meet, count),
    count,
    unit,
  );
  return named(radii, at);
}

/**
 * How close two sets have to stand for the figure to say they share notes: the
 * distance their shared count asks for, or {@link MEET_LEAST} deep into each
 * other, whichever is the further apart of the two — so a pair sharing one note
 * is not dragged deeper than its count. A pair sharing nothing is unbounded:
 * what holds those apart is the area they are asked to cover, which is none.
 */
function meetBy(
  radii: readonly number[],
  target: readonly number[],
  apart: readonly number[],
  count: number,
): number[] {
  return target.map((area, at) => {
    const a = Math.floor(at / count);
    const b = at % count;
    if (a === b || area <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(apart[at], radii[a] + radii[b] - MEET_LEAST);
  });
}

/**
 * Where each disc starts: the widest first at the origin, and each next one at
 * whichever candidate meets the most of the sets it shares notes with and then
 * stands nearest the distances it is asked to keep. Candidates are taken round
 * each placed disc at the distance this one wants from it, and where two of
 * those circles cross.
 */
function place(
  radii: readonly number[],
  apart: readonly number[],
  meet: readonly number[],
  count: number,
): Point[] {
  const order = radii
    .map((_unused, at) => at)
    .sort((a, b) => radii[b] - radii[a] || a - b);
  const at = order.map(() => ({ x: 0, y: 0 }));
  const placed: number[] = [];
  for (const which of order) {
    if (placed.length === 0) {
      placed.push(which);
      continue;
    }
    const wants = (other: number): number => apart[which * count + other];
    const tries: Point[] = [];
    for (const other of placed) {
      const reach = wants(other);
      for (let turn = 0; turn < FIT_TURNS; turn++) {
        const angle = (turn / FIT_TURNS) * Math.PI * 2;
        tries.push({
          x: at[other].x + reach * Math.cos(angle),
          y: at[other].y + reach * Math.sin(angle),
        });
      }
    }
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        tries.push(
          ...crossings(
            at[placed[a]],
            wants(placed[a]),
            at[placed[b]],
            wants(placed[b]),
          ),
        );
      }
    }
    const scored = tries.map((point) => {
      let error = 0;
      let clear = 0;
      for (const other of placed) {
        const away = Math.hypot(point.x - at[other].x, point.y - at[other].y);
        const off = away - wants(other);
        error += off * off;
        if (away > meet[which * count + other]) clear += 1;
      }
      return { point, clear, error };
    });
    scored.sort(
      (a, b) =>
        a.clear - b.clear ||
        a.error - b.error ||
        a.point.x - b.point.x ||
        a.point.y - b.point.y,
    );
    at[which] = scored[0].point;
    placed.push(which);
  }
  return at;
}

/** Where two circles cross, which is empty where they do not. */
function crossings(a: Point, ra: number, b: Point, rb: number): Point[] {
  const apart = Math.hypot(b.x - a.x, b.y - a.y);
  if (apart <= 1e-9 || apart > ra + rb || apart < Math.abs(ra - rb)) return [];
  const along = (apart * apart + ra * ra - rb * rb) / (2 * apart);
  const across = ra * ra - along * along;
  if (across < 0) return [];
  const off = Math.sqrt(across);
  const ux = (b.x - a.x) / apart;
  const uy = (b.y - a.y) / apart;
  const mx = a.x + along * ux;
  const my = a.y + along * uy;
  return [
    { x: mx - off * uy, y: my + off * ux },
    { x: mx + off * uy, y: my - off * ux },
  ];
}

/**
 * The placement walked down the sum of squared overlap-area errors, counted in
 * notes so the fit minimises the number a reader is looking at, with a pair
 * that shares notes and stands short of meeting weighted far above that. A
 * fixed budget of steps, each a halving search along the numerical gradient
 * that takes the first step which lowers the error: monotone, bounded, the same
 * on every peer. The meeting term is a distance and the area term an area, so
 * two sets drawn clear of each other are pulled together from a tangency the
 * area term alone has no slope at.
 */
function settle(
  radii: readonly number[],
  target: readonly number[],
  meet: readonly number[],
  from: readonly Point[],
  count: number,
  unit: number,
): Point[] {
  if (count < 2) return [...from];
  const scale = radii.reduce((sum, r) => sum + r, 0) / count;
  const nudge = scale * 1e-3;
  const errorAt = (coords: readonly number[]): number => {
    let sum = 0;
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        const apart = Math.hypot(
          coords[a * 2] - coords[b * 2],
          coords[a * 2 + 1] - coords[b * 2 + 1],
        );
        const off =
          (lensArea(radii[a], radii[b], apart) - target[a * count + b]) / unit;
        sum += off * off;
        const short = apart - meet[a * count + b];
        if (short > 0) sum += (MEET_WEIGHT * short) / scale;
      }
    }
    return sum;
  };

  let coords = from.flatMap((point) => [point.x, point.y]);
  let error = errorAt(coords);
  let reach = scale;
  for (let step = 0; step < FIT_STEPS; step++) {
    const slope = coords.map((_unused, which) => {
      const up = [...coords];
      const down = [...coords];
      up[which] += nudge;
      down[which] -= nudge;
      return (errorAt(up) - errorAt(down)) / (2 * nudge);
    });
    const length = Math.hypot(...slope);
    if (!(length > 0)) break;
    let taken = false;
    for (let back = 0; back < FIT_BACKTRACKS; back++) {
      const next = coords.map(
        (value, which) => value - (reach * slope[which]) / length,
      );
      const after = errorAt(next);
      if (after < error) {
        coords = next;
        error = after;
        taken = true;
        break;
      }
      reach /= 2;
    }
    if (!taken) break;
    reach *= 1.6;
  }
  return Array.from({ length: count }, (_unused, at) => ({
    x: coords[at * 2],
    y: coords[at * 2 + 1],
  }));
}

/**
 * The discs with each one's name pointed out of the figure, so a name lands on
 * the part of its own disc the others are least likely to be over. A disc on
 * the figure's own middle has no way out, and takes its turn round the compass
 * instead.
 */
function named(radii: readonly number[], at: readonly Point[]): SetsShape[] {
  const count = radii.length;
  const mx = at.reduce((sum, point) => sum + point.x, 0) / Math.max(count, 1);
  const my = at.reduce((sum, point) => sum + point.y, 0) / Math.max(count, 1);
  return radii.map((r, which) => {
    const dx = at[which].x - mx;
    const dy = at[which].y - my;
    const away = Math.hypot(dx, dy);
    return {
      cx: at[which].x,
      cy: at[which].y,
      r,
      nameAt:
        away > 1e-6
          ? Math.atan2(dy, dx)
          : -Math.PI / 2 + (which / count) * Math.PI * 2,
    };
  });
}

/**
 * Every region of a figure, measured on {@link GRID}: which cells stand in
 * each, where each one's deepest point is, and the runs of cells that cover it.
 */
function measure(
  shapes: readonly SetsShape[],
  outside: number,
  unit: number,
): SetsDiagram {
  const { box, margin } = boxAround(shapes, outside, unit);
  const stepX = (box.maxX - box.minX) / GRID;
  const stepY = (box.maxY - box.minY) / GRID;
  const centreOf = (gx: number, gy: number): Point => ({
    x: box.minX + (gx + 0.5) * stepX,
    y: box.minY + (gy + 0.5) * stepY,
  });

  const mask = new Int32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      mask[gy * GRID + gx] = regionAt(shapes, centreOf(gx, gy));
    }
  }

  const depth = depthWithin(mask);
  const regions = new Map<number, Mutable>();
  for (let gy = 0; gy < GRID; gy++) {
    let runFrom = -1;
    let runId = -1;
    const close = (until: number): void => {
      if (runFrom < 0) return;
      const found = open(regions, runId);
      found.cells += until - runFrom;
      found.cover.push({
        minX: box.minX + runFrom * stepX,
        maxX: box.minX + until * stepX,
        minY: box.minY + gy * stepY,
        maxY: box.minY + (gy + 1) * stepY,
      });
      runFrom = -1;
    };
    for (let gx = 0; gx < GRID; gx++) {
      const id = mask[gy * GRID + gx];
      if (id !== runId) {
        close(gx);
        runId = id;
        runFrom = gx;
      }
      const found = open(regions, id);
      const at = depth[gy * GRID + gx];
      if (at > found.deepest) {
        found.deepest = at;
        found.centre = centreOf(gx, gy);
      }
    }
    close(GRID);
  }

  // The deepest point of the ring outside every set is whichever of its corners
  // came out widest, and the notes standing outside read better under the
  // figure than in a corner of it — so that region alone is given its place.
  const ring = regions.get(0);
  if (ring !== undefined && shapes.length > 0) {
    ring.centre = {
      x: (box.minX + box.maxX) / 2,
      y: box.maxY - margin / 2,
    };
  }

  return {
    shapes,
    box,
    regions: [...regions.keys()]
      .sort((a, b) => a - b)
      .map((id) => {
        const found = regions.get(id) as Mutable;
        return {
          id,
          centre: found.centre,
          area: found.cells * stepX * stepY,
          bounds: coveredBy(found.cover),
          cover: found.cover,
        };
      }),
  };
}

interface Mutable {
  cells: number;
  deepest: number;
  centre: Point;
  cover: Bounds[];
}

function open(regions: Map<number, Mutable>, id: number): Mutable {
  let found = regions.get(id);
  if (found === undefined) {
    found = { cells: 0, deepest: -1, centre: { x: 0, y: 0 }, cover: [] };
    regions.set(id, found);
  }
  return found;
}

/**
 * How far each cell stands from anything that is not its own region, in cells —
 * a chamfer pass, so the deepest cell of a region is found in one walk of the
 * grid rather than by measuring every cell against every other.
 */
function depthWithin(mask: Int32Array): Float32Array {
  const far = GRID * 2;
  const depth = new Float32Array(GRID * GRID).fill(far);
  const near = Math.SQRT2;

  const seed = (gx: number, gy: number): boolean => {
    if (gx === 0 || gy === 0 || gx === GRID - 1 || gy === GRID - 1) return true;
    const id = mask[gy * GRID + gx];
    return (
      mask[gy * GRID + gx - 1] !== id ||
      mask[gy * GRID + gx + 1] !== id ||
      mask[(gy - 1) * GRID + gx] !== id ||
      mask[(gy + 1) * GRID + gx] !== id
    );
  };
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if (seed(gx, gy)) depth[gy * GRID + gx] = 0;
    }
  }

  const reach = (at: number, from: number, step: number, ok: boolean): void => {
    if (!ok) return;
    const through = depth[from] + step;
    if (through < depth[at]) depth[at] = through;
  };
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const at = gy * GRID + gx;
      reach(at, at - 1, 1, gx > 0);
      reach(at, at - GRID, 1, gy > 0);
      reach(at, at - GRID - 1, near, gx > 0 && gy > 0);
      reach(at, at - GRID + 1, near, gx < GRID - 1 && gy > 0);
    }
  }
  for (let gy = GRID - 1; gy >= 0; gy--) {
    for (let gx = GRID - 1; gx >= 0; gx--) {
      const at = gy * GRID + gx;
      reach(at, at + 1, 1, gx < GRID - 1);
      reach(at, at + GRID, 1, gy < GRID - 1);
      reach(at, at + GRID + 1, near, gx < GRID - 1 && gy < GRID - 1);
      reach(at, at + GRID - 1, near, gx > 0 && gy < GRID - 1);
    }
  }
  return depth;
}

/**
 * The figure's box, and how wide the ring round the discs came out: the notes
 * carrying none of the drawn tags are given the same room per note the sets
 * themselves are drawn at.
 */
function boxAround(
  shapes: readonly SetsShape[],
  outside: number,
  unit: number,
): { box: Bounds; margin: number } {
  const want = unit * Math.max(outside, 0);
  if (shapes.length === 0) {
    const half = Math.max(Math.sqrt(want) / 2, OUTSIDE_LEAST);
    return {
      box: { minX: -half, maxX: half, minY: -half, maxY: half },
      margin: half,
    };
  }
  const reach = shapes.map(shapeBounds);
  const minX = Math.min(...reach.map((at) => at.minX));
  const maxX = Math.max(...reach.map((at) => at.maxX));
  const minY = Math.min(...reach.map((at) => at.minY));
  const maxY = Math.max(...reach.map((at) => at.maxY));
  // The ring's own area over the span it wraps: 4m² + 2m(w + h) = want.
  const span = maxX - minX + (maxY - minY);
  const grown = (-span + Math.sqrt(span * span + 4 * want)) / 4;
  const margin = Math.max(grown, OUTSIDE_LEAST);
  return {
    box: {
      minX: minX - margin,
      maxX: maxX + margin,
      minY: minY - margin,
      maxY: maxY + margin,
    },
    margin,
  };
}

function coveredBy(cover: readonly Bounds[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const at of cover) {
    minX = Math.min(minX, at.minX);
    maxX = Math.max(maxX, at.maxX);
    minY = Math.min(minY, at.minY);
    maxY = Math.max(maxY, at.maxY);
  }
  return { minX, maxX, minY, maxY };
}
