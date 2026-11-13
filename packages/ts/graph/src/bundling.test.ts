import { describe, expect, it } from "vitest";
import {
  awayFromPath,
  bSpline,
  bundleControls,
  bundledPath,
  pathLength,
  pointAlong,
  routedThrough,
  spanNearest,
  traceBroken,
  traceWhole,
  treePath,
} from "./bundling.js";

//        0
//      /   \
//     1     2
//    / \     \
//   3   4     5
//              \
//               6
//  7 (a second tree)
//   \
//    8
const PARENT = [-1, 0, 0, 1, 1, 2, 5, -1, 7];
const POSITIONS = [
  [0, 0],
  [-100, 100],
  [100, 100],
  [-150, 200],
  [-50, 200],
  [150, 200],
  [200, 300],
  [500, 0],
  [500, 100],
].flat();

function chord(points: Float32Array): (x: number, y: number) => number {
  const fx = points[0];
  const fy = points[1];
  const tx = points[points.length - 2];
  const ty = points[points.length - 1];
  const span = Math.hypot(tx - fx, ty - fy);
  return (x, y) => Math.abs((tx - fx) * (fy - y) - (fx - x) * (ty - fy)) / span;
}

function middleOff(strength: number): number {
  const path = bundledPath(PARENT, POSITIONS, 3, 6, strength)!;
  const middle = pointAlong(path, pathLength(path) / 2);
  return chord(path)(middle.x, middle.y);
}

describe("the tree path between two marks", () => {
  it("climbs to the ancestor the two share and down again", () => {
    expect(treePath(PARENT, 3, 6)).toEqual([3, 1, 0, 2, 5, 6]);
    expect(treePath(PARENT, 3, 4)).toEqual([3, 1, 4]);
  });

  it("runs straight down from an ancestor to its descendant", () => {
    expect(treePath(PARENT, 0, 6)).toEqual([0, 2, 5, 6]);
    expect(treePath(PARENT, 6, 0)).toEqual([6, 5, 2, 0]);
  });

  it("joins two trees through their roots", () => {
    expect(treePath(PARENT, 4, 8)).toEqual([4, 1, 0, 7, 8]);
  });

  it("is the pair alone where the tree joins them directly", () => {
    expect(treePath(PARENT, 1, 3)).toEqual([1, 3]);
    expect(bundledPath(PARENT, POSITIONS, 1, 3, 1)).toBeNull();
  });

  it("stops at a cycle rather than walking it", () => {
    expect(treePath([1, 0, 0], 2, 1)).toEqual([2, 0, 1]);
  });
});

describe("the bundled line", () => {
  it("is the straight line at a strength of nothing", () => {
    const path = bundledPath(PARENT, POSITIONS, 3, 6, 0)!;
    const off = chord(path);
    for (let at = 0; at < path.length; at += 2) {
      expect(off(path[at], path[at + 1])).toBeLessThan(1e-3);
    }
  });

  it("follows the tree path whole at full strength", () => {
    const points = treePath(PARENT, 3, 6).map((mark) => ({
      x: POSITIONS[mark * 2],
      y: POSITIONS[mark * 2 + 1],
    }));
    expect(bundleControls(points, 1)).toEqual(points);
    const path = bundledPath(PARENT, POSITIONS, 3, 6, 1)!;
    expect(path).toEqual(bSpline(points));
    // The spline passes within its own reach of the root it climbs through.
    expect(awayFromPath({ x: 0, y: 0 }, path)).toBeLessThan(60);
  });

  it("starts and ends on the two marks at every strength", () => {
    for (const strength of [0, 0.4, 0.85, 1]) {
      const path = bundledPath(PARENT, POSITIONS, 3, 6, strength)!;
      expect([path[0], path[1]]).toEqual([-150, 200]);
      expect([path[path.length - 2], path[path.length - 1]]).toEqual([
        200, 300,
      ]);
    }
  });

  it("bows its middle further off the straight line as the strength rises", () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map(middleOff);
    for (let at = 1; at < steps.length; at++) {
      expect(steps[at]).toBeGreaterThan(steps[at - 1]);
    }
  });

  it("holds a strength outside the range to its ends", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    expect(bundleControls(points, 2)).toEqual(bundleControls(points, 1));
    expect(bundleControls(points, -1)).toEqual(bundleControls(points, 0));
  });
});

describe("tracing a polyline", () => {
  const corner = Float32Array.from([0, 0, 10, 0, 10, 10]);

  function sink() {
    const calls: string[] = [];
    return {
      calls,
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
    };
  }

  it("measures it and finds a point along it", () => {
    expect(pathLength(corner)).toBe(20);
    expect(pointAlong(corner, 15)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(corner, 99)).toEqual({ x: 10, y: 10 });
  });

  it("traces it whole", () => {
    const into = sink();
    traceWhole(into, corner);
    expect(into.calls).toEqual(["M0,0", "L10,0", "L10,10"]);
  });

  it("breaks it, a dash running round the corner it meets", () => {
    const into = sink();
    traceBroken(into, corner, [
      { from: 0, to: 4 },
      { from: 8, to: 12 },
      { from: 16, to: 20 },
    ]);
    expect(into.calls).toEqual([
      "M0,0",
      "L4,0",
      "M8,0",
      "L10,0",
      "L10,2",
      "M10,6",
      "L10,10",
    ]);
  });

  it("measures a tap off the nearest stretch", () => {
    expect(awayFromPath({ x: 13, y: 5 }, corner)).toBe(3);
  });
});

describe("the stretch of the tree a tap on a bundled line lands on", () => {
  const along = (a: number, b: number) => ({
    marks: treePath(PARENT, a, b),
    drawn: bundledPath(PARENT, POSITIONS, a, b, 1)!,
  });

  it("is the span of the tree the curve is drawn about there", () => {
    const { marks, drawn } = along(3, 6);
    expect(marks).toEqual([3, 1, 0, 2, 5, 6]);
    expect(spanNearest(drawn, marks, { x: -150, y: 200 })).toEqual([3, 1]);
    expect(spanNearest(drawn, marks, { x: 200, y: 300 })).toEqual([5, 6]);
    const middle = pointAlong(drawn, pathLength(drawn) / 2);
    expect([
      [1, 0],
      [0, 2],
    ]).toContainEqual(spanNearest(drawn, marks, middle));
  });

  it("gathers every line routed through that span, and only those", () => {
    const lines: [number, number][] = [
      [3, 6],
      [4, 5],
      [3, 2],
      [3, 4],
      [0, 2],
      [7, 8],
    ];
    expect(routedThrough(PARENT, lines, [0, 2])).toEqual([0, 1, 2]);
    expect(routedThrough(PARENT, lines, [2, 0])).toEqual([0, 1, 2]);
    // A line the tree joins directly is drawn straight, through nothing.
    expect(routedThrough(PARENT, lines, [7, 8])).toEqual([]);
  });
});
