import fc from "fast-check";
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
  pictureNamed,
  picturesFile,
  readGraphFile,
  readPicturesFile,
  uploadAt,
  VAULT_FORMAT,
  VaultFormatError,
  type VaultGraph,
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

  it("reads back who the graph belongs to, and their picture in this folder", () => {
    const graph = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
      owner_name: "Ada Lovelace",
      owner_avatar: mediaPath("up1", "png"),
    };
    expect(readGraphFile(graphFile(graph))).toEqual(graph);
  });

  it("reads back what a note written in the graph is gated by", () => {
    const graph = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
      ownership: "owned" as const,
    };
    expect(readGraphFile(graphFile(graph))).toEqual(graph);
  });

  it("reads back what a graph asks of whoever writes in it", () => {
    const graph = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
      vouching: "required" as const,
    };
    expect(readGraphFile(graphFile(graph))).toEqual(graph);
  });

  it("asks nobody to be vouched where the file says something it cannot read", () => {
    const bytes = encodeText(
      JSON.stringify({
        format: VAULT_FORMAT,
        graph: NOTE,
        name: "The thesis",
        owner: OWNER,
        vouching: "notarised",
      }),
    );
    expect(readGraphFile(bytes).vouching).toBeUndefined();
  });

  it("writes the same bytes for a graph nobody has gated", () => {
    const open = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
    };
    expect(decodeText(graphFile(open))).toBe(
      `${JSON.stringify(
        {
          format: VAULT_FORMAT,
          graph: NOTE,
          name: "The thesis",
          owner: OWNER,
        },
        null,
        2,
      )}\n`,
    );
    expect(readGraphFile(graphFile(open)).ownership).toBeUndefined();
  });

  it("leaves a graph gated by something it has never heard of open", () => {
    const bytes = encodeText(
      JSON.stringify({
        format: VAULT_FORMAT,
        graph: NOTE,
        name: "The thesis",
        owner: OWNER,
        ownership: "sealed",
      }),
    );
    expect(readGraphFile(bytes).ownership).toBeUndefined();
  });

  it("leaves out a name nobody wrote and a picture this folder does not hold", () => {
    for (const elsewhere of [
      "../ada.png",
      "/home/ada/ada.png",
      "notes/ada.png",
      "media/../ada.png",
      "media/deeper/ada.png",
      "http://a.example/ada.png",
      "https:ada.png",
      "file:///home/ada/ada.png",
      "javascript:alert(1)",
      7,
    ]) {
      const bytes = encodeText(
        JSON.stringify({
          format: VAULT_FORMAT,
          graph: NOTE,
          name: "The thesis",
          owner: OWNER,
          owner_name: "",
          owner_avatar: elsewhere,
          owner_banner: elsewhere,
          owner_bio: "",
        }),
      );
      const read = readGraphFile(bytes);
      expect(read.owner_name).toBeUndefined();
      expect(read.owner_avatar).toBeUndefined();
      expect(read.owner_banner).toBeUndefined();
      expect(read.owner_bio).toBeUndefined();
    }
  });

  it("reads back a banner, a bio and a picture linked from elsewhere", () => {
    const graph = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
      owner_avatar: "https://a.example/ada.png",
      owner_banner: mediaPath("up2", "jpg"),
      owner_bio: "Notes on the engine.",
    };
    expect(readGraphFile(graphFile(graph))).toEqual(graph);
    expect(pictureNamed(graph.owner_avatar)).toBe(true);
    expect(pictureNamed(graph.owner_banner)).toBe(true);
  });

  it("reads every graph it writes back as it was, and writes no two alike", () => {
    const optional = <T>(value: fc.Arbitrary<T>) =>
      fc.option(value, { nil: undefined });
    const picture = fc.oneof(
      fc
        .stringMatching(/^[A-Za-z0-9_-]{1,20}$/)
        .chain((upload) =>
          fc
            .constantFrom(undefined, "png", "jpg")
            .map((extension) => mediaPath(upload, extension)),
        ),
      fc
        .stringMatching(/^[a-z0-9/._-]{0,30}$/)
        .map((path) => `https://pictures.example/${path}`),
    );
    const said = fc
      .record({
        name: fc.string(),
        ownership: optional(fc.constantFrom("open" as const, "owned" as const)),
        vouching: optional(
          fc.constantFrom("optional" as const, "required" as const),
        ),
        owner_name: optional(fc.string({ minLength: 1 })),
        owner_avatar: optional(picture),
        owner_banner: optional(picture),
        owner_bio: optional(fc.string({ minLength: 1 })),
        project: optional(fc.string({ minLength: 1 })),
      })
      .map(
        (fields): VaultGraph =>
          Object.fromEntries(
            Object.entries({
              format: VAULT_FORMAT,
              graph: NOTE,
              owner: OWNER,
              ...fields,
            }).filter(([, value]) => value !== undefined),
          ) as unknown as VaultGraph,
      );

    fc.assert(
      fc.property(said, (graph) => {
        expect(readGraphFile(graphFile(graph))).toEqual(graph);
      }),
    );
    fc.assert(
      fc.property(said, said, (one, other) => {
        const same =
          decodeText(graphFile(one)) === decodeText(graphFile(other));
        expect(same).toBe(JSON.stringify(one) === JSON.stringify(other));
      }),
    );
  });

  it("reads back where the code this graph is about is", () => {
    const graph = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The compiler",
      owner: OWNER,
      project: "..",
    };
    expect(readGraphFile(graphFile(graph))).toEqual(graph);
  });

  it("leaves a graph that is nobody's project carrying no path", () => {
    const alone = {
      format: VAULT_FORMAT,
      graph: NOTE,
      name: "The thesis",
      owner: OWNER,
    };
    expect(decodeText(graphFile(alone))).not.toContain("project");
    expect(readGraphFile(graphFile(alone)).project).toBeUndefined();
    const empty = encodeText(JSON.stringify({ ...alone, project: "" }));
    expect(readGraphFile(empty).project).toBeUndefined();
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
