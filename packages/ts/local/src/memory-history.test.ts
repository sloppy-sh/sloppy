import { encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import { HistoryError } from "./history.js";
import { MemoryHistory } from "./memory-history.js";

const NOTE = "notes/01J0000000000000000000000A.md";
const OTHER = "notes/01J0000000000000000000000B.md";

function graph(): { files: MemoryFiles; history: MemoryHistory } {
  const files = new MemoryFiles({ root: "/vault" });
  return { files, history: new MemoryHistory(files) };
}

async function write(
  files: MemoryFiles,
  path: string,
  words: string,
): Promise<void> {
  await files.write(path, encodeText(words));
}

describe("the states a graph has been in", () => {
  it("says what is in the folder that the history is not keeping", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");

    expect(await history.status()).toEqual({
      changed: [],
      untracked: [NOTE],
      branch: "main",
      ahead: 0,
    });

    await history.commit("A first note");
    await write(files, NOTE, "one, written again");

    expect((await history.status()).changed).toEqual([NOTE]);
    expect((await history.status()).untracked).toEqual([]);
  });

  it("counts a file taken away as changed", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await files.remove(NOTE);

    expect((await history.status()).changed).toEqual([NOTE]);
  });

  it("commits nothing where nothing was written", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");

    expect(await history.commit("A first note")).toBeDefined();
    expect(await history.commit("Again")).toBeUndefined();
  });

  it("lists the commits newest first, a page at a time", async () => {
    const { files, history } = graph();
    for (const words of ["one", "two", "three"]) {
      await write(files, NOTE, words);
      await history.commit(words);
    }

    const first = await history.log(2);
    expect(first.commits.map((one) => one.message)).toEqual(["three", "two"]);
    expect(first.cursor).toBeDefined();

    const rest = await history.log(2, first.cursor);
    expect(rest.commits.map((one) => one.message)).toEqual(["one"]);
    expect(rest.cursor).toBeUndefined();
    expect(rest.commits[0].parents).toEqual([]);
  });

  it("reads the whole graph as it was at any commit", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "as it was");
    const first = await history.commit("A first note");
    await write(files, NOTE, "as it is");
    await history.commit("Written again");

    const held = await history.readAt(first?.id ?? "");
    expect(held.get(NOTE)).toEqual(encodeText("as it was"));
    expect(await files.read(NOTE)).toEqual(encodeText("as it is"));
  });

  it("puts the folder on the branch it is switched to", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");
    await history.switch("aside");
    await write(files, OTHER, "beside it");
    await history.commit("A note beside it");

    expect(await history.branches()).toEqual([
      { name: "main", head: expect.any(String), current: false },
      { name: "aside", head: expect.any(String), current: true },
    ]);

    await history.switch("main");
    expect(await files.read(OTHER)).toBeUndefined();
    expect(await files.read(NOTE)).toEqual(encodeText("one"));
  });

  it("will not leave what is written here behind", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");
    await write(files, NOTE, "written since");

    await expect(history.switch("aside")).rejects.toBeInstanceOf(HistoryError);
  });

  it("takes a branch that leads back through this one whole", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");
    await history.switch("aside");
    await write(files, OTHER, "beside it");
    await history.commit("A note beside it");
    await history.switch("main");

    expect(await history.merge("aside")).toEqual({ merged: true });
    expect(await files.read(OTHER)).toEqual(encodeText("beside it"));
    expect((await history.log(10)).commits.map((one) => one.message)).toEqual([
      "A note beside it",
      "A first note",
    ]);
  });

  it("carries both sides where each wrote a different note", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");
    await history.switch("aside");
    await write(files, OTHER, "beside it");
    await history.commit("A note beside it");
    await history.switch("main");
    await write(files, NOTE, "one, written again");
    await history.commit("Written again");

    expect(await history.merge("aside")).toEqual({ merged: true });
    expect(await files.read(OTHER)).toEqual(encodeText("beside it"));
    expect(await files.read(NOTE)).toEqual(encodeText("one, written again"));

    const held = await history.log(1);
    expect(held.commits[0].parents).toHaveLength(2);
  });

  it("hands back what both sides wrote into, and never one file holding two", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");
    await history.switch("aside");
    await write(files, NOTE, "theirs");
    await history.commit("Written there");
    await history.switch("main");
    await write(files, NOTE, "mine");
    await history.commit("Written here");

    expect(await history.merge("aside")).toEqual({
      merged: false,
      conflicts: [NOTE],
    });
    expect(await files.read(NOTE)).toEqual(encodeText("mine"));
    await expect(history.commit("Merged")).rejects.toBeInstanceOf(HistoryError);

    await history.resolve(NOTE, "theirs");
    expect(await files.read(NOTE)).toEqual(encodeText("theirs"));

    const merged = await history.commit("Merged");
    expect(merged?.parents).toHaveLength(2);
    expect((await history.status()).changed).toEqual([]);
  });

  it("refuses a branch name it already has, and one it has never heard of", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");

    await expect(history.branch("aside")).rejects.toBeInstanceOf(HistoryError);
    await expect(history.switch("elsewhere")).rejects.toBeInstanceOf(
      HistoryError,
    );
    await expect(history.readAt("nowhere")).rejects.toBeInstanceOf(
      HistoryError,
    );
  });

  it("is on no commit until one is made", async () => {
    const { history } = graph();
    expect(await history.currentCommit()).toBeUndefined();
    expect((await history.log(10)).commits).toEqual([]);
    await expect(history.branch("aside")).rejects.toBeInstanceOf(HistoryError);
  });
});
