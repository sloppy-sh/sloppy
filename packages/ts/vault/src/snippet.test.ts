import { type CodeSnippet, snippetsOf } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { emptySidecars, fromMarkdown, toMarkdown } from "./markdown.js";
import { digestOfText, quoteOf, snippetState } from "./snippet.js";

const FILE = ["one", "two", "three", "four", "five"].join("\n");

const sha256 = digestOfText;

async function quoted(text: string, from: number, to: number) {
  const snippet = await quoteOf(text, { path: "src/a.ts", from, to });
  if (!snippet) throw new Error("nothing quoted");
  return snippet;
}

describe("quoting lines of a file", () => {
  it("holds exactly those lines and a digest of them", async () => {
    const snippet = await quoted(`${FILE}\n`, 2, 3);
    expect(snippet).toEqual({
      path: "src/a.ts",
      from: 2,
      to: 3,
      source: "two\nthree",
      digest: await sha256("two\nthree"),
      language: "ts",
    });
  });

  it("digests exactly those lines' UTF-8, with no newline after the last", async () => {
    expect((await quoted(FILE, 2, 3)).digest).toBe(
      "sha256:43fc3d02ea6e854a19e994c75467d8163dde2464c83a12a5c56c59f47f75e253",
    );
  });

  it("reads a file written with CRLF as the same lines", async () => {
    const snippet = await quoted(FILE.replace(/\n/g, "\r\n"), 2, 3);
    expect(snippet.source).toBe("two\nthree");
  });

  it("quotes nothing past the end of the file", async () => {
    expect(
      await quoteOf(FILE, { path: "src/a.ts", from: 5, to: 6 }),
    ).toBeUndefined();
  });
});

describe("where the code under a quote stands", () => {
  it("is unchanged while the lines digest the same", async () => {
    const snippet = await quoted(FILE, 2, 3);
    expect(await snippetState(snippet, FILE)).toEqual({ state: "unchanged" });
  });

  it("has moved where the same text stands elsewhere in the file", async () => {
    const snippet = await quoted(FILE, 2, 3);
    const now = `zero\nnew\n${FILE}`;
    expect(await snippetState(snippet, now)).toEqual({
      state: "moved",
      now: { path: "src/a.ts", from: 4, to: 5 },
    });
  });

  it("takes the run nearest where it was when the text stands twice", async () => {
    const snippet = await quoted("a\nb\nc\nd\nb\nc", 5, 6);
    expect(await snippetState(snippet, "x\nb\nc\nd\ne\nb\nc")).toEqual({
      state: "moved",
      now: { path: "src/a.ts", from: 6, to: 7 },
    });
  });

  it("has changed where the place is there and says something else", async () => {
    const snippet = await quoted(FILE, 2, 3);
    expect(await snippetState(snippet, "one\nTWO\nthree\nfour\nfive")).toEqual({
      state: "changed",
      now: { path: "src/a.ts", from: 2, to: 3 },
      says: "TWO\nthree",
    });
  });

  it("has changed to what is left where the file now ends inside it", async () => {
    const snippet = await quoted(FILE, 4, 5);
    expect(await snippetState(snippet, "one\ntwo\nthree\nFOUR")).toEqual({
      state: "changed",
      now: { path: "src/a.ts", from: 4, to: 4 },
      says: "FOUR",
    });
  });

  it("is removed where the file has gone, or no longer reaches it", async () => {
    const snippet = await quoted(FILE, 4, 5);
    expect(await snippetState(snippet, undefined)).toEqual({
      state: "removed",
    });
    expect(await snippetState(snippet, "one\ntwo")).toEqual({
      state: "removed",
    });
  });

  it("asks elsewhere only once the file has not got the text", async () => {
    const snippet = await quoted(FILE, 2, 3);
    const asked: CodeSnippet[] = [];
    const elsewhere = async (held: CodeSnippet) => {
      asked.push(held);
      return { path: "src/b.ts", from: 10, to: 11 };
    };
    expect(await snippetState(snippet, FILE, elsewhere)).toEqual({
      state: "unchanged",
    });
    expect(asked).toEqual([]);
    expect(await snippetState(snippet, undefined, elsewhere)).toEqual({
      state: "moved",
      now: { path: "src/b.ts", from: 10, to: 11 },
    });
  });

  it("is unknown, never broken, where the digest is spelled some other way", async () => {
    const snippet = {
      ...(await quoted(FILE, 2, 3)),
      digest: `later-algorithm:${"0f".repeat(20)}`,
    };
    expect(await snippetState(snippet, undefined)).toEqual({
      state: "unknown",
    });
  });

  it("finds no move for a quote whose text was edited by hand", async () => {
    const snippet = { ...(await quoted(FILE, 2, 3)), source: "one\ntwo" };
    expect((await snippetState(snippet, `x\n${FILE}`)).state).toBe("changed");
  });
});

describe("a quote in a vault", () => {
  it("is the fenced code a forge draws, with the reference in its info", async () => {
    const snippet = await quoted(FILE, 2, 3);
    const markdown = toMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "codeSnippet",
            attrs: { ...snippet },
          },
        ],
      },
      emptySidecars("01J0000000000000000000000C"),
    );
    expect(markdown).toBe(
      `\`\`\`ts code:src/a.ts#L2-L3 ${await sha256("two\nthree")}\ntwo\nthree\n\`\`\``,
    );
  });

  it("reads one written by hand, with or without a language", async () => {
    const digest = await sha256("x");
    const read = fromMarkdown(
      `\`\`\`code:Makefile#L4-L4 ${digest}\nx\n\`\`\`\n\n\`\`\`rust code:src/m.rs#L9 ${digest}\nx\n\`\`\``,
      emptySidecars("01J0000000000000000000000C"),
    );
    expect(snippetsOf(read)).toEqual([
      { path: "Makefile", from: 4, to: 4, digest, source: "x" },
      {
        path: "src/m.rs",
        from: 9,
        to: 9,
        digest,
        source: "x",
        language: "rust",
      },
    ]);
  });

  it("leaves a fence naming a place and no digest an ordinary fence", () => {
    const read = fromMarkdown(
      "```ts code:src/a.ts#L1-L2\n\n```",
      emptySidecars("01J0000000000000000000000C"),
    );
    expect(read.content?.[0]?.type).toBe("codeBlock");
    expect(read.content?.[0]?.attrs).toEqual({
      language: "ts code:src/a.ts#L1-L2",
    });
  });
});
