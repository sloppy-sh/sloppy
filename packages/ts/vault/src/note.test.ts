import {
  authorsOf,
  type BlockDocument,
  type BlockView,
  type EdgeLook,
  EdgeLookSchema,
  isUnstyled,
  looksWritten,
  MARK_SCALE_MAX,
  MARK_SCALE_MIN,
  type NodeAppearance,
  type NodeView,
} from "@sloppy/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { documents } from "./documents.test-support.js";
import {
  decodeText,
  inkPath,
  notePath,
  type PictureSize,
  VaultFormatError,
} from "./layout.js";
import type { EmojiDrawing } from "./markdown.js";
import { noteToVault, type NoteSource, vaultToNote } from "./note.js";

const OWNER = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const BOB = "did:syr:z6MkuBobBobBobBobBobBobBobBobBob";
const CAI = "did:syr:z6MkvCaiCaiCaiCaiCaiCaiCaiCaiCai";
const NOTE = "01J0000000000000000000000A";
const PARENT = "01J0000000000000000000000B";
const BLOCK = "01J0000000000000000000000C";
const SECOND = "01J0000000000000000000000D";

function note(over: Partial<NodeView> = {}): NodeView {
  return {
    ref: `${OWNER}/${NOTE}`,
    created_by: OWNER,
    depth: 2,
    origin: `${OWNER}/${PARENT}`,
    parent: `${OWNER}/${PARENT}`,
    address: "1a1",
    title: "What I meant: a note",
    tags: ["biology", "seed"],
    links: [`${OWNER}/${PARENT}`],
    published: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...over,
  } as NodeView;
}

function block(ulid: string, content: unknown): BlockView {
  return {
    ref: `${OWNER}/${ulid}`,
    created_by: OWNER,
    node: `${OWNER}/${NOTE}`,
    ord: "a",
    content,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as BlockView;
}

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function read(
  files: Map<string, Uint8Array>,
  pictures?: Map<string, PictureSize>,
  emoji?: Map<string, EmojiDrawing>,
) {
  const ink = new Map<string, Record<string, unknown>>();
  for (const [path, bytes] of files) {
    if (!path.endsWith(".ink.json")) continue;
    const stem = path.slice(".sloppy/ink/".length, -".ink.json".length);
    ink.set(stem, JSON.parse(decodeText(bytes)));
  }
  const source: NoteSource = {
    markdown: decodeText(files.get(notePath(NOTE)) as Uint8Array),
    ink,
    pictures,
    emoji,
  };
  return vaultToNote(source);
}

const ULIDS = [
  "01J0000000000000000000000C",
  "01J0000000000000000000000D",
  "01J0000000000000000000000E",
];

function roundTrip(contents: readonly BlockDocument[]) {
  const written = noteToVault(
    note(),
    [],
    contents.map((content, at) => block(ULIDS[at], content)),
  );
  return read(written.files, written.pictures, written.emoji).sections;
}

/** Ids of pictures somebody's own store handed back, including the ones that
 *  would read back as something other than themselves. */
const pictures = fc.oneof(
  fc.constantFrom("01J0000000000000000000000E", "17", "1e5", " x", '"q"'),
  fc.string({ minLength: 1, maxLength: 8 }),
);

const looks: fc.Arbitrary<NodeAppearance> = fc.record(
  {
    ring_weight: fc.constantFrom("none", "hairline", "regular", "heavy"),
    ring_style: fc.constantFrom("solid", "open", "notched", "dashed"),
    mark_radius: fc.constantFrom("small", "regular", "large"),
    mark_scale: fc.double({
      min: MARK_SCALE_MIN,
      max: MARK_SCALE_MAX,
      noNaN: true,
    }),
    preview: pictures,
    // A channel that says nothing is not written down, the way an attribute
    // that says nothing is not: `isUnstyled` is what reads the two the same.
    preview_more: fc.array(pictures, { minLength: 1, maxLength: 3 }),
    preview_every: fc.integer({ min: 1, max: 240 }),
    preview_transition: fc.constantFrom("none", "fade"),
    preview_size: fc.constantFrom("small", "medium", "large"),
    preview_cover: fc.double({ min: 0.42, max: 0.93, noNaN: true }),
  },
  { requiredKeys: [] },
);

describe("a note as a file", () => {
  it("writes what a person reads and cites, and reads it back", () => {
    const { files } = noteToVault(
      note(),
      ["1a", "2"],
      [block(BLOCK, paragraph("First")), block(SECOND, paragraph("Second"))],
    );
    const text = decodeText(files.get(notePath(NOTE)) as Uint8Array);
    expect(text).toBe(
      [
        "---",
        `ref: ${OWNER}/${NOTE}`,
        `parent: ${OWNER}/${PARENT}`,
        "address: 1a1",
        "aliases:",
        "  - 1a",
        "  - 2",
        "tags:",
        "  - biology",
        "  - seed",
        "links:",
        `  - ${OWNER}/${PARENT}`,
        'title: "What I meant: a note"',
        "created: 2026-01-01T00:00:00.000Z",
        "updated: 2026-01-02T00:00:00.000Z",
        "---",
        "",
        `<!-- block ${BLOCK} -->`,
        "",
        "First",
        "",
        `<!-- block ${SECOND} -->`,
        "",
        "Second",
        "",
      ].join("\n"),
    );
    expect(read(files)).toEqual({
      ref: `${OWNER}/${NOTE}`,
      parent: `${OWNER}/${PARENT}`,
      address: "1a1",
      aliases: ["1a", "2"],
      tags: ["biology", "seed"],
      links: [`${OWNER}/${PARENT}`],
      title: "What I meant: a note",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-02T00:00:00.000Z",
      sections: [
        { ulid: BLOCK, content: paragraph("First") },
        { ulid: SECOND, content: paragraph("Second") },
      ],
    });
  });

  it("leaves out a branch's parent and a note's missing address", () => {
    const { files } = noteToVault(
      note({ parent: undefined, address: undefined, tags: [], links: [] }),
      [],
      [],
    );
    const read = vaultToNote({
      markdown: decodeText(files.get(notePath(NOTE)) as Uint8Array),
    });
    expect(read.parent).toBeUndefined();
    expect(read.address).toBeUndefined();
    expect(read.aliases).toEqual([]);
    expect(read.tags).toEqual([]);
    expect(read.sections).toEqual([]);
  });

  it("writes a drawing's strokes and a picture of them beside the note", () => {
    const attrs = {
      strokes: [{ points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }], width: 2 }],
      width: 40,
      height: 20,
      description: "A line",
    };
    const { files } = noteToVault(
      note(),
      [],
      [block(BLOCK, { type: "doc", content: [{ type: "ink", attrs }] })],
    );
    expect(
      JSON.parse(decodeText(files.get(inkPath(`${BLOCK}-0`)) as Uint8Array)),
    ).toEqual(attrs);
    const svg = decodeText(
      files.get(`.sloppy/ink/${BLOCK}-0.svg`) as Uint8Array,
    );
    expect(svg).toContain("<title>A line</title>");
    expect(svg).toContain('viewBox="0 0 40 20"');
    expect(read(files).sections[0].content).toEqual({
      type: "doc",
      content: [{ type: "ink", attrs }],
    });
  });

  it("carries a picture's size out and back", () => {
    const { files, pictures } = noteToVault(
      note(),
      [],
      [
        block(BLOCK, {
          type: "doc",
          content: [
            {
              type: "picture",
              attrs: { upload_id: "up1", width: 8, height: 6 },
            },
          ],
        }),
      ],
    );
    expect(pictures).toEqual(new Map([["up1", { width: 8, height: 6 }]]));
    expect(read(files, pictures).sections[0].content).toEqual({
      type: "doc",
      content: [
        { type: "picture", attrs: { upload_id: "up1", width: 8, height: 6 } },
      ],
    });
  });

  it("carries every section of it back, whatever is written in them", {
    timeout: 60_000,
  }, () => {
    fc.assert(
      fc.property(
        fc.array(documents(), { minLength: 1, maxLength: ULIDS.length }),
        (contents) => {
          expect(roundTrip(contents)).toEqual(
            contents.map((content, at) => ({ ulid: ULIDS[at], content })),
          );
        },
      ),
      { numRuns: 10000 },
    );
  });

  it("writes the commit the note was read against beside when it changed", () => {
    const commit = "8e52d1a4c0b3f1e2d9a7c6b5a4938271605f4e3d";
    const { files } = noteToVault(note({ checked: commit }), [], []);
    const text = decodeText(files.get(notePath(NOTE)) as Uint8Array);
    expect(text).toContain(
      ["updated: 2026-01-02T00:00:00.000Z", `checked: ${commit}`].join("\n"),
    );
    expect(read(files).checked).toBe(commit);
  });

  it("leaves a note nobody has confirmed carrying no commit", () => {
    const { files } = noteToVault(note(), [], []);
    expect(decodeText(files.get(notePath(NOTE)) as Uint8Array)).not.toContain(
      "checked",
    );
    expect(read(files).checked).toBeUndefined();
  });

  it("carries the commit back however that history spells one", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 128 }), (commit) => {
        const { files } = noteToVault(note({ checked: commit }), [], []);
        expect(read(files).checked).toBe(commit);
      }),
      { numRuns: 2000 },
    );
  });

  it("carries the look its author gave the mark, whatever it says", () => {
    fc.assert(
      fc.property(looks, (look) => {
        const { files } = noteToVault(note({ appearance: look }), [], []);
        expect(read(files).appearance).toEqual(
          isUnstyled(look) ? undefined : look,
        );
      }),
      { numRuns: 2000 },
    );
  });

  it("writes the look as its own block, and none at all for a note with none", () => {
    const { files } = noteToVault(
      note({ appearance: { ring_weight: "heavy", preview_more: ["up1"] } }),
      [],
      [],
    );
    const text = decodeText(files.get(notePath(NOTE)) as Uint8Array);
    expect(text).toContain(
      [
        "appearance:",
        "  ring_weight: heavy",
        "  preview_more:",
        "    - up1",
      ].join("\n"),
    );
    for (const said of [{}, { preview_more: [] }]) {
      const { files: bare } = noteToVault(note({ appearance: said }), [], []);
      expect(decodeText(bare.get(notePath(NOTE)) as Uint8Array)).not.toContain(
        "appearance",
      );
    }
  });

  it("keeps a section whose writing reads as the start of the next one", () => {
    const source = `<!-- block ${SECOND} -->\nand then`;
    const held: BlockDocument = {
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: source }] },
      ],
    } as BlockDocument;
    expect(roundTrip([held])).toEqual([{ ulid: BLOCK, content: held }]);
  });

  it("keeps both sizes of one picture used twice", () => {
    const picture = (width: number): BlockDocument =>
      ({
        type: "doc",
        content: [
          {
            type: "picture",
            attrs: { upload_id: "up1", width, height: width },
          },
        ],
      }) as BlockDocument;
    expect(roundTrip([picture(800), picture(200)])).toEqual([
      { ulid: ULIDS[0], content: picture(800) },
      { ulid: ULIDS[1], content: picture(200) },
    ]);

    const first = noteToVault(note(), [], [block(BLOCK, picture(800))]);
    const second = noteToVault(note(), [], [block(BLOCK, picture(200))], {
      pictures: first.pictures,
      emoji: first.emoji,
    });
    expect(second.pictures.get("up1")).toEqual({ width: 800, height: 800 });
    expect(read(first.files, second.pictures).sections[0].content).toEqual(
      picture(800),
    );
    expect(read(second.files, second.pictures).sections[0].content).toEqual(
      picture(200),
    );
  });

  it("hands back how each emoji the note is written with draws", () => {
    const { emoji } = noteToVault(
      note(),
      [],
      [
        block(BLOCK, {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "emoji",
                  attrs: { name: "party_parrot", src: "https://a.example/p" },
                },
              ],
            },
          ],
        }),
      ],
    );
    expect(emoji).toEqual(
      new Map([["party_parrot", { src: "https://a.example/p" }]]),
    );
  });

  it("leaves whose writing it is out where it is the author's alone", () => {
    for (const authors of [undefined, [OWNER]]) {
      const { files } = noteToVault(note({ authors }), [], []);
      const text = decodeText(files.get(notePath(NOTE)) as Uint8Array);
      expect(text).not.toContain("authors");
      expect(text).not.toContain("owner");
      expect(text).not.toContain("contributors");
      const read = vaultToNote({ markdown: text });
      expect(read.authors).toBeUndefined();
      expect(read.owner).toBeUndefined();
      expect(read.contributors).toBeUndefined();
    }
  });

  it("carries whose writing a note is, and who gates it", () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            owner: fc.constantFrom(OWNER, BOB, CAI),
            authors: fc
              .subarray([OWNER, BOB, CAI], { minLength: 1 })
              .filter((held) => !(held.length === 1 && held[0] === OWNER)),
            contributors: fc.subarray([BOB, CAI], { minLength: 1 }),
          },
          { requiredKeys: [] },
        ),
        (whose) => {
          const { files } = noteToVault(note(whose), [], []);
          const read = vaultToNote({
            markdown: decodeText(files.get(notePath(NOTE)) as Uint8Array),
          });
          expect(read.owner).toEqual(whose.owner);
          expect(read.authors).toEqual(whose.authors);
          expect(read.contributors).toEqual(whose.contributors);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("writes whose it is under the addresses and before the writing", () => {
    const { files } = noteToVault(
      note({ owner: OWNER, authors: [OWNER, BOB], contributors: [CAI] }),
      [],
      [],
    );
    expect(decodeText(files.get(notePath(NOTE)) as Uint8Array)).toContain(
      [
        `owner: ${OWNER}`,
        "authors:",
        `  - ${OWNER}`,
        `  - ${BOB}`,
        "contributors:",
        `  - ${CAI}`,
        "tags:",
      ].join("\n"),
    );
  });

  it("reads a note written before anybody but its author could write in it", () => {
    // The file every note in every vault on disk today is: no owner, no
    // authors, no contributors.
    const read = vaultToNote({
      markdown: `---\nref: ${OWNER}/${NOTE}\ntitle: As it was\n---\n`,
    });
    expect(read.owner).toBeUndefined();
    expect(read.authors).toBeUndefined();
    expect(read.contributors).toBeUndefined();
    expect(authorsOf({ created_by: OWNER, authors: read.authors })).toEqual([
      OWNER,
    ]);
  });

  it("refuses a file that is not a note", () => {
    expect(() => vaultToNote({ markdown: "# Just some markdown" })).toThrow(
      VaultFormatError,
    );
    expect(() => vaultToNote({ markdown: "---\ntitle: x\n---\n" })).toThrow(
      VaultFormatError,
    );
  });
});

/** Words a person might write on a line, the ones that read back as something
 *  other than themselves included. */
const labels = fc.oneof(
  fc.constantFrom(
    "answers",
    "17",
    "1e5",
    " x ",
    '"q"',
    "a: b",
    "a #b",
    "- x",
    "to: y",
    "over\ntwo lines",
    "",
  ),
  fc.string({ maxLength: 12 }),
);

const TARGETS = [
  `${OWNER}/01J0000000000000000000000E`,
  `${OWNER}/01J0000000000000000000000F`,
  `${BOB}/01J0000000000000000000000G`,
];

const edges: fc.Arbitrary<EdgeLook[]> = fc
  .uniqueArray(
    fc.record(
      {
        to: fc.constantFrom(...TARGETS),
        label: labels,
        direction: fc.constantFrom("to", "from", "both"),
        stroke: fc.constantFrom("solid", "dashed", "dotted"),
      },
      { requiredKeys: ["to"] },
    ),
    { selector: (look) => look.to, maxLength: TARGETS.length },
  )
  .map((looks) => looks.map((look) => EdgeLookSchema.parse(look)));

describe("the looks a note sets on its lines", () => {
  it("writes each one as an entry, its fields in one order", () => {
    const { files } = noteToVault(
      note({
        edges: [
          {
            to: TARGETS[0],
            label: "grew out of",
            direction: "to",
            stroke: "dotted",
          },
          { to: TARGETS[1], stroke: "solid" },
        ],
      }),
      [],
      [],
    );
    expect(decodeText(files.get(notePath(NOTE)) as Uint8Array)).toContain(
      [
        "edges:",
        `  - to: ${TARGETS[0]}`,
        "    label: grew out of",
        "    direction: to",
        "    stroke: dotted",
        `  - to: ${TARGETS[1]}`,
        "    stroke: solid",
      ].join("\n"),
    );
  });

  it("writes none for a note nobody set one on, and none for a look that says nothing", () => {
    for (const held of [undefined, [], [{ to: TARGETS[0] }]] as (
      | EdgeLook[]
      | undefined
    )[]) {
      const { files } = noteToVault(note({ edges: held }), [], []);
      expect(decodeText(files.get(notePath(NOTE)) as Uint8Array)).not.toContain(
        "edges",
      );
      expect(read(files).edges).toBeUndefined();
    }
  });

  it("carries every look back, whatever a person wrote on the line", () => {
    fc.assert(
      fc.property(edges, (looks) => {
        const { files } = noteToVault(note({ edges: looks }), [], []);
        expect(read(files).edges).toEqual(looksWritten(looks));
      }),
      { numRuns: 5000 },
    );
  });

  it("leaves the rest of the note alone beside them", () => {
    const { files } = noteToVault(
      note({ edges: [{ to: TARGETS[0], label: "cites" }] }),
      ["1a"],
      [block(BLOCK, paragraph("First"))],
    );
    const held = read(files);
    expect(held.links).toEqual([`${OWNER}/${PARENT}`]);
    expect(held.aliases).toEqual(["1a"]);
    expect(held.title).toBe("What I meant: a note");
    expect(held.sections).toEqual([
      { ulid: BLOCK, content: paragraph("First") },
    ]);
  });

  it("costs the look and not the note where a hand got one wrong", () => {
    const { files } = noteToVault(
      note({ edges: [{ to: TARGETS[0], label: "cites" }] }),
      [],
      [],
    );
    const text = decodeText(files.get(notePath(NOTE)) as Uint8Array).replace(
      `  - to: ${TARGETS[0]}`,
      "  - to: 1a",
    );
    const held = vaultToNote({ markdown: text });
    expect(held.edges).toBeUndefined();
    expect(held.title).toBe("What I meant: a note");
  });
});
