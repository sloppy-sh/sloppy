// A state a graph has been in, read as a graph and set beside another —
// docs/ARCHITECTURE.md § "The vault's history".

import type { SloppyApi } from "@sloppy/client";
import type { OwnedRef } from "@sloppy/types";
import type { Vault } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { changedBetween, graphAsItIs, graphAsItWas, LocalApi } from "./api.js";
import { MemoryFiles } from "./files.js";
import { textDocument } from "./local.test-support.js";

const ROOT = "/Users/me/garden";

function opened(store = new Map<string, Uint8Array>()) {
  const files = new MemoryFiles({ root: ROOT, store, data: "/data" });
  return { api: new LocalApi(files), files, store };
}

/** Everything in the folder, which is what the history keeps of it. */
async function state(files: MemoryFiles): Promise<Vault> {
  const vault: Vault = new Map();
  for (const path of await files.list("")) {
    const bytes = await files.read(path);
    if (bytes) vault.set(path, bytes);
  }
  return vault;
}

async function words(api: LocalApi, note: OwnedRef, said: string) {
  await api.createBlock({ node: note, content: textDocument(said) });
}

describe("a graph as it was", () => {
  it("reads exactly as the folder does", async () => {
    const held = opened();
    const first = await held.api.createNode({ title: "Origins" });
    await words(held.api, first.ref, "The seed of it");
    const was = await state(held.files);
    await held.api.updateNode(first.ref, { title: "Something else" });
    await held.api.createNode({ title: "A second thought" });

    const then = await graphAsItWas(was);

    expect((await then.listNodes()).map((one) => one.title)).toEqual([
      "Origins",
    ]);
    const sections = await then.listBlocks(first.ref);
    expect(sections).toHaveLength(1);
    expect(await then.graphHere()).toBe(await held.api.graphHere());
  });

  it("is whose graph it says it is, not this device's", async () => {
    const held = opened();
    const note = await held.api.createNode({ title: "Origins" });
    const was = await state(held.files);

    const then = await graphAsItWas(was);

    expect((await then.me())?.did).toBe(note.created_by);
  });

  it("refuses every act that would write, in words", async () => {
    const held = opened();
    const note = await held.api.createNode({ title: "Origins" });
    const then = await graphAsItWas(await state(held.files));
    const asItWas = /This is your graph as it was/;

    await expect(then.createNode({ title: "Another" })).rejects.toThrow(
      asItWas,
    );
    await expect(
      then.updateNode(note.ref, { title: "Another" }),
    ).rejects.toThrow(asItWas);
    await expect(then.deleteNode(note.ref)).rejects.toThrow(asItWas);
    await expect(then.setAddress(note.ref, null)).rejects.toThrow(asItWas);
    await expect(
      then.moveNote(note.ref, { relation: "under", note: note.ref }),
    ).rejects.toThrow(asItWas);
    await expect(
      then.createBlock({ node: note.ref, content: textDocument("No") }),
    ).rejects.toThrow(asItWas);
    await expect(then.updateProfile({ display_name: "Ada" })).rejects.toThrow(
      asItWas,
    );
    await expect(
      then.createUpload({
        role: "block",
        filename: "a.png",
        mime_type: "image/png",
        size: 1,
      }),
    ).rejects.toThrow(asItWas);
  });

  it("leaves the folder it came from untouched", async () => {
    const held = opened();
    await held.api.createNode({ title: "Origins" });
    const before = new Map(held.store);

    const then = await graphAsItWas(await state(held.files));
    await then.listNodes();

    for (const path of before.keys()) {
      expect(held.store.get(path)).toEqual(before.get(path));
    }
    expect([...held.store.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it("is read out of whatever is serving the folder, and nowhere else", async () => {
    const held = opened();
    await held.api.createNode({ title: "Origins" });

    expect([...(await graphAsItIs(held.api)).keys()]).toEqual(
      [...(await state(held.files)).keys()].filter(
        (path) => !path.startsWith(".sloppy/bin"),
      ),
    );
    await expect(graphAsItIs({} as SloppyApi)).rejects.toThrow(
      "not one this device keeps",
    );
  });

  it("says so where there was no graph in the folder yet", async () => {
    await expect(graphAsItWas(new Map())).rejects.toThrow(
      "Your graph was not in this folder yet",
    );
  });
});

describe("what changed between two states", () => {
  it("names the notes that arrived and the ones that went", async () => {
    const held = opened();
    const first = await held.api.createNode({ title: "Origins" });
    const was = await state(held.files);
    const second = await held.api.createNode({ title: "A second thought" });
    await held.api.deleteNode(first.ref);
    const now = await state(held.files);

    const changed = changedBetween(was, now);

    expect(
      changed.notes.map((one) => [one.ref, one.became, one.title]),
    ).toEqual(
      expect.arrayContaining([
        [second.ref, "added", "A second thought"],
        [first.ref, "removed", "Origins"],
      ]),
    );
    expect(changed.notes).toHaveLength(2);
  });

  it("says what a note was called and numbered on each side", async () => {
    const held = opened();
    const first = await held.api.createNode({ title: "Origins" });
    const was = await state(held.files);
    await held.api.updateNode(first.ref, { title: "Where it started" });
    await held.api.setAddress(first.ref, "2");
    const now = await state(held.files);

    const [note] = changedBetween(was, now).notes;

    expect(note.became).toBe("kept");
    expect(note.retitled).toEqual({ from: "Origins", to: "Where it started" });
    expect(note.renumbered).toEqual({ from: "1", to: "2" });
  });

  it("says where a note was moved from and to", async () => {
    const held = opened();
    const first = await held.api.createNode({ title: "Origins" });
    const under = await held.api.createNode({
      title: "Springs from it",
      from: { relation: "under", note: first.ref },
    });
    const beside = await held.api.createNode({ title: "On its own" });
    const was = await state(held.files);
    await held.api.moveNote(under.ref, {
      relation: "under",
      note: beside.ref,
    });
    const now = await state(held.files);

    const moved = changedBetween(was, now).notes.find(
      (one) => one.ref === under.ref,
    );

    expect(moved?.moved).toEqual({ from: first.ref, to: beside.ref });
  });

  it("puts a changed section on both sides, as each side wrote it", async () => {
    const held = opened();
    const note = await held.api.createNode({ title: "Origins" });
    const section = await held.api.createBlock({
      node: note.ref,
      content: textDocument("The seed of it"),
    });
    const was = await state(held.files);
    await held.api.updateBlock(section.ref, {
      content: textDocument("The seed of the argument"),
    });
    const gone = await held.api.createBlock({
      node: note.ref,
      content: textDocument("And what grew"),
    });
    const now = await state(held.files);

    const changed = changedBetween(was, now).notes.find(
      (one) => one.ref === note.ref,
    );

    expect(changed?.sections).toEqual(
      expect.arrayContaining([
        {
          ulid: section.ref.split("/")[1],
          before: textDocument("The seed of it"),
          after: textDocument("The seed of the argument"),
        },
        {
          ulid: gone.ref.split("/")[1],
          after: textDocument("And what grew"),
        },
      ]),
    );
  });

  it("lists the sections in the order they stand in the note", async () => {
    const held = opened();
    const note = await held.api.createNode({ title: "Origins" });
    const was = await state(held.files);
    const under = await held.api.createBlock({
      node: note.ref,
      content: textDocument("What grew out of it"),
    });
    // A ulid orders by the millisecond it was made in: two in one millisecond
    // would not tell creation order and standing order apart.
    await new Promise((done) => setTimeout(done, 2));
    const over = await held.api.createBlock({
      node: note.ref,
      content: textDocument("The seed"),
    });
    const now = await state(held.files);

    const changed = changedBetween(was, now).notes.find(
      (one) => one.ref === note.ref,
    );

    expect(changed?.sections.map((one) => one.ulid)).toEqual([
      over.ref.split("/")[1],
      under.ref.split("/")[1],
    ]);
  });

  it("is empty between one state and itself", async () => {
    const held = opened();
    await held.api.createNode({ title: "Origins" });
    const now = await state(held.files);

    expect(changedBetween(now, now)).toEqual({
      notes: [],
      pictures: { added: 0, removed: 0 },
    });
  });
});
