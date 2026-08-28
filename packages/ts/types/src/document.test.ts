import { describe, expect, it } from "vitest";
import { BlockSchema } from "./block.js";
import { BlockDocumentSchema, MAX_DOCUMENT_NESTING } from "./document.js";

/**
 * A document nesting exactly `levels` deep, counted the way the bound counts:
 * the doc, its content array and the one element in it are the first three,
 * and the rest of the depth is spent inside that element's `attrs`.
 */
function nested(levels: number): unknown {
  let attrs: Record<string, unknown> = {};
  for (let made = 4; made < levels; made += 1) attrs = { held: attrs };
  return { type: "doc", content: [{ type: "paragraph", attrs }] };
}

/** The same depth, spent on elements holding elements instead. */
function indented(indents: number): unknown {
  let node: Record<string, unknown> = { type: "paragraph" };
  for (let made = 0; made < indents; made += 1) {
    node = { type: "blockquote", content: [node] };
  }
  return { type: "doc", content: [node] };
}

/** A bulleted list indented `indents` times, as the editor writes one. */
function bulleted(indents: number): unknown {
  let item: Record<string, unknown> = {
    type: "listItem",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "a thought" }] },
    ],
  };
  for (let made = 1; made < indents; made += 1) {
    item = {
      type: "listItem",
      content: [{ type: "bulletList", content: [item] }],
    };
  }
  return { type: "doc", content: [{ type: "bulletList", content: [item] }] };
}

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

  it("takes a document nested to the bound", () => {
    expect(() =>
      BlockDocumentSchema.parse(nested(MAX_DOCUMENT_NESTING)),
    ).not.toThrow();
  });

  it("refuses one nested past it, wherever the depth is spent", () => {
    expect(() =>
      BlockDocumentSchema.parse(nested(MAX_DOCUMENT_NESTING + 1)),
    ).toThrow(/nested too deeply/);
    expect(() =>
      BlockDocumentSchema.parse(indented(MAX_DOCUMENT_NESTING)),
    ).toThrow(/nested too deeply/);
  });

  // docs/ARCHITECTURE.md § "Blocks and ink" says the bound still takes a list
  // indented ten times, which is a claim about this shape and not about depth.
  it("takes a list indented ten times", () => {
    expect(() => BlockDocumentSchema.parse(bulleted(10))).not.toThrow();
  });

  // A refinement on an object schema takes these away, and the throw lands at
  // import — nothing a type-check or a route test would ever reach.
  it("can still be narrowed the way a schema is", () => {
    expect(() => BlockDocumentSchema.omit({ type: true })).not.toThrow();
    expect(() => BlockDocumentSchema.partial()).not.toThrow();
  });

  it("opens a block nobody has written in yet", () => {
    const empty = BlockSchema.shape.content.parse(undefined);
    expect(empty).toEqual({ type: "doc", content: [] });
    expect(BlockSchema.shape.content.parse(undefined)).not.toBe(empty);
  });
});
