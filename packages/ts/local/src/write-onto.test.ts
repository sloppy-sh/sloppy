// What a machine writer's tags do on a note it writes alone, and on one
// somebody else has written in — docs/ARCHITECTURE.md § "Tooling".

import type { BlockDocument, DidSyr, NodeView } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import { LocalApi } from "./api.js";
import {
  type Device,
  device,
  PickingFiles,
  reopened,
} from "./local.test-support.js";
import { writeOnto } from "./write-onto.js";

const BOB = "did:syr:z6MkuBobBobBobBobBobBobBobBobBob";

function section(heading: string, said: string): BlockDocument {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: heading }],
      },
      { type: "paragraph", content: [{ type: "text", text: said }] },
    ],
  };
}

async function opened(): Promise<Device> {
  const held = device();
  await held.api.createGraph({ title: "The compiler" });
  return held;
}

/** The same folder written in by somebody else, which is what a machine
 *  writing into a container somebody shares with it is. */
function writingAs(held: Device, writer: DidSyr): LocalApi {
  return new LocalApi(new PickingFiles({ store: held.store }), { writer });
}

async function noteWith(api: LocalApi, tags: string[]): Promise<NodeView> {
  const note = await api.createNode({
    from: { relation: "free" },
    title: "What the reader does",
    tags,
  });
  await api.createBlock({
    node: note.ref,
    content: section("What it does", "It reads a file."),
  });
  return note;
}

describe("a machine writer's tags", () => {
  it("go on the note it writes alone", async () => {
    const held = await opened();
    const note = await noteWith(held.api, []);

    const done = await writeOnto(
      held.api,
      note,
      [section("What it does", "It reads a file and hands back the sections.")],
      ["parsing"],
    );

    expect(done.done).toBe("written");
    expect((await held.api.getNode(note.ref))?.tags).toEqual(["parsing"]);
  });

  it("never take off one the note already carries", async () => {
    const held = await opened();
    const note = await noteWith(held.api, ["protocol"]);

    await writeOnto(
      held.api,
      note,
      [section("What it does", "Again.")],
      ["parsing"],
    );

    expect((await held.api.getNode(note.ref))?.tags).toEqual([
      "parsing",
      "protocol",
    ]);
  });

  it("are not written again where the note already carries every one", async () => {
    const held = await opened();
    const note = await noteWith(held.api, ["protocol"]);
    const retagged = vi.spyOn(held.api, "updateNode");

    await writeOnto(
      held.api,
      note,
      [section("What it does", "Again.")],
      ["protocol"],
    );

    expect(retagged).not.toHaveBeenCalled();
    expect((await held.api.getNode(note.ref))?.tags).toEqual(["protocol"]);
  });

  it("are read the way a person typing them would be read", async () => {
    const held = await opened();
    const note = await noteWith(held.api, []);

    await writeOnto(
      held.api,
      note,
      [section("What it does", "Again.")],
      ["Parsing" as never],
    );

    expect((await held.api.getNode(note.ref))?.tags).toEqual(["parsing"]);
  });

  it("are offered rather than written where somebody else has written in the note", async () => {
    const held = await opened();
    const note = await noteWith(held.api, ["protocol"]);
    const machine = writingAs(held, BOB);
    const seen = await machine.getNode(note.ref);

    const done = await writeOnto(
      machine,
      seen as NodeView,
      [section("What it does", "It reads a file and hands back the sections.")],
      ["parsing"],
    );

    expect(done.done).toBe("offered");
    const theirs = reopened(held);
    expect((await theirs.getNode(note.ref))?.tags).toEqual(["protocol"]);
    const [offer] = await theirs.listAmendments(note.ref);
    expect(offer.tags).toEqual(["parsing", "protocol"]);
  });

  it("land on the note once the offer is taken in", async () => {
    const held = await opened();
    const note = await noteWith(held.api, ["protocol"]);
    const machine = writingAs(held, BOB);
    await writeOnto(
      machine,
      (await machine.getNode(note.ref)) as NodeView,
      [section("What it does", "Again.")],
      ["parsing"],
    );

    const theirs = reopened(held);
    const [offer] = await theirs.listAmendments(note.ref);
    await theirs.approveAmendment(offer.ref);

    expect((await theirs.getNode(note.ref))?.tags).toEqual([
      "parsing",
      "protocol",
    ]);
  });

  it("writes the sections and no tag where none was named", async () => {
    const held = await opened();
    const note = await noteWith(held.api, []);

    await writeOnto(held.api, note, [section("Why", "Because.")]);

    expect((await held.api.getNode(note.ref))?.tags).toEqual([]);
    expect(await held.api.listBlocks(note.ref)).toHaveLength(2);
  });
});
