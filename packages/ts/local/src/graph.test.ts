import { DELETED_KEPT_FOR_DAYS, splitOwnedRef } from "@sloppy/types";
import { PICTURES_FILE, decodeText, encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import type { LocalGraph, StoredNote, StoredSection } from "./graph.js";
import { NoteWriter } from "./notes.js";
import { graphOnly, reread, textDocument } from "./local.test-support.js";
import { BIN_FILE, binPath } from "./vault-paths.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function noteIn(graph: LocalGraph, ref: string): StoredNote {
  const held = graph.find(ref);
  if (!held) throw new Error(`no note at ${ref}`);
  return held;
}

function section(
  ulid: string,
  content: StoredSection["content"],
  at: string,
): StoredSection {
  return { ulid, content, created_at: at, updated_at: at };
}

async function read(files: MemoryFiles, path: string): Promise<string> {
  const bytes = await files.at("/graphs/one").read(path);
  return bytes ? decodeText(bytes) : "";
}

describe("what a note keeps on the way through the folder", () => {
  it("reads its sections back in the order they were written", async () => {
    const files = new MemoryFiles();
    const { graph, writer, did } = await graphOnly(files);
    const note = await writer.create({ title: "Seeds" });
    const held = noteIn(graph, note.ref);
    await graph.save({
      ...held,
      sections: [
        section(
          "01J0000000000000000000000A",
          textDocument("first"),
          held.created_at,
        ),
        section(
          "01J0000000000000000000000B",
          textDocument("second"),
          held.created_at,
        ),
      ],
    });

    const again = await reread(files, did);
    const back = noteIn(again, note.ref);
    expect(back.sections.map((one) => one.ulid)).toEqual([
      "01J0000000000000000000000A",
      "01J0000000000000000000000B",
    ]);
    expect(again.blockViews(back).map((one) => one.ord)).toEqual([
      "00000000",
      "00000001",
    ]);
  });

  it("keeps the tags, the links and the notes its writing names", async () => {
    const files = new MemoryFiles();
    const { graph, writer, did } = await graphOnly(files);
    const one = await writer.create({ title: "One" });
    const two = await writer.create({ title: "Two" });
    await writer.update(one.ref, {
      tags: ["seed", "biology"],
      links: [two.ref],
    });
    const held = noteIn(graph, one.ref);
    await graph.save({
      ...held,
      sections: [
        section(
          "01J0000000000000000000000A",
          {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "reference", attrs: { note: two.ref, label: "Two" } },
                ],
              },
            ],
          },
          held.created_at,
        ),
      ],
    });

    const again = await reread(files, did);
    const view = again.view(noteIn(again, one.ref));
    expect(view.tags).toEqual(["biology", "seed"]);
    expect(view.links).toEqual([two.ref]);
    expect(view.references).toEqual([two.ref]);
  });

  it("carries a picture's size beside the link that names it", async () => {
    const files = new MemoryFiles();
    const { graph, writer, did } = await graphOnly(files);
    const asset = await graph.putPicture(
      { role: "block", filename: "seed.png", mime_type: "image/png" },
      new Uint8Array([1, 2, 3]),
    );
    const note = await writer.create({ title: "With a picture" });
    const held = noteIn(graph, note.ref);
    const attrs = {
      upload_id: asset.upload_id,
      alt: "a seed",
      width: 240,
      height: 120,
    };
    await graph.save({
      ...held,
      sections: [
        section(
          "01J0000000000000000000000A",
          { type: "doc", content: [{ type: "picture", attrs }] },
          held.created_at,
        ),
      ],
    });
    expect(await read(files, PICTURES_FILE)).toContain(asset.upload_id);

    const again = await reread(files, did);
    expect(
      noteIn(again, note.ref).sections[0].content.content?.[0].attrs,
    ).toEqual(attrs);
    expect(again.picturePath(asset.upload_id)).toBe(
      `media/${asset.upload_id}.png`,
    );
    expect((await again.listPictures("block"))[0].filename).toBe("seed.png");
  });

  it("draws a shortcode off the folder's own catalog", async () => {
    const files = new MemoryFiles();
    const { graph, did } = await graphOnly(files);
    const asset = await graph.putPicture(
      { role: "emoji", filename: "party.png", mime_type: "image/png" },
      new Uint8Array([9]),
    );
    const added = await graph.addEmoji("party", "sticker", asset.upload_id);

    const again = await reread(files, did);
    expect(again.ownEmoji().map((one) => one.shortcode)).toEqual(["party"]);
    expect(again.ownEmoji()[0].kind).toBe("sticker");
    expect(again.ownEmoji()[0].src).toBe(added.src);

    await again.removeEmoji("party");
    expect((await reread(files, did)).ownEmoji()).toEqual([]);
  });
});

describe("the bin, as a folder holds it", () => {
  it("moves a deleted note's file into the bin and back out again", async () => {
    const files = new MemoryFiles();
    const { writer, did } = await graphOnly(files);
    const root = await writer.create({ title: "A branch" });
    const child = await writer.create({
      from: { relation: "under", note: root.ref },
    });
    const ulid = splitOwnedRef(root.ref).localId;
    const vault = files.at("/graphs/one");

    await writer.remove(root.ref);
    expect(await vault.exists(`notes/${ulid}.md`)).toBe(false);
    expect(await vault.exists(binPath(ulid))).toBe(true);
    expect(await read(files, BIN_FILE)).toContain(ulid);

    const away = await reread(files, did);
    expect(away.live()).toEqual([]);
    expect(away.deletedBranches().map((one) => one.ref)).toEqual([root.ref]);
    expect(away.deletedBranches()[0].notes).toBe(2);

    await writer.restore(root.ref);
    const back = await reread(files, did);
    expect(await vault.exists(`notes/${ulid}.md`)).toBe(true);
    expect(
      back
        .live()
        .map((one) => one.ref)
        .sort(),
    ).toEqual([root.ref, child.ref].sort());
  });

  it("gives a binned note's number to whoever asks for it, and leaves a way back", async () => {
    const files = new MemoryFiles();
    const { writer, did } = await graphOnly(files);
    const first = await writer.create({});
    const second = await writer.create({});
    expect([first.address, second.address]).toEqual(["1", "2"]);

    await writer.remove(first.ref);
    expect((await writer.setAddress(second.ref, "1")).address).toBe("1");

    const again = await reread(files, did);
    const gone = again.findDeleted(first.ref);
    expect(gone?.address).toBeUndefined();
    expect(gone?.aliases).toEqual(["1"]);
    expect(again.view(noteIn(again, second.ref)).aliases).toEqual(["2"]);
  });

  it("never retires a number another note is at, and never hands a purged one back", async () => {
    const files = new MemoryFiles();
    const { graph, writer, did } = await graphOnly(files);
    const first = await writer.create({});
    const second = await writer.create({});
    const third = await writer.create({});
    await writer.remove(first.ref);
    await writer.remove(third.ref);
    await writer.setAddress(second.ref, "1");
    await graph.purge(graph.binned());

    // "1" is the standing note's, so it is still that note's to take back.
    await writer.setAddress(second.ref, null);
    expect((await writer.setAddress(second.ref, "1")).address).toBe("1");
    // "3" went with the note that spent it and is never assigned again.
    await expect(
      new NoteWriter(await reread(files, did)).create({ address: "3" }),
    ).rejects.toThrow("You have used 3 before");
  });

  it("purges what has been in the bin longer than it can be put back", async () => {
    const files = new MemoryFiles();
    const { graph, writer, did } = await graphOnly(files);
    const note = await writer.create({});
    await writer.remove(note.ref);

    await graph.sweep(Date.now() + (DELETED_KEPT_FOR_DAYS + 1) * DAY_MS);
    const again = await reread(files, did);
    expect(again.all()).toEqual([]);
    expect(await read(files, BIN_FILE)).toContain('"1"');
    await expect(
      new NoteWriter(again).create({ address: "1" }),
    ).rejects.toThrow("You have used 1 before");
  });
});

describe("a folder a hand has been in", () => {
  it("leaves a file that is not a note alone and opens the graph anyway", async () => {
    const files = new MemoryFiles();
    const { writer, did } = await graphOnly(files);
    const note = await writer.create({ title: "Kept" });
    await files.at("/graphs/one").write("notes/README.txt", encodeText("hi"));

    const again = await reread(files, did);
    expect(again.live().map((one) => one.ref)).toEqual([note.ref]);
  });
});
