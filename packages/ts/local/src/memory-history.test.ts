import { encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import { HistoryError } from "./history.js";
import { MemoryHistory, MemoryRemotes } from "./memory-history.js";

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
      behind: 0,
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

const KEPT_URL = "https://example.test/ada/garden.git";

/** Two folders and the one place they both keep their graph. */
function together(): {
  ada: { files: MemoryFiles; history: MemoryHistory };
  bo: { files: MemoryFiles; history: MemoryHistory };
  kept: MemoryHistory;
} {
  const remotes = new MemoryRemotes();
  const kept = new MemoryHistory(new MemoryFiles({ root: "/kept" }));
  remotes.keep(KEPT_URL, kept);
  const one = (root: string) => {
    const files = new MemoryFiles({ root });
    return { files, history: new MemoryHistory(files, { remotes }) };
  };
  return { ada: one("/ada"), bo: one("/bo"), kept };
}

function drawing(page: { commits: { id: string; message: string }[] }) {
  return page.commits.map((one) => [one.id, one.message]);
}

describe("a graph kept somewhere else as well", () => {
  it("names the places it is kept, and refuses two of one name", async () => {
    const { ada } = together();
    await ada.history.addRemote("origin", KEPT_URL);

    expect(await ada.history.remotes()).toEqual([
      { name: "origin", url: KEPT_URL },
    ]);
    await expect(
      ada.history.addRemote("origin", "https://example.test/else.git"),
    ).rejects.toBeInstanceOf(HistoryError);
    await expect(
      ada.history.setRemoteUrl("nowhere", KEPT_URL),
    ).rejects.toBeInstanceOf(HistoryError);

    await ada.history.setRemoteUrl("origin", "https://example.test/moved.git");
    expect(await ada.history.remotes()).toEqual([
      { name: "origin", url: "https://example.test/moved.git" },
    ]);

    await ada.history.removeRemote("origin");
    expect(await ada.history.remotes()).toEqual([]);
    await expect(ada.history.removeRemote("origin")).rejects.toBeInstanceOf(
      HistoryError,
    );
  });

  it("carries a remote's branches with it when it is called something else", async () => {
    const { ada } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");
    await ada.history.push();

    await ada.history.renameRemote("origin", "github");

    expect(await ada.history.remotes()).toEqual([
      { name: "github", url: KEPT_URL },
    ]);
    expect((await ada.history.status()).upstream).toBe("github/main");
    expect((await ada.history.branches()).map((one) => one.name)).toEqual([
      "main",
      "github/main",
    ]);

    await write(ada.files, OTHER, "beside it");
    await ada.history.commit("A note beside it");
    await ada.history.push();
    expect((await ada.history.status()).ahead).toBe(0);

    await ada.history.addRemote("origin", "https://example.test/else.git");
    await expect(
      ada.history.renameRemote("github", "origin"),
    ).rejects.toBeInstanceOf(HistoryError);
    await expect(
      ada.history.renameRemote("nowhere", "elsewhere"),
    ).rejects.toBeInstanceOf(HistoryError);
  });

  it("follows what a branch taken whole was taken from", async () => {
    const { ada, bo } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await bo.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");
    await ada.history.push();

    await bo.history.pull();
    expect(await bo.history.status()).toMatchObject({
      ahead: 0,
      behind: 0,
      upstream: "origin/main",
    });

    await write(ada.files, OTHER, "beside it");
    await ada.history.commit("A note beside it");
    await ada.history.push();
    await bo.history.fetch("origin");

    expect(await bo.history.status()).toMatchObject({ ahead: 0, behind: 1 });
  });

  it("lists the branches kept here beside the ones it last heard of", async () => {
    const { ada, bo } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await bo.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    const first = await ada.history.commit("A first note");
    await ada.history.push();
    await bo.history.pull();
    await write(bo.files, OTHER, "beside it");
    const second = await bo.history.commit("A note beside it");

    expect(await bo.history.branches()).toEqual([
      {
        name: "main",
        head: second?.id,
        current: true,
        upstream: "origin/main",
        ahead: 1,
        behind: 0,
      },
      {
        name: "origin/main",
        head: first?.id,
        current: false,
        remote: "origin",
      },
    ]);
  });

  it("reproduces every commit and every head for whoever takes them", async () => {
    const { ada, bo, kept } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await bo.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");
    await write(ada.files, OTHER, "beside it");
    const second = await ada.history.commit("A note beside it");
    await ada.history.push();

    await bo.history.fetch("origin");

    expect((await kept.branches()).map((one) => one.head)).toEqual([
      second?.id,
    ]);
    expect(drawing(await bo.history.graph(10))).toEqual(
      drawing(await ada.history.graph(10)),
    );
    expect(
      (await bo.history.graph(10)).commits.find((one) => one.id === second?.id)
        ?.refs,
    ).toEqual(["origin/main"]);
  });

  it("takes in what somebody else kept there, and says so where there is nothing to take", async () => {
    const { ada, bo } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await bo.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");
    await ada.history.push();

    expect(await bo.history.pull()).toEqual({ merged: true });
    expect(await bo.files.read(NOTE)).toEqual(encodeText("one"));
    expect(await bo.history.pull()).toEqual({ merged: true });

    await write(bo.files, OTHER, "beside it");
    await bo.history.commit("A note beside it");
    await bo.history.push();

    expect((await ada.history.status()).behind).toBe(0);
    await ada.history.fetch("origin");
    expect(await ada.history.status()).toMatchObject({
      ahead: 0,
      behind: 1,
      upstream: "origin/main",
    });

    expect(await ada.history.pull()).toEqual({ merged: true });
    expect(await ada.files.read(OTHER)).toEqual(encodeText("beside it"));
    expect((await ada.history.status()).behind).toBe(0);
  });

  it("will not write over commits this folder has not taken in", async () => {
    const { ada, bo } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await bo.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");
    await ada.history.push();
    await bo.history.pull();
    await write(bo.files, OTHER, "beside it");
    await bo.history.commit("A note beside it");
    await bo.history.push();

    await write(ada.files, NOTE, "one, written again");
    await ada.history.commit("Written again");

    await expect(ada.history.push()).rejects.toThrow(
      "Pull first, then push again.",
    );
  });

  it("hands back what both sides wrote into on a pull, exactly as a merge does", async () => {
    const { ada, bo } = together();
    await ada.history.addRemote("origin", KEPT_URL);
    await bo.history.addRemote("origin", KEPT_URL);
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");
    await ada.history.push();
    await bo.history.pull();

    await write(bo.files, NOTE, "theirs");
    await bo.history.commit("Written there");
    await bo.history.push();
    await write(ada.files, NOTE, "mine");
    await ada.history.commit("Written here");

    expect(await ada.history.pull()).toEqual({
      merged: false,
      conflicts: [NOTE],
    });
    await ada.history.resolve(NOTE, "theirs");
    const merged = await ada.history.commit("Merged");
    expect(merged?.parents).toHaveLength(2);
    expect(await ada.files.read(NOTE)).toEqual(encodeText("theirs"));
  });

  it("refuses a place it has never heard of, and one that is not there", async () => {
    const { ada } = together();
    await write(ada.files, NOTE, "one");
    await ada.history.commit("A first note");

    await expect(ada.history.push("origin")).rejects.toBeInstanceOf(
      HistoryError,
    );

    await ada.history.addRemote("origin", "https://example.test/nobody.git");
    await expect(ada.history.push()).rejects.toBeInstanceOf(HistoryError);
    await expect(ada.history.fetch("origin")).rejects.toBeInstanceOf(
      HistoryError,
    );
  });
});

describe("the whole history as one picture", () => {
  it("draws every branch, newest first and never ahead of what it springs from", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    const first = await history.commit("A first note");
    await write(files, NOTE, "one, written again");
    const second = await history.commit("Written again");
    await history.branchAt("aside", first?.id ?? "");
    await history.switch("aside");
    await write(files, OTHER, "beside it");
    const third = await history.commit("A note beside it");

    const drawn = await history.graph(10);
    expect(drawn.commits.map((one) => one.id)).toEqual([
      third?.id,
      second?.id,
      first?.id,
    ]);
    const at = new Map(drawn.commits.map((one, index) => [one.id, index]));
    for (const one of drawn.commits) {
      for (const parent of one.parents) {
        expect(at.get(parent)).toBeGreaterThan(at.get(one.id) ?? 0);
      }
    }
    expect(drawn.commits.map((one) => one.refs)).toEqual([
      ["aside"],
      ["main"],
      [],
    ]);
  });

  it("pages the picture the way a listing is paged", async () => {
    const { files, history } = graph();
    for (const words of ["one", "two", "three"]) {
      await write(files, NOTE, words);
      await history.commit(words);
    }

    const first = await history.graph(2);
    expect(first.commits.map((one) => one.message)).toEqual(["three", "two"]);
    const rest = await history.graph(2, first.cursor);
    expect(rest.commits.map((one) => one.message)).toEqual(["one"]);
    expect(rest.cursor).toBeUndefined();
  });

  it("will not let go of the branch the folder is on", async () => {
    const { files, history } = graph();
    await write(files, NOTE, "one");
    await history.commit("A first note");
    await history.branch("aside");

    await expect(history.deleteBranch("main")).rejects.toBeInstanceOf(
      HistoryError,
    );
    await history.deleteBranch("aside");
    expect((await history.branches()).map((one) => one.name)).toEqual(["main"]);
    await expect(
      history.branchAt("elsewhere", "nowhere"),
    ).rejects.toBeInstanceOf(HistoryError);
  });
});

describe("who the commits here are by", () => {
  it("records the person the folder was told about", async () => {
    const { files, history } = graph();
    expect(await history.gitUser()).toBeUndefined();
    await history.setGitUser({ name: "Ada", email: "ada@example.test" });
    await write(files, NOTE, "one");

    expect((await history.commit("A first note"))?.author).toBe("Ada");
    expect(await history.gitUser()).toEqual({
      name: "Ada",
      email: "ada@example.test",
    });
  });

  it("says which key signed a commit while signing is on, and nothing after", async () => {
    const { files, history } = graph();
    expect(await history.signing()).toEqual({ kind: "none" });

    await history.setSigning({ kind: "ssh", key: { kind: "kept" } });
    await write(files, NOTE, "one");
    const signed = await history.commit("A first note");
    expect(signed?.signature).toEqual({ by: "SHA256:kept", verified: true });
    expect((await history.graph(1)).commits[0].signature).toEqual({
      by: "SHA256:kept",
      verified: true,
    });

    await history.setSigning({ kind: "openpgp", keyId: "9E3C" });
    await write(files, NOTE, "one, written again");
    expect((await history.commit("Written again"))?.signature).toEqual({
      by: "9E3C",
      verified: true,
    });

    await history.setSigning({ kind: "none" });
    await write(files, NOTE, "one, written once more");
    expect(
      (await history.commit("Written once more"))?.signature,
    ).toBeUndefined();
    expect((await history.log(1)).commits[0].signature).toBeUndefined();
  });
});
