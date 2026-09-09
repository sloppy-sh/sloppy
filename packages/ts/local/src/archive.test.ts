import { splitOwnedRef } from "@sloppy/types";
import { unpack } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import {
  type Device,
  body,
  device,
  reopened,
  textDocument,
} from "./local.test-support.js";
import { BIN_FILE } from "./vault-paths.js";

/** A device with one graph on it: a note with writing, and one in the bin. */
async function written(picks?: string[]) {
  const held = device(picks ?? ["/graphs/one", "/graphs/two"]);
  const graph = await held.api.createGraph({ title: "Thesis" });
  const note = await held.api.createNode({ title: "Seeds", tags: ["seed"] });
  await held.api.createBlock({
    node: note.ref,
    content: textDocument("A seed keeps its own clock."),
  });
  const thrown = await held.api.createNode({ title: "Thrown away" });
  await held.api.deleteNode(thrown.ref);
  return { held, graph, note };
}

async function archiveFrom(held: Device, ref: string): Promise<Blob> {
  return body((await held.api.exportArchive(ref)).bytes);
}

describe("a graph taken out as a file", () => {
  it("carries the notes and not the bin", async () => {
    const { held, graph, note } = await written();
    const out = await held.api.exportArchive(graph.ref);
    expect(out.filename).toMatch(/^Thesis \d{4}-\d{2}-\d{2}\.sloppy$/);

    const vault = unpack(out.bytes);
    expect(vault.has("graph.json")).toBe(true);
    expect(vault.has(`notes/${splitOwnedRef(note.ref).localId}.md`)).toBe(true);
    expect(vault.has(BIN_FILE)).toBe(false);
    expect(
      [...vault.keys()].some((path) => path.includes(".sloppy/bin/")),
    ).toBe(false);
  });
});

describe("somebody else's graph brought in", () => {
  it("says what the file holds before anything is written", async () => {
    const theirs = await written(["/theirs"]);
    const mine = device(["/graphs/one", "/graphs/arrived"]);
    await mine.api.createGraph({ title: "Mine" });

    const said = await mine.api.previewArchive(
      await archiveFrom(theirs.held, theirs.graph.ref),
    );
    expect(said.name).toBe("Thesis");
    expect(said.notes).toBe(1);
    expect(said.owner).toBe(splitOwnedRef(theirs.note.ref).did);
    expect(said.collisions).toEqual([]);
    expect(said.replaces).toBe(false);
    expect(said.replacing).toBe(0);
  });

  it("opens a folder of its own, under this device's identity", async () => {
    const theirs = await written(["/theirs"]);
    const mine = device(["/graphs/one", "/graphs/arrived"]);
    const home = await mine.api.createGraph({ title: "Mine" });
    const me = await mine.api.me();

    const brought = await mine.api.importArchive(
      await archiveFrom(theirs.held, theirs.graph.ref),
    );
    expect(brought.title).toBe("Thesis");
    expect(brought.created_by).toBe(me?.did);

    const again = reopened(mine);
    expect((await again.listGraphs()).map((one) => one.ref)).toEqual([
      home.ref,
      brought.ref,
    ]);
    const arrived = (await again.listNodes({ graph: brought.ref }))[0];
    expect(arrived.title).toBe("Seeds");
    expect(arrived.address).toBe("1");
    expect(arrived.created_by).toBe(me?.did);
    expect(splitOwnedRef(arrived.ref).localId).toBe(
      splitOwnedRef(theirs.note.ref).localId,
    );
    expect((await again.listBlocks(arrived.ref))[0].content).toEqual(
      textDocument("A seed keeps its own clock."),
    );
  });
});

describe("a graph of this device's own brought back in", () => {
  it("writes over the one it came out of", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const note = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const out = await archiveFrom(held, second.ref);

    await held.api.updateNode(note.ref, { title: "Beans, later" });
    const said = await held.api.previewArchive(out);
    expect(said.replaces).toBe(true);
    expect(said.replacing).toBe(1);
    expect(said.collisions).toEqual([]);

    const back = await held.api.importArchive(out);
    expect(back.ref).toBe(second.ref);
    expect((await reopened(held).getNode(note.ref))?.title).toBe("Beans");
  });

  it("refuses one whose notes are already in another graph here", async () => {
    const { held, graph, note } = await written();
    const said = await held.api.previewArchive(
      await archiveFrom(held, graph.ref),
    );
    // The graph a person started with is what every archive of one names, so
    // this one opens a graph of its own — and its notes are already here.
    expect(said.replaces).toBe(false);
    expect(said.collisions).toEqual([note.ref]);
    await expect(
      held.api.importArchive(await archiveFrom(held, graph.ref)),
    ).rejects.toThrow("already in another of your graphs");
  });

  it("refuses a file that is not a graph", async () => {
    const held = device();
    await held.api.createGraph({ title: "Thesis" });
    await expect(
      held.api.previewArchive(body(new Uint8Array([1, 2, 3, 4]))),
    ).rejects.toThrow("isn't a Sloppy graph");
  });
});
