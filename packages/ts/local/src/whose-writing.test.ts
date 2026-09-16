// Whose writing a note in a folder carries, and what a change offered on
// somebody else's note does — docs/ARCHITECTURE.md § "Whose writing a note
// carries".

import { type DidSyr, type OwnedRef, ulid } from "@sloppy/types";
import { amendmentPath } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi } from "./api.js";
import { MemoryFiles } from "./files.js";
import {
  body,
  type Device,
  device,
  graphOnly,
  PickingFiles,
  reopened,
  reread,
  textDocument,
} from "./local.test-support.js";

const BOB = "did:syr:z6MkuBobBobBobBobBobBobBobBobBob";
const CAI = "did:syr:z6MkvCaiCaiCaiCaiCaiCaiCaiCaiCai";

interface Folder extends Device {
  /** Whose the graph in the folder is. */
  did: DidSyr;
  graph: OwnedRef;
}

async function opened(): Promise<Folder> {
  const held = device();
  const graph = await held.api.createGraph({ title: "Thesis" });
  const me = await held.api.me();
  return { ...held, did: me?.did as DidSyr, graph: graph.ref };
}

/** The same folder written in under another of the identities this device
 *  holds, which is what a folder shared through git is. */
function writingAs(held: Folder, writer: DidSyr): LocalApi {
  return new LocalApi(new PickingFiles({ store: held.store }), { writer });
}

/** Everything in the folder, so an assertion reads the files rather than an
 *  index a write left behind. */
function read(held: Folder): LocalApi {
  return reopened(held);
}

function offerPath(held: Folder, offer: OwnedRef): string {
  return `/graphs/one/${amendmentPath(offer.slice(offer.lastIndexOf("/") + 1))}`;
}

describe("whose writing a note carries", () => {
  it("takes in the writing of anybody who writes in an open note", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });

    await writingAs(held, BOB).updateNode(note.ref, { title: "Seeds, again" });

    const written = await read(held).getNode(note.ref);
    expect(written?.title).toBe("Seeds, again");
    expect(written?.authors).toEqual([held.did, BOB]);
  });

  it("names each writer once, however often they write", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });
    const bob = writingAs(held, BOB);

    await bob.updateNode(note.ref, { title: "Once" });
    await writingAs(held, BOB).updateNode(note.ref, { tags: ["seed"] });

    expect((await read(held).getNode(note.ref))?.authors).toEqual([
      held.did,
      BOB,
    ]);
  });

  it("carries a section somebody else writes into the note's authorship", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });

    await writingAs(held, BOB).createBlock({
      node: note.ref,
      content: textDocument("What I would add"),
    });

    const again = read(held);
    expect((await again.getNode(note.ref))?.authors).toEqual([held.did, BOB]);
    expect(await again.listBlocks(note.ref)).toHaveLength(1);
  });

  it("writes a new note under the person writing it", async () => {
    const held = await opened();

    const note = await writingAs(held, BOB).createNode({ title: "Mine" });

    expect(note.authors).toEqual([BOB]);
    expect((await read(held).getNode(note.ref))?.authors).toEqual([BOB]);
  });

  it("leaves whose writing a note is out of the file where it is the graph's own", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });

    expect(note.authors).toBeUndefined();
    expect((await read(held).getNode(note.ref))?.authors).toBeUndefined();
  });

  it("stamps the writer as owner in a graph that gates what is written in it", async () => {
    const held = await opened();
    await held.api.updateGraph(held.graph, {
      title: "Thesis",
      ownership: "owned",
    });

    const mine = await writingAs(held, BOB).createNode({ title: "Mine" });

    expect(mine.owner).toBe(BOB);
    expect((await read(held).getNode(mine.ref))?.owner).toBe(BOB);
  });

  it("lands an owner's own writing and leaves its authorship alone", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });
    await held.api.updateNode(note.ref, { owner: held.did });

    const written = await held.api.updateNode(note.ref, {
      title: "Still mine",
    });

    expect(written.title).toBe("Still mine");
    expect(written.authors).toBeUndefined();
  });
});

describe("a note somebody else writes", () => {
  async function gated(): Promise<{ held: Folder; note: OwnedRef }> {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });
    await held.api.updateNode(note.ref, { owner: held.did });
    return { held, note: note.ref };
  }

  it("takes no ordinary write, and says what to do instead", async () => {
    const { held, note } = await gated();
    const bob = writingAs(held, BOB);

    await expect(
      bob.updateNode(note, { title: "As I would have it" }),
    ).rejects.toThrow("Offer your change instead");
    await expect(
      bob.createBlock({ node: note, content: textDocument("Mine") }),
    ).rejects.toThrow("Offer your change instead");
    await expect(
      bob.actOnNodes({ notes: [note], act: { act: "tag", tags: ["seed"] } }),
    ).rejects.toThrow("Offer your change instead");

    const written = await read(held).getNode(note);
    expect(written?.title).toBe("Seeds");
  });

  it("takes no section carried into it from a note anybody writes", async () => {
    const { held, note } = await gated();
    const mine = await held.api.createNode({ title: "Mine" });
    const section = await writingAs(held, BOB).createBlock({
      node: mine.ref,
      content: textDocument("What I would add"),
    });

    await expect(
      writingAs(held, BOB).updateBlock(section.ref, { node: note }),
    ).rejects.toThrow("Offer your change instead");

    const again = read(held);
    expect(await again.listBlocks(note)).toEqual([]);
    expect(await again.listBlocks(mine.ref)).toHaveLength(1);
  });

  it("keeps its place out of anybody else's hands", async () => {
    const { held, note } = await gated();
    const beside = await held.api.createNode({ title: "Beside it" });
    const bob = writingAs(held, BOB);

    await expect(bob.setAddress(note, "7")).rejects.toThrow(
      "Only its owner can number it",
    );
    await expect(
      bob.moveNote(note, { relation: "under", note: beside.ref }),
    ).rejects.toThrow("Only its owner can carry it somewhere else");
    await expect(bob.deleteNode(note)).rejects.toThrow(
      "Only its owner can delete it",
    );
    await expect(
      bob.actOnNodes({ notes: [note], act: { act: "delete" } }),
    ).rejects.toThrow("Only its owner can delete it");
  });

  it("is nobody else's to claim", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });

    await expect(
      writingAs(held, BOB).updateNode(note.ref, { owner: BOB }),
    ).rejects.toThrow("Only its owner can say who writes it");
  });

  it("is opened again by the person whose graph it is in", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });
    await held.api.updateNode(note.ref, { owner: BOB });

    const opened_ = await held.api.updateNode(note.ref, { owner: null });

    expect(opened_.owner).toBeUndefined();
    expect((await read(held).getNode(note.ref))?.owner).toBeUndefined();
  });
});

describe("a change offered on a note", () => {
  async function offered(): Promise<{
    held: Folder;
    note: OwnedRef;
    section: OwnedRef;
    offer: OwnedRef;
  }> {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds", tags: ["one"] });
    const section = await held.api.createBlock({
      node: note.ref,
      content: textDocument("As it stands"),
    });
    await held.api.updateNode(note.ref, { owner: held.did });
    const offer = await writingAs(held, BOB).proposeAmendment({
      note: note.ref,
      message: "I think this reads better.",
      title: "Seeds, as I would have it",
      tags: ["one", "two"],
      blocks: [
        { ref: section.ref, content: textDocument("As I would have it") },
      ],
    });
    return { held, note: note.ref, section: section.ref, offer: offer.ref };
  }

  it("is a file in the folder, and is read back out of it", async () => {
    const { held, note, offer } = await offered();

    expect(held.store.has(offerPath(held, offer))).toBe(true);
    const standing = await read(held).listAmendments(note);
    expect(standing).toHaveLength(1);
    expect(standing[0].ref).toBe(offer);
    expect(standing[0].by).toBe(BOB);
    expect(standing[0].message).toBe("I think this reads better.");
    expect(standing[0].title).toBe("Seeds, as I would have it");
    expect(standing[0].blocks[0].content).toEqual(
      textDocument("As I would have it"),
    );
  });

  it("leaves the note as it stands until it is taken in", async () => {
    const { held, note } = await offered();

    const written = await read(held).getNode(note);
    expect(written?.title).toBe("Seeds");
    expect(written?.tags).toEqual(["one"]);
    expect(written?.contributors).toBeUndefined();
  });

  it("is one per person per note, written again rather than stacked", async () => {
    const { held, note, section, offer } = await offered();

    const again = await writingAs(held, BOB).proposeAmendment({
      note,
      title: "Seeds, thought about",
      tags: [],
      blocks: [{ ref: section, content: textDocument("Thought about") }],
    });

    expect(again.ref).toBe(offer);
    expect(again.message).toBeUndefined();
    const standing = await read(held).listAmendments(note);
    expect(standing).toHaveLength(1);
    expect(standing[0].title).toBe("Seeds, thought about");
  });

  it("is read by the person who writes the note, and by whoever offered it", async () => {
    const { held, note } = await offered();

    expect(await writingAs(held, BOB).listAmendments(note)).toHaveLength(1);
    expect(await writingAs(held, CAI).listAmendments(note)).toEqual([]);
  });

  it("stands beside what somebody else offered on the same note", async () => {
    const { held, note, section, offer } = await offered();

    const second = await writingAs(held, CAI).proposeAmendment({
      note,
      title: "Seeds, otherwise",
      tags: [],
      blocks: [{ ref: section, content: textDocument("Otherwise") }],
    });

    const standing = await read(held).listAmendments(note);
    expect(standing.map((one) => one.ref).sort()).toEqual(
      [offer, second.ref].sort(),
    );
    expect(standing.map((one) => one.by).sort()).toEqual([BOB, CAI].sort());
  });

  it("is read oldest first", async () => {
    const files = new MemoryFiles();
    const { graph, writer } = await graphOnly(files);
    const note = await writer.create({ title: "Seeds" });
    const at = new Date().toISOString();
    for (const [made, by] of [
      ["01J0000000000000000000000B", CAI],
      ["01J0000000000000000000000A", BOB],
    ] as const) {
      await graph.saveOffer({
        ulid: made,
        amends: note.ref,
        by,
        at,
        title: "As I would have it",
        tags: [],
        sections: [],
      });
    }

    expect(graph.offersOn(note.ref).map((one) => one.by)).toEqual([BOB, CAI]);
  });

  it("is not something to make on a note you write yourself", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });

    await expect(
      held.api.proposeAmendment({
        note: note.ref,
        title: "Seeds",
        tags: [],
        blocks: [],
      }),
    ).rejects.toThrow("You can write in this note");
  });

  it("becomes the note's writing whole when it is taken in", async () => {
    const { held, note, section, offer } = await offered();
    const was = await held.api.getNode(note);

    const written = await read(held).approveAmendment(offer);

    expect(written.title).toBe("Seeds, as I would have it");
    expect(written.tags).toEqual(["one", "two"]);
    expect(written.contributors).toEqual([BOB]);
    expect(written.authors).toBeUndefined();
    expect(written.updated_at >= (was?.updated_at as string)).toBe(true);
    const again = read(held);
    expect((await again.listBlocks(note))[0].content).toEqual(
      textDocument("As I would have it"),
    );
    expect((await again.listBlocks(note))[0].ref).toBe(section);
    expect(await again.listAmendments(note)).toEqual([]);
    expect(held.store.has(offerPath(held, offer))).toBe(false);
  });

  it("adds and takes out sections as the offer has them", async () => {
    const { held, note, section, offer } = await offered();
    const added = `${held.did}/${ulid()}`;
    await writingAs(held, BOB).proposeAmendment({
      note,
      title: "Seeds",
      tags: [],
      blocks: [{ ref: added, content: textDocument("A second thought") }],
    });

    await read(held).approveAmendment(offer);

    const stack = await read(held).listBlocks(note);
    expect(stack).toHaveLength(1);
    expect(stack[0].ref).toBe(added);
    expect(stack[0].ref).not.toBe(section);
  });

  it("leaves nothing behind when it is turned down", async () => {
    const { held, note, offer } = await offered();

    await read(held).declineAmendment(offer);

    const again = read(held);
    expect(await again.listAmendments(note)).toEqual([]);
    expect((await again.getNode(note))?.title).toBe("Seeds");
    expect((await again.getNode(note))?.contributors).toBeUndefined();
    expect(held.store.has(offerPath(held, offer))).toBe(false);
  });

  it("is taken back by the person who offered it and by nobody else", async () => {
    const { held, note, offer } = await offered();

    await expect(writingAs(held, CAI).withdrawAmendment(offer)).rejects.toThrow(
      "Only the person who offered this change can take it back",
    );
    await writingAs(held, BOB).withdrawAmendment(offer);

    expect(await read(held).listAmendments(note)).toEqual([]);
  });

  it("is settled by the person who writes the note and by nobody else", async () => {
    const { held, offer } = await offered();
    const bob = writingAs(held, BOB);

    await expect(bob.approveAmendment(offer)).rejects.toThrow(
      "This change is for the person who writes that note",
    );
    await expect(bob.declineAmendment(offer)).rejects.toThrow(
      "This change is for the person who writes that note",
    );
  });

  it("rides in an archive and settles back into the graph it came from", async () => {
    const { held, note, offer } = await offered();
    const owner = read(held);
    const archive = await owner.exportArchive(held.graph);
    await owner.declineAmendment(offer);
    expect(await owner.listAmendments(note)).toEqual([]);

    await owner.importArchive(body(archive.bytes));

    const standing = await read(held).listAmendments(note);
    expect(standing).toHaveLength(1);
    expect(standing[0].by).toBe(BOB);
    expect(standing[0].title).toBe("Seeds, as I would have it");
  });

  it("goes with the note it was offered on when that note is gone for good", async () => {
    const files = new MemoryFiles();
    const { graph, writer, did } = await graphOnly(files);
    const note = await writer.create({ title: "Seeds" });
    await graph.saveOffer({
      ulid: ulid(),
      amends: note.ref,
      by: BOB,
      at: new Date().toISOString(),
      title: "As I would have it",
      tags: [],
      sections: [],
    });

    await writer.remove(note.ref);
    await graph.purge(graph.binned());

    expect(graph.offersOn(note.ref)).toEqual([]);
    expect((await reread(files, did)).offersOn(note.ref)).toEqual([]);
  });

  it("does not arrive twice when the archive is brought in again", async () => {
    const { held, note } = await offered();
    const owner = read(held);
    const archive = await owner.exportArchive(held.graph);

    await owner.importArchive(body(archive.bytes));

    expect(await read(held).listAmendments(note)).toHaveLength(1);
  });
});
