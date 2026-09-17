import type {
  Address,
  BlockDocument,
  BlockView,
  ImportConflict,
  ImportResolution,
  NodeView,
  OwnedRef,
} from "@sloppy/types";
import {
  noteToVault,
  type Vault,
  vaultDifference,
  type VaultNote,
} from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { readNotes } from "./archive-import.service";
import {
  conflictsBetween,
  noteInWords,
  settled,
  type TwoCopies,
  unanswered,
} from "./merging";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const FIRST = "01J0000000000000000000000A";
const SECOND = "01J0000000000000000000000B";
const THIRD = "01J0000000000000000000000C";
const SECTIONS = ["01J000000000000000000000S1", "01J000000000000000000000S2"];

interface Written {
  ulid: string;
  parent?: string;
  address?: Address;
  aliases?: Address[];
  title: string;
  tags?: string[];
  checked?: string;
  sections?: { ulid: string; text: string }[];
}

function ref(ulid: string): OwnedRef {
  return `${DID}/${ulid}` as OwnedRef;
}

function paragraph(text: string): BlockDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** The vault these notes are written into, the way one graph's export writes
 *  them. */
function vaultOf(notes: readonly Written[]): Vault {
  const vault: Vault = new Map();
  for (const note of notes) {
    const view = {
      ref: ref(note.ulid),
      ...(note.parent === undefined ? {} : { parent: ref(note.parent) }),
      ...(note.address === undefined ? {} : { address: note.address }),
      title: note.title,
      tags: note.tags ?? [],
      links: [],
      ...(note.checked === undefined ? {} : { checked: note.checked }),
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    } as unknown as NodeView;
    const blocks = (note.sections ?? []).map(
      (section, at) =>
        ({
          ref: ref(section.ulid),
          node: view.ref,
          ord: String.fromCharCode(97 + at),
          content: paragraph(section.text),
        }) as unknown as BlockView,
    );
    for (const [path, bytes] of noteToVault(view, note.aliases ?? [], blocks)
      .files) {
      vault.set(path, bytes);
    }
  }
  return vault;
}

function copies(
  mine: readonly Written[],
  theirs: readonly Written[],
): TwoCopies {
  const here = vaultOf(mine);
  const there = vaultOf(theirs);
  return {
    mine: byRef(readNotes(here)),
    theirs: byRef(readNotes(there)),
    difference: vaultDifference(here, there),
  };
}

function byRef(notes: readonly VaultNote[]): Map<OwnedRef, VaultNote> {
  return new Map(notes.map((note) => [note.ref, note]));
}

function held(notes: readonly VaultNote[], of: string): VaultNote {
  return notes.find((note) => note.ref === ref(of)) as VaultNote;
}

const COMMIT = "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708";
const LATER = "a78dc8213b4c5d6e7f8091a2b3c4d5e6f7089abc";

const osmosis: Written = {
  ulid: FIRST,
  address: "1",
  title: "Osmosis",
  sections: [{ ulid: SECTIONS[0], text: "The cell wall holds" }],
};

describe("what two copies of one graph disagree about", () => {
  it("finds nothing to settle where the copies agree", () => {
    expect(conflictsBetween(copies([osmosis], [osmosis]))).toEqual([]);
  });

  it("says nothing about a note only one side has", () => {
    const extra: Written = { ulid: SECOND, title: "Written since" };

    expect(conflictsBetween(copies([osmosis], [osmosis, extra]))).toEqual([]);
    expect(conflictsBetween(copies([osmosis, extra], [osmosis]))).toEqual([]);
  });

  it("names a note the two copies call different things", () => {
    const [conflict] = conflictsBetween(
      copies([osmosis], [{ ...osmosis, title: "Osmosis, again" }]),
    );

    expect(conflict.kind).toBe("note");
    expect(conflict.ref).toBe(ref(FIRST));
    expect(conflict.mine).toContain("“Osmosis”");
    expect(conflict.theirs).toContain("“Osmosis, again”");
    expect(conflict.sections).toEqual([]);
  });

  it("names a note the two copies tag differently", () => {
    const [conflict] = conflictsBetween(
      copies([{ ...osmosis, tags: ["biology"] }], [{ ...osmosis, tags: [] }]),
    );

    expect(conflict.kind).toBe("note");
    expect(conflict.ref).toBe(ref(FIRST));
  });

  it("says nothing about tags standing in a different order", () => {
    expect(
      conflictsBetween(
        copies(
          [{ ...osmosis, tags: ["biology", "seed"] }],
          [{ ...osmosis, tags: ["seed", "biology"] }],
        ),
      ),
    ).toEqual([]);
  });

  it("says what each side wrote into a section they both wrote into", () => {
    const [conflict] = conflictsBetween(
      copies(
        [osmosis],
        [
          {
            ...osmosis,
            sections: [{ ulid: SECTIONS[0], text: "The cell wall gives" }],
          },
        ],
      ),
    );

    expect(conflict.kind).toBe("section");
    expect(conflict.sections).toEqual([
      {
        section: SECTIONS[0],
        mine: "The cell wall holds",
        theirs: "The cell wall gives",
      },
    ]);
  });

  it("names a number the two copies have on different notes", () => {
    const conflict = conflictsBetween(
      copies(
        [osmosis, { ulid: SECOND, title: "Alongside" }],
        [
          { ...osmosis, address: undefined },
          { ulid: SECOND, address: "1", title: "Alongside" },
        ],
      ),
    ).find((one) => one.kind === "address") as ImportConflict;

    expect(conflict.kind).toBe("address");
    expect(conflict.address).toBe("1");
    expect(conflict.ref).toBe(ref(FIRST));
    expect(conflict.other).toBe(ref(SECOND));
    expect(conflict.theirs).toContain("“Alongside”");
  });

  it("quotes the note by what it is called and how it opens", () => {
    const two = copies([osmosis], [osmosis]);

    expect(noteInWords(two.mine.get(ref(FIRST)) as VaultNote)).toBe(
      "1 “Osmosis” — The cell wall holds",
    );
    expect(
      noteInWords({
        ...(two.mine.get(ref(FIRST)) as VaultNote),
        title: "",
        address: undefined,
      }),
    ).toBe("a note you have not titled — The cell wall holds");
  });
});

describe("a settlement nobody finished", () => {
  const two = copies([osmosis], [{ ...osmosis, title: "Osmosis, again" }]);

  it("holds back a conflict nobody chose between", () => {
    expect(unanswered(conflictsBetween(two), [])).toHaveLength(1);
    expect(
      unanswered(conflictsBetween(two), [
        { kind: "note", ref: ref(FIRST), keep: "mine", sections: [] },
      ]),
    ).toEqual([]);
  });

  it("holds back a number put on a note neither side has there", () => {
    const numbering = copies(
      [osmosis, { ulid: SECOND, title: "Alongside" }],
      [
        { ...osmosis, address: undefined },
        { ulid: SECOND, address: "1", title: "Alongside" },
      ],
    );
    const conflicts = conflictsBetween(numbering);
    const answer = (numbered: OwnedRef): ImportResolution[] => [
      { kind: "note", ref: ref(FIRST), keep: "mine", sections: [] },
      { kind: "note", ref: ref(SECOND), keep: "mine", sections: [] },
      {
        kind: "address",
        ref: ref(FIRST),
        keep: "mine",
        sections: [],
        numbered,
      },
    ];

    expect(unanswered(conflicts, answer(ref(THIRD)))).toHaveLength(1);
    expect(unanswered(conflicts, answer(ref(SECOND)))).toEqual([]);
  });
});

describe("the two copies settled into one graph", () => {
  it("keeps what only this graph has and takes what only the archive has", () => {
    const only: Written = { ulid: SECOND, title: "Written since" };
    const arriving: Written = { ulid: THIRD, title: "In the file" };
    const two = copies([osmosis, only], [osmosis, arriving]);

    const notes = settled(two, conflictsBetween(two), []);

    expect(notes.map((note) => note.ref).sort()).toEqual(
      [ref(FIRST), ref(SECOND), ref(THIRD)].sort(),
    );
    expect(held(notes, SECOND).title).toBe("Written since");
    expect(held(notes, THIRD).title).toBe("In the file");
  });

  it("leaves a note nobody chose about as this graph has it", () => {
    const two = copies(
      [{ ...osmosis, tags: ["biology"] }],
      [{ ...osmosis, tags: ["seed"] }],
    );

    expect(held(settled(two, conflictsBetween(two), []), FIRST).tags).toEqual([
      "biology",
    ]);
  });

  it("takes the archive's confirmation for a note this graph has none on", () => {
    const two = copies([osmosis], [{ ...osmosis, checked: COMMIT }]);

    expect(held(settled(two, conflictsBetween(two), []), FIRST).checked).toBe(
      COMMIT,
    );
  });

  it("keeps the confirmation of the copy the person kept", () => {
    const two = copies(
      [{ ...osmosis, tags: ["biology"], checked: COMMIT }],
      [{ ...osmosis, tags: ["seed"], checked: LATER }],
    );
    const conflicts = conflictsBetween(two);

    expect(held(settled(two, conflicts, []), FIRST).checked).toBe(COMMIT);
    expect(
      held(
        settled(two, conflicts, [
          { kind: "note", ref: ref(FIRST), keep: "theirs", sections: [] },
        ]),
        FIRST,
      ).checked,
    ).toBe(LATER);
  });

  it("takes the tags of the copy the person kept", () => {
    const two = copies(
      [{ ...osmosis, tags: ["biology"] }],
      [{ ...osmosis, tags: ["seed"] }],
    );
    const conflicts = conflictsBetween(two);

    const notes = settled(two, conflicts, [
      { kind: "note", ref: ref(FIRST), keep: "theirs", sections: [] },
    ]);

    expect(held(notes, FIRST).tags).toEqual(["seed"]);
  });

  it("keeps the copy the person chose, whole", () => {
    const theirs: Written = {
      ...osmosis,
      title: "Osmosis, again",
      sections: [{ ulid: SECTIONS[0], text: "The cell wall gives" }],
    };
    const two = copies([osmosis], [theirs]);
    const conflicts = conflictsBetween(two);

    const mine = settled(two, conflicts, [
      { kind: "section", ref: ref(FIRST), keep: "mine", sections: [] },
    ]);
    expect(held(mine, FIRST).title).toBe("Osmosis");
    expect(held(mine, FIRST).sections[0].content).toEqual(
      paragraph("The cell wall holds"),
    );

    const took = settled(two, conflicts, [
      { kind: "section", ref: ref(FIRST), keep: "theirs", sections: [] },
    ]);
    expect(held(took, FIRST).title).toBe("Osmosis, again");
    expect(held(took, FIRST).sections[0].content).toEqual(
      paragraph("The cell wall gives"),
    );
  });

  it("takes one section from the other copy of a note kept from this one", () => {
    const two = copies(
      [
        {
          ...osmosis,
          sections: [
            { ulid: SECTIONS[0], text: "The cell wall holds" },
            { ulid: SECTIONS[1], text: "And the second, here" },
          ],
        },
      ],
      [
        {
          ...osmosis,
          title: "Osmosis, again",
          sections: [
            { ulid: SECTIONS[0], text: "The cell wall gives" },
            { ulid: SECTIONS[1], text: "And the second, there" },
          ],
        },
      ],
    );

    const notes = settled(two, conflictsBetween(two), [
      {
        kind: "section",
        ref: ref(FIRST),
        keep: "mine",
        sections: [{ section: SECTIONS[1], keep: "theirs" }],
      },
    ]);

    const note = held(notes, FIRST);
    expect(note.title).toBe("Osmosis");
    expect(note.sections.map((section) => section.content)).toEqual([
      paragraph("The cell wall holds"),
      paragraph("And the second, there"),
    ]);
  });

  it("keeps every number either copy of a note carried leading to it", () => {
    const two = copies(
      [{ ...osmosis, address: "1a", aliases: ["1z"] }],
      [{ ...osmosis, address: "1b", aliases: ["1y"] }],
    );

    const notes = settled(two, conflictsBetween(two), [
      { kind: "note", ref: ref(FIRST), keep: "mine", sections: [] },
    ]);

    expect(held(notes, FIRST).address).toBe("1a");
    expect(held(notes, FIRST).aliases).toEqual(["1b", "1y", "1z"]);
  });

  it("gives a contested number to the note chosen and leaves the other unnumbered", () => {
    const two = copies(
      [osmosis, { ulid: SECOND, title: "Alongside" }],
      [
        { ...osmosis, address: undefined },
        { ulid: SECOND, address: "1", title: "Alongside" },
      ],
    );
    const conflicts = conflictsBetween(two);

    const kept = settled(two, conflicts, [
      { kind: "note", ref: ref(FIRST), keep: "mine", sections: [] },
      { kind: "note", ref: ref(SECOND), keep: "mine", sections: [] },
      {
        kind: "address",
        ref: ref(FIRST),
        keep: "mine",
        sections: [],
        numbered: ref(SECOND),
      },
    ]);
    expect(held(kept, SECOND).address).toBe("1");
    expect(held(kept, FIRST).address).toBeUndefined();
    expect(held(kept, FIRST).aliases).toEqual(["1"]);
  });

  it("leaves a contested number with the side kept where nobody named a note", () => {
    const two = copies(
      [osmosis, { ulid: SECOND, title: "Alongside" }],
      [
        { ...osmosis, address: undefined },
        { ulid: SECOND, address: "1", title: "Alongside" },
      ],
    );
    const conflicts = conflictsBetween(two);

    const mine = settled(two, conflicts, [
      { kind: "note", ref: ref(FIRST), keep: "mine", sections: [] },
      { kind: "note", ref: ref(SECOND), keep: "mine", sections: [] },
      { kind: "address", ref: ref(FIRST), keep: "mine", sections: [] },
    ]);
    expect(held(mine, FIRST).address).toBe("1");
    expect(held(mine, SECOND).address).toBeUndefined();
    expect(held(mine, SECOND).aliases).toEqual(["1"]);

    const theirs = settled(two, conflicts, [
      { kind: "note", ref: ref(FIRST), keep: "theirs", sections: [] },
      { kind: "note", ref: ref(SECOND), keep: "theirs", sections: [] },
      { kind: "address", ref: ref(FIRST), keep: "theirs", sections: [] },
    ]);
    expect(held(theirs, SECOND).address).toBe("1");
    expect(held(theirs, FIRST).address).toBeUndefined();
  });
});
