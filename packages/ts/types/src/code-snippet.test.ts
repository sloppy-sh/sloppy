import { describe, expect, it } from "vitest";
import { anchorsOf } from "./code-anchor.js";
import {
  linesAt,
  readSnippetInfo,
  snippetInfo,
  snippetNode,
  snippetOf,
  snippetStanding,
  withSnippets,
} from "./code-snippet.js";

const DIGEST = `sha256:${"ab".repeat(32)}`;
const SNIPPET = {
  path: "src/a.ts",
  from: 3,
  to: 5,
  digest: DIGEST,
  source: "x",
  language: "ts",
};

describe("a snippet's info string", () => {
  it("names the language, the place and the digest, one word each", () => {
    expect(snippetInfo(SNIPPET)).toBe(`ts code:src/a.ts#L3-L5 ${DIGEST}`);
    expect(readSnippetInfo(`ts code:src/a.ts#L3-L5 ${DIGEST}`)).toEqual({
      path: "src/a.ts",
      from: 3,
      to: 5,
      language: "ts",
      digest: DIGEST,
    });
  });

  it("reads a place with no digest as a quote asked for", () => {
    expect(readSnippetInfo("code:src/a.ts#L7")).toEqual({
      path: "src/a.ts",
      from: 7,
      to: 7,
    });
  });

  it("is no snippet where the reference names a whole file, a name, or outside the project", () => {
    expect(readSnippetInfo("ts code:src/a.ts")).toBeUndefined();
    expect(readSnippetInfo("ts code:src/a.ts#parse")).toBeUndefined();
    expect(readSnippetInfo("ts code:../a.ts#L1-L2")).toBeUndefined();
    expect(readSnippetInfo("ts")).toBeUndefined();
    expect(readSnippetInfo(`a b code:src/a.ts#L1 ${DIGEST}`)).toBeUndefined();
    expect(readSnippetInfo("ts code:src/a.ts#L1 sha256:short")).toBeUndefined();
  });

  it("cannot be spelled for a path a word cannot hold", () => {
    expect(snippetInfo({ ...SNIPPET, path: "a b/c.ts" })).toBeUndefined();
  });
});

describe("a snippet in a section", () => {
  it("is an anchor to its lines wherever the section's places are read", () => {
    expect(anchorsOf({ type: "doc", content: [snippetNode(SNIPPET)] })).toEqual(
      [{ path: "src/a.ts", fragment: { kind: "lines", from: 3, to: 5 } }],
    );
  });

  it("reads back from its element as itself", () => {
    expect(snippetOf(snippetNode(SNIPPET))).toEqual(SNIPPET);
  });

  it("is replaced in place, inside whatever holds it", () => {
    const content = [
      { type: "blockquote", content: [snippetNode(SNIPPET)] },
      { type: "paragraph" },
    ];
    const changed = withSnippets({ type: "doc", content }, (held) => ({
      ...held,
      source: "y",
    }));
    expect(changed.content?.[0]?.content?.[0]?.attrs?.source).toBe("y");
    expect(changed.content?.[1]).toEqual({ type: "paragraph" });
  });
});

describe("the lines a place names", () => {
  it("are those lines, and nothing where the file stops short", () => {
    expect(linesAt("a\nb\nc\n", { path: "x", from: 2, to: 3 })).toBe("b\nc");
    expect(linesAt("a\nb", { path: "x", from: 2, to: 3 })).toBeUndefined();
  });
});

describe("a snippet's state as an answer says it", () => {
  it("names where it moved to, and what changed lines say now", () => {
    expect(
      snippetStanding(SNIPPET, {
        state: "moved",
        now: { path: "src/b.ts", from: 1, to: 3 },
      }),
    ).toEqual({ at: "src/a.ts#L3-L5", state: "moved", now: "src/b.ts#L1-L3" });
    expect(
      snippetStanding(SNIPPET, {
        state: "changed",
        now: { path: "src/a.ts", from: 3, to: 5 },
        says: "y",
      }),
    ).toEqual({
      at: "src/a.ts#L3-L5",
      state: "changed",
      now: "src/a.ts#L3-L5",
      says: "y",
    });
  });
});
