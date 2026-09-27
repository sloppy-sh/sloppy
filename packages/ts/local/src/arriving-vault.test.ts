import type { SloppyApi } from "@sloppy/client";
import type { OwnedRef } from "@sloppy/types";
import type { Vault } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi, previewArrivingVault, settleArrivingVault } from "./api.js";
import {
  type Device,
  device,
  PickingFiles,
  reopened,
  textDocument,
} from "./local.test-support.js";

/** A second copy of this device's folders, written into apart from the ones the
 *  person has open — which is what a draft of them is. */
function draftOf(held: Device): LocalApi {
  return new LocalApi(new PickingFiles({ store: new Map(held.store) }));
}

/** One graph with one note in it, and the state both copies fork from. */
async function forked() {
  const held = device();
  const graph = await held.api.createGraph({ title: "Thesis" });
  const note = await held.api.createNode({ title: "Seeds" });
  const block = await held.api.createBlock({
    node: note.ref,
    content: textDocument("A seed keeps its own clock."),
  });
  return { held, graph, note, block, from: await held.api.vaultHere() };
}

describe("another copy of a graph this device keeps", () => {
  it("merges with nothing to settle where only it was written in", async () => {
    const { held, note, from } = await forked();
    const drafted = draftOf(held);
    const written = await drafted.createNode({
      from: { relation: "under", note: note.ref },
      title: "Germination",
    });
    const vault = await drafted.vaultHere();

    const said = await held.api.previewVault({ vault, from });
    expect(said.conflicts).toEqual([]);
    expect(said.binning).toEqual([]);
    expect(said.notes).toBe(2);

    await held.api.importVault({ vault, from });
    const client = reopened(held);
    expect((await client.getNode(written.ref))?.title).toBe("Germination");
    expect((await client.getNode(written.ref))?.address).toBe("1a");
  });

  it("takes what only the copy wrote and keeps what only the folder did", async () => {
    const { held, note, from } = await forked();
    const mine = await held.api.createNode({ title: "Mine alone" });
    const drafted = draftOf(held);
    await drafted.updateNode(note.ref, { title: "Seeds, as the draft has it" });
    const vault = await drafted.vaultHere();
    await held.api.updateNode(mine.ref, { title: "Mine alone, later" });

    const said = await held.api.previewVault({ vault, from });
    expect(said.conflicts).toEqual([]);

    await held.api.importVault({ vault, from });
    const client = reopened(held);
    expect((await client.getNode(note.ref))?.title).toBe(
      "Seeds, as the draft has it",
    );
    expect((await client.getNode(mine.ref))?.title).toBe("Mine alone, later");
  });

  it("leaves the folder's own where no state the copy was taken from is given", async () => {
    const { held, note } = await forked();
    const drafted = draftOf(held);
    await drafted.updateNode(note.ref, { title: "Seeds, as the draft has it" });
    const vault = await drafted.vaultHere();

    const said = await held.api.previewVault({ vault });
    expect(said.conflicts.map((one) => one.ref)).toEqual([note.ref]);
    await expect(held.api.importVault({ vault })).rejects.toThrow(
      "disagree about one note",
    );
  });

  it("answers a section conflict where both copies wrote into one section", async () => {
    const { held, note, block, from } = await forked();
    const drafted = draftOf(held);
    await drafted.updateBlock(block.ref, {
      content: textDocument("A seed keeps its own calendar."),
    });
    const vault = await drafted.vaultHere();
    await held.api.updateBlock(block.ref, {
      content: textDocument("A seed keeps nobody else's clock."),
    });

    const said = await held.api.previewVault({ vault, from });
    expect(said.conflicts.map((one) => [one.kind, one.ref])).toEqual([
      ["section", note.ref],
    ]);
    const [conflict] = said.conflicts;
    expect(conflict.sections).toHaveLength(1);
    expect(conflict.sections[0].mine).toContain("nobody else's clock");
    expect(conflict.sections[0].theirs).toContain("its own calendar");

    await expect(held.api.importVault({ vault, from })).rejects.toThrow(
      "disagree about one note",
    );
  });

  it("answers an address conflict where each copy gave one number to a different note", async () => {
    const { held, from } = await forked();
    const drafted = draftOf(held);
    const theirs = await drafted.createNode({ title: "Soil" });
    expect(theirs.address).toBe("2");
    const vault = await drafted.vaultHere();
    const mine = await held.api.createNode({ title: "Water" });
    expect(mine.address).toBe("2");

    const said = await held.api.previewVault({ vault, from });
    const address = said.conflicts.filter((one) => one.kind === "address");
    expect(address).toHaveLength(1);
    expect(address[0].address).toBe("2");
    expect([address[0].ref, address[0].other]).toContain(mine.ref);

    await held.api.importVault(
      { vault, from },
      {
        resolutions: [
          {
            kind: "address",
            ref: address[0].ref,
            keep: "mine",
            numbered: mine.ref,
          },
        ],
      },
    );
    const client = reopened(held);
    expect((await client.getNode(mine.ref))?.address).toBe("2");
    const arrived = await client.getNode(theirs.ref);
    expect(arrived?.title).toBe("Soil");
    expect(arrived?.address).toBeUndefined();
    expect(arrived?.aliases).toEqual(["2"]);
  });

  it("puts in the bin what the copy binned, and leaves what only the folder holds", async () => {
    const { held, note, from } = await forked();
    const drafted = draftOf(held);
    await drafted.deleteNode(note.ref);
    const vault = await drafted.vaultHere();
    const since = await held.api.createNode({ title: "Written since" });

    const said = await held.api.previewVault({ vault, from });
    expect(said.binning).toEqual([note.ref]);
    expect(said.conflicts).toEqual([]);

    await held.api.importVault({ vault, from });
    const client = reopened(held);
    expect(await client.getNode(note.ref)).toBeNull();
    expect((await client.deletedBranches()).map((one) => one.title)).toEqual([
      "Seeds",
    ]);
    expect((await client.getNode(since.ref))?.title).toBe("Written since");
  });

  it("asks before binning a note the folder has been written in since", async () => {
    const { held, note, block, from } = await forked();
    const drafted = draftOf(held);
    await drafted.deleteNode(note.ref);
    const vault = await drafted.vaultHere();
    await held.api.updateBlock(block.ref, {
      content: textDocument("A seed keeps nobody else's clock."),
    });

    const said = await held.api.previewVault({ vault, from });
    expect(said.binning).toEqual([note.ref]);
    expect(
      said.conflicts.map((one) => [one.kind, one.ref, one.theirs]),
    ).toEqual([["note", note.ref, "In the bin."]]);

    await held.api.importVault(
      { vault, from },
      { resolutions: [{ kind: "note", ref: note.ref, keep: "mine" }] },
    );
    expect((await reopened(held).getNode(note.ref))?.title).toBe("Seeds");
  });

  it("leaves in the bin what the folder binned and the copy still holds", async () => {
    const { held, note, from } = await forked();
    const drafted = draftOf(held);
    const written = await drafted.createNode({ title: "Written in the copy" });
    const vault = await drafted.vaultHere();
    await held.api.deleteNode(note.ref);

    const said = await held.api.previewVault({ vault, from });
    expect(said.conflicts).toEqual([]);
    expect(said.binning).toEqual([]);

    await held.api.importVault({ vault, from });
    const client = reopened(held);
    expect(await client.getNode(note.ref)).toBeNull();
    expect((await client.deletedBranches()).map((one) => one.title)).toEqual([
      "Seeds",
    ]);
    expect((await client.getNode(written.ref))?.title).toBe(
      "Written in the copy",
    );
  });

  it("asks before bringing back a note the folder binned and the copy wrote into", async () => {
    const { held, note, block, from } = await forked();
    const drafted = draftOf(held);
    await drafted.updateBlock(block.ref, {
      content: textDocument("A seed keeps its own calendar."),
    });
    const vault = await drafted.vaultHere();
    await held.api.deleteNode(note.ref);

    const said = await held.api.previewVault({ vault, from });
    expect(said.conflicts.map((one) => [one.kind, one.ref, one.mine])).toEqual([
      ["note", note.ref, "In the bin."],
    ]);
    expect(said.conflicts[0].theirs).toContain("its own calendar");
    await expect(held.api.importVault({ vault, from })).rejects.toThrow(
      "disagree about one note",
    );

    await held.api.importVault(
      { vault, from },
      { resolutions: [{ kind: "note", ref: note.ref, keep: "theirs" }] },
    );
    const client = reopened(held);
    const back = await client.getNode(note.ref);
    expect(back?.title).toBe("Seeds");
    expect(back?.address).toBe("1");
  });

  it("keeps a note the folder binned in the bin where the person settles it that way", async () => {
    const { held, note, block, from } = await forked();
    const drafted = draftOf(held);
    await drafted.updateBlock(block.ref, {
      content: textDocument("A seed keeps its own calendar."),
    });
    const vault = await drafted.vaultHere();
    await held.api.deleteNode(note.ref);

    await held.api.importVault(
      { vault, from },
      { resolutions: [{ kind: "note", ref: note.ref, keep: "mine" }] },
    );
    const client = reopened(held);
    expect(await client.getNode(note.ref)).toBeNull();
    expect((await client.deletedBranches()).map((one) => one.title)).toEqual([
      "Seeds",
    ]);
  });

  it("bins nothing where the caller says no state the copy was taken from", async () => {
    const { held, note } = await forked();
    const drafted = draftOf(held);
    await drafted.deleteNode(note.ref);
    const vault = await drafted.vaultHere();

    const said = await held.api.previewVault({ vault });
    expect(said.binning).toEqual([]);

    await held.api.importVault({ vault });
    expect((await reopened(held).getNode(note.ref))?.title).toBe("Seeds");
  });

  it("refuses a vault that is a copy of no graph in front of anybody", async () => {
    const { held } = await forked();
    const elsewhere = device(["/graphs/two"]);
    await elsewhere.api.createGraph({ title: "Garden" });
    const vault: Vault = await elsewhere.api.vaultHere();

    await expect(held.api.previewVault({ vault })).rejects.toThrow(
      "not a copy of the graph in front of you",
    );
  });

  it("says which graph the copy is of", async () => {
    const { held, graph, from } = await forked();
    const said = await held.api.previewVault({ vault: from });
    expect(said.graph).toBe(graph.ref as OwnedRef);
    expect(said.conflicts).toEqual([]);
  });

  it("is reached by a page holding only whatever serves the graph", async () => {
    const { held, note, from } = await forked();
    const drafted = draftOf(held);
    await drafted.updateNode(note.ref, { title: "Seeds, later" });
    const vault = await drafted.vaultHere();

    const said = await previewArrivingVault(held.api, { vault, from });
    expect(said.conflicts).toEqual([]);
    await settleArrivingVault(held.api, { vault, from });
    expect((await reopened(held).getNode(note.ref))?.title).toBe(
      "Seeds, later",
    );

    const nowhere = {} as SloppyApi;
    await expect(previewArrivingVault(nowhere, { vault })).rejects.toThrow(
      "not one this device keeps",
    );
    await expect(settleArrivingVault(nowhere, { vault })).rejects.toThrow(
      "not one this device keeps",
    );
  });
});
