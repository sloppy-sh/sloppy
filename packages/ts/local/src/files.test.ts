import { describe, expect, it } from "vitest";
import { encodeText } from "@sloppy/vault";
import { MemoryFiles, OutsideRootError, readOnly } from "./files.js";

describe("files rooted at a folder", () => {
  it("reads back what it wrote, and answers nothing for what is not there", async () => {
    const files = new MemoryFiles({ root: "/vault" });
    await files.write("notes/a.md", encodeText("one"));

    expect(await files.read("notes/a.md")).toEqual(encodeText("one"));
    expect(await files.read("notes/b.md")).toBeUndefined();
    expect(await files.exists("notes/a.md")).toBe(true);
    expect(await files.exists("notes/b.md")).toBe(false);
  });

  it("removing what is not there is success", async () => {
    const files = new MemoryFiles();
    await expect(files.remove("gone.md")).resolves.toBeUndefined();
  });

  it("lists every file under a folder, as paths from the root", async () => {
    const files = new MemoryFiles({ root: "/vault" });
    await files.write("graph.json", encodeText("{}"));
    await files.write("notes/a.md", encodeText("a"));
    await files.write(".sloppy/ink/b-1.ink.json", encodeText("[]"));

    expect((await files.list("")).sort()).toEqual([
      ".sloppy/ink/b-1.ink.json",
      "graph.json",
      "notes/a.md",
    ]);
    expect(await files.list("notes")).toEqual(["notes/a.md"]);
  });

  it("refuses a path that leaves the folder it was given", async () => {
    const files = new MemoryFiles({ root: "/vault" });
    await expect(files.read("../elsewhere/a.md")).rejects.toBeInstanceOf(
      OutsideRootError,
    );
    await expect(
      files.write("/etc/passwd", encodeText("x")),
    ).rejects.toBeInstanceOf(OutsideRootError);
  });

  it("keeps one store behind two roots, the way two folders on a disk are", async () => {
    const files = new MemoryFiles({ root: "/vault" });
    await files.write("notes/a.md", encodeText("one"));

    const beside = files.at("/vault/notes");
    expect(await beside.read("a.md")).toEqual(encodeText("one"));

    await beside.write("b.md", encodeText("two"));
    expect(await files.read("notes/b.md")).toEqual(encodeText("two"));
  });

  it("reads a relative root as one under the folder it already has", () => {
    expect(new MemoryFiles({ root: "/vault" }).at("media").root).toBe(
      "/vault/media",
    );
  });

  it("hands a picture over as something a page can load", () => {
    const files = new MemoryFiles();
    void files.write("media/p.png", new Uint8Array([1, 2, 3]));
    expect(files.url("media/p.png")).toMatch(
      /^data:application\/octet-stream;base64,/,
    );
  });
});

describe("files this device only reads", () => {
  it("answers what is there and refuses every way of changing it", async () => {
    const held = new MemoryFiles({ root: "/theirs" });
    await held.write("notes/a.md", encodeText("one"));
    const files = readOnly(held);

    expect(await files.read("notes/a.md")).toEqual(encodeText("one"));
    expect(await files.list("notes")).toEqual(["notes/a.md"]);
    expect(await files.exists("notes/a.md")).toBe(true);

    await expect(files.write("notes/a.md", encodeText("two"))).rejects.toThrow(
      "can only be read",
    );
    await expect(files.remove("notes/a.md")).rejects.toThrow(
      "can only be read",
    );
    await expect(files.mkdir("media")).rejects.toThrow("can only be read");
    expect(await held.read("notes/a.md")).toEqual(encodeText("one"));
  });

  it("carries that to every folder reached from it", async () => {
    const held = new MemoryFiles({ root: "/theirs" });
    await held.write("notes/a.md", encodeText("one"));

    const beside = readOnly(held).at("notes");
    expect(await beside.read("a.md")).toEqual(encodeText("one"));
    await expect(beside.write("b.md", encodeText("two"))).rejects.toThrow(
      "can only be read",
    );
    expect(await held.exists("notes/b.md")).toBe(false);
  });

  it("brings no folder over, because that would write one", () => {
    expect(readOnly(new MemoryFiles()).clone).toBeUndefined();
  });
});
