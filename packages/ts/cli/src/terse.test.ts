// The terse answer `sloppy mcp --answers terse` serves.

import { describe, expect, it } from "vitest";
import { refsWidened, stripped, terseAnswer, terseValue } from "./terse.js";

const HOME = "did:syr:z6MkHome";
const ONE = "01M6830BSWRFD11FJG4ZQ1MYG9";
const TWO = "01M6840T2Y7X0P21G26KDVDT9C";
const ELSEWHERE = `did:syr:z6MkOther/${TWO}`;

describe("a terse answer", () => {
  it("says each quote of code as one string, with what changed lines say under it", () => {
    expect(
      terseValue(
        {
          quoted: [
            { at: "src/a.ts#L1-L2", state: "unchanged" },
            { at: "src/a.ts#L4-L5", state: "moved", now: "src/a.ts#L6-L7" },
            {
              at: "src/b.ts#L1-L1",
              state: "changed",
              now: "src/b.ts#L1-L1",
              says: "x = 2",
            },
          ],
        },
        HOME,
      ),
    ).toEqual({
      quoted: [
        "src/a.ts#L1-L2 unchanged",
        "src/a.ts#L4-L5 moved src/a.ts#L6-L7",
        "src/b.ts#L1-L1 changed src/b.ts#L1-L1\nx = 2",
      ],
    });
  });

  it("names each section a long note's outline leaves out as its heading and size", () => {
    expect(
      terseValue(
        {
          outline: [
            { heading: "Why", size: 3608 },
            { heading: "How", size: 412 },
          ],
        },
        HOME,
      ),
    ).toEqual({ outline: ["Why (3608)", "How (412)"] });
  });

  it("names a note in the graph here by its ULID, and one in anybody else's by its whole ref", () => {
    expect(
      terseValue(
        { notes: [{ note: `${HOME}/${ONE}`, parent: ELSEWHERE }] },
        HOME,
      ),
    ).toEqual({ notes: [{ ref: ONE, up: ELSEWHERE }] });
  });

  it("writes a section as its markdown, without emphasis, the target of a link into code, or escapes", () => {
    expect(
      terseValue(
        {
          sections: [
            {
              id: ONE,
              markdown: `## Why\n\nIt reads **one token**, in [parse](code:src/p.ts#parse) as [the note](sloppy:${HOME}/${TWO}) says\\: 1\\.\n\n\n| a | b |\n| --- | :-: |`,
            },
          ],
        },
        HOME,
      ),
    ).toEqual({
      text: [
        `## Why\n\nIt reads one token, in parse as [the note](sloppy:${TWO}) says: 1.\n\n| a | b |\n|-|-|`,
      ],
    });
  });

  it("leaves what a fence holds exactly as written", () => {
    const fenced = "```\nconst **a** = 1;\n\n\n```";
    expect(stripped(fenced)).toBe(fenced);
  });

  it("writes where the code under each anchor stands after its lines, and leaves out a place those lines already name", () => {
    expect(
      terseValue(
        {
          note: `${HOME}/${ONE}`,
          about: ["src/p.ts", "src", "docs/a.md"],
          anchors: [
            { path: "src/p.ts", fragment: "parse", standing: "held" },
            { path: "src", standing: "unread" },
          ],
          code: ["src/p.ts#L3-L42", "src/"],
        },
        HOME,
      ),
    ).toEqual({
      ref: ONE,
      on: ["docs/a.md"],
      code: ["src/p.ts#L3-L42 held", "src/ unread"],
    });
  });

  it("leaves out what is empty, but not an empty listing", () => {
    expect(
      terseValue({ found: [{ note: ONE, line: "", tags: [] }] }, HOME),
    ).toEqual({ found: [{ ref: ONE }] });
    expect(terseAnswer('{"found":[]}', HOME)).toBe('{"found":[]}');
  });

  it("leaves words that are not JSON as they are", () => {
    expect(terseAnswer("That note is too long to read.", HOME)).toBe(
      "That note is too long to read.",
    );
  });
});

describe("a call to a terse server", () => {
  it("reads a ULID as the note in the graph here, wherever it is in the arguments", () => {
    expect(
      refsWidened({ note: ONE, to: [TWO, ELSEWHERE], tags: ["parsing"] }, HOME),
    ).toEqual({
      note: `${HOME}/${ONE}`,
      to: [`${HOME}/${TWO}`, ELSEWHERE],
      tags: ["parsing"],
    });
  });

  it("is read as it came where there is no graph here", () => {
    expect(refsWidened({ note: ONE }, undefined)).toEqual({ note: ONE });
  });
});
