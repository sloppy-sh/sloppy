import { describe, expect, it } from "vitest";
import {
  decodeText,
  emojiAt,
  emojiPath,
  encodeText,
  graphFile,
  inkAt,
  inkImagePath,
  inkPath,
  inkStem,
  insideVault,
  mediaPath,
  noteAt,
  notePath,
  noteUlids,
  picturesFile,
  readGraphFile,
  readPicturesFile,
  uploadAt,
  VAULT_FORMAT,
  VaultFormatError,
} from "./layout.js";

const NOTE = "01J0000000000000000000000A";
const BLOCK = "01J0000000000000000000000C";
const OWNER = "did:syr:z6MktEXAMPLEEXAMPLEEXAMPLEEXAMPLE";

describe("where a vault keeps things", () => {
  it("names a note by its ulid and reads it back", () => {
    expect(notePath(NOTE)).toBe(`notes/${NOTE}.md`);
    expect(noteAt(notePath(NOTE))).toBe(NOTE);
    expect(noteAt("notes/thoughts.md")).toBeUndefined();
    expect(noteAt(`notes/deeper/${NOTE}.md`)).toBeUndefined();
  });

  it("names a picture by the upload, whatever the bytes were", () => {
    expect(mediaPath("up1", "png")).toBe("media/up1.png");
    expect(mediaPath("up1", ".png")).toBe("media/up1.png");
    expect(uploadAt(mediaPath("up1", "png"))).toBe("up1");
    expect(uploadAt(mediaPath("up1"))).toBe("up1");
    expect(uploadAt("notes/up1.png")).toBeUndefined();
  });

  it("names a drawing's two files after the section it is in", () => {
    const stem = inkStem(BLOCK, 2);
    expect(inkPath(stem)).toBe(`.sloppy/ink/${BLOCK}-2.ink.json`);
    expect(inkImagePath(stem)).toBe(`.sloppy/ink/${BLOCK}-2.svg`);
    expect(inkAt(inkPath(stem))).toBe(stem);
    expect(inkAt(inkImagePath(stem))).toBe(stem);
    expect(inkAt("media/x.svg")).toBeUndefined();
  });

  it("names an emoji by its shortcode", () => {
    expect(emojiPath("parrot", "gif")).toBe(".sloppy/emoji/parrot.gif");
    expect(emojiAt(".sloppy/emoji/parrot.gif")).toBe("parrot");
  });

  it("reads back the graph it wrote", () => {
    const graph = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
    };
    expect(readGraphFile(graphFile(graph))).toEqual(graph);
  });

  it("says a file written by a newer Sloppy needs a newer Sloppy", () => {
    const bytes = encodeText(
      JSON.stringify({ format: 99, graph: NOTE, name: "x", owner: OWNER }),
    );
    expect(() => readGraphFile(bytes)).toThrow(VaultFormatError);
    expect(() => readGraphFile(bytes)).toThrow(/Update/);
  });

  it("refuses a file that is not a graph at all", () => {
    expect(() => readGraphFile(encodeText("not json"))).toThrow(
      VaultFormatError,
    );
    for (const held of [
      JSON.stringify({ graph: NOTE, name: "x", owner: OWNER }),
      JSON.stringify({ format: 0, graph: NOTE, name: "x", owner: OWNER }),
    ]) {
      expect(() => readGraphFile(encodeText(held))).toThrow(
        /isn't a Sloppy graph/,
      );
    }
  });

  it("holds a path to what is inside the vault", () => {
    expect(insideVault(notePath(NOTE))).toBe(true);
    expect(insideVault(".sloppy/ink/a.svg")).toBe(true);
    for (const outside of [
      "",
      "/etc/passwd",
      "C:/notes/x.md",
      "../x.md",
      "notes/../../x.md",
      "notes\\x.md",
      "notes//x.md",
    ]) {
      expect(insideVault(outside)).toBe(false);
    }
  });

  it("keeps a picture's size and drops what is not one", () => {
    const sizes = new Map([["up1", { width: 8, height: 6 }]]);
    expect(readPicturesFile(picturesFile(sizes))).toEqual(sizes);
    expect(
      readPicturesFile(encodeText('{"up1":{"width":"wide"},"up2":7}')),
    ).toEqual(new Map([["up1", {}]]));
    expect(readPicturesFile(encodeText("{"))).toEqual(new Map());
  });

  it("lists the notes a vault holds", () => {
    const vault = new Map([
      [notePath(NOTE), encodeText("")],
      ["media/up1.png", encodeText("")],
      ["notes/README.md", encodeText("")],
    ]);
    expect(noteUlids(vault)).toEqual([NOTE]);
  });

  it("carries text through unchanged", () => {
    expect(decodeText(encodeText("a — ü 🙂"))).toBe("a — ü 🙂");
  });
});
