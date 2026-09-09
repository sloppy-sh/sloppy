// DESIGN.md § "A difference between two states": the notes a difference names
// are left as they are and everything else recedes, the notes that went are
// drawn where the earlier state put them, and a move is a fact about the lines.
// What the canvas STRIKES for each of those is `scene.difference.test.ts`'s;
// what the model decides is here.

import type { NodeView, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  type DrawnNode,
  differenceMarks,
  drawnNodes,
  type GraphDifference,
  nodesWithGone,
} from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { applyLod } from "./lod.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";

const OWNER = "did:syr:someone";
const palette = buildPalette({
  ink: "oklch(0.21 0.01 60)",
  paper: "oklch(0.98 0.006 85)",
  hues: Array.from(
    { length: 8 },
    (_, at) => `oklch(0.61 0.13 ${25 + at * 45})`,
  ),
});

const ref = (address: string): OwnedRef => `${OWNER}/${address}` as OwnedRef;

function note(address: string, over: Partial<NodeView> = {}): NodeView {
  return {
    ref: ref(address),
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: address.length,
    origin: ref(address),
    title: address,
    tags: [],
    links: [],
    published: false,
    ...over,
  } as NodeView;
}

const drawn = (nodes: readonly NodeView[]): DrawnNode[] =>
  nodes.map((node) => ({
    node,
    collapsed: false,
    folded: 0,
    tags: node.tags,
  }));

const nothing: GraphDifference = {
  added: new Set(),
  removed: [],
  moved: [],
  changed: new Set(),
};

/** A difference with only these in it, so a test names one kind at a time. */
const asking = (over: Partial<GraphDifference>): GraphDifference => ({
  ...nothing,
  ...over,
});

describe("what one note is between two states", () => {
  it("gives a note in several of the lists exactly one value", () => {
    const moved = ref("1a");
    const marks = differenceMarks(
      asking({
        moved: [{ ref: moved, from: ref("2") }],
        changed: new Set([moved, ref("1b")]),
      }),
    );
    expect(marks.get(moved)).toBe("changed");
    expect(marks.get(ref("1b"))).toBe("changed");
  });

  it("reads a note that went over every other thing said about it", () => {
    const gone = note("1a", { parent: ref("1") });
    const marks = differenceMarks(
      asking({ removed: [gone], changed: new Set([gone.ref]) }),
    );
    expect(marks.get(gone.ref)).toBe("gone");
  });

  it("names nothing where the two states are the same", () => {
    expect(differenceMarks(nothing).size).toBe(0);
    expect(differenceMarks(undefined).size).toBe(0);
  });
});

describe("the notes that went, standing back in the region", () => {
  const field = [note("1"), note("1a", { parent: ref("1") })];
  const gone = note("1b", { parent: ref("1") });

  it("hands back the region itself where nothing went", () => {
    expect(nodesWithGone(field, nothing)).toBe(field);
    expect(nodesWithGone(field, undefined)).toBe(field);
  });

  it("puts a note that went back beside the ones that stayed", () => {
    const held = nodesWithGone(field, asking({ removed: [gone] }));
    expect(held.map((node) => node.ref)).toEqual([
      ...field.map((node) => node.ref),
      gone.ref,
    ]);
  });

  // The later state is what the canvas is handed, so a ref in both is the note
  // that is there now — a second copy of it would be a second mark.
  it("never draws a note twice", () => {
    const held = nodesWithGone(field, asking({ removed: [field[1]] }));
    expect(held).toHaveLength(field.length);
  });

  it("puts it where the earlier state drew it", () => {
    const before = buildModel(drawn([...field, gone]), {
      selection: [],
      palette,
    });
    const difference = asking({ removed: [gone] });
    const after = buildModel(drawn(nodesWithGone(field, difference)), {
      selection: [],
      palette,
      difference,
    });
    // Seeded off the genealogy alone, so a field holding the same notes seeds
    // the same way whichever state each of them came from.
    for (const at of [...field, gone]) {
      const was = before.graph.getNodeAttributes(at.ref);
      const now = after.graph.getNodeAttributes(at.ref);
      expect([now.anchorX, now.anchorY], at.ref).toEqual([
        was.anchorX,
        was.anchorY,
      ]);
    }
  });
});

describe("a mark while two states are being compared", () => {
  const field = [
    note("1"),
    note("1a", { parent: ref("1") }),
    note("1b", { parent: ref("1") }),
  ];
  const gone = note("1c", {
    parent: ref("1"),
    appearance: { ring_weight: "heavy", preview: "picture-1" },
  });

  const model = (difference: GraphDifference, selection: Tag[] = []) =>
    buildModel(drawn(nodesWithGone(field, difference)), {
      selection,
      palette,
      difference,
    });

  it("carries what the difference says of it, and nothing on the rest", () => {
    const built = model(
      asking({
        added: new Set([field[1].ref]),
        changed: new Set([field[2].ref]),
      }),
    );
    expect(built.graph.getNodeAttributes(field[1].ref).difference).toBe(
      "arrived",
    );
    expect(built.graph.getNodeAttributes(field[2].ref).difference).toBe(
      "changed",
    );
    expect(
      built.graph.getNodeAttributes(field[0].ref).difference,
    ).toBeUndefined();
  });

  // DESIGN.md: a note that went is a band around nothing, so there is no mark
  // inside it for a look or a picture to be drawn on.
  it("draws nothing inside a note that went", () => {
    const built = model(asking({ removed: [gone] }));
    const mark = built.graph.getNodeAttributes(gone.ref);
    expect(mark.ringWeight).toBe("none");
    expect(mark.preview.pictures).toEqual([]);

    const still = buildModel(drawn([...field, gone]), {
      selection: [],
      palette,
    }).graph.getNodeAttributes(gone.ref);
    expect(still.ringWeight).toBe("heavy");
    expect(still.preview.pictures).toEqual(["picture-1"]);
  });

  it("leaves the notes it names as they are and recedes the rest", () => {
    const built = model(asking({ added: new Set([field[1].ref]) }));
    expect(built.graph.getNodeAttributes(field[1].ref).alpha).toBe(1);
    const dimmed = built.graph.getNodeAttributes(field[0].ref);
    expect(dimmed.alpha).toBe(palette.unselectedAlpha(dimmed.fill));
  });

  it("leaves a note that only moved as it is", () => {
    const built = model(
      asking({ moved: [{ ref: field[1].ref, from: ref("2") }] }),
    );
    expect(built.graph.getNodeAttributes(field[1].ref).alpha).toBe(1);
    expect(built.graph.getNodeAttributes(field[1].ref).difference).toBe(
      "moved",
    );
  });

  // Two questions at once is two shares off one mark, and the floor is what
  // keeps the graph on the page — DESIGN.md § "A difference between two states".
  it("recedes at one strength however many questions are being asked", () => {
    const tagged = [
      field[0],
      { ...field[1], tags: ["seed"] as Tag[] },
      field[2],
    ];
    const difference = asking({ added: new Set([field[2].ref]) });
    const both = buildModel(drawn(tagged), {
      selection: ["seed"] as Tag[],
      palette,
      difference,
    });
    const outside = both.graph.getNodeAttributes(field[0].ref);
    expect(outside.alpha).toBe(palette.unselectedAlpha(outside.fill));

    const tagsOnly = buildModel(drawn(tagged), {
      selection: ["seed"] as Tag[],
      palette,
    });
    const one = tagsOnly.graph.getNodeAttributes(field[0].ref);
    expect(outside.alpha).toBe(one.alpha);
  });
});

describe("the lines a difference draws", () => {
  const field = [
    note("1"),
    note("1a", { parent: ref("1") }),
    note("2"),
    note("2a", { parent: ref("2") }),
  ];
  const at = (model: ReturnType<typeof buildModel>, of: OwnedRef): number =>
    model.graph.getNodeAttributes(of).index;

  it("draws the line a note arrived with", () => {
    const difference = asking({ added: new Set([field[1].ref]) });
    const model = buildModel(drawn(field), {
      selection: [],
      palette,
      difference,
    });
    expect(model.difference.arrived).toEqual([
      at(model, field[1].ref),
      at(model, field[0].ref),
    ]);
    expect(model.difference.gone).toEqual([]);
  });

  it("draws the line a note took with it", () => {
    const gone = note("1b", { parent: ref("1") });
    const difference = asking({ removed: [gone] });
    const held = nodesWithGone(field, difference);
    const model = buildModel(drawn(held), {
      selection: [],
      palette,
      difference,
    });
    expect(model.difference.gone).toEqual([
      at(model, gone.ref),
      at(model, field[0].ref),
    ]);
    expect(model.difference.arrived).toEqual([]);
  });

  // The two lines are the one thing on the canvas that says WHERE a note went.
  it("draws a move as the line it left and the line it joined", () => {
    const difference = asking({
      moved: [{ ref: field[3].ref, from: field[0].ref }],
    });
    const model = buildModel(drawn(field), {
      selection: [],
      palette,
      difference,
    });
    expect(model.difference.arrived).toEqual([
      at(model, field[3].ref),
      at(model, field[2].ref),
    ]);
    expect(model.difference.gone).toEqual([
      at(model, field[3].ref),
      at(model, field[0].ref),
    ]);
  });

  it("draws no line to a parent this canvas is not drawing", () => {
    const difference = asking({
      moved: [{ ref: field[3].ref, from: ref("9") }],
    });
    const model = buildModel(drawn(field), {
      selection: [],
      palette,
      difference,
    });
    expect(model.difference.gone).toEqual([]);
    expect(model.difference.arrived).toHaveLength(2);
  });

  // A person editing their own label is not a note going anywhere, so a
  // renumbered note is `changed` and nothing on the lines moves.
  it("draws nothing for a note whose address a person edited", () => {
    const difference = asking({ changed: new Set([field[3].ref]) });
    const model = buildModel(drawn(field), {
      selection: [],
      palette,
      difference,
    });
    expect(model.difference).toEqual({ arrived: [], gone: [] });
    expect(model.graph.getNodeAttributes(field[3].ref).difference).toBe(
      "changed",
    );
  });

  // Nothing here is an edge: a line to the parent a note LEFT would pull it
  // back there, which is the one place it is not.
  it("moves nothing the layout reads", () => {
    const difference = asking({
      moved: [{ ref: field[3].ref, from: field[0].ref }],
    });
    const plain = buildModel(drawn(field), { selection: [], palette });
    const compared = buildModel(drawn(field), {
      selection: [],
      palette,
      difference,
    });
    expect(compared.graph.size).toBe(plain.graph.size);
    for (const of of field) {
      const was = plain.graph.getNodeAttributes(of.ref);
      const now = compared.graph.getNodeAttributes(of.ref);
      expect([now.anchorX, now.anchorY, now.x, now.y], of.ref).toEqual([
        was.anchorX,
        was.anchorY,
        was.x,
        was.y,
      ]);
    }
  });
});

/**
 * A difference with nothing in it is two states that turned out to be the same,
 * and a graph nobody has asked a question of draws as itself. Held over
 * generated fields rather than a handful, since what could differ is one
 * attribute of one node out of thousands.
 */
describe("two states that are the same", () => {
  const shapes = [
    { total: 120, roots: 2, seed: 11 },
    { total: 400, roots: 3, seed: 4242, pulledRoots: [2] },
    { total: 900, roots: 6, seed: 20260909, maxSiblings: 9 },
  ];

  for (const shape of shapes) {
    it(`draws ${shape.total} notes exactly as no difference does`, () => {
      const corpus = makeCorpus(shape);
      const held = drawnNodes(
        corpus.nodes,
        applyLod(corpus.nodes, new Set<OwnedRef>(), undefined).collapsed,
      );
      for (const selection of [[] as Tag[], corpus.tags.slice(0, 2)]) {
        const options = { selection, palette, viewer: corpus.owner };
        const plain = buildModel(held, options);
        const empty = buildModel(
          drawnNodes(
            nodesWithGone(corpus.nodes, nothing),
            applyLod(corpus.nodes, new Set<OwnedRef>(), undefined).collapsed,
          ),
          { ...options, difference: nothing },
        );
        expect(empty.order).toEqual(plain.order);
        expect(empty.difference).toEqual({ arrived: [], gone: [] });
        for (const of of plain.order) {
          expect(
            empty.graph.getNodeAttributes(of),
            `${of} · ${selection.length} tags`,
          ).toEqual(plain.graph.getNodeAttributes(of));
        }
        expect(empty.graph.size).toBe(plain.graph.size);
      }
    });
  }
});
