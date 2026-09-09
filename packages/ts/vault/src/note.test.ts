import type { BlockDocument, BlockView, NodeView } from "@sloppy/types";
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

  it("refuses a file that is not a note", () => {
    expect(() => vaultToNote({ markdown: "# Just some markdown" })).toThrow(
      VaultFormatError,
    );
    expect(() => vaultToNote({ markdown: "---\ntitle: x\n---\n" })).toThrow(
      VaultFormatError,
    );
  });
});
