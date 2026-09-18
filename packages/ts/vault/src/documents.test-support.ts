// Documents of every kind the editor writes, generated. The shapes here are
// the ones a vault carries: an attribute that says nothing — `null`, `""`,
// `false` — is not one of them, because a vault does not write those down.

import type { DocumentMark, DocumentNode } from "@sloppy/types";
import fc from "fast-check";

const LETTERS = [..."ab XY", ..."*_`~[]()#<>=+-.!$:", ..."\\'\"{}|/", ..."019"];

const words = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 8 })
  .map((held) => held.join(""));

const MARKS = ["link", "bold", "italic", "strike", "code"] as const;

const REF =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01J0000000000000000000000A";
const OTHER_REF =
  "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE/01J0000000000000000000000E";

const marks: fc.Arbitrary<DocumentMark[]> = fc
  .subarray([...MARKS])
  .chain((chosen) =>
    fc
      .constantFrom(
        "https://a.example/x",
        "sloppy:not-a-ref",
        // A link somebody wrote to a note, which a citation of that note reads
        // exactly like.
        `sloppy:${REF}`,
      )
      .map((href) =>
        chosen.map((type) =>
          type === "link" ? { type, attrs: { href } } : { type },
        ),
      ),
  );

const run: fc.Arbitrary<DocumentNode> = fc
  .tuple(words, marks)
  .map(([text, held]) =>
    held.length > 0
      ? { type: "text", text, marks: held }
      : { type: "text", text },
  );

const atoms: fc.Arbitrary<DocumentNode> = fc.oneof(
  fc.constant({ type: "hardBreak" }),
  fc
    .tuple(fc.constantFrom("smile", "party_parrot"), fc.boolean())
    .map(([name, sticker]) => ({
      type: "emoji",
      attrs: { name, char: "🙂", ...(sticker ? { sticker: true } : {}) },
    })),
  words.map((label) => ({
    type: "reference",
    attrs: { note: REF, label },
  })),
  words.map((tex) => ({ type: "math", attrs: { tex } })),
  fc.constant({ type: "unheardOf", attrs: { held: [1, null, "x"] } }),
);

/** Two runs of text carrying the same marks are one run: that is what the
 *  editor stores and what reading one back gives. */
function merged(nodes: readonly DocumentNode[]): DocumentNode[] {
  const out: DocumentNode[] = [];
  for (const held of nodes) {
    const last = out[out.length - 1];
    if (
      last &&
      last.type === "text" &&
      held.type === "text" &&
      JSON.stringify(last.marks) === JSON.stringify(held.marks)
    ) {
      out[out.length - 1] = {
        ...last,
        text: (last.text ?? "") + (held.text ?? ""),
      };
      continue;
    }
    out.push(held);
  }
  return out;
}

const inline = fc
  .array(
    fc.oneof({ weight: 3, arbitrary: run }, { weight: 1, arbitrary: atoms }),
    {
      maxLength: 4,
    },
  )
  .map(merged);

const UPLOAD = "01J0000000000000000000000B";

/** A source somebody wrote that reads as the start of the next section. */
const OPENS_A_SECTION = "one\n<!-- block 01J0000000000000000000000D -->\ntwo";

function element(
  type: string,
  attrs: Record<string, unknown>,
  content?: DocumentNode[],
): DocumentNode {
  const made: DocumentNode = { type };
  if (Object.keys(attrs).length > 0) made.attrs = attrs;
  if (content && content.length > 0) made.content = content;
  return made;
}

const slot = fc.array(fc.constantFrom({ note: REF }, { note: OTHER_REF }), {
  maxLength: 2,
});

/** The four slots the editor writes, and the shapes a hand or a later build
 *  leaves behind — a slot missing, a slot holding something that cites no note,
 *  a place carrying more than the citation — which the vault carries as JSON
 *  rather than as lines. */
const compasses: fc.Arbitrary<DocumentNode> = fc.oneof(
  fc.tuple(slot, slot, slot, slot).map(([north, south, east, west]) => ({
    type: "compass",
    attrs: { north, south, east, west },
  })),
  fc.constant({ type: "compass", attrs: { north: [{ note: REF }] } }),
  fc.constant({
    type: "compass",
    attrs: { north: [REF], south: [], east: [], west: [] },
  }),
  fc.constant({
    type: "compass",
    attrs: {
      north: [{ note: "not-a-ref" }],
      south: [],
      east: [],
      west: [],
    },
  }),
  fc.constant({
    type: "compass",
    attrs: {
      north: [{ note: REF, label: "the tides" }],
      south: [],
      east: [],
      west: [],
    },
  }),
  fc.constant({
    type: "compass",
    attrs: { north: [], south: [], east: [], west: [], why: "later" },
  }),
);

const leaves: fc.Arbitrary<DocumentNode> = fc.oneof(
  inline.map((content) => element("paragraph", {}, content)),
  fc
    .tuple(fc.integer({ min: 1, max: 6 }), inline)
    .map(([level, content]) => element("heading", { level }, content)),
  fc.constant({ type: "horizontalRule" }),
  fc
    .tuple(
      fc.option(fc.constantFrom("ts", "rust", "mermaid"), { nil: undefined }),
      fc.oneof(
        words,
        fc.constant("a\n\nb"),
        fc.constant("```\nx"),
        fc.constant(OPENS_A_SECTION),
      ),
    )
    .map(([language, source]) =>
      element("codeBlock", language === undefined ? {} : { language }, [
        { type: "text", text: source },
      ]),
    ),
  fc
    .oneof(words, fc.constant("graph TD;\nA-->B"), fc.constant(OPENS_A_SECTION))
    .map((source) => element("diagram", { language: "mermaid", source })),
  fc
    .oneof(words, fc.constant("x = 1\n$ y"), fc.constant(OPENS_A_SECTION))
    .map((tex) => element("mathBlock", { tex })),
  fc
    .tuple(
      fc.option(words, { nil: undefined }),
      fc.option(fc.integer({ min: 1, max: 4000 }), { nil: undefined }),
    )
    .map(([alt, width]) =>
      element("picture", {
        upload_id: UPLOAD,
        ...(alt === undefined ? {} : { alt }),
        ...(width === undefined ? {} : { width, height: 100 }),
      }),
    ),
  fc.constant({
    type: "ink",
    attrs: {
      strokes: [{ points: [{ x: 1, y: 2, pressure: 0.5, t: 0 }], width: 2 }],
      width: 300,
      height: 120,
      raster_upload_id: null,
      description: "A shape",
    },
  }),
  compasses,
  fc.constant({ type: "fromTheFuture", attrs: { whatever: { deep: true } } }),
);

/** A section's document, as deep as a person nests one. */
export function documents(): fc.Arbitrary<{
  type: "doc";
  content: DocumentNode[];
}> {
  const { blocks } = fc.letrec((tie) => ({
    blocks: fc.oneof(
      { maxDepth: 2, withCrossShrink: true },
      leaves,
      fc
        .array(tie("blocks") as fc.Arbitrary<DocumentNode>, {
          minLength: 1,
          maxLength: 2,
        })
        .map((content) => element("blockquote", {}, content)),
      fc
        .tuple(
          fc.integer({ min: 1, max: 3 }),
          fc.array(
            fc.array(tie("blocks") as fc.Arbitrary<DocumentNode>, {
              minLength: 1,
              maxLength: 2,
            }),
            { minLength: 1, maxLength: 3 },
          ),
        )
        .map(([start, items]) =>
          element(
            "orderedList",
            { start },
            items.map((content) => element("listItem", {}, content)),
          ),
        ),
      fc
        .array(
          fc.array(tie("blocks") as fc.Arbitrary<DocumentNode>, {
            minLength: 1,
            maxLength: 2,
          }),
          { minLength: 1, maxLength: 3 },
        )
        .map((items) =>
          element(
            "bulletList",
            {},
            items.map((content) => element("listItem", {}, content)),
          ),
        ),
      fc
        .array(
          fc.tuple(
            fc.boolean(),
            fc.array(tie("blocks") as fc.Arbitrary<DocumentNode>, {
              minLength: 1,
              maxLength: 2,
            }),
          ),
          { minLength: 1, maxLength: 3 },
        )
        .map((items) =>
          element(
            "taskList",
            {},
            items.map(([checked, content]) =>
              element("taskItem", checked ? { checked: true } : {}, content),
            ),
          ),
        ),
    ),
  }));
  return fc
    .array(blocks as fc.Arbitrary<DocumentNode>, { maxLength: 4 })
    .map((content) => ({ type: "doc" as const, content }));
}
