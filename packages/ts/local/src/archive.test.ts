import {
  type OwnedRef,
  splitOwnedRef,
  ulid,
  UNNAMED_GRAPH_ULID,
} from "@sloppy/types";
import {
  GRAPH_FILE,
  amendmentToVault,
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

/** An offer standing in the folder, written the way one arriving through git or
 *  an archive is, and answering with the file it landed at. */
async function offering(
  held: Device,
  note: OwnedRef,
  root = "/graphs/one",
): Promise<string> {
  const { did } = splitOwnedRef(note);
  const at = new Date().toISOString();
  const { files } = amendmentToVault({
    ref: `${did}/${ulid()}`,
    created_by: did,
    created_at: at,
    updated_at: at,
    note,
    by: "did:syr:elsewhere",
    at,
    title: "Seeds, as they would have it",
    tags: [],
    blocks: [],
  });
  const [path, bytes] = [...files][0] as [string, Uint8Array];
  await held.files.at(root).write(path, bytes);
  return path;
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

  it("carries the offers standing on those notes", async () => {
    const { held, graph, note } = await written();
    const offer = await offering(held, note.ref);

    const vault = unpack((await held.api.exportArchive(graph.ref)).bytes);
    expect(vault.has(offer)).toBe(true);
  });
});

describe("a graph closed", () => {
  it("leaves no offer lying in the folder", async () => {
    const { held, graph, note } = await written();
    const offer = await offering(held, note.ref);

    await held.api.closeGraph(graph.ref);
    expect(await held.files.at("/graphs/one").exists(offer)).toBe(false);
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

/** One graph on this device, taken out and then written in since, so the two
 *  copies say different things about the one note in it. */
async function diverged() {
  const held = device(["/graphs/one", "/graphs/two"]);
  await held.api.createGraph({ title: "Thesis" });
  const second = await held.api.createGraph({ title: "Garden" });
  const note = await held.api.createNode({
    from: { relation: "branch", graph: second.ref },
    title: "Beans",
  });
  const out = await archiveFrom(held, second.ref);
  await held.api.updateNode(note.ref, { title: "Beans, later" });
  return { held, second, note, out };
}

/** Two copies of one graph with the number 2 on a different note in each: the
 *  folder's "Kale", and the file's "Peas". */
async function contestedNumber() {
  const theirs = device(["/graphs/one"]);
  const away = await theirs.api.createGraph({ title: "Garden" });
  const beans = await theirs.api.createNode({
    from: { relation: "branch", graph: away.ref },
    title: "Beans",
  });
  expect(beans.address).toBe("1");
  const base = await archiveFrom(theirs, away.ref);
  const peas = await theirs.api.createNode({
    from: { relation: "branch", graph: away.ref },
    title: "Peas",
  });
  expect(peas.address).toBe("2");
  const out = await archiveFrom(theirs, away.ref);

  const mine = device(["/graphs/arrived"]);
  const here = await mine.api.importArchive(base);
  const kale = await mine.api.createNode({
    from: { relation: "branch", graph: here.ref },
    title: "Kale",
  });
  expect(kale.address).toBe("2");
  const arrived = `${splitOwnedRef(kale.ref).did}/${
    splitOwnedRef(peas.ref).localId
  }` as OwnedRef;
  return { mine, here, kale, arrived, out };
}

/** A graph taken out as a file, and then a note in it thrown away and swept up
 *  here, so the folder has retired the number that note spent and the file
 *  still holds it. */
async function swept() {
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
  expect(spent.address).toBe("2");
  const out = await archiveFrom(held, second.ref);

  await held.api.deleteNode(spent.ref);
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
  await reopened(held).deletedBranches();
  return { held, second, spent, out };
}

describe("a graph of this device's own brought back in", () => {
  it("brings back what only the file holds and keeps what only the folder does", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const beans = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const out = await archiveFrom(held, second.ref);

    await held.api.deleteNode(beans.ref);
    const peas = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Peas",
    });

    const said = await held.api.previewArchive(out);
    expect(said.merges).toBe(true);
    expect(said.conflicts).toEqual([]);
    expect(said.replaces).toBe(false);

    const back = await held.api.importArchive(out);
    expect(back.ref).toBe(second.ref);
    const client = reopened(held);
    expect((await client.getNode(beans.ref))?.title).toBe("Beans");
    expect((await client.getNode(peas.ref))?.title).toBe("Peas");
    expect(await client.deletedBranches()).toEqual([]);
  });

  it("says what the two copies disagree about, before anything is written", async () => {
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
    expect(said.merges).toBe(true);
    expect(said.replaces).toBe(false);
    expect(said.replacing).toBe(0);
    expect(said.conflicts).toEqual([
      {
        kind: "note",
        ref: note.ref,
        sections: [],
        mine: "Beans, later",
        theirs: "Beans",
      },
    ]);

    await expect(held.api.importArchive(out)).rejects.toThrow(
      "disagree about one note",
    );
    expect((await reopened(held).getNode(note.ref))?.title).toBe(
      "Beans, later",
    );
  });

  it("writes nothing at all while a disagreement is unsettled", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const beans = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const peas = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Peas",
    });
    const out = await archiveFrom(held, second.ref);

    await held.api.updateNode(beans.ref, { title: "Beans, later" });
    await held.api.deleteNode(peas.ref);
    await expect(held.api.importArchive(out)).rejects.toThrow(
      "disagree about one note",
    );

    const client = reopened(held);
    expect((await client.getNode(beans.ref))?.title).toBe("Beans, later");
    // The note in the bin would have come back with the rest of the file.
    expect((await client.deletedBranches()).map((one) => one.title)).toEqual([
      "Peas",
    ]);
  });

  it("keeps what is in the folder where the person chose it", async () => {
    const { held, note, out } = await diverged();
    await held.api.importArchive(out, {
      resolutions: [{ kind: "note", ref: note.ref, keep: "mine" }],
    });
    expect((await reopened(held).getNode(note.ref))?.title).toBe(
      "Beans, later",
    );
  });

  it("takes what is in the file where the person chose it", async () => {
    const { held, second, note, out } = await diverged();
    const back = await held.api.importArchive(out, {
      resolutions: [{ kind: "note", ref: note.ref, keep: "theirs" }],
    });
    expect(back.ref).toBe(second.ref);
    expect((await reopened(held).getNode(note.ref))?.title).toBe("Beans");
  });

  it("keeps leading by the number the side it let go had", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const beans = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    expect(beans.address).toBe("1");
    const out = await archiveFrom(held, second.ref);
    await held.api.setAddress(beans.ref, "4");

    const [conflict] = (await held.api.previewArchive(out)).conflicts;
    // Two numbers, and not two identical texts, is what a person settles here.
    expect(conflict.mine).toBe("Numbered 4\nBeans");
    expect(conflict.theirs).toBe("Numbered 1\nBeans");

    await held.api.importArchive(out, {
      resolutions: [{ kind: "note", ref: beans.ref, keep: "theirs" }],
    });
    const client = reopened(held);
    const back = await client.getNode(beans.ref);
    expect(back?.address).toBe("1");
    // 4 was this graph's to spend and it spent it on this note, so it still
    // leads there and no second note may have it.
    expect(back?.aliases).toEqual(["4"]);
    await expect(
      client.createNode({
        from: { relation: "root", address: "4", graph: second.ref },
      }),
    ).rejects.toThrow("4 still leads to “Beans”");
  });

  it("says where each side puts a note the two copies moved apart", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const beans = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const kale = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Kale",
    });
    const pods = await held.api.createNode({
      from: { relation: "under", note: beans.ref },
      title: "Pods",
    });
    expect(pods.address).toBe("1a");
    const out = await archiveFrom(held, second.ref);

    const [moved] = await held.api.moveNote(pods.ref, {
      relation: "under",
      note: kale.ref,
    });
    expect(moved.address).toBe("2a");

    const [conflict] = (await held.api.previewArchive(out)).conflicts;
    expect(conflict.mine).toBe("Numbered 2a\nUnder “Kale”\nPods");
    expect(conflict.theirs).toBe("Numbered 1a\nUnder “Beans”\nPods");
  });

  it("counts a tag written on one side alone as a disagreement", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const note = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
      tags: ["seed"],
    });
    const out = await archiveFrom(held, second.ref);

    await held.api.updateNode(note.ref, { tags: ["seed", "sown"] });
    const said = await held.api.previewArchive(out);
    expect(said.conflicts).toEqual([
      {
        kind: "note",
        ref: note.ref,
        sections: [],
        mine: "Beans\nseed, sown",
        theirs: "Beans\nseed",
      },
    ]);

    await held.api.importArchive(out, {
      resolutions: [{ kind: "note", ref: note.ref, keep: "theirs" }],
    });
    expect((await reopened(held).getNode(note.ref))?.tags).toEqual(["seed"]);
  });

  it("settles a note section by section", async () => {
    const held = device(["/graphs/one", "/graphs/two"]);
    await held.api.createGraph({ title: "Thesis" });
    const second = await held.api.createGraph({ title: "Garden" });
    const note = await held.api.createNode({
      from: { relation: "branch", graph: second.ref },
      title: "Beans",
    });
    const first = await held.api.createBlock({
      node: note.ref,
      content: textDocument("Sown in April."),
    });
    const next = await held.api.createBlock({
      node: note.ref,
      content: textDocument("Picked in July."),
    });
    await held.api.createBlock({
      node: note.ref,
      content: textDocument("A row of them by the wall."),
    });
    const out = await archiveFrom(held, second.ref);

    await held.api.updateBlock(first.ref, {
      content: textDocument("Sown in May."),
    });
    await held.api.updateBlock(next.ref, {
      content: textDocument("Picked in August."),
    });

    const said = await held.api.previewArchive(out);
    const [conflict] = said.conflicts;
    expect(conflict.kind).toBe("section");
    // Each disputed section in both sides' words, and the whole note in them
    // besides, since the side kept governs the sections nobody disputed.
    expect(
      [...conflict.sections].sort((a, b) => (a.mine < b.mine ? -1 : 1)),
    ).toEqual([
      {
        section: splitOwnedRef(next.ref).localId,
        mine: "Picked in August.",
        theirs: "Picked in July.",
      },
      {
        section: splitOwnedRef(first.ref).localId,
        mine: "Sown in May.",
        theirs: "Sown in April.",
      },
    ]);
    expect(conflict.mine).toContain("A row of them by the wall.");
    expect(conflict.mine).toContain("Sown in May.");
    expect(conflict.theirs).toContain("Sown in April.");

    await held.api.importArchive(out, {
      resolutions: [
        {
          kind: "section",
          ref: note.ref,
          keep: "mine",
          sections: [
            { section: splitOwnedRef(next.ref).localId, keep: "theirs" },
          ],
        },
      ],
    });
    const client = reopened(held);
    expect(
      (await client.listBlocks(note.ref)).map((one) => one.content),
    ).toEqual([
      textDocument("A row of them by the wall."),
      textDocument("Picked in July."),
      textDocument("Sown in May."),
    ]);
  });

  it("settles a number the two copies have on different notes", async () => {
    const { mine, here, kale, arrived, out } = await contestedNumber();

    const said = await mine.api.previewArchive(out);
    expect(said.conflicts.filter((one) => one.kind === "address")).toEqual([
      {
        kind: "address",
        ref: kale.ref,
        other: arrived,
        address: "2",
        sections: [],
        mine: "Kale",
        theirs: "Peas",
      },
    ]);

    await mine.api.importArchive(out, {
      resolutions: [{ kind: "address", ref: kale.ref, keep: "theirs" }],
    });
    const client = reopened(mine);
    const peas = await client.getNode(arrived);
    expect(peas?.title).toBe("Peas");
    expect(peas?.address).toBe("2");
    // The note that gave the number up still leads by it.
    const gave = await client.getNode(kale.ref);
    expect(gave?.address).toBeUndefined();
    expect(gave?.aliases).toEqual(["2"]);
    await expect(
      client.createNode({
        from: { relation: "root", address: "2", graph: here.ref },
      }),
    ).rejects.toThrow("2 already leads to “Peas”");
  });

  it("leaves a contested number where the person kept the folder's note", async () => {
    const { mine, kale, arrived, out } = await contestedNumber();
    await mine.api.importArchive(out, {
      resolutions: [{ kind: "address", ref: kale.ref, keep: "mine" }],
    });
    const client = reopened(mine);
    expect((await client.getNode(kale.ref))?.address).toBe("2");
    const peas = await client.getNode(arrived);
    expect(peas?.title).toBe("Peas");
    expect(peas?.address).toBeUndefined();
    expect(peas?.aliases).toEqual(["2"]);
  });

  it("gives a contested number to the note the person named", async () => {
    const { mine, kale, arrived, out } = await contestedNumber();
    await mine.api.importArchive(out, {
      resolutions: [
        { kind: "address", ref: kale.ref, keep: "mine", numbered: arrived },
      ],
    });
    const client = reopened(mine);
    expect((await client.getNode(arrived))?.address).toBe("2");
    const gave = await client.getNode(kale.ref);
    expect(gave?.address).toBeUndefined();
    expect(gave?.aliases).toEqual(["2"]);
  });

  it("leaves an arriving note unnumbered where a note here led by its number", async () => {
    const { mine, here, kale, arrived, out } = await contestedNumber();
    await mine.api.setAddress(kale.ref, "5");

    // Two notes at 2 no longer, so there is nothing for a person to settle.
    expect((await mine.api.previewArchive(out)).conflicts).toEqual([]);
    await mine.api.importArchive(out);

    const client = reopened(mine);
    const peas = await client.getNode(arrived);
    expect(peas?.title).toBe("Peas");
    expect(peas?.address).toBeUndefined();
    expect(peas?.aliases ?? []).not.toContain("2");
    await expect(
      client.createNode({
        from: { relation: "root", address: "2", graph: here.ref },
      }),
    ).rejects.toThrow("2 still leads to “Kale”");
  });

  it("brings a drawing and a picture in with the note that arrives", async () => {
    const drawn = {
      strokes: [{ points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }], width: 2 }],
      width: 40,
      height: 20,
      description: "A line",
    };
    const theirs = device(["/graphs/theirs"]);
    const away = await theirs.api.createGraph({ title: "Garden" });
    await theirs.api.createNode({
      from: { relation: "branch", graph: away.ref },
      title: "Beans",
    });
    const base = await archiveFrom(theirs, away.ref);

    const ticket = await theirs.api.createUpload({
      role: "block",
      filename: "seed.png",
      mime_type: "image/png",
      size: 3,
    });
    await theirs.api.sendUpload(ticket, new Blob([new Uint8Array([1, 2, 3])]));
    await theirs.api.completeUpload({ upload_id: ticket.upload_id });
    const kale = await theirs.api.createNode({
      from: { relation: "branch", graph: away.ref },
      title: "Kale",
    });
    const written = {
      type: "doc" as const,
      content: [
        { type: "ink", attrs: drawn },
        {
          type: "picture",
          attrs: { upload_id: ticket.upload_id, width: 8, height: 6 },
        },
      ],
    };
    await theirs.api.createBlock({ node: kale.ref, content: written });
    const out = await archiveFrom(theirs, away.ref);

    const mine = device(["/graphs/arrived"]);
    const here = await mine.api.importArchive(base);
    await mine.api.importArchive(out);

    const client = reopened(mine);
    const arrived =
      `${splitOwnedRef(here.ref).did}/${splitOwnedRef(kale.ref).localId}` as OwnedRef;
    expect((await client.listBlocks(arrived))[0].content).toEqual(written);
    expect(
      mine.store.get(`/graphs/arrived/media/${ticket.upload_id}.png`),
    ).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("brings an emoji the folder has no picture for in with the note", async () => {
    const theirs = device(["/graphs/theirs"]);
    const away = await theirs.api.createGraph({ title: "Garden" });
    await theirs.api.createNode({
      from: { relation: "branch", graph: away.ref },
      title: "Beans",
    });
    const base = await archiveFrom(theirs, away.ref);

    const ticket = await theirs.api.createUpload({
      role: "emoji",
      filename: "sprout.png",
      mime_type: "image/png",
      size: 3,
    });
    await theirs.api.sendUpload(ticket, new Blob([new Uint8Array([9, 8, 7])]));
    await theirs.api.completeUpload({ upload_id: ticket.upload_id });
    const drawn = await theirs.api.addEmoji({
      shortcode: "sprout",
      kind: "emoji",
      upload_id: ticket.upload_id,
    });
    const kale = await theirs.api.createNode({
      from: { relation: "branch", graph: away.ref },
      title: "Kale",
    });
    const written = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "emoji", attrs: { name: "sprout", src: drawn.src } },
          ],
        },
      ],
    };
    await theirs.api.createBlock({ node: kale.ref, content: written });
    const out = await archiveFrom(theirs, away.ref);

    const mine = device(["/graphs/arrived"]);
    const here = await mine.api.importArchive(base);
    await mine.api.importArchive(out);

    const client = reopened(mine);
    expect((await client.ownEmoji()).map((one) => one.shortcode)).toEqual([
      "sprout",
    ]);
    const arrived =
      `${splitOwnedRef(here.ref).did}/${splitOwnedRef(kale.ref).localId}` as OwnedRef;
    expect((await client.listBlocks(arrived))[0].content).toEqual(written);
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

  it("still owes a citation every number the graph it settles into retired", async () => {
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

  it("brings a note back with the number it spent, and nobody else's", async () => {
    const { held, second, spent, out } = await swept();
    await reopened(held).importArchive(out);

    const client = reopened(held);
    const back = await client.getNode(spent.ref);
    expect(back?.title).toBe("Peas");
    expect(back?.address).toBe("2");
    await expect(
      client.createNode({
        from: { relation: "root", address: "2", graph: second.ref },
      }),
    ).rejects.toThrow("2 already leads to “Peas”");
  });

  it("leaves a retired number that names no note where it is", async () => {
    const { held, second, spent, out } = await swept();
    held.store.set(
      `/graphs/two/${BIN_FILE}`,
      encodeText(JSON.stringify({ deleted: {}, retired: ["2"] })),
    );
    await reopened(held).importArchive(out);

    const client = reopened(held);
    const back = await client.getNode(spent.ref);
    expect(back?.title).toBe("Peas");
    // The folder's own copy of 2 names no note, so it is nobody's to take.
    expect(back?.address).toBeUndefined();
    await expect(
      client.createNode({
        from: { relation: "root", address: "2", graph: second.ref },
      }),
    ).rejects.toThrow("You have used 2 before");
  });

  it("leaves the numbers the folder's copy is at where they are", async () => {
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
    const peas = await client.getNode(later.ref);
    expect(peas?.address).toBe("5");
    expect(peas?.aliases).toEqual(["2"]);
    const pods = await client.getNode(under.ref);
    expect(pods?.address).toBe("7");
    expect(pods?.aliases).toEqual(["1a"]);
    expect((await client.deletedBranches())[0].address).toBe("6");
    await expect(
      client.createNode({
        from: { relation: "root", address: "2", graph: second.ref },
      }),
    ).rejects.toThrow("2 still leads to “Peas”");
  });

  it("settles into the graph this device started with, like any other", async () => {
    const { held, graph, note } = await written();
    const said = await held.api.previewArchive(
      await archiveFrom(held, graph.ref),
    );
    // Every graph's ulid is its own, the first one included, so an archive of
    // it comes home rather than opening a stranger beside it.
    expect(said.merges).toBe(true);
    expect(said.conflicts).toEqual([]);
    expect(said.collisions).toEqual([]);

    const back = await held.api.importArchive(
      await archiveFrom(held, graph.ref),
    );
    expect(back.ref).toBe(graph.ref);
    expect((await reopened(held).getNode(note.ref))?.title).toBe("Seeds");
  });

  it("comes home to a folder started before graphs had their own number", async () => {
    const { held, graph } = await written(["/graphs/one"]);
    const said = JSON.parse(
      decodeText(held.store.get(`/graphs/one/${GRAPH_FILE}`) as Uint8Array),
    );
    held.store.set(
      `/graphs/one/${GRAPH_FILE}`,
      encodeText(`${JSON.stringify({ ...said, graph: UNNAMED_GRAPH_ULID })}\n`),
    );

    const client = reopened(held);
    const [own] = await client.listGraphs();
    expect(own.ref).not.toBe(graph.ref);
    expect(splitOwnedRef(own.ref).localId).not.toBe(UNNAMED_GRAPH_ULID);

    const out = await archiveFrom({ ...held, api: client }, own.ref);
    expect((await client.previewArchive(out)).merges).toBe(true);
    expect((await client.importArchive(out)).ref).toBe(own.ref);
  });

  it("refuses one whose notes are already in another graph here", async () => {
    const { held, graph, note } = await written();
    const said = await held.api.previewArchive(
      renamed(await held.api.exportArchive(graph.ref)),
    );
    // A graph of its own, holding notes this device already keeps somewhere
    // else.
    expect(said.replaces).toBe(false);
    expect(said.merges).toBe(false);
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
