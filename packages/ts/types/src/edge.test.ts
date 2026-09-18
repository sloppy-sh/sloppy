import { describe, expect, it } from "vitest";
import {
  EDGE_DIRECTIONS,
  EDGE_KINDS,
  EDGE_LABEL_MAX,
  EDGE_STROKES,
  type EdgeKind,
  type EdgeLook,
  EdgeLookSchema,
  isBlankLook,
  isConnection,
  lookBetween,
  type LookingNote,
  lookOn,
  looksAreOnePerTarget,
  looksRead,
  looksReaching,
  looksWritten,
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

const OWNER = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const A = `${OWNER}/01J0000000000000000000000A` as const;
const B = `${OWNER}/01J0000000000000000000000B` as const;
const C = `${OWNER}/01J0000000000000000000000C` as const;

function end(ref: string, updated_at: string, edges?: EdgeLook[]): LookingNote {
  return { ref, updated_at, ...(edges === undefined ? {} : { edges }) };
}

const EARLY = "2026-01-01T00:00:00.000Z";
const LATE = "2026-01-02T00:00:00.000Z";

describe("a look a person set on a line", () => {
  it("names the note at the other end and nothing else it needs", () => {
    expect(EdgeLookSchema.parse({ to: B })).toEqual({ to: B });
  });

  it("keeps the three channels open and the values closed", () => {
    expect(EDGE_DIRECTIONS).toEqual(["to", "from", "both"]);
    expect(EDGE_STROKES).toEqual(["solid", "dashed", "dotted"]);
    for (const direction of EDGE_DIRECTIONS) {
      expect(EdgeLookSchema.parse({ to: B, direction }).direction).toBe(
        direction,
      );
    }
    for (const stroke of EDGE_STROKES) {
      expect(EdgeLookSchema.parse({ to: B, stroke }).stroke).toBe(stroke);
    }
    expect(EdgeLookSchema.safeParse({ to: B, stroke: "wavy" }).success).toBe(
      false,
    );
    expect(EdgeLookSchema.safeParse({ to: B, direction: "up" }).success).toBe(
      false,
    );
  });

  it("takes a label as somebody typed it, trimmed, and only so long", () => {
    expect(EdgeLookSchema.parse({ to: B, label: "  grew out of  " })).toEqual({
      to: B,
      label: "grew out of",
    });
    const long = "x".repeat(EDGE_LABEL_MAX);
    expect(EdgeLookSchema.parse({ to: B, label: ` ${long} ` }).label).toBe(
      long,
    );
    expect(EdgeLookSchema.safeParse({ to: B, label: `${long}y` }).success).toBe(
      false,
    );
  });

  it("refuses something that is not a note at the other end", () => {
    expect(EdgeLookSchema.safeParse({ to: "1a" }).success).toBe(false);
  });
});

describe("what a note may carry", () => {
  it("is one look per note at the other end", () => {
    expect(looksAreOnePerTarget(undefined)).toBe(true);
    expect(looksAreOnePerTarget([])).toBe(true);
    expect(looksAreOnePerTarget([{ to: B }, { to: C }])).toBe(true);
    expect(looksAreOnePerTarget([{ to: B, label: "one" }, { to: B }])).toBe(
      false,
    );
  });

  it("is what a reader keeps the first of, rather than refusing the note", () => {
    expect(
      looksRead([
        { to: B, label: "one" },
        { to: C, stroke: "dotted" },
        { to: B, label: "two" },
      ]),
    ).toEqual([
      { to: B, label: "one" },
      { to: C, stroke: "dotted" },
    ]);
    expect(looksRead([])).toEqual([]);
  });

  it("reads the same look as the one a note answers with", () => {
    const edges: EdgeLook[] = [
      { to: B, label: "one" },
      { to: B, label: "two" },
    ];
    expect(looksRead(edges)[0]).toEqual(lookOn(end(A, EARLY, edges), B));
  });
});

describe("the looks that travel to somebody who may not read every note", () => {
  it("are the ones whose other end the reader reaches", () => {
    expect(
      looksReaching(
        [
          { to: B, label: "answers" },
          { to: C, label: "unpublished" },
        ],
        (to) => to === B,
      ),
    ).toEqual([{ to: B, label: "answers" }]);
  });

  it("are absent where none of them is reached, and where there are none", () => {
    expect(
      looksReaching([{ to: C, label: "unpublished" }], (to) => to === B),
    ).toBeUndefined();
    expect(looksReaching(undefined, () => true)).toBeUndefined();
  });
});

describe("the looks a write leaves behind", () => {
  it("leaves them alone where the write said nothing about them", () => {
    expect(looksWritten(undefined)).toBeUndefined();
  });

  it("takes them all off where the write named none", () => {
    expect(looksWritten([])).toBeUndefined();
  });

  it("drops a look that names no channel, and the list where none does", () => {
    expect(isBlankLook({ to: B })).toBe(true);
    expect(isBlankLook({ to: B, stroke: "dotted" })).toBe(false);
    expect(looksWritten([{ to: B }, { to: C }])).toBeUndefined();
    expect(looksWritten([{ to: B }, { to: C, label: "cites" }])).toEqual([
      { to: C, label: "cites" },
    ]);
  });

  it("reads a label somebody cleared as nothing said", () => {
    expect(looksWritten([{ to: B, label: "" }])).toBeUndefined();
    expect(looksWritten([{ to: B, label: "", stroke: "solid" }])).toEqual([
      { to: B, stroke: "solid" },
    ]);
  });
});

describe("which look draws the line between two notes", () => {
  it("is neither where neither end set one", () => {
    expect(lookBetween(end(A, EARLY), end(B, EARLY))).toBeUndefined();
  });

  it("is the one end that set one, asked from either side", () => {
    const a = end(A, EARLY, [{ to: B, label: "answers" }]);
    const b = end(B, LATE);
    expect(lookBetween(a, b)).toEqual({ to: B, label: "answers" });
    expect(lookBetween(b, a)).toEqual({ to: B, label: "answers" });
  });

  it("says nothing about a note this one is not joined to", () => {
    const a = end(A, EARLY, [{ to: C, label: "elsewhere" }]);
    expect(lookBetween(a, end(B, EARLY))).toBeUndefined();
    expect(lookOn(a, C)).toEqual({ to: C, label: "elsewhere" });
    expect(lookOn(a, B)).toBeUndefined();
  });

  it("takes the later-written end where both set one", () => {
    const a = end(A, EARLY, [{ to: B, stroke: "dashed" }]);
    const b = end(B, LATE, [{ to: A, stroke: "dotted" }]);
    expect(lookBetween(a, b)).toEqual({ to: A, stroke: "dotted" });
    expect(lookBetween(b, a)).toEqual({ to: A, stroke: "dotted" });
  });

  // Two peers reading one pair have to read one look, and two notes written in
  // the same millisecond are otherwise a coin toss.
  it("settles a tie the same way on every machine", () => {
    const a = end(A, EARLY, [{ to: B, stroke: "dashed" }]);
    const b = end(B, EARLY, [{ to: A, stroke: "dotted" }]);
    expect(lookBetween(a, b)).toEqual({ to: B, stroke: "dashed" });
    expect(lookBetween(b, a)).toEqual({ to: B, stroke: "dashed" });
  });

  it("answers the winning end's own entry, so which way it points is in it", () => {
    const a = end(A, LATE, [{ to: B, direction: "to" }]);
    const b = end(B, EARLY, [{ to: A, direction: "to" }]);
    expect(lookBetween(a, b)?.to).toBe(B);
    expect(lookBetween(b, a)?.to).toBe(B);
  });
});
