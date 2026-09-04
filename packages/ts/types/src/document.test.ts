import { describe, expect, it } from "vitest";
import { BlockSchema } from "./block.js";
import {
  BlockDocumentSchema,
  citedNotes,
  citedUploads,
  EMOJI_UPLOAD_ATTR,
  MAX_DOCUMENT_NESTING,
  REFERENCE_NODE,
  REFERENCE_NOTE_ATTR,
} from "./document.js";

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

describe("the assets a section cites", () => {
  const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
  const cite = (content: unknown[]) =>
    citedUploads(BlockDocumentSchema.parse({ type: "doc", content }));

  it("are the uploads its elements name", () => {
    expect(
      cite([
        { type: "picture", attrs: { upload_id: `${AVA}/01PIC`, width: 40 } },
        {
          type: "ink",
          attrs: {
            strokes: [],
            width: 4,
            height: 4,
            raster_upload_id: `${AVA}/01INK`,
          },
        },
      ]).sort(),
    ).toEqual([`${AVA}/01INK`, `${AVA}/01PIC`]);
  });

  it("are found inside an element kind nothing here has a renderer for", () => {
    // Publishing has to copy what a peer will read, and a kind this build
    // cannot draw is carried untouched — so its pictures travel with it.
    expect(
      cite([
        {
          type: "diagram-from-a-later-build",
          attrs: { panels: [{ upload_id: `${AVA}/01FUTURE` }] },
        },
      ]),
    ).toEqual([`${AVA}/01FUTURE`]);
  });

  it("name one upload once however many elements draw it", () => {
    const twice = { type: "picture", attrs: { upload_id: `${AVA}/01PIC` } };
    expect(cite([twice, twice])).toEqual([`${AVA}/01PIC`]);
  });

  it("are nothing on an emoji as its author wrote it, which names a shortcode", () => {
    // The case publishing cannot delegate to this walk: there is no upload on
    // the element to copy, only a name in a catalog.
    expect(
      cite([
        {
          type: "paragraph",
          content: [
            { type: "emoji", attrs: { name: "kite", char: "", sticker: true } },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("are the emoji's copy once publishing has written it on", () => {
    expect(
      cite([
        {
          type: "paragraph",
          content: [
            {
              type: "emoji",
              attrs: {
                name: "kite",
                char: "",
                sticker: true,
                [EMOJI_UPLOAD_ATTR]: `${AVA}/01EMOJI`,
              },
            },
          ],
        },
      ]),
    ).toEqual([`${AVA}/01EMOJI`]);
  });

  it("are nothing where a citation is empty or is not one", () => {
    expect(
      cite([
        { type: "picture", attrs: { upload_id: "" } },
        { type: "picture", attrs: { upload_id: null } },
        { type: "paragraph", content: [{ type: "text", text: "upload_id" }] },
      ]),
    ).toEqual([]);
  });
});

describe("the notes a section cites", () => {
  const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
  const BEN = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
  const ulid = (n: number) => `01JPBSHEDX${String(n).padStart(16, "0")}`;
  const SEED = `${AVA}/${ulid(1)}`;
  const TIDE = `${BEN}/${ulid(2)}`;

  const cite = (content: unknown[]) =>
    citedNotes(BlockDocumentSchema.parse({ type: "doc", content }));

  const reference = (note: unknown, label = "a note") => ({
    type: REFERENCE_NODE,
    attrs: { [REFERENCE_NOTE_ATTR]: note, label },
  });

  it("are nothing where nobody cited one", () => {
    expect(
      cite([
        { type: "paragraph", content: [{ type: "text", text: "a thought" }] },
      ]),
    ).toEqual([]);
  });

  it("are the notes its references name, however deep the writing goes", () => {
    expect(
      cite([
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "see " },
                    reference(SEED, "The seed"),
                  ],
                },
              ],
            },
          ],
        },
        { type: "paragraph", content: [reference(TIDE, "The tide")] },
      ]),
    ).toEqual([SEED, TIDE]);
  });

  it("name one note once however often the writing cites it", () => {
    expect(
      cite([
        { type: "paragraph", content: [reference(SEED), reference(SEED)] },
        { type: "paragraph", content: [reference(TIDE)] },
        { type: "paragraph", content: [reference(SEED)] },
      ]),
    ).toEqual([SEED, TIDE]);
  });

  it("skip a reference that names anything but a note", () => {
    expect(
      cite([
        {
          type: "paragraph",
          content: [
            reference(""),
            reference("the seed"),
            reference(AVA),
            reference(`${AVA}/not-a-ulid`),
            reference(null),
            reference(7),
            { type: REFERENCE_NODE },
            reference(SEED),
          ],
        },
      ]),
    ).toEqual([SEED]);
  });

  it("are nothing on an element that merely holds a ref", () => {
    // A ref in another element's payload is not a citation, and reading one as
    // an edge would draw a line nobody wrote.
    expect(
      cite([
        { type: "picture", attrs: { upload_id: SEED } },
        { type: "paragraph", content: [{ type: "text", text: SEED }] },
      ]),
    ).toEqual([]);
  });
});
