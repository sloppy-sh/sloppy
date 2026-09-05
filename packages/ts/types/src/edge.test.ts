import { describe, expect, it } from "vitest";
import {
  EDGE_KINDS,
  type EdgeKind,
  isConnection,
  strongestEdge,
} from "./edge.js";

const PAIRS = EDGE_KINDS.flatMap((a) =>
  EDGE_KINDS.map((b) => [a, b] as [EdgeKind, EdgeKind]),
);

// DESIGN.md § Edges: a pair may be parent and child, consecutive, referenced and
// hand-linked at once, and draws one line.
describe("the line a pair draws when several kinds are true of it", () => {
  it("is the ruling: the hand, then the run, then a reference", () => {
    expect(EDGE_KINDS).toEqual(["link", "run", "reference", "genealogy"]);
  });

  it("is one of the two, whichever order they are asked in", () => {
    for (const [a, b] of PAIRS) {
      const won = strongestEdge(a, b);
      expect([a, b]).toContain(won);
      expect(strongestEdge(b, a)).toBe(won);
    }
  });

  it("does not depend on the order several are folded in", () => {
    for (const [a, b] of PAIRS) {
      for (const c of EDGE_KINDS) {
        expect(strongestEdge(strongestEdge(a, b), c)).toBe(
          strongestEdge(a, strongestEdge(b, c)),
        );
      }
    }
  });

  it("leaves a kind alone against itself", () => {
    for (const kind of EDGE_KINDS) {
      expect(strongestEdge(kind, kind)).toBe(kind);
    }
  });

  it("keeps the hand above every line the addresses already draw", () => {
    expect(strongestEdge("link", "reference")).toBe("link");
    expect(strongestEdge("run", "link")).toBe("link");
  });

  // The run is the line a reader walks, and a note naming its neighbour drew
  // nothing on the canvas — DESIGN.md § Edges.
  it("leaves the run standing where a note cites the neighbour it follows", () => {
    expect(strongestEdge("run", "reference")).toBe("run");
  });

  it("still lifts a citation off the tree's own line", () => {
    expect(strongestEdge("genealogy", "reference")).toBe("reference");
  });
});

describe("a line somebody made on purpose", () => {
  it("is either way of making one, and neither way the addresses make", () => {
    expect(EDGE_KINDS.filter(isConnection)).toEqual(["link", "reference"]);
  });
});
