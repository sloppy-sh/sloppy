import { splitOwnedRef } from "@sloppy/types";
import {
  GRAPH_FILE,
  decodeText,
  encodeText,
  pack,
  unpack,
} from "@sloppy/vault";
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

/** The same archive under a graph ulid this device does not keep, which is what
 *  makes it a graph of its own arriving. */
function renamed(out: { bytes: Uint8Array }): Blob {
  const vault = unpack(out.bytes);
  const said = JSON.parse(decodeText(vault.get(GRAPH_FILE) as Uint8Array));
  vault.set(
    GRAPH_FILE,
    encodeText(
      `${JSON.stringify({ ...said, graph: "01JAPART000000000000000000" })}\n`,
    ),
  );
  return body(pack(vault));
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

  it("brings its owner's name back with it, and leaves somebody else's behind", async () => {
    const held = device(["/graphs/one", "/graphs/mine", "/graphs/theirs"]);
    await held.api.createGraph({ title: "Thesis" });
    const mine = await held.api.createGraph({ title: "Garden" });
    await held.api.updateProfile({ display_name: "Ada Lovelace" });
    const out = await archiveFrom(held, mine.ref);
    await held.api.importArchive(out);
    expect((await reopened(held).profile()).display_name).toBe("Ada Lovelace");

    const theirs = await written(["/theirs"]);
    await theirs.held.api.updateProfile({ display_name: "Somebody else" });
    const yours = device(["/graphs/one", "/graphs/arrived"]);
    await yours.api.createGraph({ title: "Mine" });
    await yours.api.importArchive(
      await archiveFrom(theirs.held, theirs.graph.ref),
    );
    expect((await yours.api.profile()).display_name).toBeNull();
  });

  it("still owes a citation every number the graph it replaces retired", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const spent = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Peas",
    });
    await held.api.deleteNode(spent.ref);
    // The bin never travels, so this archive holds "1" and knows nothing of "2".
    const out = await archiveFrom(held, second.ref);

    held.store.set(
      `/graphs/two/${BIN_FILE}`,
      encodeText(
        JSON.stringify({
          deleted: {
            [splitOwnedRef(spent.ref).localId]: "2020-01-01T00:00:00.000Z",
          },
          retired: [],
        }),
      ),
    );
    const client = reopened(held);
    await client.deletedBranches();
    await client.importArchive(out);

    await expect(
      reopened(held).createNode({
        from: { relation: "root", address: "2", graph: second.ref },
      }),
    ).rejects.toThrow("You have used 2 before");
  });

  it("still owes a citation every number the graph it replaces was at", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const beans = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const out = await archiveFrom(held, second.ref);

    const later = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Peas",
    });
    expect(later.address).toBe("2");
    await held.api.setAddress(later.ref, "5");
    const thrown = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Kale",
    });
    expect(thrown.address).toBe("6");
    await held.api.deleteNode(thrown.ref);
    const under = await held.api.createNode({
      from: { relation: "under", note: beans.ref },
      title: "Pods",
    });
    expect(under.address).toBe("1a");
    const [carried] = await held.api.moveNote(under.ref, {
      relation: "after",
      note: beans.ref,
    });
    expect(carried.address).toBe("7");

    await held.api.importArchive(out);

    const client = reopened(held);
    expect(await client.deletedBranches()).toEqual([]);
    for (const address of ["2", "5", "6", "7"]) {
      await expect(
        client.createNode({
          from: { relation: "root", address, graph: second.ref },
        }),
      ).rejects.toThrow(`You have used ${address} before`);
    }
    await expect(
      client.createNode({
        from: { relation: "under", note: beans.ref },
        address: "1a",
      }),
    ).rejects.toThrow("You have used 1a before");
  });

  it("settles into the graph this device started with, like any other", async () => {
    const { held, graph, note } = await written();
    const said = await held.api.previewArchive(
      await archiveFrom(held, graph.ref),
    );
    // Every graph's ulid is its own, the first one included, so an archive of
    // it comes home rather than opening a stranger beside it.
    expect(said.replaces).toBe(true);
    expect(said.collisions).toEqual([]);

    const back = await held.api.importArchive(
      await archiveFrom(held, graph.ref),
    );
    expect(back.ref).toBe(graph.ref);
    expect((await reopened(held).getNode(note.ref))?.title).toBe("Seeds");
  });

  it("refuses one whose notes are already in another graph here", async () => {
    const { held, graph, note } = await written();
    const said = await held.api.previewArchive(
      renamed(await held.api.exportArchive(graph.ref)),
    );
    // A graph of its own, holding notes this device already keeps somewhere
    // else.
    expect(said.replaces).toBe(false);
    expect(said.collisions).toEqual([note.ref]);
    await expect(
      held.api.importArchive(renamed(await held.api.exportArchive(graph.ref))),
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
