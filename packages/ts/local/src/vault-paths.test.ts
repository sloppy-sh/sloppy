import { describe, expect, it } from "vitest";
import { carriedOut, vaultOwned } from "./vault-paths.js";

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
