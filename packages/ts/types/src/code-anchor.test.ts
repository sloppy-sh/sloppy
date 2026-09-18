import { describe, expect, it } from "vitest";
import { anchorsOf, type CodeAnchor, parseCodeAnchor } from "./code-anchor.js";
import type { BlockDocument } from "./document.js";

function linked(href: string): BlockDocument {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "here",
            marks: [{ type: "link", attrs: { href } }],
          },
        ],
      },
    ],
  };
}

describe("an anchor into code", () => {
  it("reads a whole file, a line, a run of lines and a name", () => {
    const cases: [string, CodeAnchor][] = [
      ["code:src/api.ts", { path: "src/api.ts" }],
      ["code:src/api.ts#", { path: "src/api.ts" }],
      [
        "code:src/api.ts#L12",
        { path: "src/api.ts", fragment: { kind: "lines", from: 12, to: 12 } },
      ],
      [
        "code:src/api.ts#L12-L20",
        { path: "src/api.ts", fragment: { kind: "lines", from: 12, to: 20 } },
      ],
      [
        "code:src/api.ts#writeNote",
        { path: "src/api.ts", fragment: { kind: "symbol", name: "writeNote" } },
      ],
      [
        "code:Cargo.toml#Lifecycle",
        { path: "Cargo.toml", fragment: { kind: "symbol", name: "Lifecycle" } },
      ],
      [
        "code:src/api.ts#L20-L12",
        { path: "src/api.ts", fragment: { kind: "symbol", name: "L20-L12" } },
      ],
      [
        "code:src/api.ts#L0",
        { path: "src/api.ts", fragment: { kind: "symbol", name: "L0" } },
      ],
    ];
    for (const [href, anchor] of cases) {
      expect(parseCodeAnchor(href)).toEqual(anchor);
    }
  });

  it("is not an anchor where the scheme is somebody else's", () => {
    for (const href of [
      "https://example.com/src/api.ts",
      "sloppy:did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01J0000000000000000000000A",
      "/src/api.ts",
      "src/api.ts",
      "CODE:src/api.ts",
    ]) {
      expect(parseCodeAnchor(href)).toBeUndefined();
    }
  });

  it("refuses a path that climbs out of the project or starts at a disk", () => {
    for (const path of [
      "",
      "/etc/passwd",
      "../../.ssh/authorized_keys",
      "src/../../out",
      "./src/api.ts",
      "src//api.ts",
      "C:/Users/someone/notes.md",
      "src\\api.ts",
    ]) {
      expect(parseCodeAnchor(`code:${path}`)).toBeUndefined();
      expect(parseCodeAnchor(`code:${path}#L1`)).toBeUndefined();
    }
  });

  it("names every place a section points at, in order and once each", () => {
    const document: BlockDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "one",
              marks: [{ type: "link", attrs: { href: "code:src/a.ts#L3" } }],
            },
            {
              type: "text",
              text: "again",
              marks: [{ type: "link", attrs: { href: "code:src/a.ts#L3-L3" } }],
            },
            {
              type: "text",
              text: "a page",
              marks: [
                { type: "link", attrs: { href: "https://example.com/" } },
              ],
            },
          ],
        },
        {
          type: "something-this-build-cannot-draw",
          attrs: { inner: { href: "code:src/b.ts" } },
        },
      ],
    };
    expect(anchorsOf(document)).toEqual([
      { path: "src/a.ts", fragment: { kind: "lines", from: 3, to: 3 } },
      { path: "src/b.ts" },
    ]);
  });

  it("names nothing where a section points at no code", () => {
    expect(anchorsOf({ type: "doc", content: [] })).toEqual([]);
    expect(anchorsOf(linked("https://example.com/"))).toEqual([]);
    expect(anchorsOf(linked("code:../out/a.ts"))).toEqual([]);
  });
});
