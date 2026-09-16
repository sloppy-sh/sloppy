import type {
  AmendmentSection,
  AmendmentView,
  BlockDocument,
  BlockView,
  NodeView,
} from "@sloppy/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { amendmentToVault, inkOffered, vaultToAmendment } from "./amendment.js";
import { documents } from "./documents.test-support.js";
import {
  amendmentPath,
  decodeText,
  inkPath,
  VaultFormatError,
} from "./layout.js";
import { noteToVault } from "./note.js";

const OWNER = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";
const BOB = "did:syr:z6MkuBobBobBobBobBobBobBobBobBob";
const OFFER = "01J0000000000000000000000F";
const NOTE = "01J0000000000000000000000A";
const SECTIONS = [
  "01J0000000000000000000000C",
  "01J0000000000000000000000D",
  "01J0000000000000000000000E",
];

function section(ulid: string, content: unknown): AmendmentSection {
  return { ref: `${OWNER}/${ulid}`, content } as AmendmentSection;
}

function offer(over: Partial<AmendmentView> = {}): AmendmentView {
  return {
    ref: `${OWNER}/${OFFER}`,
    created_by: OWNER,
    note: `${OWNER}/${NOTE}`,
    by: BOB,
    at: "2026-02-01T00:00:00.000Z",
    title: "As I would have it",
    tags: ["seed"],
    blocks: [],
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    ...over,
  } as AmendmentView;
}

function read(files: Map<string, Uint8Array>) {
  return vaultToAmendment({
    markdown: decodeText(files.get(amendmentPath(OFFER)) as Uint8Array),
  });
}

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("an offered change as a file", () => {
  it("writes what is offered, and reads it back", () => {
    const { files } = amendmentToVault(
      offer({
        message: "I think this reads better.",
        blocks: [section(SECTIONS[0], paragraph("As I would have it"))],
      }),
    );
    expect(decodeText(files.get(amendmentPath(OFFER)) as Uint8Array)).toBe(
      [
        "---",
        `amends: ${OWNER}/${NOTE}`,
        `by: ${BOB}`,
        "at: 2026-02-01T00:00:00.000Z",
        "message: I think this reads better.",
        "title: As I would have it",
        "tags:",
        "  - seed",
        "---",
        "",
        `<!-- block ${SECTIONS[0]} -->`,
        "",
        "As I would have it",
        "",
      ].join("\n"),
    );
    expect(read(files)).toEqual({
      amends: `${OWNER}/${NOTE}`,
      by: BOB,
      at: "2026-02-01T00:00:00.000Z",
      message: "I think this reads better.",
      title: "As I would have it",
      tags: ["seed"],
      sections: [
        { ulid: SECTIONS[0], content: paragraph("As I would have it") },
      ],
    });
  });

  it("leaves out what was not said", () => {
    const held = read(amendmentToVault(offer({ tags: [] })).files);
    expect(held.message).toBeUndefined();
    expect(held.appearance).toBeUndefined();
    expect(held.tags).toEqual([]);
    expect(held.sections).toEqual([]);
  });

  it("carries the look it offers", () => {
    const held = read(
      amendmentToVault(offer({ appearance: { ring_weight: "heavy" } })).files,
    );
    expect(held.appearance).toEqual({ ring_weight: "heavy" });
  });

  it("carries every section it offers, whatever is written in them", () => {
    fc.assert(
      fc.property(
        fc.array(documents(), { minLength: 1, maxLength: SECTIONS.length }),
        (contents: BlockDocument[]) => {
          const written = amendmentToVault(
            offer({
              blocks: contents.map((content, at) =>
                section(SECTIONS[at], content),
              ),
            }),
          );
          const ink = new Map<string, Record<string, unknown>>();
          for (const [path, bytes] of written.files) {
            if (!path.endsWith(".ink.json")) continue;
            const stem = path.slice(".sloppy/ink/".length, -".ink.json".length);
            ink.set(stem, JSON.parse(decodeText(bytes)));
          }
          const back = vaultToAmendment({
            markdown: decodeText(
              written.files.get(amendmentPath(OFFER)) as Uint8Array,
            ),
            ink,
            pictures: written.pictures,
            emoji: written.emoji,
          });
          expect(back.sections).toEqual(
            contents.map((content, at) => ({ ulid: SECTIONS[at], content })),
          );
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("writes a drawing it offers beside the note's rather than over it", () => {
    const attrs = {
      strokes: [{ points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }], width: 2 }],
      width: 40,
      height: 20,
    };
    const drawn = { type: "doc", content: [{ type: "ink", attrs }] };
    const note = noteToVault(
      {
        ref: `${OWNER}/${NOTE}`,
        created_by: OWNER,
        depth: 1,
        origin: `${OWNER}/${NOTE}`,
        title: "Seeds",
        tags: [],
        links: [],
        published: false,
        created_at: "2026-02-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      } as NodeView,
      [],
      [
        {
          ref: `${OWNER}/${SECTIONS[0]}`,
          created_by: OWNER,
          node: `${OWNER}/${NOTE}`,
          ord: "00000000",
          content: drawn,
          created_at: "2026-02-01T00:00:00.000Z",
          updated_at: "2026-02-01T00:00:00.000Z",
        } as BlockView,
      ],
    );
    const { files } = amendmentToVault(
      offer({ blocks: [section(SECTIONS[0], drawn as BlockDocument)] }),
    );

    const written = [...files.keys()].filter((path) =>
      path.endsWith(".ink.json"),
    );
    expect(written).toEqual([inkPath(`${OFFER}-${SECTIONS[0]}-0`)]);
    expect(written.some((path) => note.files.has(path))).toBe(false);
    expect(inkOffered(`${OFFER}-${SECTIONS[0]}-0`, OFFER)).toBe(true);
    expect(inkOffered(`${SECTIONS[0]}-0`, OFFER)).toBe(false);
  });

  it("refuses a file that names no note or nobody", () => {
    for (const markdown of [
      "# Just some markdown",
      "---\ntitle: x\n---\n",
      `---\namends: ${OWNER}/${NOTE}\n---\n`,
      `---\nby: ${BOB}\n---\n`,
    ]) {
      expect(() => vaultToAmendment({ markdown })).toThrow(VaultFormatError);
    }
  });
});
