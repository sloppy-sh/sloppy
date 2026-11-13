// Hand links routed along the genealogy — Holten's hierarchical edge bundling,
// with the tree the canvas already draws as the hierarchy. DESIGN.md § Edges,
// "Bundled along the tree", is the doc of record.

import type { Point } from "./viewport.js";

/** Holten's β where a reader has not set one: tight enough that a bundle reads
 *  as one cord, loose enough that its lines can still be told apart. */
export const BUNDLE_STRENGTH = 0.85;

/** Points each span of the spline is sampled at. */
const SAMPLES_PER_SPAN = 6;

/** Something a path can be traced into — a pixi `Graphics` is one. */
export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
}

/**
 * The marks a line between `a` and `b` passes through on the tree, both ends
 * included: up from `a` to the lowest ancestor the two share and down to `b`.
 * `parent` holds each mark's drawn parent, or -1 for one with none drawn. Two
 * marks in different trees meet at the tree's virtual root, so the path is
 * `a`'s chain to its root and then `b`'s root down to `b`.
 */
export function treePath(
  parent: ArrayLike<number>,
  a: number,
  b: number,
): number[] {
  const up = chainToRoot(parent, a);
  const down = chainToRoot(parent, b);
  const onUp = new Map(up.map((mark, at) => [mark, at]));
  const meet = down.findIndex((mark) => onUp.has(mark));
  if (meet === -1) return [...up, ...down.reverse()];
  return [
    ...up.slice(0, onUp.get(down[meet])! + 1),
    ...down.slice(0, meet).reverse(),
  ];
}

/** A mark and its ancestors in order, stopping at a cycle a broken tree holds. */
function chainToRoot(parent: ArrayLike<number>, from: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  for (let at = from; at >= 0 && !seen.has(at); at = parent[at] ?? -1) {
    seen.add(at);
    chain.push(at);
  }
  return chain;
}

/**
 * The control polygon of a tree path, straightened by `strength`: Holten's
 * P'ᵢ = β·Pᵢ + (1 − β)·(P₀ + i/(N−1)·(P_{N−1} − P₀)). β = 1 is the tree path
 * itself and β = 0 every point on the straight line between the two ends.
 */
export function bundleControls(
  path: readonly Point[],
  strength: number,
): Point[] {
  const beta = Math.min(1, Math.max(0, strength));
  const last = path.length - 1;
  if (last < 1) return path.map((point) => ({ ...point }));
  const from = path[0];
  const to = path[last];
  return path.map((point, at) => {
    const along = at / last;
    return {
      x: beta * point.x + (1 - beta) * (from.x + along * (to.x - from.x)),
      y: beta * point.y + (1 - beta) * (from.y + along * (to.y - from.y)),
    };
  });
}

/**
 * The drawn path through a control polygon: a uniform cubic B-spline, its two
 * end points tripled so it starts and ends on the marks themselves, sampled as
 * a polyline of interleaved x, y. A polygon of two points is the straight line.
 */
export function bSpline(controls: readonly Point[]): Float32Array {
  if (controls.length <= 2) {
    return Float32Array.from(controls.flatMap((point) => [point.x, point.y]));
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  const padded = [first, first, ...controls, last, last];
  const spans = padded.length - 3;
  const out = new Float32Array((spans * SAMPLES_PER_SPAN + 1) * 2);
  let write = 0;
  for (let span = 0; span < spans; span++) {
    const [p0, p1, p2, p3] = padded.slice(span, span + 4);
    for (let step = 0; step < SAMPLES_PER_SPAN; step++) {
      const t = step / SAMPLES_PER_SPAN;
      out[write++] = basis(p0.x, p1.x, p2.x, p3.x, t);
      out[write++] = basis(p0.y, p1.y, p2.y, p3.y, t);
    }
  }
  out[write++] = last.x;
  out[write] = last.y;
  return out;
}

function basis(p0: number, p1: number, p2: number, p3: number, t: number) {
  const it = 1 - t;
  return (
    (it * it * it * p0 +
      (3 * t * t * t - 6 * t * t + 4) * p1 +
      (-3 * t * t * t + 3 * t * t + 3 * t + 1) * p2 +
      t * t * t * p3) /
    6
  );
}

/**
 * The bundled line between marks `a` and `b`, or `null` where the tree adds
 * nothing to the straight line — two marks the tree joins directly.
 * `positions` is interleaved x, y per mark.
 */
export function bundledPath(
  parent: ArrayLike<number>,
  positions: ArrayLike<number>,
  a: number,
  b: number,
  strength: number,
): Float32Array | null {
  const path = treePath(parent, a, b);
  if (path.length <= 2) return null;
  const points = path.map((mark) => ({
    x: positions[mark * 2],
    y: positions[mark * 2 + 1],
  }));
  return bSpline(bundleControls(points, strength));
}

/** How long a polyline is. */
export function pathLength(points: Float32Array): number {
  let length = 0;
  for (let at = 2; at < points.length; at += 2) {
    length += Math.hypot(
      points[at] - points[at - 2],
      points[at + 1] - points[at - 1],
    );
  }
  return length;
}

/** The point `distance` along a polyline, held to its two ends. */
export function pointAlong(points: Float32Array, distance: number): Point {
  let left = Math.max(0, distance);
  for (let at = 2; at < points.length; at += 2) {
    const dx = points[at] - points[at - 2];
    const dy = points[at + 1] - points[at - 1];
    const span = Math.hypot(dx, dy);
    if (span > 0 && left <= span) {
      const share = left / span;
      return { x: points[at - 2] + dx * share, y: points[at - 1] + dy * share };
    }
    left -= span;
  }
  return { x: points[points.length - 2], y: points[points.length - 1] };
}

/** A polyline traced whole. */
export function traceWhole(into: PathSink, points: Float32Array): void {
  if (points.length < 4) return;
  into.moveTo(points[0], points[1]);
  for (let at = 2; at < points.length; at += 2) {
    into.lineTo(points[at], points[at + 1]);
  }
}

/**
 * A polyline traced broken: each segment is a stretch of it, as distances
 * along it — what `dashSegments` and `dotSegments` in `scene.ts` hand back.
 */
export function traceBroken(
  into: PathSink,
  points: Float32Array,
  segments: readonly { from: number; to: number }[],
): void {
  let span = 2;
  let before = 0;
  for (const segment of segments) {
    let drawing = false;
    for (; span < points.length; span += 2) {
      const x0 = points[span - 2];
      const y0 = points[span - 1];
      const dx = points[span] - x0;
      const dy = points[span + 1] - y0;
      const length = Math.hypot(dx, dy);
      const after = before + length;
      if (after < segment.from) {
        before = after;
        continue;
      }
      const at = (along: number) =>
        length === 0
          ? 0
          : (Math.max(before, Math.min(after, along)) - before) / length;
      if (!drawing) {
        const start = at(segment.from);
        into.moveTo(x0 + dx * start, y0 + dy * start);
        drawing = true;
      }
      if (after >= segment.to) {
        const end = at(segment.to);
        into.lineTo(x0 + dx * end, y0 + dy * end);
        break;
      }
      into.lineTo(points[span], points[span + 1]);
      before = after;
    }
  }
}

/** How far a point lies off a polyline. */
export function awayFromPath(point: Point, points: Float32Array): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = 2; at < points.length; at += 2) {
    const fx = points[at - 2];
    const fy = points[at - 1];
    const dx = points[at] - fx;
    const dy = points[at + 1] - fy;
    const span = dx * dx + dy * dy;
    const along =
      span === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((point.x - fx) * dx + (point.y - fy) * dy) / span),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - (fx + dx * along), point.y - (fy + dy * along)),
    );
  }
  return nearest;
}

/**
 * The span of the tree — the two marks it joins — that a bundled line is drawn
 * nearest to at `point`. `drawn` is the line {@link bundledPath} laid along
 * `marks`, its tree path in the same order: the spline's sample at the nearest
 * point is read back to the control it is drawn about.
 */
export function spanNearest(
  drawn: Float32Array,
  marks: readonly number[],
  point: Point,
): [number, number] {
  let nearest = Number.POSITIVE_INFINITY;
  let sample = 0;
  for (let at = 2; at < drawn.length; at += 2) {
    const fx = drawn[at - 2];
    const fy = drawn[at - 1];
    const dx = drawn[at] - fx;
    const dy = drawn[at + 1] - fy;
    const span = dx * dx + dy * dy;
    const along =
      span === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((point.x - fx) * dx + (point.y - fy) * dy) / span),
          );
    const away = Math.hypot(
      point.x - (fx + dx * along),
      point.y - (fy + dy * along),
    );
    if (away >= nearest) continue;
    nearest = away;
    sample = at / 2 - 1 + along;
  }
  // `bSpline` pads each end twice, so the spline about control `c` is drawn at
  // sample (c + 1) · SAMPLES_PER_SPAN.
  const control = sample / SAMPLES_PER_SPAN - 1;
  const first = Math.min(marks.length - 2, Math.max(0, Math.floor(control)));
  return [marks[first], marks[first + 1]];
}

/**
 * Which of `lines` are routed through the span of the tree between `a` and `b`:
 * the ones whose tree path steps between the two, either way, and is longer
 * than the step itself — a line the tree joins directly is drawn straight and
 * routed through nothing. Answered as indices into `lines`.
 */
export function routedThrough(
  parent: ArrayLike<number>,
  lines: readonly (readonly [number, number])[],
  [a, b]: readonly [number, number],
): number[] {
  const through: number[] = [];
  lines.forEach(([from, to], at) => {
    const path = treePath(parent, from, to);
    if (path.length <= 2) return;
    for (let step = 1; step < path.length; step++) {
      const one = path[step - 1];
      const other = path[step];
      if ((one === a && other === b) || (one === b && other === a)) {
        through.push(at);
        return;
      }
    }
  });
  return through;
}
