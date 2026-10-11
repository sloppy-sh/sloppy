// The diagrams a sets reading stands its marks inside. DESIGN.md § "Sets — the
// tags as places" is the doc of record.
//
// The SHAPE is fixed — circles for one, two and three drawn sets, and four
// ellipses in Venn's own construction for four, which is the fewest shapes that
// still show all fifteen overlaps — and the size answers the count of notes on
// the field ({@link setsGrowth}), so two devices reading the same selection of
// the same notes draw the same figure.
//
// A REGION is one combination of the drawn sets, written as a bitmask over them:
// bit `1 << i` is the i-th drawn tag, in selection order, and 0 is the region
// outside every one of them. Everything a region needs beyond that bitmask —
// where a fold stands in it, what a tap on it frames, and the rectangles that
// cover it — is measured on a fixed grid, so it is the same on every peer.

import { DRAWN_SETS_MOST } from "../contract.js";
import type { Bounds, Point } from "../viewport.js";

/** How far a diagram reaches from its centre, in world units. Wide enough that
 *  the smallest of the fifteen regions still holds a run of marks. */
export const SETS_REACH = 900;

/** How far outside the shapes a diagram's own box reaches, as a share of
 *  {@link SETS_REACH}: the room the notes outside every drawn set stand in. */
const OUTSIDE_MARGIN = 0.5;

/** The grid each region's extent, centre and cover are measured on, walked once
 *  per count of drawn sets. */
const GRID = 384;

/** How far inside a set's outline its name is written, in world units. */
const NAME_INSET = 26;

/**
 * One of the shapes a diagram is drawn from, in world units relative to the
 * diagram's centre. A circle is an ellipse whose radii agree.
 */
export interface SetsShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Radians, counter-clockwise. */
  rotation: number;
  /**
   * Where this set's name is written, as the ellipse parameter it sits at —
   * declared with the construction rather than worked out, because which tip of
   * a leaning ellipse reads as its outer edge is a fact about the figure.
   */
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
  /** How much of the diagram's box the region covers, in square world units. */
  area: number;
  /** What a tap on this region's fold frames. */
  bounds: Bounds;
  /**
   * Axis-aligned rectangles covering the region, one per run of grid cells.
   * What a drop lights: a region is an intersection of ellipses and has no
   * outline of its own to stroke.
   */
  cover: readonly Bounds[];
}

export interface SetsDiagram {
  shapes: readonly SetsShape[];
  /** Every region, `0` first and then by rising bitmask. */
  regions: readonly SetsRegion[];
  /** The diagram's own box: the shapes plus the room outside them. */
  box: Bounds;
}

/**
 * The notes a figure holds at its own size. Past it the whole figure is drawn
 * larger rather than packed tighter, so a region's room grows with the notes it
 * is asked to hold — DESIGN.md § "Sets — the tags as places".
 */
export const SETS_FITS = 150;

/** How much larger than its own size a field of `notes` notes draws its figure:
 *  the square root of its share of {@link SETS_FITS}, so four times the notes is
 *  twice the figure and four times the room. */
export function setsGrowth(notes: number): number {
  return notes <= SETS_FITS ? 1 : Math.sqrt(notes / SETS_FITS);
}

/**
 * The diagram for `count` drawn sets — 0 drawing no shape at all, one region,
 * and every note standing outside — on a field of `notes` notes, which is what
 * {@link setsGrowth} draws it at. Measured once per count and held; growing a
 * measurement is a multiplication over what it already said.
 */
export function setsDiagram(count: number, notes = 0): SetsDiagram {
  const at = Math.min(Math.max(Math.round(count), 0), DRAWN_SETS_MOST);
  return grownBy((held[at] ??= measure(SHAPES[at])), setsGrowth(notes));
}

const held: (SetsDiagram | undefined)[] = [];

/** `diagram` drawn `factor` times its own size about its centre. */
function grownBy(diagram: SetsDiagram, factor: number): SetsDiagram {
  if (factor === 1) return diagram;
  const point = (at: Point): Point => ({ x: at.x * factor, y: at.y * factor });
  const box = (at: Bounds): Bounds => ({
    minX: at.minX * factor,
    maxX: at.maxX * factor,
    minY: at.minY * factor,
    maxY: at.maxY * factor,
  });
  return {
    shapes: diagram.shapes.map((shape) => ({
      ...shape,
      cx: shape.cx * factor,
      cy: shape.cy * factor,
      rx: shape.rx * factor,
      ry: shape.ry * factor,
    })),
    regions: diagram.regions.map((region) => ({
      id: region.id,
      centre: point(region.centre),
      area: region.area * factor * factor,
      bounds: box(region.bounds),
      cover: region.cover.map(box),
    })),
    box: box(diagram.box),
  };
}

/** Whether a point is inside one shape. */
export function inShape(shape: SetsShape, at: Point): boolean {
  const dx = at.x - shape.cx;
  const dy = at.y - shape.cy;
  const cos = Math.cos(-shape.rotation);
  const sin = Math.sin(-shape.rotation);
  const u = dx * cos - dy * sin;
  const v = dx * sin + dy * cos;
  return (u * u) / (shape.rx * shape.rx) + (v * v) / (shape.ry * shape.ry) <= 1;
}

/** The region a point stands in, as a bitmask over `shapes`. */
export function regionAt(shapes: readonly SetsShape[], at: Point): number {
  let mask = 0;
  for (const [bit, shape] of shapes.entries()) {
    if (inShape(shape, at)) mask |= 1 << bit;
  }
  return mask;
}

/** Whether a point is inside the box a diagram's regions are measured over. */
export function inBox(box: Bounds, at: Point): boolean {
  return (
    at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY
  );
}

/** Where one set's name is written: the point its outline reaches at
 *  {@link SetsShape.nameAt}, pulled inside by {@link NAME_INSET}. */
export function namePoint(shape: SetsShape): Point {
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  const u = Math.max(shape.rx - NAME_INSET, 0) * Math.cos(shape.nameAt);
  const v = Math.max(shape.ry - NAME_INSET, 0) * Math.sin(shape.nameAt);
  return { x: shape.cx + u * cos - v * sin, y: shape.cy + u * sin + v * cos };
}

/** The box one shape fills, in diagram coordinates — what holds a set's name
 *  inside the set it names. */
export function shapeBounds(shape: SetsShape): Bounds {
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  const reachX = Math.hypot(shape.rx * cos, shape.ry * sin);
  const reachY = Math.hypot(shape.rx * sin, shape.ry * cos);
  return {
    minX: shape.cx - reachX,
    maxX: shape.cx + reachX,
    minY: shape.cy - reachY,
    maxY: shape.cy + reachY,
  };
}

/** One shape's outline as a closed run of points, which is how a leaning
 *  ellipse is drawn and hit alike. */
export function shapeOutline(shape: SetsShape, steps = 180): Point[] {
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  return Array.from({ length: steps }, (_unused, step) => {
    const turn = (step / steps) * Math.PI * 2;
    const u = shape.rx * Math.cos(turn);
    const v = shape.ry * Math.sin(turn);
    return { x: shape.cx + u * cos - v * sin, y: shape.cy + u * sin + v * cos };
  });
}

const circle = (
  cx: number,
  cy: number,
  r: number,
  nameAt: number,
): SetsShape => ({ cx, cy, rx: r, ry: r, rotation: 0, nameAt });

/** Three circles on a ring, one of them at the top. */
function ring(radius: number, reach: number): SetsShape[] {
  return [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6].map((turn) =>
    circle(Math.cos(turn) * radius, Math.sin(turn) * radius, reach, turn),
  );
}

/**
 * Venn's four ellipses: two leaning one way on the left, two the other way on
 * the right, mirrored about the diagram's vertical axis. The numbers are the
 * arrangement that leaves the smallest of the fifteen regions the most room —
 * `geometry.test.ts` is what holds every one of them open.
 */
function venn4(): SetsShape[] {
  const a = 0.64 * SETS_REACH;
  const b = 0.34 * SETS_REACH;
  const lean = (42 * Math.PI) / 180;
  const inner = { x: 0.02 * SETS_REACH, y: -0.16 * SETS_REACH };
  const outer = { x: 0.16 * SETS_REACH, y: 0.05 * SETS_REACH };
  return [
    {
      cx: -outer.x,
      cy: outer.y,
      rx: a,
      ry: b,
      rotation: lean,
      nameAt: Math.PI,
    },
    {
      cx: -inner.x,
      cy: inner.y,
      rx: a,
      ry: b,
      rotation: lean,
      nameAt: Math.PI,
    },
    { cx: inner.x, cy: inner.y, rx: a, ry: b, rotation: -lean, nameAt: 0 },
    { cx: outer.x, cy: outer.y, rx: a, ry: b, rotation: -lean, nameAt: 0 },
  ];
}

/** The shapes of each diagram, by how many sets it draws. */
const SHAPES: readonly SetsShape[][] = [
  [],
  [circle(0, 0, 0.8 * SETS_REACH, -Math.PI / 2)],
  [
    circle(-0.4 * SETS_REACH, 0, 0.72 * SETS_REACH, Math.PI),
    circle(0.4 * SETS_REACH, 0, 0.72 * SETS_REACH, 0),
  ],
  ring(0.38 * SETS_REACH, 0.62 * SETS_REACH),
  venn4(),
];

/**
 * Every region of a set of shapes, measured on {@link GRID}: which cells stand
 * in each, where each one's deepest point is, and the runs of cells that cover
 * it. Walked once per diagram.
 */
function measure(shapes: readonly SetsShape[]): SetsDiagram {
  const box = boxAround(shapes);
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

  // The region outside every set is a ring round the figure, and its deepest
  // point is whichever corner of the ring happens to be widest. The notes
  // standing outside read better under the figure than beside one corner of
  // it, so that region alone is given a place rather than measured one.
  const outside = regions.get(0);
  if (outside !== undefined && shapes.length > 0) {
    outside.centre = {
      x: (box.minX + box.maxX) / 2,
      y: box.maxY - (OUTSIDE_MARGIN * SETS_REACH) / 2,
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

function boxAround(shapes: readonly SetsShape[]): Bounds {
  if (shapes.length === 0) {
    return {
      minX: -SETS_REACH,
      maxX: SETS_REACH,
      minY: -SETS_REACH,
      maxY: SETS_REACH,
    };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const shape of shapes) {
    for (const at of shapeOutline(shape, 240)) {
      minX = Math.min(minX, at.x);
      maxX = Math.max(maxX, at.x);
      minY = Math.min(minY, at.y);
      maxY = Math.max(maxY, at.y);
    }
  }
  const margin = OUTSIDE_MARGIN * SETS_REACH;
  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minY: minY - margin,
    maxY: maxY + margin,
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
