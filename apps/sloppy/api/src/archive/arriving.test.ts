import {
  type Address,
  createOwnedRecordId,
  type DidSyr,
  type Node,
  type NodeAlias,
  nowIso,
  type OwnedRef,
  ownedRefFrom,
} from "@sloppy/types";
import type { VaultNote } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import {
  addressesLedBy,
  type ArrivingAmendment,
  type GraphNow,
  type Kept,
  mergeRefusal,
  mergeRows,
  offeredRows,
  placed,
  repeated,
  retiring,
  rowsFor,
} from "./arriving";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva" as DidSyr;
const GRAPH: OwnedRef = `${DID}/01JGRAPH2ND000000000000000`;
const COMMIT = "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708";
const LATER = "a78dc8213b4c5d6e7f8091a2b3c4d5e6f7089abc";

function ref(nth: number): OwnedRef {
  return `${DID}/01JNKTE${String(nth).padStart(19, "0")}`;
}

function note(over: Partial<VaultNote> & { ref: OwnedRef }): VaultNote {
  return {
    aliases: [],
    tags: [],
    links: [],
    title: "",
    sections: [],
    ...over,
  };
}

describe("the genealogy a vault leaves to be re-derived", () => {
  it("takes each note's depth and origin off the parent chain", () => {
    const [root, under, deeper] = placed([
      note({ ref: ref(1) }),
      note({ ref: ref(2), parent: ref(1) }),
      note({ ref: ref(3), parent: ref(2) }),
    ]);

    expect([root.depth, under.depth, deeper.depth]).toEqual([1, 2, 3]);
    expect([root.origin, under.origin, deeper.origin]).toEqual([
      ref(1),
      ref(1),
      ref(1),
    ]);
  });

  it("does the same when a note is written down before its parent", () => {
    const [under, root] = placed([
      note({ ref: ref(2), parent: ref(1) }),
      note({ ref: ref(1) }),
    ]);

    expect(under.depth).toBe(2);
    expect(under.origin).toBe(ref(1));
    expect(root.depth).toBe(1);
  });

  it("opens a branch where the archive carries no parent for the note", () => {
    const [orphan] = placed([note({ ref: ref(2), parent: ref(9) })]);

    expect(orphan.parent).toBeUndefined();
    expect(orphan.depth).toBe(1);
    expect(orphan.origin).toBe(ref(2));
  });

  it("settles a chain that names itself rather than walking it forever", () => {
    const settled = placed([
      note({ ref: ref(1), parent: ref(2) }),
      note({ ref: ref(2), parent: ref(1) }),
    ]);

    expect(settled.map((one) => one.depth).sort()).toEqual([1, 2]);
    expect(settled.filter((one) => one.parent === undefined)).toHaveLength(1);
  });
});

describe("the rows an archive's notes land as", () => {
  const section = (words: string) => ({
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text: words }] }],
  });

  it("keeps a note's ULID, its label and the addresses it still leads by", () => {
    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({
          ref: ref(1),
          address: "1a" as Address,
          aliases: ["1b" as Address],
          title: "A city remembers",
          tags: ["Biology"],
          links: [ref(2)],
        }),
      ]),
      new Map(),
    );

    expect(written.nodes).toHaveLength(1);
    expect(written.nodes[0].address).toBe("1a");
    expect(written.nodes[0].graph).toBe(GRAPH);
    expect(written.nodes[0].tags).toEqual(["biology"]);
    expect(written.nodes[0].links).toEqual([ref(2)]);
    expect(written.aliases.map((one) => one.address)).toEqual(["1b"]);
    expect(written.aliases[0].note).toBe(ref(1));
  });

  it("keeps the commit a note was confirmed against, and none where it says none", () => {
    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({
          ref: ref(1),
          checked: "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708",
        }),
        note({ ref: ref(2) }),
      ]),
      new Map(),
    );

    expect(written.nodes[0].checked).toBe(
      "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708",
    );
    expect(written.nodes[1]).not.toHaveProperty("checked");
  });

  it("drops an alias at an address a note arriving is actually at", () => {
    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({ ref: ref(1), address: "1a" as Address }),
        note({ ref: ref(2), aliases: ["1a" as Address] }),
      ]),
      new Map(),
    );

    expect(written.aliases).toEqual([]);
  });

  it("stacks a note's sections in the order the file reads them", () => {
    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({
          ref: ref(1),
          sections: [
            { ulid: "01JSECTAKN0000000000000001", content: section("first") },
            { ulid: "01JSECTAKN0000000000000002", content: section("second") },
          ],
        }),
      ]),
      new Map(),
    );

    expect(written.blocks).toHaveLength(2);
    expect(written.blocks[0].ord < written.blocks[1].ord).toBe(true);
    expect(written.blocks.map((one) => one.node)).toEqual([ref(1), ref(1)]);
  });

  it("writes back the looks a note's file holds, the way it writes back its links", () => {
    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({
          ref: ref(1),
          links: [ref(2)],
          edges: [{ to: ref(2), label: "follows from", stroke: "dashed" }],
        }),
        note({ ref: ref(2) }),
      ]),
      new Map(),
    );

    expect(written.nodes[0].edges).toEqual([
      { to: ref(2), label: "follows from", stroke: "dashed" },
    ]);
    expect(written.nodes[1]).not.toHaveProperty("edges");
  });

  // A hand edits the files, so a second look on one line costs that look and
  // never the import — docs/ARCHITECTURE.md § "A look a person set on a line".
  it("keeps the first of two looks a file puts on one line", () => {
    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({
          ref: ref(1),
          edges: [
            { to: ref(2), label: "follows from" },
            { to: ref(2), label: "objects to" },
          ],
        }),
      ]),
      new Map(),
    );

    expect(written.nodes[0].edges).toEqual([
      { to: ref(2), label: "follows from" },
    ]);
  });

  it("takes a look from the archive though it keeps the styling it has", () => {
    const kept: Kept = {
      created_at: "2020-01-01T00:00:00.000Z",
      published: true,
      graph: GRAPH,
      appearance: { ring_weight: "heavy" },
    };

    const written = rowsFor(
      DID,
      GRAPH,
      placed([
        note({ ref: ref(1), edges: [{ to: ref(2), label: "answers" }] }),
      ]),
      new Map([[ref(1), kept]]),
    );

    expect(written.nodes[0].edges).toEqual([{ to: ref(2), label: "answers" }]);
    expect(written.nodes[0].appearance).toEqual(kept.appearance);
  });

  it("leaves the styling and the publication of a note it writes over alone", () => {
    const kept: Kept = {
      created_at: "2020-01-01T00:00:00.000Z",
      published: true,
      graph: GRAPH,
      appearance: { ring_weight: "heavy" },
    };

    const written = rowsFor(
      DID,
      GRAPH,
      placed([note({ ref: ref(1) })]),
      new Map([[ref(1), kept]]),
    );

    expect(written.nodes[0].published).toBe(true);
    expect(written.nodes[0].appearance).toEqual(kept.appearance);
    expect(written.nodes[0].created_at).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("the addresses the notes an import writes over take with them", () => {
  const going = (localRef: OwnedRef, address: Address): Node => ({
    id: createOwnedRecordId("node", DID, localRef.slice(DID.length + 1)),
    created_by: DID,
    graph: GRAPH,
    address,
    depth: 1,
    origin: localRef,
    title: "",
    tags: [],
    links: [],
    published: false,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const led = (address: Address, note: OwnedRef): NodeAlias => ({
    id: createOwnedRecordId("node_alias", DID),
    created_by: DID,
    graph: GRAPH,
    address,
    note,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  it("retires the ones the archive does not bring back", () => {
    const retired = retiring(
      DID,
      GRAPH,
      [going(ref(1), "1" as Address), going(ref(2), "2" as Address)],
      [],
      new Set(["1" as Address]),
    );

    expect(retired.map((one) => one.address)).toEqual(["2"]);
    expect(retired[0].graph).toBe(GRAPH);
  });

  it("retires an address the graph led back by that the archive drops", () => {
    const retired = retiring(
      DID,
      GRAPH,
      [going(ref(1), "1b" as Address)],
      [led("1a" as Address, ref(1))],
      new Set(["1b" as Address]),
    );

    expect(retired.map((one) => one.address)).toEqual(["1a"]);
  });

  it("leaves an address alone where the archive brings it back as an alias", () => {
    const retired = retiring(
      DID,
      GRAPH,
      [going(ref(1), "1a" as Address)],
      [],
      addressesLedBy([
        note({
          ref: ref(1),
          address: "1c" as Address,
          aliases: ["1a" as Address],
        }),
      ]),
    );

    expect(retired).toEqual([]);
  });
});

describe("an archive that says one thing twice", () => {
  const section = (ulid: string) => ({
    ulid,
    content: { type: "doc" as const, content: [] },
  });

  it("reads clean where every note, number and section is its own", () => {
    expect(
      repeated([
        note({
          ref: ref(1),
          address: "1" as Address,
          sections: [section("01JSECTAKN0000000000000001")],
        }),
        note({
          ref: ref(2),
          address: "1a" as Address,
          sections: [section("01JSECTAKN0000000000000002")],
        }),
      ]),
    ).toBeUndefined();
  });

  it("names the two notes it puts at one number", () => {
    const found = repeated([
      note({ ref: ref(1), address: "1a" as Address, title: "A city" }),
      note({ ref: ref(2), address: "1a" as Address, title: "The river" }),
    ]);

    expect(found?.what).toBe("address");
    expect(found?.address).toBe("1a");
    expect(found?.notes.map((one) => one.title)).toEqual([
      "A city",
      "The river",
    ]);
  });

  it("catches one note written into two files", () => {
    const found = repeated([note({ ref: ref(1) }), note({ ref: ref(1) })]);

    expect(found?.what).toBe("note");
    expect(found?.notes).toHaveLength(2);
  });

  it("catches one section pasted into a second note", () => {
    const found = repeated([
      note({ ref: ref(1), sections: [section("01JSECTAKN0000000000000001")] }),
      note({ ref: ref(2), sections: [section("01JSECTAKN0000000000000001")] }),
    ]);

    expect(found?.what).toBe("section");
    expect(found?.notes).toHaveLength(2);
  });

  it("names the one note where a section of it is written twice", () => {
    const found = repeated([
      note({
        ref: ref(1),
        title: "A city",
        sections: [
          section("01JSECTAKN0000000000000001"),
          section("01JSECTAKN0000000000000001"),
        ],
      }),
    ]);

    expect(found?.what).toBe("section");
    expect(found?.notes.map((one) => one.title)).toEqual(["A city"]);
  });
});

describe("the rows a merge lands as", () => {
  const row = (over: Partial<Node> & { ref: OwnedRef }): Node => ({
    id: createOwnedRecordId("node", DID, over.ref.slice(DID.length + 1)),
    created_by: DID,
    graph: GRAPH,
    depth: 1,
    origin: over.ref,
    title: "",
    tags: [],
    links: [],
    published: false,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...over,
  });

  const alias = (address: Address, note: OwnedRef): NodeAlias => ({
    id: createOwnedRecordId("node_alias", DID),
    created_by: DID,
    graph: GRAPH,
    address,
    note,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const now = (over: Partial<GraphNow> = {}): GraphNow => ({
    arriving: new Set(),
    held: [],
    aliases: [],
    retired: [],
    offers: [],
    ...over,
  });

  it("writes the notes the archive carries and leaves the rest where they are", () => {
    const notes = placed([note({ ref: ref(1) }), note({ ref: ref(2) })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ arriving: new Set([ref(1)]), held: [row({ ref: ref(2) })] }),
    );

    expect(write.writing).toEqual([ref(1)]);
    expect(write.nodes.map((one) => ownedRefFrom(one.id))).toEqual([ref(1)]);
  });

  it("confirms a note the graph keeps without writing the note", () => {
    const notes = placed([note({ ref: ref(1), checked: COMMIT })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ held: [row({ ref: ref(1) })] }),
    );

    expect(write.writing).toEqual([]);
    expect(write.blocks).toEqual([]);
    expect(write.confirming).toEqual([{ note: ref(1), checked: COMMIT }]);
  });

  it("confirms a note the graph keeps a reading of its own on", () => {
    const notes = placed([note({ ref: ref(1), checked: LATER })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ held: [row({ ref: ref(1), checked: COMMIT })] }),
    );

    expect(write.writing).toEqual([]);
    expect(write.confirming).toEqual([{ note: ref(1), checked: LATER }]);
  });

  it("leaves a note the graph keeps where the two say the same reading", () => {
    const notes = placed([note({ ref: ref(1), checked: COMMIT })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ held: [row({ ref: ref(1), checked: COMMIT })] }),
    );

    expect(write.writing).toEqual([]);
    expect(write.confirming).toEqual([]);
  });

  it("says the reading of a note it is writing on the row itself", () => {
    const notes = placed([note({ ref: ref(1), checked: COMMIT })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ arriving: new Set([ref(1)]) }),
    );

    expect(write.confirming).toEqual([]);
    expect(write.nodes[0].checked).toBe(COMMIT);
  });

  it("writes a note the graph keeps where the merge put something above it", () => {
    const notes = placed([
      note({ ref: ref(1) }),
      note({ ref: ref(2), parent: ref(1) }),
    ]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ arriving: new Set([ref(1)]), held: [row({ ref: ref(2) })] }),
    );

    expect(write.writing.sort()).toEqual([ref(1), ref(2)].sort());
    expect(
      write.nodes.find((one) => ownedRefFrom(one.id) === ref(2))?.depth,
    ).toBe(2);
  });

  it("leaves an address leading where it already leads, and drops the lead a note takes back", () => {
    const notes = placed([
      note({ ref: ref(1), address: "1a" as Address }),
      note({ ref: ref(2), aliases: ["1b" as Address] }),
    ]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({
        arriving: new Set([ref(1), ref(2)]),
        held: [row({ ref: ref(1) }), row({ ref: ref(2) })],
        aliases: [
          alias("1a" as Address, ref(1)),
          alias("1b" as Address, ref(3)),
        ],
      }),
    );

    expect(write.dropping).toEqual(["1a"]);
    expect(write.aliases).toEqual([]);
  });

  it("takes a number off a note in the bin and leaves it leading there", () => {
    const notes = placed([note({ ref: ref(1), address: "1a" as Address })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({
        arriving: new Set([ref(1)]),
        held: [
          row({ ref: ref(1) }),
          row({ ref: ref(2), address: "1a" as Address, deleted_at: nowIso() }),
        ],
      }),
    );

    expect(write.yielding).toEqual([ref(2)]);
    expect(write.aliases.map((one) => [one.address, one.note])).toEqual([
      ["1a", ref(2)],
    ]);
  });

  it("refuses a settlement that would put two notes at one number", () => {
    const found = mergeRefusal(
      placed([
        note({ ref: ref(1), address: "1a" as Address, title: "Here" }),
        note({ ref: ref(2), address: "1a" as Address, title: "There" }),
      ]),
      now(),
    );

    expect(found?.what).toBe("twice");
    expect(found?.address).toBe("1a");
  });

  it("lets a note take back a number it spent and refuses another one it", () => {
    const spent = (held: OwnedRef) => ({
      id: createOwnedRecordId("retired_address", DID),
      created_by: DID,
      graph: GRAPH,
      address: "1a" as Address,
      note: held,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    const arriving = placed([note({ ref: ref(1), address: "1a" as Address })]);

    expect(
      mergeRefusal(arriving, now({ retired: [spent(ref(1))] })),
    ).toBeUndefined();
    expect(
      mergeRefusal(arriving, now({ retired: [spent(ref(2))] }))?.what,
    ).toBe("spent");
  });

  it("refuses a number that still leads back to a note carried away from it", () => {
    const found = mergeRefusal(
      placed([
        note({ ref: ref(1), address: "1a" as Address, title: "Arriving" }),
        note({
          ref: ref(2),
          address: "1b" as Address,
          aliases: ["1a" as Address],
          title: "Moved on",
        }),
      ]),
      now({
        held: [row({ ref: ref(2), address: "1b" as Address })],
        aliases: [alias("1a" as Address, ref(2))],
      }),
    );

    expect(found?.what).toBe("led");
    expect(found?.address).toBe("1a");
  });

  it("lets a note keep a number somebody is already standing at", () => {
    const found = mergeRefusal(
      placed([
        note({ ref: ref(1), address: "1a" as Address }),
        note({ ref: ref(2), aliases: ["1a" as Address] }),
      ]),
      now({
        held: [
          row({ ref: ref(1), address: "1a" as Address }),
          row({ ref: ref(2) }),
        ],
        aliases: [alias("1a" as Address, ref(2))],
      }),
    );

    expect(found).toBeUndefined();
  });

  it("lets a number lead back to a note that is no longer there", () => {
    const found = mergeRefusal(
      placed([note({ ref: ref(1), address: "1a" as Address })]),
      now({ aliases: [alias("1a" as Address, ref(2))] }),
    );

    expect(found).toBeUndefined();
  });

  it("lets a note take a number that leads back to a note in the bin", () => {
    const found = mergeRefusal(
      placed([note({ ref: ref(1), address: "1a" as Address })]),
      now({
        held: [
          row({
            ref: ref(2),
            address: "1b" as Address,
            deleted_at: nowIso(),
          }),
        ],
        aliases: [alias("1a" as Address, ref(2))],
      }),
    );

    expect(found).toBeUndefined();
  });

  it("leads every address a settled note carries, not only the rewritten ones", () => {
    const notes = placed([note({ ref: ref(1), aliases: ["1a" as Address] })]);

    const write = mergeRows(
      DID,
      GRAPH,
      notes,
      now({ held: [row({ ref: ref(1) })] }),
    );

    expect(write.writing).toEqual([]);
    expect(write.aliases.map((one) => [one.address, one.note])).toEqual([
      ["1a", ref(1)],
    ]);
  });
});

describe("the offers an archive carries", () => {
  const BRAM = "did:syr:z6MkBramBramBramBramBramBramBram" as DidSyr;
  const offer = (
    over: Partial<ArrivingAmendment> & { ulid: string; amends: OwnedRef },
  ): ArrivingAmendment => ({
    by: BRAM,
    title: "As I would have it",
    tags: [],
    sections: [],
    ...over,
  });

  it("names the offer under the identity taking it in and leaves who offered it alone", () => {
    const [row] = offeredRows(
      DID,
      [offer({ ulid: "01JAMENDA00000000000000000", amends: ref(1) })],
      new Set([ref(1)]),
    );

    expect(ownedRefFrom(row.id)).toBe(`${DID}/01JAMENDA00000000000000000`);
    expect(row.created_by).toBe(DID);
    expect(row.by).toBe(BRAM);
    expect(row.note).toBe(ref(1));
  });

  it("names each proposed section by the ULID the note's own section has", () => {
    const [row] = offeredRows(
      DID,
      [
        offer({
          ulid: "01JAMENDA00000000000000000",
          amends: ref(1),
          sections: [
            {
              ulid: "01JSECTA000000000000000000",
              content: { type: "doc", content: [] },
            },
          ],
        }),
      ],
      new Set([ref(1)]),
    );

    expect(row.blocks.map((one) => one.ref)).toEqual([
      `${DID}/01JSECTA000000000000000000`,
    ]);
  });

  it("brings the looks the offer proposes on the note's lines", () => {
    const [row] = offeredRows(
      DID,
      [
        offer({
          ulid: "01JAMENDA00000000000000000",
          amends: ref(1),
          edges: [{ to: ref(2), label: "follows from", stroke: "dashed" }],
        }),
      ],
      new Set([ref(1)]),
    );

    expect(row.edges).toEqual([
      { to: ref(2), label: "follows from", stroke: "dashed" },
    ]);
  });

  it("leaves a note's looks alone where the offer proposes none", () => {
    const [row] = offeredRows(
      DID,
      [offer({ ulid: "01JAMENDA00000000000000000", amends: ref(1) })],
      new Set([ref(1)]),
    );

    expect("edges" in row).toBe(false);
  });

  it("drops one offered on a note the archive does not carry", () => {
    expect(
      offeredRows(
        DID,
        [offer({ ulid: "01JAMENDA00000000000000000", amends: ref(9) })],
        new Set([ref(1)]),
      ),
    ).toEqual([]);
  });

  it("lands one offer per person per note, whatever the folder says", () => {
    const rows = offeredRows(
      DID,
      [
        offer({ ulid: "01JAMENDA00000000000000000", amends: ref(1) }),
        offer({ ulid: "01JAMENDB00000000000000000", amends: ref(1) }),
      ],
      new Set([ref(1)]),
    );

    expect(rows.map((one) => ownedRefFrom(one.id))).toEqual([
      `${DID}/01JAMENDA00000000000000000`,
    ]);
  });

  it("writes over the one that person already had standing on that note", () => {
    const standing = {
      id: createOwnedRecordId("amendment", DID, "01JAMENDZ00000000000000000"),
      created_by: DID,
      note: ref(1),
      by: BRAM,
      at: nowIso(),
      title: "",
      tags: [],
      blocks: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    const write = mergeRows(
      DID,
      GRAPH,
      placed([note({ ref: ref(1) })]),
      {
        arriving: new Set(),
        held: [],
        aliases: [],
        retired: [],
        offers: [standing],
      },
      [offer({ ulid: "01JAMENDA00000000000000000", amends: ref(1) })],
    );

    expect(write.amendments.map((one) => ownedRefFrom(one.id))).toEqual([
      `${DID}/01JAMENDA00000000000000000`,
    ]);
    expect(write.unsettling).toEqual([`${DID}/01JAMENDZ00000000000000000`]);
  });
});
