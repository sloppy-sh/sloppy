import { describe, expect, it } from "vitest";
import {
  WINDOW_DEPTH,
  WINDOW_PART_KINDS,
  WindowAskSchema,
  WindowCutSchema,
  WindowPartKindSchema,
  WindowPartSchema,
  WindowSchema,
} from "./window.js";

const REF =
  "did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M71Z3Z8BAGKH20DJV4PKAA98";

const PARTS = {
  note: { kind: "note", ref: REF, text: "# Why\n\nAll of it.", tokens: 12 },
  ancestor: { kind: "ancestor", ref: REF, text: "The opening.", tokens: 4 },
  sibling: { kind: "sibling", ref: REF, text: "A title", tokens: 2 },
  code: {
    kind: "code",
    path: "src/garden/seed.ts",
    fragment: "L3-L9",
    standing: "held",
    text: "export function sow() {}",
    tokens: 7,
  },
  instructions: {
    kind: "instructions",
    path: ".sloppy/AGENT.md",
    text: "The reasons are in the notes.",
    tokens: 6,
  },
} as const;

describe("a window's part", () => {
  it("has a valid example of every kind", () => {
    expect(Object.keys(PARTS)).toEqual([...WINDOW_PART_KINDS]);
    for (const part of Object.values(PARTS)) {
      expect(WindowPartSchema.parse(part)).toEqual(part);
    }
  });

  it("reads a code part with no fragment as the whole file", () => {
    const { fragment: _, ...whole } = PARTS.code;
    expect(WindowPartSchema.parse(whole)).toEqual(whole);
  });

  it("refuses a kind it does not know", () => {
    expect(WindowPartKindSchema.safeParse("summary").success).toBe(false);
    expect(
      WindowPartSchema.safeParse({ ...PARTS.note, kind: "summary" }).success,
    ).toBe(false);
  });

  it("refuses a note part named by a path, and a code part named by a ref", () => {
    const { ref: _, ...unnamed } = PARTS.note;
    expect(
      WindowPartSchema.safeParse({ ...unnamed, path: "src/a.ts" }).success,
    ).toBe(false);
    const { path: __, ...pathless } = PARTS.code;
    expect(WindowPartSchema.safeParse({ ...pathless, ref: REF }).success).toBe(
      false,
    );
  });

  it("refuses a path outside the project, a standing it does not know, and negative tokens", () => {
    expect(
      WindowPartSchema.safeParse({ ...PARTS.code, path: "../secret" }).success,
    ).toBe(false);
    expect(
      WindowPartSchema.safeParse({ ...PARTS.code, standing: "stale" }).success,
    ).toBe(false);
    expect(
      WindowPartSchema.safeParse({ ...PARTS.sibling, tokens: -1 }).success,
    ).toBe(false);
  });
});

describe("what a window cut", () => {
  it("is a part's source and the tokens cutting it saved, with no text", () => {
    const { text: _, ...cut } = PARTS.sibling;
    expect(WindowCutSchema.parse(cut)).toEqual(cut);
    expect(WindowCutSchema.parse(PARTS.sibling)).toEqual(cut);
  });

  it("refuses a cut that names no source", () => {
    expect(WindowCutSchema.safeParse({ kind: "code", tokens: 3 }).success).toBe(
      false,
    );
  });
});

describe("a window", () => {
  const cut = { kind: "code", path: "src/a.ts", standing: "moved", tokens: 90 };

  it("parses its parts, its budget and what was cut", () => {
    const window = {
      parts: [PARTS.note, PARTS.ancestor],
      budget: 4000,
      cut: [cut],
    };
    expect(WindowSchema.parse(window)).toEqual(window);
  });

  it("refuses a budget that is not a positive whole number of tokens", () => {
    for (const budget of [0, -5, 1.5]) {
      expect(
        WindowSchema.safeParse({ parts: [], budget, cut: [] }).success,
      ).toBe(false);
    }
  });
});

describe("a window's ask", () => {
  it("reaches the default depth when it names none", () => {
    expect(
      WindowAskSchema.parse({ ask: "Why sow first?", budget: 8000 }),
    ).toEqual({ ask: "Why sow first?", budget: 8000, depth: WINDOW_DEPTH });
  });

  it("keeps a depth it names, including none", () => {
    expect(
      WindowAskSchema.parse({ ask: "Why?", budget: 100, depth: 0 }).depth,
    ).toBe(0);
  });

  it("refuses an empty ask, a missing budget, and a negative depth", () => {
    expect(WindowAskSchema.safeParse({ ask: "  ", budget: 100 }).success).toBe(
      false,
    );
    expect(WindowAskSchema.safeParse({ ask: "Why?" }).success).toBe(false);
    expect(
      WindowAskSchema.safeParse({ ask: "Why?", budget: 100, depth: -1 })
        .success,
    ).toBe(false);
  });
});
