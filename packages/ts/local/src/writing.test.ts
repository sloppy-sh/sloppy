import { encodeText } from "@sloppy/vault";
import { describe, expect, it, vi } from "vitest";
import {
  type Device,
  device,
  reopened,
  textDocument,
} from "./local.test-support.js";

async function opened(): Promise<Device> {
  const held = device();
  await held.api.createGraph({ title: "Thesis" });
  return held;
}

describe("a note's sections", () => {
  it("are added deliberately, in the order a person puts them", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });
    const first = await held.api.createBlock({
      node: note.ref,
      content: textDocument("one"),
    });
    const second = await held.api.createBlock({
      node: note.ref,
      after: first.ref,
      content: textDocument("two"),
    });
    const top = await held.api.createBlock({
      node: note.ref,
      content: textDocument("nought"),
    });

    const stack = await reopened(held).listBlocks(note.ref);
    expect(stack.map((one) => one.ref)).toEqual([
      top.ref,
      first.ref,
      second.ref,
    ]);
  });

  it("are written, reordered and removed", async () => {
    const held = await opened();
    const note = await held.api.createNode({});
    const first = await held.api.createBlock({
      node: note.ref,
      content: textDocument("one"),
    });
    const second = await held.api.createBlock({
      node: note.ref,
      after: first.ref,
      content: textDocument("two"),
    });

    await held.api.updateBlock(first.ref, {
      content: textDocument("one, rewritten"),
    });
    await held.api.updateBlock(first.ref, { after: second.ref });
    const stack = await reopened(held).listBlocks(note.ref);
    expect(stack.map((one) => one.ref)).toEqual([second.ref, first.ref]);
    expect(stack[1].content).toEqual(textDocument("one, rewritten"));

    await held.api.deleteBlock(second.ref);
    expect(
      (await reopened(held).listBlocks(note.ref)).map((one) => one.ref),
    ).toEqual([first.ref]);
  });

  it("refuses a write over one that was written somewhere else", async () => {
    const held = await opened();
    const note = await held.api.createNode({});
    const block = await held.api.createBlock({
      node: note.ref,
      content: textDocument("one"),
    });
    const written = await held.api.updateBlock(block.ref, {
      content: textDocument("two"),
      expects: block.updated_at,
    });
    await expect(
      held.api.updateBlock(block.ref, {
        content: textDocument("three"),
        expects: "2001-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("written somewhere else");
    expect((await held.api.listBlocks(note.ref))[0].content).toEqual(
      written.content,
    );
  });

  it("moves a section from one note into another", async () => {
    const held = await opened();
    const from = await held.api.createNode({});
    const into = await held.api.createNode({});
    const block = await held.api.createBlock({
      node: from.ref,
      content: textDocument("carried"),
    });
    await held.api.updateBlock(block.ref, { node: into.ref });

    const again = reopened(held);
    expect(await again.listBlocks(from.ref)).toEqual([]);
    expect((await again.listBlocks(into.ref)).map((one) => one.ref)).toEqual([
      block.ref,
    ]);
  });
});

describe("finding a note again", () => {
  it("reaches it by its address, and by an address it was carried away from", async () => {
    const held = await opened();
    const one = await held.api.createNode({ title: "One" });
    const two = await held.api.createNode({ title: "Two" });
    const under = await held.api.createNode({
      from: { relation: "under", note: one.ref },
    });
    await held.api.moveNote(under.ref, { relation: "under", note: two.ref });

    const at = await held.api.searchNotes("2a");
    expect(at.map((hit) => hit.note)).toEqual([under.ref]);
    const was = await held.api.searchNotes("1a");
    expect(was[0].note).toBe(under.ref);
    expect(was[0].wasAt).toBe("1a");
  });

  it("reaches it by words in its writing, with the writing around them", async () => {
    const held = await opened();
    const note = await held.api.createNode({ title: "Seeds" });
    await held.api.createBlock({
      node: note.ref,
      content: textDocument("A seed keeps its own clock underground."),
    });
    await held.api.createNode({ title: "Nothing to do with it" });

    const found = await reopened(held).searchNotes("clock underground");
    expect(found.map((hit) => hit.note)).toEqual([note.ref]);
    expect(found[0].snippet).toContain("keeps its own clock");
  });

  it("reaches it by a tag, and counts the tags a graph carries", async () => {
    const held = await opened();
    const one = await held.api.createNode({ title: "One", tags: ["seed"] });
    await held.api.createNode({ title: "Two", tags: ["seed", "biology"] });

    expect(await held.api.listTags()).toEqual([
      { tag: "seed", notes: 2 },
      { tag: "biology", notes: 1 },
    ]);
    expect(
      (await held.api.searchNotes("seed")).map((hit) => hit.note),
    ).toContain(one.ref);
  });

  it("answers what was written last, newest first", async () => {
    vi.useFakeTimers();
    try {
      const held = await opened();
      const one = await held.api.createNode({ title: "One" });
      vi.advanceTimersByTime(1000);
      const two = await held.api.createNode({ title: "Two" });
      expect(
        (await held.api.recentNotes({ limit: 2 })).map((view) => view.ref),
      ).toEqual([two.ref, one.ref]);

      vi.advanceTimersByTime(1000);
      await held.api.updateNode(one.ref, { title: "One again" });
      expect(
        (await reopened(held).recentNotes({ limit: 2 })).map(
          (view) => view.ref,
        ),
      ).toEqual([one.ref, two.ref]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a picture and an emoji in a folder", () => {
  it("puts a picture's bytes where the ticket says and reads them back from there", async () => {
    const held = await opened();
    const ticket = await held.api.createUpload({
      role: "block",
      filename: "seed.png",
      mime_type: "image/png",
      size: 3,
      width: 8,
      height: 4,
    });
    await held.files
      .at("/graphs/one")
      .write(`media/${ticket.upload_id}.png`, new Uint8Array([1, 2, 3]));
    const asset = await held.api.completeUpload({
      upload_id: ticket.upload_id,
    });
    expect(asset).toEqual({
      upload_id: ticket.upload_id,
      mime_type: "image/png",
      size: 3,
      width: 8,
      height: 4,
    });

    const again = reopened(held);
    expect((await again.ownPictures()).map((one) => one.filename)).toEqual([
      "seed.png",
    ]);
    expect((await again.ownPicture(ticket.upload_id)).src).toBe(
      held.files.at("/graphs/one").url(`media/${ticket.upload_id}.png`),
    );

    await again.removePicture(ticket.upload_id);
    expect(await reopened(held).ownPictures()).toEqual([]);
  });

  it("says a picture whose bytes never arrived could not be added", async () => {
    const held = await opened();
    const ticket = await held.api.createUpload({
      role: "block",
      filename: "seed.png",
      mime_type: "image/png",
      size: 3,
    });
    await expect(
      held.api.completeUpload({ upload_id: ticket.upload_id }),
    ).rejects.toThrow("could not be added");
  });

  it("keeps a shortcode's picture in the folder, and refuses a second of the same name", async () => {
    const held = await opened();
    const ticket = await held.api.createUpload({
      role: "emoji",
      filename: "party.png",
      mime_type: "image/png",
      size: 1,
    });
    await held.files
      .at("/graphs/one")
      .write(`media/${ticket.upload_id}.png`, encodeText("x"));
    await held.api.completeUpload({ upload_id: ticket.upload_id });
    const emoji = await held.api.addEmoji({
      shortcode: "party",
      kind: "emoji",
      upload_id: ticket.upload_id,
    });
    expect(emoji.shortcode).toBe("party");
    expect(held.store.has("/graphs/one/.sloppy/emoji/party.png")).toBe(true);

    await expect(
      held.api.addEmoji({
        shortcode: "party",
        kind: "emoji",
        upload_id: ticket.upload_id,
      }),
    ).rejects.toThrow("already have an emoji called party");

    expect(
      (await reopened(held).ownEmoji()).map((one) => one.emoji_id),
    ).toEqual(["party"]);
    await held.api.removeEmoji("party");
    expect(await reopened(held).ownEmoji()).toEqual([]);
  });
});
