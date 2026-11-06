// The shape a drawn set takes: an ellipse with the area its count asks for,
// which a figure that can honour every overlap with discs keeps round.
// DESIGN.md § "Sets — the tags as places" is the doc of record.

import type { Bounds, Point } from "../viewport.js";

/** One of the shapes a figure is drawn from, in world units relative to the
 *  figure's centre: an ellipse with the area of the disc of radius `r`. */
export interface SetsShape {
  cx: number;
  cy: number;
  /** The radius of the disc with this shape's area. */
  r: number;
  /** The half-axis along `turn` over `r`; the other half-axis is `r / stretch`,
   *  so 1 is a disc. */
  stretch: number;
  /** Which way the long axis points, in radians. */
  turn: number;
  /** Which way out of its own centre this set's name is written, in radians. */
  nameAt: number;
}

/** A shape without the place its name is written. */
export type SetsOutline = Omit<SetsShape, "nameAt">;

/** The two half-axes of a shape: along its turn, and across it. */
function halfAxes(shape: SetsOutline): { along: number; across: number } {
  return { along: shape.r * shape.stretch, across: shape.r / shape.stretch };
}

/** A point in a shape's own frame, scaled so its outline is the unit circle. */
function unitFrame(shape: SetsOutline, at: Point): { u: number; v: number } {
  const { along, across } = halfAxes(shape);
  const dx = at.x - shape.cx;
  const dy = at.y - shape.cy;
  const cos = Math.cos(shape.turn);
  const sin = Math.sin(shape.turn);
  return {
    u: (dx * cos + dy * sin) / along,
    v: (dy * cos - dx * sin) / across,
  };
}

/** Whether a point is inside one shape. */
export function inShape(shape: SetsOutline, at: Point): boolean {
  const { u, v } = unitFrame(shape, at);
  return u * u + v * v <= 1;
}

/**
 * How far a point stands outside a shape's outline, in world units, negative
 * inside, to first order: exact on a disc and on any outline, and near enough
 * for a point well clear of one. Measured once per shape for every point it is
 * asked about.
 */
export function gaugeOf(shape: SetsOutline): (x: number, y: number) => number {
  const { along, across } = halfAxes(shape);
  const cos = Math.cos(shape.turn);
  const sin = Math.sin(shape.turn);
  const least = Math.min(along, across);
  return (x, y) => {
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    const u = (dx * cos + dy * sin) / along;
    const v = (dy * cos - dx * sin) / across;
    const q = Math.sqrt(u * u + v * v);
    if (q < 1e-9) return -least;
    const pu = u / along;
    const pv = v / across;
    return ((q - 1) * q) / Math.sqrt(pu * pu + pv * pv);
  };
}

/**
 * How far a point stands outside a shape's outline, in world units, negative
 * inside — exactly wherever it is within `near` of the outline, and to first
 * order further off. Measured once per shape for every point it is asked
 * about.
 */
export function gapOf(
  shape: SetsOutline,
  near = 0,
): (x: number, y: number) => number {
  const rough = gaugeOf(shape);
  if (shape.stretch === 1) return rough;
  const { along, across } = halfAxes(shape);
  const cos = Math.cos(shape.turn);
  const sin = Math.sin(shape.turn);
  return (x, y) => {
    const gap = rough(x, y);
    if (Math.abs(gap) > near * 2) return gap;
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    const u = dx * cos + dy * sin;
    const v = dy * cos - dx * sin;
    const away = toEllipse(along, across, Math.abs(u), Math.abs(v));
    return gap <= 0 ? -away : away;
  };
}

/**
 * The distance from a point in the first quadrant to the ellipse with
 * half-axes `a` ≥ `b`, by bisection on the root that names the nearest point
 * of the outline. Eberly, "Distance from a Point to an Ellipse, an Ellipsoid,
 * or a Hyperellipsoid" (2013).
 */
function toEllipse(a: number, b: number, y0: number, y1: number): number {
  if (y1 > 0) {
    if (y0 > 0) {
      const z0 = y0 / a;
      const z1 = y1 / b;
      const g = z0 * z0 + z1 * z1 - 1;
      if (g === 0) return 0;
      const ratio = (a / b) * (a / b);
      const s = rootOf(ratio, z0, z1, g);
      return Math.hypot((ratio * y0) / (s + ratio) - y0, y1 / (s + 1) - y1);
    }
    return Math.abs(y1 - b);
  }
  const reach = a * y0;
  const room = a * a - b * b;
  if (reach < room) {
    const x0 = reach / room;
    return Math.hypot(a * x0 - y0, b * Math.sqrt(1 - x0 * x0));
  }
  return Math.abs(y0 - a);
}

function rootOf(ratio: number, z0: number, z1: number, g: number): number {
  const n0 = ratio * z0;
  let low = z1 - 1;
  let high = g < 0 ? 0 : Math.hypot(n0, z1) - 1;
  let s = low;
  for (let step = 0; step < 64; step++) {
    s = (low + high) / 2;
    if (s === low || s === high) break;
    const r0 = n0 / (s + ratio);
    const r1 = z1 / (s + 1);
    const at = r0 * r0 + r1 * r1 - 1;
    if (at > 0) low = s;
    else if (at < 0) high = s;
    else break;
  }
  return s;
}

/** How far a shape's outline stands from its centre along `angle`. */
export function reachAlong(shape: SetsOutline, angle: number): number {
  const { along, across } = halfAxes(shape);
  const off = angle - shape.turn;
  return 1 / Math.hypot(Math.cos(off) / along, Math.sin(off) / across);
}

/** The region a point stands in, as a bitmask over `shapes`. */
export function regionAt(shapes: readonly SetsOutline[], at: Point): number {
  let mask = 0;
  for (const [bit, shape] of shapes.entries()) {
    if (inShape(shape, at)) mask |= 1 << bit;
  }
  return mask;
}

/** The box one shape fills, in figure coordinates — what holds a set's name
 *  inside the set it names. */
export function shapeBounds(shape: SetsOutline): Bounds {
  const { along, across } = halfAxes(shape);
  const cos = Math.cos(shape.turn);
  const sin = Math.sin(shape.turn);
  const wide = Math.hypot(along * cos, across * sin);
  const high = Math.hypot(along * sin, across * cos);
  return {
    minX: shape.cx - wide,
    maxX: shape.cx + wide,
    minY: shape.cy - high,
    maxY: shape.cy + high,
  };
}

/** One shape's outline as a closed run of points, which is how it is drawn. */
export function shapeOutline(shape: SetsOutline, steps = 180): Point[] {
  const { along, across } = halfAxes(shape);
  const cos = Math.cos(shape.turn);
  const sin = Math.sin(shape.turn);
  return Array.from({ length: steps }, (_unused, step) => {
    const turn = (step / steps) * Math.PI * 2;
    const u = along * Math.cos(turn);
    const v = across * Math.sin(turn);
    return {
      x: shape.cx + u * cos - v * sin,
      y: shape.cy + u * sin + v * cos,
    };
  });
}
