import { describe, expect, it } from "vitest";
import { BlockSchema } from "./block.js";
import { BlockDocumentSchema } from "./document.js";

const section = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "A section" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "with " },
        { type: "text", marks: [{ type: "bold" }], text: "several" },
        { type: "text", text: " elements in it." },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "one" }] },
          ],
        },
      ],
    },
    {
      type: "ink",
      attrs: {
        strokes: [{ points: [{ x: 1, y: 2, pressure: 0.4, t: 0 }], width: 2 }],
        width: 320,
        height: 240,
      },
    },
  ],
};

describe("the document a block stores", () => {
  it("keeps a whole section, nesting and drawings included", () => {
    expect(BlockDocumentSchema.parse(section)).toEqual(section);
  });

  it("carries an element kind it has no renderer for", () => {
    const doc = {
      type: "doc",
      content: [{ type: "sketchpad", attrs: { later: true } }],
    };
    expect(BlockDocumentSchema.parse(doc)).toEqual(doc);
  });

  it("refuses what is not a document", () => {
    for (const wrong of [
      "# A heading",
      null,
      [],
      { type: "paragraph" },
      { type: "doc", content: {} },
    ]) {
      expect(() => BlockDocumentSchema.parse(wrong)).toThrow();
    }
  });

  it("refuses an element that names no kind", () => {
    expect(() =>
      BlockDocumentSchema.parse({
        type: "doc",
        content: [{ attrs: { level: 2 } }],
      }),
    ).toThrow();
  });

  it("opens a block nobody has written in yet", () => {
    const empty = BlockSchema.shape.content.parse(undefined);
    expect(empty).toEqual({ type: "doc", content: [] });
    expect(BlockSchema.shape.content.parse(undefined)).not.toBe(empty);
  });
});
