import type { BlockDocument } from "@sloppy/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { documents } from "./documents.test-support.js";
import type { Sidecars } from "./markdown.js";
import { emptySidecars, fromMarkdown, toMarkdown } from "./markdown.js";

const BLOCK = "01J0000000000000000000000C";

/** Everything the conversion writes: the text, and the files beside it. */
function written(document: BlockDocument): {
  text: string;
  sidecars: Sidecars;
} {
  const sidecars = emptySidecars(BLOCK);
  return { text: toMarkdown(document, sidecars), sidecars };
}

function files(written: { text: string; sidecars: Sidecars }): string {
  const { text, sidecars } = written;
  return JSON.stringify([
    text,
    [...sidecars.pictures],
    [...sidecars.ink],
    [...sidecars.emoji],
  ]);
}

function readBack(document: BlockDocument): BlockDocument {
  const held = written(document);
  return fromMarkdown(held.text, held.sidecars);
}

describe("a document through a vault", () => {
  it("comes back as itself", { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(documents(), (document) => {
        expect(readBack(document)).toEqual(document);
      }),
      { numRuns: 20000 },
    );
  });

  it("never writes the same files for two documents that differ", () => {
    fc.assert(
      fc.property(documents(), documents(), (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(files(written(a))).not.toEqual(files(written(b)));
      }),
      { numRuns: 2000 },
    );
  });
});

describe("what markdown carries", () => {
  const doc = (...content: unknown[]): BlockDocument =>
    ({ type: "doc", content }) as BlockDocument;

  it("writes prose, headings and lists a person can read", () => {
    const { text } = written(
      doc(
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Seeds" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "one ", marks: [] },
            { type: "text", text: "two", marks: [{ type: "bold" }] },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "done" }],
                },
              ],
            },
          ],
        },
      ),
    );
    expect(text).toBe("## Seeds\n\none **two**\n\n- a\n\n- [x] done");
  });

  it("writes an emoji as its shortcode and a citation as a link", () => {
    const ref =
      "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01J0000000000000000000000A";
    const { text, sidecars } = written(
      doc({
        type: "paragraph",
        content: [
          {
            type: "emoji",
            attrs: { name: "smile", char: "🙂", sticker: false },
          },
          { type: "reference", attrs: { note: ref, label: "That note" } },
        ],
      }),
    );
    expect(text).toBe(`:smile:[That note](sloppy:${ref})`);
    expect(sidecars.emoji.get("smile")).toEqual({ char: "🙂" });
  });

  it("writes a link as the address somebody wrote", () => {
    const link = (attrs: Record<string, unknown>): BlockDocument =>
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "see " },
          { type: "text", text: "this page", marks: [{ type: "link", attrs }] },
        ],
      });
    const href = "https://example.com/";
    expect(written(link({ href })).text).toBe(
      "see [this page](https://example.com/)",
    );
    expect(
      written(
        link({
          href,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          class: null,
          title: null,
        }),
      ).text,
    ).toBe("see [this page](https://example.com/)");
    expect(readBack(link({ href }))).toEqual(link({ href }));
  });

  it("writes an anchor into code as the path somebody wrote", () => {
    const anchor = (href: string): BlockDocument =>
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "the parser",
            marks: [{ type: "link", attrs: { href } }],
          },
        ],
      });
    for (const href of [
      "code:src/api.ts",
      "code:src/api.ts#L12-L20",
      "code:packages/ts/vault/src/markdown.ts#fromMarkdown",
    ]) {
      expect(written(anchor(href)).text).toBe(`[the parser](${href})`);
      expect(readBack(anchor(href))).toEqual(anchor(href));
    }
  });

  it("writes a link to a note as itself, so a citation stays a citation", () => {
    const ref =
      "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01J0000000000000000000000A";
    const held = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "That note",
          marks: [{ type: "link", attrs: { href: `sloppy:${ref}` } }],
        },
      ],
    });
    const { text } = written(held);
    expect(text).toContain("<!-- sloppy:span ");
    expect(readBack(held)).toEqual(held);
  });

  it("writes a picture into media and its size beside it", () => {
    const { text, sidecars } = written(
      doc({
        type: "picture",
        attrs: { upload_id: "up1", alt: "A tree", width: 800, height: 600 },
      }),
    );
    expect(text).toBe("![A tree](media/up1)");
    expect(sidecars.pictures.get("up1")).toEqual({ width: 800, height: 600 });
  });

  it("links a picture at the file the vault holds it in", () => {
    const sidecars = emptySidecars(BLOCK);
    sidecars.media.set("up1", "media/up1.png");
    const text = toMarkdown(
      doc({ type: "picture", attrs: { upload_id: "up1" } }),
      sidecars,
    );
    expect(text).toBe("![](media/up1.png)");
    expect(fromMarkdown(text, sidecars)).toEqual(
      doc({ type: "picture", attrs: { upload_id: "up1" } }),
    );
  });

  it("writes a drawing as its strokes beside a picture of them", () => {
    const attrs = { strokes: [], width: 10, height: 10 };
    const { text, sidecars } = written(doc({ type: "ink", attrs }));
    expect(text).toBe(`![](.sloppy/ink/${BLOCK}-0.svg)`);
    expect(sidecars.ink.get(`${BLOCK}-0`)).toEqual(attrs);
  });

  it("opens a section around a drawing whose strokes were deleted", () => {
    const text = `![Waves](.sloppy/ink/${BLOCK}-0.svg)`;
    expect(fromMarkdown(text, emptySidecars(BLOCK))).toEqual(
      doc({
        type: "ink",
        attrs: { strokes: [], width: 600, height: 200, description: "Waves" },
      }),
    );
  });

  it("reads an attribute that says nothing as one nobody wrote", () => {
    expect(
      readBack(
        doc({
          type: "codeBlock",
          attrs: { language: null },
          content: [{ type: "text", text: "x" }],
        }),
      ),
    ).toEqual(
      doc({ type: "codeBlock", content: [{ type: "text", text: "x" }] }),
    );
    expect(
      readBack(
        doc({
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
              ],
            },
          ],
        }),
      ),
    ).toEqual(
      doc({
        type: "taskList",
        content: [
          {
            type: "taskItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "a" }] },
            ],
          },
        ],
      }),
    );
  });

  it("writes a code block in a diagram's language as itself", () => {
    const held = doc({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [{ type: "text", text: "graph TD;" }],
    });
    const { text } = written(held);
    expect(text.startsWith("<!-- sloppy:node ")).toBe(true);
    expect(readBack(held)).toEqual(held);
  });

  it("writes a fence that would open the next section as itself", () => {
    const held = doc({
      type: "codeBlock",
      content: [{ type: "text", text: `<!-- block ${BLOCK} -->` }],
    });
    const { text } = written(held);
    expect(text.startsWith("<!-- sloppy:node ")).toBe(true);
    expect(readBack(held)).toEqual(held);
  });

  it("carries an element kind it has never heard of", () => {
    const held = doc({ type: "hologram", attrs: { spin: 3 } });
    const { text } = written(held);
    expect(text).toBe(
      '<!-- sloppy:node {"type":"hologram","attrs":{"spin":3}} -->',
    );
    expect(readBack(held)).toEqual(held);
  });

  it("keeps a comment closing sequence out of the comment", () => {
    const held = doc({ type: "hologram", attrs: { says: "a --> b" } });
    expect(readBack(held)).toEqual(held);
  });
});

describe("a compass in a section", () => {
  const doc = (...content: unknown[]): BlockDocument =>
    ({ type: "doc", content }) as BlockDocument;

  const DID = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
  const TIDES = `${DID}/01J0000000000000000000000A`;
  const MOON = `${DID}/01J0000000000000000000000E`;

  /** The places one slot holds, as the editor writes them: a citation under the
   *  same key a sentence cites a note under. */
  const cite = (...refs: string[]) => refs.map((note) => ({ note }));

  const compass = (slots: Record<string, unknown> = {}) =>
    doc({
      type: "compass",
      attrs: { north: [], south: [], east: [], west: [], ...slots },
    });

  it("is a line per filled slot, in the order the slots are written", () => {
    expect(
      written(compass({ west: cite(MOON), north: cite(TIDES, MOON) })).text,
    ).toBe(`north: [[${TIDES}]] [[${MOON}]]\nwest: [[${MOON}]]`);
  });

  it("comes back as itself", () => {
    expect(readBack(compass({ south: cite(TIDES) }))).toEqual(
      compass({ south: cite(TIDES) }),
    );
  });

  it("writes an empty one as itself, because it has no lines", () => {
    const held = compass();
    expect(written(held).text.startsWith("<!-- sloppy:node ")).toBe(true);
    expect(readBack(held)).toEqual(held);
  });

  it("writes a slot carrying more than the citation as JSON", () => {
    const held = compass({ north: [{ note: TIDES, label: "the tides" }] });
    expect(written(held).text.startsWith("<!-- sloppy:node ")).toBe(true);
    expect(readBack(held)).toEqual(held);
  });

  it("is two compasses where a person wrote two", () => {
    const held = doc(
      {
        type: "compass",
        attrs: { north: cite(TIDES), south: [], east: [], west: [] },
      },
      {
        type: "compass",
        attrs: { north: cite(MOON), south: [], east: [], west: [] },
      },
    );
    expect(written(held).text).toBe(
      `north: [[${TIDES}]]\n\nnorth: [[${MOON}]]`,
    );
    expect(readBack(held)).toEqual(held);
  });

  it("leaves prose that reads like a slot as prose", () => {
    const held = doc({
      type: "paragraph",
      content: [{ type: "text", text: `north: [[${TIDES}]]` }],
    });
    const { text } = written(held);
    expect(text).not.toContain("[[");
    expect(readBack(held)).toEqual(held);
  });
});
