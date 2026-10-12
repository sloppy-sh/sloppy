import {
  type NodeView,
  type OwnedRef,
  type Tag,
  TAG_HUE_SLOTS,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  DRAWN_SETS_MOST,
  GRAPH_ARRANGEMENTS,
  drawnRefs,
  drawnNodes,
  drawnReading,
  drawnSetSlots,
  drawnSetsOf,
  edgeLookKey,
  edgeLooksByPair,
  type GraphEdgeLook,
} from "./contract.js";

const DID = "did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc";

const ref = (seq: number): OwnedRef =>
  `${DID}/01JYQ0000000000000000${String(seq).padStart(5, "0")}`;

function node(
  seq: number,
  address: string,
  parent?: NodeView,
  tags: string[] = [],
): NodeView {
  return {
    ref: ref(seq),
    created_by: DID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: (address.match(/[0-9]+|[a-z]+/g) ?? []).length,
    parent: parent?.ref,
    origin: parent?.origin ?? ref(seq),
    title: address,
    tags: tags as Tag[],
    links: [],
    published: false,
  };
}

const root = node(1, "1");
const child = node(2, "1a", root, ["seed"]);
const grandchild = node(3, "1a1", child, ["evergreen", "seed"]);
const sibling = node(4, "1b", root);

describe("drawnNodes", () => {
  it("draws everything when nothing is collapsed", () => {
    const drawn = drawnNodes([root, child, grandchild], new Set());
    expect(drawn.map((d) => d.node.address)).toEqual(["1", "1a", "1a1"]);
    expect(drawn.every((d) => !d.collapsed && d.folded === 0)).toBe(true);
  });

  it("folds a whole subtree into its collapsed root", () => {
    const drawn = drawnNodes(
      [root, child, grandchild, sibling],
      new Set([root.ref]),
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0].node.ref).toBe(root.ref);
    expect(drawn[0].collapsed).toBe(true);
    expect(drawn[0].folded).toBe(3);
  });

  it("counts a nested collapse once, into the outermost root", () => {
    const drawn = drawnNodes(
      [root, child, grandchild],
      new Set([root.ref, child.ref]),
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0].folded).toBe(2);
  });

  it("leaves a collapsed node's siblings alone", () => {
    const drawn = drawnNodes(
      [root, child, grandchild, sibling],
      new Set([child.ref]),
    );
    expect(drawn.map((d) => d.node.address)).toEqual(["1", "1a", "1b"]);
    expect(drawn[1].folded).toBe(1);
    expect(drawn[2].folded).toBe(0);
  });

  it("draws a node whose ancestors the host has not loaded", () => {
    const drawn = drawnNodes([grandchild], new Set([root.ref, child.ref]));
    expect(drawn.map((d) => d.node.address)).toEqual(["1a1"]);
  });

  it("carries what it folded, so a fold never hides a match", () => {
    const drawn = drawnNodes(
      [root, child, grandchild, sibling],
      new Set([root.ref]),
    );
    expect(new Set(drawn[0].tags)).toEqual(new Set(["seed", "evergreen"]));
  });

  it("carries a nested collapse's tags out to the outermost mega-node", () => {
    const drawn = drawnNodes(
      [root, child, grandchild],
      new Set([root.ref, child.ref]),
    );
    expect(new Set(drawn[0].tags)).toEqual(new Set(["seed", "evergreen"]));
  });

  it("gives a mark that folded nothing its own tags and no others", () => {
    const drawn = drawnNodes([root, child, grandchild, sibling], new Set());
    expect(drawn.map((entry) => entry.tags)).toEqual([
      [],
      ["seed"],
      ["evergreen", "seed"],
      [],
    ]);
  });

  it("never folds across origins", () => {
    const theirs = node(9, "1a");
    const drawn = drawnNodes([root, theirs], new Set([root.ref]));
    expect(drawn.map((d) => d.node.ref)).toEqual([root.ref, theirs.ref]);
    expect(drawn[0].folded).toBe(0);
  });
});

// DESIGN.md § "The mark": being open is a set a mark can be IN, so a fold
// aggregates it the way it aggregates tags — a mega-node answers for the
// subtree it replaced, and the strip listing an open note never disagrees with
// the canvas about it.
describe("drawnReading", () => {
  const every = [root, child, grandchild, sibling];

  it("leaves a drawn note where it is", () => {
    expect(
      drawnReading(every, new Set(), {
        open: new Set([child.ref, sibling.ref]),
        active: sibling.ref,
      }),
    ).toEqual({
      open: new Set([child.ref, sibling.ref]),
      active: sibling.ref,
    });
  });

  it("lifts the mega-node that swallowed a note, rather than nothing at all", () => {
    expect(
      drawnReading(every, new Set([root.ref]), {
        open: new Set([grandchild.ref]),
        active: null,
      }),
    ).toEqual({ open: new Set([root.ref]), active: null });
  });

  it("carries a nested fold out to the outermost mega-node", () => {
    expect(
      drawnReading(every, new Set([root.ref, child.ref]), {
        open: new Set([grandchild.ref]),
        active: grandchild.ref,
      }),
    ).toEqual({ open: new Set([root.ref]), active: root.ref });
  });

  // Two tabs inside one fold are one mark, and it lifts at the stronger of the
  // two: the fold holds the note being read.
  it("folds two open notes onto one mark, at the stronger strength", () => {
    expect(
      drawnReading(every, new Set([root.ref]), {
        open: new Set([child.ref, grandchild.ref]),
        active: grandchild.ref,
      }),
    ).toEqual({ open: new Set([root.ref]), active: root.ref });
  });

  it("leaves a note the host has not loaded alone, lifting nothing", () => {
    const away = node(9, "2");
    expect(
      drawnReading(every, new Set([root.ref]), {
        open: new Set([away.ref]),
        active: away.ref,
      }),
    ).toEqual({ open: new Set([away.ref]), active: away.ref });
  });
});

// The notes a channel names are a set a mark can be IN, so a fold aggregates it
// the way it aggregates tags: a mega-node standing for a named note carries the
// channel rather than losing it with the field.
describe("drawnRefs", () => {
  const every = [root, child, grandchild, sibling];

  it("leaves a drawn note where it is", () => {
    expect(drawnRefs(every, new Set(), new Set([child.ref]))).toEqual(
      new Set([child.ref]),
    );
  });

  it("names the mega-node that swallowed a named note", () => {
    expect(
      drawnRefs(every, new Set([root.ref]), new Set([grandchild.ref])),
    ).toEqual(new Set([root.ref]));
  });

  it("carries a nested fold out to the outermost mega-node", () => {
    expect(
      drawnRefs(
        every,
        new Set([root.ref, child.ref]),
        new Set([grandchild.ref]),
      ),
    ).toEqual(new Set([root.ref]));
  });

  it("names nothing where the question named nothing", () => {
    expect(drawnRefs(every, new Set([root.ref]), new Set())).toEqual(new Set());
  });

  it("leaves a note the host has not loaded alone", () => {
    const away = node(9, "2");
    expect(drawnRefs(every, new Set([root.ref]), new Set([away.ref]))).toEqual(
      new Set([away.ref]),
    );
  });
});

describe("the looks a canvas was handed", () => {
  const cited: GraphEdgeLook = {
    from: child.ref,
    to: root.ref,
    label: "answers",
  };

  it("finds a pair's look whichever end it is asked from", () => {
    const byPair = edgeLooksByPair([cited]);
    expect(byPair.get(edgeLookKey(child.ref, root.ref))).toBe(cited);
    expect(byPair.get(edgeLookKey(root.ref, child.ref))).toBe(cited);
  });

  it("keeps each pair apart", () => {
    expect(edgeLookKey(root.ref, child.ref)).not.toBe(
      edgeLookKey(root.ref, sibling.ref),
    );
    const byPair = edgeLooksByPair([
      cited,
      { from: root.ref, to: sibling.ref, stroke: "dotted" },
    ]);
    expect(byPair.size).toBe(2);
    expect(byPair.get(edgeLookKey(root.ref, sibling.ref))?.stroke).toBe(
      "dotted",
    );
  });

  it("draws the first of two on one pair, the look a note answers with", () => {
    const byPair = edgeLooksByPair([
      cited,
      { from: root.ref, to: child.ref, label: "and again" },
    ]);
    expect(byPair.size).toBe(1);
    expect(byPair.get(edgeLookKey(child.ref, root.ref))).toBe(cited);
  });

  it("is empty where the host handed none", () => {
    expect(edgeLooksByPair(undefined).size).toBe(0);
    expect(edgeLooksByPair([]).size).toBe(0);
  });
});

describe("the readings of one canvas", () => {
  it("offers the two readings, the genealogy first — what absent means", () => {
    expect([...GRAPH_ARRANGEMENTS]).toEqual(["genealogy", "sets"]);
  });

  it("draws as many sets as there are hue slots, at the most", () => {
    expect(DRAWN_SETS_MOST).toBe(TAG_HUE_SLOTS.length);
  });
});

// Which tags are drawn as places is one function, so the canvas, the rail and
// the menu cannot disagree about what the reader is looking at.
describe("the tags a field draws as places", () => {
  const tagged = (serial: number, tags: string[]): NodeView =>
    node(serial, `1a${serial}`, root, tags);

  /** Three tags one note apart, so the order by count is unambiguous. */
  const field = [
    tagged(10, ["beta", "alpha", "gamma"]),
    tagged(11, ["beta", "alpha"]),
    tagged(12, ["beta"]),
  ];

  it("leads with the selection, in selection order", () => {
    expect(drawnSetsOf(["gamma", "alpha"] as Tag[], field)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("draws the most-carried tags of a field nobody has asked about", () => {
    expect(drawnSetsOf([], field)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("reads two tags the same notes carry in name order", () => {
    const evenly = [tagged(20, ["zebra", "aardvark"]), tagged(21, ["zebra"])];
    expect(drawnSetsOf([], evenly)).toEqual(["zebra", "aardvark"]);
    expect(drawnSetsOf([], [tagged(22, ["zebra", "aardvark"])])).toEqual([
      "aardvark",
      "zebra",
    ]);
  });

  it("names a tag once, however it arrives twice", () => {
    expect(drawnSetsOf(["beta", "beta"] as Tag[], field)).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
    expect(drawnSetsOf([], [tagged(30, ["beta", "beta"]), ...field])).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("draws nothing where neither the reader nor the notes name a tag", () => {
    expect(drawnSetsOf([], [node(40, "1c", root)])).toEqual([]);
    expect(drawnSetsOf([], [])).toEqual([]);
  });

  it("stops at the cap, selection first", () => {
    const many = Array.from(
      { length: DRAWN_SETS_MOST * 2 },
      (_unused, at) => `tag-${String(at).padStart(2, "0")}`,
    );
    // The later a tag stands in `many`, the more of these notes carry it.
    const carried = many.map((_unused, at) => tagged(50 + at, many.slice(at)));
    const last = many[many.length - 1] as Tag;
    const drawn = drawnSetsOf([last], carried);

    expect(drawn).toHaveLength(DRAWN_SETS_MOST);
    expect(drawn[0]).toBe(last);
    expect(new Set(drawn).size).toBe(DRAWN_SETS_MOST);
    // The cap falls on the count, so the tags left out are the least carried.
    expect(drawn.slice(1)).toEqual(
      many.slice(many.length - DRAWN_SETS_MOST, many.length - 1).reverse(),
    );
  });

  it("hands each drawn set the hue slot its place is painted in", () => {
    const drawn = drawnSetsOf(["gamma"] as Tag[], field);
    expect([...drawnSetSlots(drawn)]).toEqual([
      ["gamma", 1],
      ["beta", 2],
      ["alpha", 3],
    ]);
    expect(drawnSetSlots([]).size).toBe(0);
  });
});
