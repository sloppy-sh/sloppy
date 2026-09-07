// The words a search reads a section by, derived from the document it stores.

import { describe, expect, it } from "vitest";
import { wordsOf } from "./text";

describe("the words derived from a section", () => {
  it("reads a paragraph in the order it was written", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "The mushrooms grew" },
              { type: "text", text: " where the seeds fell." },
            ],
          },
        ],
      }),
    ).toBe("The mushrooms grew where the seeds fell.");
  });

  it("reaches through every section of a document, headings and lists too", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Spores" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "damp" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe("Spores damp");
  });

  it("reads an element this build has no renderer for", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          { type: "someLaterKind", content: [{ type: "text", text: "still" }] },
        ],
      }),
    ).toBe("still");
  });

  it("carries a marked run, because a mark is not what holds the words", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "emphasised",
                marks: [{ type: "em" }],
              },
            ],
          },
        ],
      }),
    ).toBe("emphasised");
  });

  it("collapses the whitespace a document breaks its lines with", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: " one \n" }] },
          { type: "paragraph", content: [{ type: "text", text: "  two  " }] },
        ],
      }),
    ).toBe("one two");
  });

  it("answers nothing for a section with only a drawing in it", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [{ type: "ink", attrs: { strokes: [{ points: [1, 2, 3] }] } }],
      }),
    ).toBe("");
  });

  // A drawing holds no words of its own, so what somebody said it is is the
  // only thing a search of it can read.
  it("reads what somebody said a drawing is", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          {
            type: "ink",
            attrs: {
              strokes: [{ points: [1, 2, 3] }],
              description: "the mycelium spreading",
            },
          },
        ],
      }),
    ).toBe("the mycelium spreading");
  });

  // Nor does a picture, so what somebody said it is is the only thing a search
  // of it can read.
  it("reads what somebody said a picture is", () => {
    expect(
      wordsOf({
        type: "doc",
        content: [
          {
            type: "picture",
            attrs: {
              upload_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
              width: 40,
              height: 20,
              alt: "a kite over the allotment",
            },
          },
        ],
      }),
    ).toBe("a kite over the allotment");
  });

  it("takes writing kept as a bare string as its own words", () => {
    expect(wordsOf("what somebody wrote before documents")).toBe(
      "what somebody wrote before documents",
    );
  });

  it("answers nothing for writing that is not there at all", () => {
    expect(wordsOf(undefined)).toBe("");
    expect(wordsOf(null)).toBe("");
  });
});
