import type { PublishedBlock, PublishedNode } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { comparableTo, noteChanges, type SnapshotSide } from "./difference";

const AVA = "did:syr:z6MkuVRBZ1913zrZgc4nnA3Zs9MEEf84VUN8kgTD6QoqNiu9";
const at = (tag: string) => `${AVA}/${tag.padEnd(26, "0")}`;

function note(of: Partial<PublishedNode> & { address: string }): PublishedNode {
  return {
    ref: at("NTE"),
    origin: at("RT"),
    title: "A thought",
    tags: [],
    links: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...of,
  };
}

function section(of: Partial<PublishedBlock> = {}): PublishedBlock {
  return {
    ref: at("SEC"),
    node: at("NTE"),
    ord: "a0",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    ...of,
  };
}

const side = (
  held: PublishedNode,
  sections: PublishedBlock[] = [],
): SnapshotSide => ({ note: held, sections });

describe("what became of a note between two versions", () => {
  it("says nothing about one neither version touched", () => {
    const held = note({ address: "1a" });
    expect(
      noteChanges([side(held, [section()])], [side(held, [section()])]),
    ).toEqual([]);
  });

  // A note's look is not published, so a recoloured note reaches here as one
  // whose timestamp moved and whose every readable field did not.
  it("says nothing about one whose writing did not move", () => {
    const held = note({ address: "1a" });
    expect(
      noteChanges(
        [side(held, [section()])],
        [
          side({ ...held, updated_at: "2026-06-01T00:00:00.000Z" }, [
            section(),
          ]),
        ],
      ),
    ).toEqual([]);
  });

  it("reports a note that arrived, with its whole stack added", () => {
    const held = note({ address: "1a1" });
    expect(noteChanges([], [side(held, [section()])])).toEqual([
      {
        change: "added",
        note: held,
        sections: [{ change: "added", section: section() }],
      },
    ]);
  });

  // What a note that is gone said is in the version that still has it, and that
  // is a read a reader makes when it wants one.
  it("reports a note that is gone without its sections", () => {
    const held = note({ address: "1a1" });
    expect(noteChanges([side(held, [section()])], [])).toEqual([
      { change: "removed", note: held },
    ]);
  });

  it("reports a retitled note with both sides of it", () => {
    const before = note({ address: "1a", title: "First" });
    const after = note({ address: "1a", title: "Second" });
    expect(noteChanges([side(before)], [side(after)])).toEqual([
      { change: "changed", note: after, before, sections: [] },
    ]);
  });

  it("reports a note whose sections moved, changed or went", () => {
    const held = note({ address: "1a" });
    const kept = section({ ref: at("KEPT") });
    const rewritten = section({ ref: at("REWRTE"), ord: "a1" });
    const changes = noteChanges(
      [side(held, [kept, rewritten, section({ ref: at("GNE"), ord: "a2" })])],
      [
        side(held, [
          kept,
          { ...rewritten, ord: "a3" },
          section({ ref: at("NEW"), ord: "a4" }),
        ]),
      ],
    );
    expect(changes).toHaveLength(1);
    const only = changes[0];
    if (only.change !== "changed") throw new Error("expected a changed note");
    expect(only.sections.map((held) => held.change)).toEqual([
      "changed",
      "added",
      "removed",
    ]);
  });

  it("reads a rewritten section by its document and not by its keys", () => {
    const held = note({ address: "1a" });
    const one = section({
      content: { type: "doc", content: [{ type: "p", attrs: { a: 1, b: 2 } }] },
    });
    const other = section({
      content: { type: "doc", content: [{ type: "p", attrs: { b: 2, a: 1 } }] },
    });
    expect(noteChanges([side(held, [one])], [side(held, [other])])).toEqual([]);
  });

  // An author who deletes every child of a branch and writes a new first one
  // hands out an address a reader is still holding.
  it("reports one note gone and another arrived at one address", () => {
    const before = note({ address: "1a1", ref: at("FRST") });
    const after = note({ address: "1a1", ref: at("SECND") });
    expect(
      noteChanges([side(before)], [side(after)]).map((c) => c.change),
    ).toEqual(["removed", "added"]);
  });

  it("walks both sides in address order", () => {
    const changes = noteChanges(
      [side(note({ address: "1a", ref: at("A") }))],
      [
        side(note({ address: "1", ref: at("R") })),
        side(note({ address: "1b", ref: at("B") })),
      ],
    );
    expect(changes.map((c) => c.note.address)).toEqual(["1", "1a", "1b"]);
  });
});

describe("how far two runs can be compared", () => {
  it("stops at the lower of two windows that both have more", () => {
    expect(
      comparableTo({ last: "1c", more: true }, { last: "1b", more: true }),
    ).toBe("1b");
  });

  it("reads to the end of the side that still has more", () => {
    expect(
      comparableTo({ last: "1c", more: false }, { last: "1z", more: true }),
    ).toBe("1z");
  });

  it("is unbounded once both sides are exhausted", () => {
    expect(
      comparableTo({ last: "1c", more: false }, { last: "1b", more: false }),
    ).toBeUndefined();
  });
});
