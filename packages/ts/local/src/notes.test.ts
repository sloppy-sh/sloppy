import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import { graphOnly, reread } from "./local.test-support.js";

describe("the address the rule offers", () => {
  it("numbers a branch, its children and the notes alongside them", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    const under = await writer.create({
      from: { relation: "under", note: one.ref },
    });
    const alongside = await writer.create({
      from: { relation: "after", note: under.ref },
    });
    const deeper = await writer.create({
      from: { relation: "under", note: under.ref },
    });
    const second = await writer.create({});

    expect([
      one.address,
      under.address,
      alongside.address,
      deeper.address,
      second.address,
    ]).toEqual(["1", "1a", "1b", "1a1", "2"]);
  });

  it("leaves a note nobody numbered out of the run, and what springs from it unnumbered", async () => {
    const { writer } = await graphOnly();
    const free = await writer.create({ from: { relation: "free" } });
    expect(free.address).toBeUndefined();
    const under = await writer.create({
      from: { relation: "under", note: free.ref },
    });
    expect(under.address).toBeUndefined();
    expect((await writer.create({})).address).toBe("1");
  });

  it("takes a number a person names, and refuses one that springs elsewhere", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({
      from: { relation: "root", address: "7" },
    });
    expect(one.address).toBe("7");
    const under = await writer.create({
      from: { relation: "under", note: one.ref },
      address: "7c",
    });
    expect(under.address).toBe("7c");
    await expect(
      writer.create({
        from: { relation: "under", note: one.ref },
        address: "2a",
      }),
    ).rejects.toThrow("does not spring from 7");
    await expect(
      writer.create({
        from: { relation: "under", note: one.ref },
        address: "7c",
      }),
    ).rejects.toThrow("already leads to");
  });

  it("offers the next number after the greatest, never the gap a move left", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    const a = await writer.create({
      from: { relation: "under", note: one.ref },
    });
    await writer.create({ from: { relation: "under", note: one.ref } });
    await writer.setAddress(a.ref, null);
    expect(
      (await writer.create({ from: { relation: "under", note: one.ref } }))
        .address,
    ).toBe("1c");
  });
});

describe("a label a person writes on a note", () => {
  it("leaves the one it had still leading to it", async () => {
    const files = new MemoryFiles();
    const { writer, did } = await graphOnly(files);
    const note = await writer.create({});
    const renamed = await writer.setAddress(note.ref, "4");
    expect(renamed.address).toBe("4");
    expect(renamed.aliases).toEqual(["1"]);

    const again = await reread(files, did);
    expect(again.leadsTo("1")).toEqual({ hold: "moved", note: note.ref });
    expect(again.leadsTo("4")).toEqual({ hold: "live", note: note.ref });
  });

  it("comes off, and the note is read by its title afterwards", async () => {
    const { writer } = await graphOnly();
    const note = await writer.create({ title: "Unnumbered" });
    const bare = await writer.setAddress(note.ref, null);
    expect(bare.address).toBeUndefined();
    expect(bare.aliases).toEqual(["1"]);
  });

  it("is the note's own to take back", async () => {
    const { writer } = await graphOnly();
    const note = await writer.create({});
    await writer.setAddress(note.ref, "4");
    const back = await writer.setAddress(note.ref, "1");
    expect(back.address).toBe("1");
    expect(back.aliases).toEqual(["4"]);
  });
});

describe("carrying a note somewhere else", () => {
  it("takes the next number in the run it joins and keeps what sprang from it", async () => {
    const files = new MemoryFiles();
    const { writer, did } = await graphOnly(files);
    const one = await writer.create({});
    const two = await writer.create({});
    const under = await writer.create({
      from: { relation: "under", note: one.ref },
    });
    const deeper = await writer.create({
      from: { relation: "under", note: under.ref },
    });

    const landed = await writer.move(under.ref, {
      relation: "under",
      note: two.ref,
    });
    const at = new Map(landed.map((view) => [view.ref, view]));
    expect(at.get(under.ref)?.address).toBe("2a");
    expect(at.get(under.ref)?.aliases).toEqual(["1a"]);
    expect(at.get(deeper.ref)?.address).toBe("2a1");
    expect(at.get(deeper.ref)?.parent).toBe(under.ref);
    expect(at.get(deeper.ref)?.depth).toBe(3);

    const again = await reread(files, did);
    expect(again.leadsTo("1a1")).toEqual({ hold: "moved", note: deeper.ref });
    expect(again.view(again.find(under.ref)!).origin).toBe(two.ref);
  });

  it("lands on the number a person names, and refuses one that springs elsewhere", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    const two = await writer.create({});
    const under = await writer.create({
      from: { relation: "under", note: one.ref },
    });

    await expect(
      writer.move(under.ref, { relation: "under", note: two.ref }, "1z"),
    ).rejects.toThrow("does not spring from 2");
    const landed = await writer.move(
      under.ref,
      { relation: "under", note: two.ref },
      "2c",
    );
    expect(landed.find((view) => view.ref === under.ref)?.address).toBe("2c");
  });

  it("leaves a note nobody numbered unnumbered wherever it is carried", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    const free = await writer.create({ from: { relation: "free" } });
    const landed = await writer.move(free.ref, {
      relation: "under",
      note: one.ref,
    });
    const moved = landed.find((view) => view.ref === free.ref);
    expect(moved?.address).toBeUndefined();
    expect(moved?.parent).toBe(one.ref);
    expect(moved?.depth).toBe(2);
  });

  it("refuses a note carried into what sprang from it", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    const under = await writer.create({
      from: { relation: "under", note: one.ref },
    });
    await expect(
      writer.move(one.ref, { relation: "under", note: under.ref }),
    ).rejects.toThrow("cannot be carried into what sprang from it");
  });
});

describe("one act over the notes somebody chose", () => {
  it("adds and takes off tags, and counts what it could not reach", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    const two = await writer.create({});
    const tagged = await writer.bulk({
      notes: [
        one.ref,
        two.ref,
        `${one.ref.split("/")[0]}/01JZZZZZZZZZZZZZZZZZZZZZZZ`,
      ],
      act: { act: "tag", tags: ["seed"] },
    });
    expect(tagged.reached).toBe(2);
    expect(tagged.missed).toBe(1);
    expect(tagged.notes.map((view) => view.tags)).toEqual([["seed"], ["seed"]]);

    const bare = await writer.bulk({
      notes: [one.ref],
      act: { act: "untag", tags: ["seed"] },
    });
    expect(bare.notes[0].tags).toEqual([]);
  });

  it("sends every chosen note to the bin with what sprang from it", async () => {
    const { graph, writer } = await graphOnly();
    const one = await writer.create({});
    await writer.create({ from: { relation: "under", note: one.ref } });
    const gone = await writer.bulk({
      notes: [one.ref],
      act: { act: "delete" },
    });
    expect(gone.reached).toBe(1);
    expect(graph.live()).toEqual([]);
    expect(graph.binned().length).toBe(2);
  });

  it("says publishing needs a hosted Sloppy rather than failing after the fact", async () => {
    const { writer } = await graphOnly();
    const one = await writer.create({});
    await expect(
      writer.bulk({ notes: [one.ref], act: { act: "publish" } }),
    ).rejects.toThrow("needs a hosted Sloppy");
  });
});
