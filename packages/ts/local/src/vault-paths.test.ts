import { describe, expect, it } from "vitest";
import { carriedOut, pictureKindOf, vaultOwned } from "./vault-paths.js";

describe("what a folder holds that the vault wrote", () => {
  it("is the graph, the notes and what sits under .sloppy", () => {
    for (const path of [
      "graph.json",
      "notes/01J0.md",
      "media/01J0.png",
      ".sloppy/media.json",
    ]) {
      expect(vaultOwned(path), path).toBe(true);
    }
  });

  it("is not a file the person put there themselves", () => {
    for (const path of ["README.md", "drafts/one.md"]) {
      expect(vaultOwned(path), path).toBe(false);
    }
  });

  it("is never a copy of an identity, wherever it was saved", () => {
    for (const path of [
      "sloppy-identity.json",
      "sloppy-identity 2.json",
      "sloppy-identity",
      ".sloppy/sloppy-identity.json",
      "notes/sloppy-identity.json",
    ]) {
      expect(vaultOwned(path), path).toBe(false);
      expect(carriedOut(path), path).toBe(false);
    }
  });
});

describe("what kind of picture some bytes open as", () => {
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

  it("is each kind a vault writes, read from the bytes alone", () => {
    const opening: [number[], string][] = [
      [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], "image/png"],
      [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
      [ascii("GIF87a"), "image/gif"],
      [[...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")], "image/webp"],
    ];
    for (const [bytes, kind] of opening) {
      expect(pictureKindOf(new Uint8Array(bytes))).toBe(kind);
    }
  });

  it("is none for anything else, a container that is not a picture among them", () => {
    for (const bytes of [
      [],
      ascii("<svg xmlns="),
      [...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")],
      [0x89, 0x50, 0x4e],
    ]) {
      expect(pictureKindOf(new Uint8Array(bytes))).toBeUndefined();
    }
  });
});
