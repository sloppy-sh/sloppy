import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutsideRootError } from "@sloppy/local";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFiles } from "./node-files.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (held: Uint8Array | undefined): string | undefined =>
  held === undefined ? undefined : new TextDecoder().decode(held);

describe("NodeFiles", () => {
  let root = "";
  let files: NodeFiles;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sloppy-cli-"));
    files = new NodeFiles({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes the folders above a file", async () => {
    await files.write("notes/01J.md", bytes("hello"));
    expect(await readFile(join(root, "notes/01J.md"), "utf8")).toBe("hello");
    expect(text(await files.read("notes/01J.md"))).toBe("hello");
  });

  it("answers nothing for a file that isn't there", async () => {
    expect(await files.read("notes/nobody.md")).toBeUndefined();
    expect(await files.exists("notes/nobody.md")).toBe(false);
    expect(await files.list("notes")).toEqual([]);
  });

  it("lists every file under a path, all the way down", async () => {
    await files.write("notes/a.md", bytes("a"));
    await files.write("notes/deep/b.md", bytes("b"));
    await files.write("graph.json", bytes("{}"));
    expect((await files.list("notes")).sort()).toEqual([
      "notes/a.md",
      "notes/deep/b.md",
    ]);
    expect((await files.list("")).sort()).toEqual([
      "graph.json",
      "notes/a.md",
      "notes/deep/b.md",
    ]);
  });

  it("removes a file and a folder, and removing twice is one outcome", async () => {
    await files.write("notes/a.md", bytes("a"));
    await files.remove("notes/a.md");
    await files.remove("notes/a.md");
    expect(await files.exists("notes/a.md")).toBe(false);
    await files.write("notes/deep/b.md", bytes("b"));
    await files.remove("notes/deep");
    expect(await files.list("notes")).toEqual([]);
  });

  it("says a folder is there", async () => {
    await files.mkdir("notes");
    expect(await files.exists("notes")).toBe(true);
    expect(await files.read("notes")).toBeUndefined();
  });

  it("refuses a path that would leave the root", async () => {
    await writeFile(join(root, "..", "outside.txt"), "no");
    await expect(files.read("../outside.txt")).rejects.toBeInstanceOf(
      OutsideRootError,
    );
    await expect(
      files.write("/etc/passwd", bytes("no")),
    ).rejects.toBeInstanceOf(OutsideRootError);
    await rm(join(root, "..", "outside.txt"), { force: true });
  });

  it("reads another folder with `at`, sharing the disk", async () => {
    await files.write(".sloppy/graph.json", bytes("{}"));
    const container = files.at(".sloppy");
    expect(text(await container.read("graph.json"))).toBe("{}");
    await container.write("notes/a.md", bytes("a"));
    expect(await files.exists(".sloppy/notes/a.md")).toBe(true);
  });

  it("keeps a container's own private data one level down", async () => {
    expect(await files.dataPath()).toBe(join(root, ".sloppy"));
    expect(await files.at(".sloppy").dataPath()).toBe(
      join(root, ".sloppy/.sloppy"),
    );
    const said = new NodeFiles({ root, data: join(root, "elsewhere") });
    expect(await said.at(".sloppy").dataPath()).toBe(join(root, "elsewhere"));
  });

  it("hands back an address the file can be loaded from", async () => {
    await files.write("media/a.png", bytes("png"));
    expect(files.url("media/a.png")).toBe(
      `file://${join(root, "media/a.png")}`,
    );
  });

  it("has nobody to ask for a folder", async () => {
    expect(await files.pickFolder()).toBeUndefined();
  });
});
