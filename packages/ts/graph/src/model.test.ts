import {
  type Address,
  addressDepth,
  assignTagHueSlots,
  type DidSyr,
  type EdgeKind,
  MARK_RADII,
  MARK_RADIUS_SCALE,
  MARK_SCALE_MAX,
  MARK_SCALE_MIN,
  type NodeAppearance,
  type NodeView,
  PREVIEW_COVER_MAX,
  PREVIEW_COVER_MIN,
  PREVIEW_SIZE_COVER,
  PREVIEW_SIZES,
  type OwnedRef,
  PublishedNodeSchema,
  siblingAddress,
  type Tag,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { type DrawnNode, drawnNodes, type GraphEdgeLook } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { MAX_DENSITY } from "./density.js";
import { applyLod } from "./lod.js";
import {
  buildModel,
  LEAF_RADIUS,
  MARK_PICTURE_PX,
  markPictureSide,
  WIDEST_RADIUS,
} from "./model.js";
import { buildPalette } from "./palette.js";

const corpus = makeCorpus();
const palette = buildPalette({
  ink: "oklch(0.21 0.01 60)",
  paper: "oklch(0.98 0.006 85)",
  hues: Array.from(
    { length: 8 },
    (_, at) => `oklch(0.61 0.13 ${25 + at * 45})`,
  ),
});

const drawn = drawnNodes(
  corpus.nodes,
  applyLod(corpus.nodes, new Set<OwnedRef>(), undefined).collapsed,
);

const selection = ["seed", "biology", "question"] as Tag[];

describe("buildModel", () => {
  const model = buildModel(drawn, {
    selection: [],
    palette,
    viewer: corpus.owner,
  });

  it("holds every drawn node, in the order it was handed them", () => {
    expect(model.order).toEqual(drawn.map((entry) => entry.node.ref));
    expect(model.graph.order).toBe(drawn.length);
  });

  // Every drawn parent and child are joined, and nothing else is joined as
  // parentage — the line may read as something stronger where a person also
  // connected the two, which is DESIGN.md § Edges' ruling and not a missing edge.
  it("draws a genealogical edge only where both ends are drawn", () => {
    const present = new Set(model.order);
    const pair = (a: string, b: string) => [a, b].sort().join(" ");
    const parented = new Set<string>();
    for (const { node } of drawn) {
      if (node.parent === undefined || !present.has(node.parent)) continue;
      parented.add(pair(node.parent, node.ref));
      expect(model.graph.hasEdge(node.parent, node.ref)).toBe(true);
    }
    expect(parented.size).toBeGreaterThan(0);
    model.graph.forEachEdge((_e, attributes, source, target) => {
      if (attributes.kind !== "genealogy") return;
      expect(parented.has(pair(source, target))).toBe(true);
    });
  });

  it("never draws a link to a node that is not there, or to itself", () => {
    model.graph.forEachEdge((_e, attributes, source, target) => {
      expect(source).not.toBe(target);
      expect(model.graph.hasNode(source)).toBe(true);
      expect(model.graph.hasNode(target)).toBe(true);
      expect(attributes.distance).toBeGreaterThan(0);
    });
  });

  it("counts a node's drawn children, which is what a collapse folds", () => {
    for (const ref of model.order) {
      const expected = drawn.filter(
        (entry) => entry.node.parent === ref,
      ).length;
      expect(model.graph.getNodeAttributes(ref).children).toBe(expected);
    }
  });

  // DESIGN.md § Form: provenance must survive greyscale and full zoom-out, so
  // it is the shape the scene picks, never the fill.
  it("reads provenance off the viewer, not off the colour", () => {
    for (const ref of model.order) {
      const node = model.graph.getNodeAttributes(ref);
      const source = drawn.find((entry) => entry.node.ref === ref)!.node;
      const expected =
        source.created_by !== corpus.owner
          ? "pulled"
          : source.published
            ? "published"
            : "own";
      expect(node.provenance).toBe(expected);
    }
    const kinds = new Set(
      model.order.map((ref) => model.graph.getNodeAttributes(ref).provenance),
    );
    expect(kinds).toEqual(new Set(["own", "published", "pulled"]));
  });

  it("claims nothing as the reader's own when there is no reader", () => {
    const anonymous = buildModel(drawn, { selection: [], palette });
    const kinds = new Set(
      anonymous.order.map(
        (ref) => anonymous.graph.getNodeAttributes(ref).provenance,
      ),
    );
    expect(kinds.has("pulled")).toBe(false);
  });

  it("sizes a mega-node by what it folded, and bounds it", () => {
    const megas = drawn.filter((entry) => entry.folded > 0);
    expect(megas.length).toBeGreaterThan(0);
    const radii = megas.map((entry) => ({
      folded: entry.folded,
      radius: model.graph.getNodeAttributes(entry.node.ref).radius,
    }));
    const leaf = drawn.find((entry) => entry.folded === 0);
    if (leaf) {
      const leafRadius = model.graph.getNodeAttributes(leaf.node.ref).radius;
      for (const mega of radii) expect(mega.radius).toBeGreaterThan(leafRadius);
    }
    for (const mega of radii) expect(mega.radius).toBeLessThanOrEqual(46);
    const sorted = [...radii].sort((a, b) => a.folded - b.folded);
    for (let at = 1; at < sorted.length; at++) {
      expect(sorted[at].radius).toBeGreaterThanOrEqual(sorted[at - 1].radius);
    }
  });

  // DESIGN.md § Hue: with nothing selected the graph is monochrome, and colour
  // appearing means the reader asked a question of it.
  it("colours by depth alone until a tag is selected", () => {
    for (const ref of model.order) {
      const node = model.graph.getNodeAttributes(ref);
      expect(node.fill).toBe(palette.depth(node.depth));
      expect(node.tag).toBeUndefined();
      expect(node.alpha).toBe(1);
    }
  });
});

describe("with tags selected", () => {
  const model = buildModel(drawn, {
    selection,
    palette,
    viewer: corpus.owner,
  });
  const slots = assignTagHueSlots(selection);

  it("lights a note in any selected set, in that tag's own hue", () => {
    const lit = model.order.filter(
      (ref) => model.graph.getNodeAttributes(ref).tag !== undefined,
    );
    expect(lit.length).toBeGreaterThan(0);

    for (const ref of lit) {
      const node = model.graph.getNodeAttributes(ref);
      expect(node.fill).toBe(palette.tag(slots.get(node.tag!)!));
      expect(node.alpha).toBe(1);
    }
    expect(
      new Set(lit.map((ref) => model.graph.getNodeAttributes(ref).tag)),
    ).toEqual(new Set(selection));
  });

  // DESIGN.md § Hue: one mark, one hue — the rail already says which other sets
  // a note is in, so the canvas never mixes or stripes.
  it("draws a mark in several selected sets in the earliest-selected hue", () => {
    const several = drawn.filter(
      (entry) => entry.tags.filter((tag) => selection.includes(tag)).length > 1,
    );
    expect(several.length).toBeGreaterThan(0);
    for (const entry of several) {
      const node = model.graph.getNodeAttributes(entry.node.ref);
      const earliest = selection.find((tag) => entry.tags.includes(tag));
      expect(node.tag).toBe(earliest);
    }
  });

  // AI.md: highlight, do not filter — and at the default budget two thirds of a
  // graph this size is folded into mega-nodes.
  it("lights a mega-node for a tag only the notes it folded carry", () => {
    const carriers = drawn.filter(
      (entry) =>
        entry.folded > 0 &&
        !entry.node.tags.some((tag) => selection.includes(tag)) &&
        entry.tags.some((tag) => selection.includes(tag)),
    );
    expect(carriers.length).toBeGreaterThan(0);
    for (const entry of carriers) {
      const node = model.graph.getNodeAttributes(entry.node.ref);
      expect(node.tag).toBe(selection.find((tag) => entry.tags.includes(tag)));
      expect(node.alpha).toBe(1);
    }
  });

  it("leaves no note in a selected set unaccounted for on the canvas", () => {
    const byRef = new Map(corpus.nodes.map((node) => [node.ref, node]));
    const lit = (ref: OwnedRef): boolean =>
      model.graph.hasNode(ref) &&
      model.graph.getNodeAttributes(ref).tag !== undefined;
    const carriers = corpus.nodes.filter((node) =>
      node.tags.some((tag) => selection.includes(tag)),
    );
    expect(carriers.length).toBeGreaterThan(0);

    const unanswered = carriers.filter((carrier) => {
      let at: NodeView | undefined = carrier;
      while (at !== undefined && !lit(at.ref)) {
        at = at.parent === undefined ? undefined : byRef.get(at.parent);
      }
      return at === undefined;
    });
    expect(unanswered.map((node) => node.address)).toEqual([]);
  });

  // DESIGN.md § Hue: notes carrying none of the selected tags dim; they never
  // leave, because the shape the answer is read against is the graph itself.
  it("recedes a mark in none of them without dropping it or recolouring it", () => {
    const dark = model.order.filter(
      (ref) => model.graph.getNodeAttributes(ref).tag === undefined,
    );
    expect(dark.length).toBeGreaterThan(0);
    for (const ref of dark) {
      const node = model.graph.getNodeAttributes(ref);
      expect(node.fill).toBe(palette.depth(node.depth));
      expect(node.alpha).toBe(palette.unselectedAlpha(node.fill));
      expect(node.alpha).toBeLessThan(1);
      const entry = drawn.find((entry) => entry.node.ref === ref)!;
      expect(entry.tags.some((tag) => selection.includes(tag))).toBe(false);
    }
    expect(model.order).toEqual(drawn.map((entry) => entry.node.ref));
  });

  // AI.md: highlight, not filter — the shape of the graph survives the question.
  it("leaves every seed and anchor exactly where the plain graph put them", () => {
    const plain = buildModel(drawn, {
      selection: [],
      palette,
      viewer: corpus.owner,
    });
    for (const ref of model.order) {
      const asked = model.graph.getNodeAttributes(ref);
      const before = plain.graph.getNodeAttributes(ref);
      expect([asked.x, asked.y, asked.anchorX, asked.anchorY]).toEqual([
        before.x,
        before.y,
        before.anchorX,
        before.anchorY,
      ]);
      expect(asked.anchorStrength).toBe(before.anchorStrength);
    }
  });

  it("gives one tag one colour across the whole region", () => {
    const byTag = new Map<Tag, number>();
    for (const ref of model.order) {
      const node = model.graph.getNodeAttributes(ref);
      if (node.tag === undefined) continue;
      const seen = byTag.get(node.tag);
      if (seen === undefined) byTag.set(node.tag, node.fill);
      else expect(node.fill).toBe(seen);
    }
    expect(new Set(byTag.values()).size).toBe(byTag.size);
  });

  it("spends one slot on a tag selected twice, and none on one nobody picked", () => {
    const twice = buildModel(drawn, {
      selection: [selection[0], selection[1], selection[0]] as Tag[],
      palette,
      viewer: corpus.owner,
    });
    const two = buildModel(drawn, {
      selection: selection.slice(0, 2) as Tag[],
      palette,
      viewer: corpus.owner,
    });
    for (const ref of twice.order) {
      expect(twice.graph.getNodeAttributes(ref).fill).toBe(
        two.graph.getNodeAttributes(ref).fill,
      );
    }
  });
});

// DESIGN.md § "What the code left behind": a signal is asked of the canvas the
// way a tag is, and the notes it names are the ones left in ink.
describe("a question that names notes", () => {
  const named = new Set(drawn.slice(0, 5).map((entry) => entry.node.ref));
  const model = buildModel(drawn, { selection: [], lit: named, palette });

  it("holds the named notes at full strength and dims the rest", () => {
    for (const ref of model.order) {
      const node = model.graph.getNodeAttributes(ref);
      expect(node.alpha).toBe(
        named.has(ref) ? 1 : palette.unselectedAlpha(node.fill),
      );
    }
    expect(model.order.length).toBeGreaterThan(named.size);
  });

  it("drops nothing and moves nothing, as a tag question does not", () => {
    const plain = buildModel(drawn, { selection: [], palette });
    expect(model.order).toEqual(plain.order);
    for (const ref of model.order) {
      const node = model.graph.getNodeAttributes(ref);
      const before = plain.graph.getNodeAttributes(ref);
      expect(node.fill).toBe(before.fill);
      expect([node.x, node.y]).toEqual([before.x, before.y]);
    }
  });

  // Two questions at once: a note answers both or it recedes.
  it("dims a note a selected tag lit where the signal does not name it", () => {
    const tagged = buildModel(drawn, { selection, palette });
    const lit = model.order.filter(
      (ref) => tagged.graph.getNodeAttributes(ref).tag !== undefined,
    );
    expect(lit.length).toBeGreaterThan(0);
    const both = buildModel(drawn, { selection, lit: named, palette });
    for (const ref of lit) {
      const node = both.graph.getNodeAttributes(ref);
      expect(node.alpha).toBe(
        named.has(ref) ? 1 : palette.unselectedAlpha(node.fill),
      );
    }
  });

  // A question nothing answered still asks it: the empty set is the answer
  // "none of them", and absent is nobody asking.
  it("dims the whole field for a question no note answers", () => {
    const none = buildModel(drawn, {
      selection: [],
      lit: new Set<OwnedRef>(),
      palette,
    });
    for (const ref of none.order) {
      const node = none.graph.getNodeAttributes(ref);
      expect(node.alpha).toBe(palette.unselectedAlpha(node.fill));
    }
  });
});

// DESIGN.md § "What the code left behind": the notes the code has moved under,
// which the mark carries whether or not anybody has asked.
describe("the notes the code has moved under", () => {
  const moved = new Set(drawn.slice(0, 3).map((entry) => entry.node.ref));

  it("marks those, and none of the rest", () => {
    const model = buildModel(drawn, {
      selection: [],
      codeMoved: moved,
      palette,
    });
    for (const ref of model.order) {
      expect(model.graph.getNodeAttributes(ref).codeMoved).toBe(moved.has(ref));
    }
  });

  it("marks nothing where nobody could work it out", () => {
    const model = buildModel(drawn, { selection: [], palette });
    for (const ref of model.order) {
      expect(model.graph.getNodeAttributes(ref).codeMoved).toBe(false);
    }
  });

  it("changes no hue, no strength and no place", () => {
    const plain = buildModel(drawn, { selection: [], palette });
    const model = buildModel(drawn, {
      selection: [],
      codeMoved: moved,
      palette,
    });
    for (const ref of model.order) {
      const node = model.graph.getNodeAttributes(ref);
      const before = plain.graph.getNodeAttributes(ref);
      expect(node.fill).toBe(before.fill);
      expect(node.alpha).toBe(before.alpha);
      expect([node.x, node.y]).toEqual([before.x, before.y]);
    }
  });
});

// AI.md § "The Genealogy Is the Protocol": which two notes a run joins is a
// function of what they sprang from and the order they read in, so the model
// derives it and no row carries it.
describe("the run of thought", () => {
  const model = buildModel(drawn, {
    selection: [],
    palette,
    viewer: corpus.owner,
  });

  const runsOf = (built: typeof model): [string, string][] => {
    const pairs: [string, string][] = [];
    built.graph.forEachEdge((_edge, attributes, source, target) => {
      if (attributes.kind === "run") pairs.push([source, target]);
    });
    return pairs;
  };

  it("joins every note to the one that comes next alongside it", () => {
    const isDrawn = new Set(drawn.map((entry) => entry.node.ref));
    const alongside = corpus.nodes.filter((node) => isDrawn.has(node.ref));
    const byAddress = new Map(
      alongside.map((node) => [`${node.created_by}|${node.address}`, node]),
    );
    let joined = 0;
    for (const node of alongside) {
      const next = byAddress.get(
        `${node.created_by}|${siblingAddress(node.address)}`,
      );
      if (next === undefined || next.parent !== node.parent) continue;
      joined += 1;
      expect(model.graph.getEdgeAttributes(node.ref, next.ref).kind).toBe(
        "run",
      );
    }
    expect(joined).toBeGreaterThan(0);
  });

  it("only ever joins two notes alongside each other", () => {
    const byRef = new Map(drawn.map((entry) => [entry.node.ref, entry.node]));
    for (const [source, target] of runsOf(model)) {
      const from = byRef.get(source as OwnedRef)!;
      const to = byRef.get(target as OwnedRef)!;
      expect(from.parent).toBe(to.parent);
      expect(from.created_by).toBe(to.created_by);
      expect(from.depth).toBe(to.depth);
    }
  });

  // A run is one person's sequence of thought. Two graphs that both hold a `1`
  // are not consecutive, they are two people.
  it("never runs from one person's branch into another's", () => {
    const roots = drawn
      .filter((entry) => entry.node.parent === undefined)
      .map((entry) => entry.node);
    const mine = roots.filter((node) => node.created_by === corpus.owner);
    const theirs = roots.filter((node) => node.created_by !== corpus.owner);
    expect(mine.length).toBeGreaterThan(1);
    expect(theirs.length).toBeGreaterThan(0);

    for (const ours of mine) {
      for (const other of theirs) {
        expect(model.graph.hasEdge(ours.ref, other.ref)).toBe(false);
      }
    }
    expect(model.graph.getEdgeAttributes(mine[0].ref, mine[1].ref).kind).toBe(
      "run",
    );
  });

  // Two of one person's graphs each hold a `1`, and those are two beginnings
  // rather than a run. Keyed by author they would be one.
  it("never runs from one graph's branches into another of the same person's", () => {
    const beside = `${corpus.owner}/01JGRAPH2ND000000000000000` as OwnedRef;
    const mine = [note("1"), note("2")];
    const other = [note("1", beside), note("2", beside)];
    const built = buildModel(drawnNodes([...mine, ...other], new Set()), {
      selection: [],
      palette,
    });
    expect(runsOf(built)).toHaveLength(2);
    expect(built.graph.hasEdge(mine[0].ref, other[0].ref)).toBe(false);
    expect(built.graph.hasEdge(mine[1].ref, other[1].ref)).toBe(false);
    expect(built.graph.getEdgeAttributes(other[0].ref, other[1].ref).kind).toBe(
      "run",
    );
  });

  // The point of deriving it: nothing is left holding a reference to the note
  // that went, so the two either side of the gap read as what they now are.
  it("reads across a note that is gone", () => {
    const whole = [note("1"), note("2"), note("3")];
    const full = buildModel(drawnNodes(whole, new Set()), {
      selection: [],
      palette,
    });
    expect(runsOf(full)).toHaveLength(2);

    const gapped = buildModel(drawnNodes([whole[0], whole[2]], new Set()), {
      selection: [],
      palette,
    });
    expect(runsOf(gapped)).toEqual([[whole[0].ref, whole[2].ref]]);
  });

  // DESIGN.md § Edges: the hand leads, so a link drawn along a run takes the
  // run's line — and a note's own writing naming its neighbour does not.
  it("gives way to a link somebody drew along it", () => {
    const first = note("1");
    const second = note("2");
    const drew = buildModel(
      drawnNodes([{ ...first, links: [second.ref] }, second], new Set()),
      { selection: [], palette },
    );
    expect(drew.graph.getEdgeAttributes(first.ref, second.ref).kind).toBe(
      "link",
    );
    expect(runsOf(drew)).toEqual([]);
  });
});

// DESIGN.md § Edges: a note carries two ways of connecting, and they are two
// lines rather than one — the writing's own naming is drawn whole and a hand's
// is drawn broken, so the break says how the line was made and nothing else.
describe("the two ways of connecting two notes", () => {
  const options = { selection: [], palette };
  const built = (nodes: readonly NodeView[]) =>
    buildModel(drawnNodes(nodes, new Set()), options);
  const drawnAs = (
    model: ReturnType<typeof buildModel>,
    kind: EdgeKind,
  ): [string, string][] => {
    const pairs: [string, string][] = [];
    model.graph.forEachEdge((_edge, attributes, source, target) => {
      if (attributes.kind === kind) pairs.push([source, target]);
    });
    return pairs;
  };
  /** A note across the tree from `1`: it sprang from `2`, so it is neither `1`'s
   *  child nor alongside it, and the only line the two can draw is the one
   *  somebody made. */
  const across = (): NodeView => {
    const sprang = note("2");
    return { ...note("2a"), parent: sprang.ref, origin: sprang.ref };
  };

  // A `[[` in the writing, which the server derived onto the note, against the
  // same pair joined by hand instead.
  it("tells a note's own words apart from a line somebody drew", () => {
    const from = note("1");
    const cited = across();
    const writing = built([{ ...from, references: [cited.ref] }, cited]);
    expect(drawnAs(writing, "reference")).toEqual([[from.ref, cited.ref]]);
    expect(drawnAs(writing, "link")).toEqual([]);

    const hand = built([{ ...from, links: [cited.ref] }, cited]);
    expect(drawnAs(hand, "link")).toEqual([[from.ref, cited.ref]]);
    expect(drawnAs(hand, "reference")).toEqual([]);
  });

  // The words went, so the derivation went with them.
  it("draws none once the words that named it are gone", () => {
    const from = note("1");
    const cited = across();
    expect(
      drawnAs(built([{ ...from, references: [] }, cited]), "reference"),
    ).toEqual([]);
  });

  it("reads an absent derivation as naming nothing", () => {
    const from = note("1");
    const cited = across();
    expect(from).not.toHaveProperty("references");
    expect(drawnAs(built([from, cited]), "reference")).toEqual([]);
  });

  // A pair is drawn once, as the strongest thing true of it, and the hand leads:
  // somebody reached for the menu and asked for a line, so the act has an answer
  // on the surface it was made on.
  it("draws a pair connected both ways as the line the hand made", () => {
    const from = note("1");
    const to = across();
    const both = built([
      { ...from, links: [to.ref], references: [to.ref] },
      to,
    ]);
    expect(drawnAs(both, "link")).toEqual([[from.ref, to.ref]]);
    expect(drawnAs(both, "reference")).toEqual([]);

    // Each way still ends independently: take the hand's away and the line the
    // writing makes is left, drawn whole.
    const written = built([{ ...from, references: [to.ref] }, to]);
    expect(drawnAs(written, "reference")).toEqual([[from.ref, to.ref]]);
  });

  // A note naming itself is not an edge — the server does not derive one, and
  // nothing here would draw one either.
  it("draws none from a note to itself", () => {
    const alone = note("1");
    expect(
      drawnAs(built([{ ...alone, references: [alone.ref] }]), "reference"),
    ).toEqual([]);
  });

  // Writing about the note a thought sprang from is ordinary Zettelkasten, and
  // there the citation is the rarer fact — so it takes the line from parentage.
  // How far apart the two sit is still the genealogy's to say.
  it("takes a parent's line without moving it", () => {
    const parent = note("1");
    const child = { ...note("1a"), parent: parent.ref, origin: parent.ref };
    const bare = built([parent, child]);
    const apart = bare.graph.getEdgeAttribute(
      bare.graph.undirectedEdge(parent.ref, child.ref),
      "distance",
    );

    for (const [kind, citing] of [
      ["reference", built([parent, { ...child, references: [parent.ref] }])],
      ["reference", built([{ ...parent, references: [child.ref] }, child])],
      ["link", built([parent, { ...child, links: [parent.ref] }])],
    ] as const) {
      expect(drawnAs(citing, kind)).toEqual([[parent.ref, child.ref]]);
      expect(
        citing.graph.getEdgeAttribute(
          citing.graph.undirectedEdge(parent.ref, child.ref),
          "distance",
        ),
      ).toBe(apart);
    }
  });

  // Nobody draws on the canvas by typing `[[1a]]` in `1b`: the two are already
  // joined by the line a reader walks, and trading that for a line that reads
  // like any citation across the tree would make the run patchy exactly where a
  // train of thought carries itself forward.
  it("leaves the run the line it is where the writing names the next note", () => {
    const first = note("1");
    const second = note("2");
    const bare = built([first, second]);
    const apart = bare.graph.getEdgeAttribute(
      bare.graph.undirectedEdge(first.ref, second.ref),
      "distance",
    );

    const citing = built([{ ...first, references: [second.ref] }, second]);
    expect(drawnAs(citing, "run")).toEqual([[first.ref, second.ref]]);
    expect(drawnAs(citing, "reference")).toEqual([]);
    expect(
      citing.graph.getEdgeAttribute(
        citing.graph.undirectedEdge(first.ref, second.ref),
        "distance",
      ),
    ).toBe(apart);
  });
});

/** A root of the corpus owner's, addressed by hand. */
function note(address: string, graph?: OwnedRef): NodeView {
  const ref =
    `${corpus.owner}/${graph ? `${graph}|` : ""}${address}` as OwnedRef;
  return {
    ref,
    created_by: corpus.owner,
    ...(graph ? { graph } : {}),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address: address as Address,
    depth: addressDepth(address as Address),
    origin: ref,
    title: address,
    tags: [],
    links: [],
    published: false,
  };
}

describe("carrying positions across an update", () => {
  it("leaves a node that was already drawn where it was", () => {
    const keep = new Map(
      drawn.slice(0, 10).map((entry) => [entry.node.ref, { x: 7, y: -3 }]),
    );
    const model = buildModel(drawn, { selection: [], palette, keep });
    for (const [ref] of keep) {
      const node = model.graph.getNodeAttributes(ref);
      expect([node.x, node.y]).toEqual([7, -3]);
    }
    const fresh = model.graph.getNodeAttributes(drawn[20].node.ref);
    expect([fresh.x, fresh.y]).not.toEqual([7, -3]);
  });

  const plain = buildModel(drawn, { selection: [], palette });
  const underOne = drawn.find(
    (entry) =>
      entry.node.parent !== undefined && plain.graph.hasNode(entry.node.parent),
  );
  const child = underOne?.node;
  const parent = child?.parent as OwnedRef;

  it("puts a node back beside the parent it was folded away from", () => {
    const moved = { x: 1234, y: -567 };
    const model = buildModel(drawn, {
      selection: [],
      palette,
      keep: new Map([[parent, moved]]),
    });
    const back = model.graph.getNodeAttributes(child!.ref);
    const step = plain.graph.getNodeAttributes(parent);
    expect(back.x).toBeCloseTo(moved.x + back.anchorX - step.anchorX, 6);
    expect(back.y).toBeCloseTo(moved.y + back.anchorY - step.anchorY, 6);
  });

  it("carries the offset down a branch, not just to the first child", () => {
    const under = drawn.find(
      (entry) =>
        entry.node.parent === child?.ref && plain.graph.hasNode(entry.node.ref),
    );
    if (!under) throw new Error("nothing was drawn under that note");
    const moved = { x: -800, y: 400 };
    const model = buildModel(drawn, {
      selection: [],
      palette,
      keep: new Map([[parent, moved]]),
    });
    const back = model.graph.getNodeAttributes(under.node.ref);
    const step = plain.graph.getNodeAttributes(parent);
    expect(back.x).toBeCloseTo(moved.x + back.anchorX - step.anchorX, 6);
    expect(back.y).toBeCloseTo(moved.y + back.anchorY - step.anchorY, 6);
  });

  // The seeds are what a peer agrees with, so what one reader's session did to
  // the picture must not reach them.
  it("leaves every seed where the tree put it", () => {
    const model = buildModel(drawn, {
      selection: [],
      palette,
      keep: new Map([[parent, { x: 1234, y: -567 }]]),
    });
    for (const ref of plain.order) {
      const was = plain.graph.getNodeAttributes(ref);
      const now = model.graph.getNodeAttributes(ref);
      expect([now.anchorX, now.anchorY]).toEqual([was.anchorX, was.anchorY]);
    }
  });
});

describe("the look a note's author gave it", () => {
  const styled = (address: string, appearance: NodeAppearance): DrawnNode => ({
    node: { ...note(address), appearance },
    collapsed: false,
    folded: 0,
    tags: [],
  });

  const plain = (address: string, folded = 0): DrawnNode => ({
    node: note(address),
    collapsed: folded > 0,
    folded,
    tags: [],
  });

  const radiusOf = (entries: DrawnNode[]): number => {
    const model = buildModel(entries, { selection: [], palette });
    return model.graph.getNodeAttributes(entries[0].node.ref).radius;
  };

  const markOf = (entry: DrawnNode) => {
    const model = buildModel([entry], { selection: [], palette });
    return model.graph.getNodeAttributes(model.order[0]);
  };

  it("draws nothing of its own for a note nobody styled", () => {
    const mark = markOf(plain("1"));
    expect(mark.ringWeight).toBe("none");
    expect(mark.preview.pictures).toEqual([]);
    expect(mark.previewCover).toBe(PREVIEW_COVER_MIN);
  });

  it("carries the ring and the picture its author chose", () => {
    const mark = markOf(
      styled("1", {
        ring_weight: "heavy",
        ring_style: "dashed",
        preview: "upload-1",
        preview_size: "large",
      }),
    );
    expect(mark.ringWeight).toBe("heavy");
    expect(mark.ringStyle).toBe("dashed");
    expect(mark.preview.pictures).toEqual(["upload-1"]);
    expect(mark.previewCover).toBe(PREVIEW_SIZE_COVER.large);
  });

  // The channel a slider spends. It is the same channel the steps spell, said
  // finely, so a note carrying both is drawn at the number.
  it("carries the size and the cover its author dragged to", () => {
    const mark = markOf(
      styled("1", {
        mark_radius: "small",
        mark_scale: 2.11,
        preview: "upload-1",
        preview_size: "small",
        preview_cover: PREVIEW_COVER_MAX,
      }),
    );
    expect(mark.radius).toBe(LEAF_RADIUS * 2.11);
    expect(mark.previewCover).toBe(PREVIEW_COVER_MAX);
  });

  // A number past what this build draws falls back the way a token it cannot
  // draw does: held to the range, never refused and never drawn outside it.
  it("holds a size a newer Sloppy widened past to the range it draws", () => {
    const wide = markOf(styled("1", { mark_scale: 40, preview_cover: 40 }));
    expect(wide.radius).toBe(LEAF_RADIUS * MARK_SCALE_MAX);
    expect(wide.previewCover).toBe(PREVIEW_COVER_MAX);

    const narrow = markOf(styled("1", { mark_scale: 0, preview_cover: 0 }));
    expect(narrow.radius).toBe(LEAF_RADIUS * MARK_SCALE_MIN);
    expect(narrow.previewCover).toBe(PREVIEW_COVER_MIN);
  });

  // `appearance.ts` bounds a look by shape rather than by vocabulary, so one
  // written on a newer Sloppy is stored and handed back untouched — and drawn
  // here as the note reads with nothing set, rather than refused or guessed at.
  it("draws a look this build has no renderer for as an unstyled note", () => {
    const mark = markOf(
      styled("1", {
        ring_weight: "engraved",
        mark_radius: "enormous",
        preview_size: "whole",
      }),
    );
    expect(mark.ringWeight).toBe("none");
    expect(mark.radius).toBe(radiusOf([plain("1")]));
    expect(mark.previewCover).toBe(PREVIEW_COVER_MIN);
  });

  // Every note already spelt in the steps keeps the mark it has: what each one
  // is worth is frozen, and the slider's ends are the ladder's own.
  it("draws a note spelt in the steps at exactly what they were worth", () => {
    for (const mark_radius of MARK_RADII) {
      expect(radiusOf([styled("1", { mark_radius })]), mark_radius).toBe(
        LEAF_RADIUS * MARK_RADIUS_SCALE[mark_radius],
      );
    }
    expect(MARK_RADIUS_SCALE.small).toBe(MARK_SCALE_MIN);
    expect(MARK_RADIUS_SCALE.giant).toBe(MARK_SCALE_MAX);
  });

  // DESIGN.md § "The mark": the ladder ascends, so a step up it is a bigger mark.
  it("draws every step of the ladder bigger than the one below it", () => {
    let below = 0;
    for (const mark_radius of MARK_RADII) {
      const drawn = radiusOf([styled("1", { mark_radius })]);
      expect(drawn, mark_radius).toBeGreaterThan(below);
      below = drawn;
    }
  });

  // The cap is the fold's and the author's step scales it, so the ladder still
  // ascends on a mega-node grown well past it — the case the control is reached
  // for, and the one a flat cap took back. DESIGN.md § "The mark".
  it("keeps the ladder ascending on a fold grown past the cap", () => {
    let below = 0;
    for (const mark_radius of MARK_RADII) {
      const drawn = radiusOf([
        { ...styled("1", { mark_radius }), collapsed: true, folded: 4000 },
      ]);
      expect(drawn, mark_radius).toBeGreaterThan(below);
      below = drawn;
    }
  });

  it("keeps a folded subtree bigger than a leaf wearing the same look", () => {
    for (const size of MARK_RADII) {
      const look = { mark_radius: size };
      const leaf = radiusOf([styled("1", look)]);
      const mega = radiusOf([
        { ...styled("1", look), collapsed: true, folded: 1 },
      ]);
      expect(mega, size).toBeGreaterThan(leaf);
      expect(leaf, size).toBeGreaterThan(0);
    }
  });

  // DESIGN.md § "The mark": a look is authored by one person on one note, and
  // forty of them do not average into a forty-first.
  it("draws a mega-node's own look, and none of the looks it folded", () => {
    const mark = markOf({
      ...styled("1", { ring_weight: "hairline" }),
      collapsed: true,
      folded: 12,
    });
    expect(mark.ringWeight).toBe("hairline");
    expect(mark.radius).toBeGreaterThan(radiusOf([plain("1")]));
  });

  // DESIGN.md § "A note's look never uses colour": the shape channels travel, so
  // a region a thinker shaped is read as they shaped it. The look arrives
  // through the wire schema, so a channel that started travelling would reach
  // the mark here.
  describe("a mark held from a peer", () => {
    const PEER = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva" as DidSyr;
    const THERE = `${PEER}/01JSPREAD00000000000000000` as OwnedRef;

    const markOf = (look: Record<string, unknown>) => {
      const arrived = PublishedNodeSchema.parse({
        ref: THERE,
        address: "1",
        origin: THERE,
        title: "1",
        tags: [],
        links: [],
        look,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      const entry: DrawnNode = {
        node: {
          ...note("1"),
          ref: THERE,
          created_by: PEER,
          origin: THERE,
          published: true,
          appearance: arrived.look,
        },
        collapsed: false,
        folded: 0,
        tags: [],
      };
      const model = buildModel([entry], {
        selection: [],
        palette,
        viewer: corpus.owner,
      });
      return model.graph.getNodeAttributes(THERE);
    };

    it("draws the shape its author gave it", () => {
      const mark = markOf({
        ring_weight: "heavy",
        ring_style: "dashed",
        mark_radius: "large",
      });

      expect(mark.provenance).toBe("pulled");
      expect(mark.ringWeight).toBe("heavy");
      expect(mark.ringStyle).toBe("dashed");
      expect(mark.radius).toBe(LEAF_RADIUS * MARK_RADIUS_SCALE.large);
    });

    it("wears no picture, the pictures on a mark staying with their author", () => {
      const mark = markOf({
        ring_weight: "hairline",
        preview: "upload-1",
        preview_more: ["upload-2"],
        preview_size: "large",
        preview_cover: PREVIEW_COVER_MAX,
      });

      expect(mark.ringWeight).toBe("hairline");
      expect(mark.preview.pictures).toEqual([]);
      expect(mark.previewCover).toBe(PREVIEW_COVER_MIN);
    });
  });
});

// DESIGN.md § "Several graphs on one canvas": what tells two graphs apart is
// where their fields sit, and every other channel on the mark stays what it was.
describe("several graphs on one canvas", () => {
  const HOME = `${corpus.owner}/00000000000000000000000000` as OwnedRef;
  const OTHER = `${corpus.owner}/00000000000000000000000002` as OwnedRef;
  const inOther = (node: NodeView): NodeView => ({
    ...node,
    ref: `${node.ref}x` as OwnedRef,
    graph: OTHER,
    ...(node.parent === undefined
      ? {}
      : { parent: `${node.parent}x` as OwnedRef }),
    origin: `${node.origin}x` as OwnedRef,
  });

  const mine = drawn.filter((entry) => entry.node.created_by === corpus.owner);
  const twin = mine.map((entry) => ({ ...entry, node: inOther(entry.node) }));
  const fields = [
    { ref: HOME, title: "Thesis" },
    { ref: OTHER, title: "Garden" },
  ];
  const options = { selection: [], palette, viewer: corpus.owner };
  const model = buildModel([...mine, ...twin], { ...options, fields });
  const alone = buildModel(mine, options);
  const twinAlone = buildModel(twin, options);

  it("keeps a note's place inside its own field, and moves the field", () => {
    const gapAt = (ref: OwnedRef) =>
      model.graph.getNodeAttributes(ref).anchorX -
      twinAlone.graph.getNodeAttributes(ref).anchorX;
    const first = inOther(mine[0].node).ref;
    for (const { node } of twin) {
      expect(model.graph.getNodeAttributes(node.ref).anchorY).toBe(
        twinAlone.graph.getNodeAttributes(node.ref).anchorY,
      );
      expect(gapAt(node.ref), node.ref).toBeCloseTo(gapAt(first), 6);
    }
    expect(gapAt(first)).toBeGreaterThan(0);
  });

  it("never lets one field's marks reach into the next", () => {
    const spanOf = (entries: readonly DrawnNode[]) => {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      for (const { node } of entries) {
        const mark = model.graph.getNodeAttributes(node.ref);
        minX = Math.min(minX, mark.anchorX - mark.radius);
        maxX = Math.max(maxX, mark.anchorX + mark.radius);
      }
      return { minX, maxX };
    };
    expect(spanOf(twin).minX).toBeGreaterThan(spanOf(mine).maxX);
  });

  it("names every field it drew, in the order it was given them", () => {
    expect(model.fields.map((field) => field.title)).toEqual([
      "Thesis",
      "Garden",
    ]);
    for (const field of model.fields) {
      expect(field.x).toBeGreaterThanOrEqual(field.minX);
      expect(field.x).toBeLessThanOrEqual(field.maxX);
    }
  });

  // The rule that keeps the channel honest: place is the only thing spent on
  // telling graphs apart, so the mark itself says exactly what it said before.
  it("draws each mark exactly as one graph alone would", () => {
    for (const { node } of mine) {
      expect(model.graph.getNodeAttributes(node.ref)).toEqual(
        alone.graph.getNodeAttributes(node.ref),
      );
    }
  });

  // One graph on the canvas answers no question a name could answer.
  it("writes no name where there is only one field", () => {
    expect(
      buildModel(mine, { ...options, fields: [fields[0]] }).fields,
    ).toEqual([]);
    expect(alone.fields).toEqual([]);
  });

  it("never runs from a branch of one graph into a branch of another", () => {
    const byRef = new Map(
      [...mine, ...twin].map((entry) => [entry.node.ref, entry.node]),
    );
    model.graph.forEachEdge((_edge, attributes, source, target) => {
      if (attributes.kind !== "run") return;
      expect(byRef.get(source as OwnedRef)?.graph).toBe(
        byRef.get(target as OwnedRef)?.graph,
      );
    });
  });

  // A ref names one note across every graph its author keeps, so a citation
  // typed into one graph and pointing into another draws wherever both ends
  // are on the canvas — docs/ARCHITECTURE.md § "Data model".
  it("draws a reference from a note in one field to a note in the next", () => {
    const here = mine[0].node;
    const away = inOther(mine[1].node);
    const across = buildModel(
      [
        { ...mine[0], node: { ...here, references: [away.ref] } },
        { ...twin[1], node: away },
      ],
      { ...options, fields },
    );
    const drawn: [string, string][] = [];
    across.graph.forEachEdge((_edge, attributes, source, target) => {
      if (attributes.kind === "reference") drawn.push([source, target]);
    });
    expect(drawn).toEqual([[here.ref, away.ref]]);
  });
});

// DESIGN.md § "The mark": what a picture is stored at and what a mark decodes it
// to are two budgets. Confusing them is what makes a picture go permanently
// soft, or a phone hold a mega-node's pixels for every leaf on the field.
describe("the two budgets a picture is cut against", () => {
  it("stores enough for the largest mark a look could ever become", () => {
    for (const size of PREVIEW_SIZES) {
      expect(
        markPictureSide(WIDEST_RADIUS, PREVIEW_SIZE_COVER[size]),
        size,
      ).toBeLessThanOrEqual(MARK_PICTURE_PX);
    }
    expect(markPictureSide(WIDEST_RADIUS, PREVIEW_COVER_MAX)).toBe(
      MARK_PICTURE_PX,
    );
  });

  it("decodes a leaf at a fraction of a percent of what it stores", () => {
    const leaf = markPictureSide(
      LEAF_RADIUS * MARK_SCALE_MIN,
      PREVIEW_COVER_MIN,
    );
    // Squared, because a texture costs the square of its side.
    expect((leaf / MARK_PICTURE_PX) ** 2).toBeLessThan(0.01);
  });

  // The cut is per mark and not per look, so covering a leaf's whole face is
  // still nothing beside what the widest mark on the field decodes.
  it("decodes a leaf at full cover for a leaf, not for a mega-node", () => {
    const leaf = markPictureSide(LEAF_RADIUS, PREVIEW_COVER_MAX);
    expect((leaf / MARK_PICTURE_PX) ** 2).toBeLessThan(0.02);
  });

  it("cuts marks a hair apart in size to one texture", () => {
    expect(markPictureSide(20, PREVIEW_COVER_MIN)).toBe(
      markPictureSide(21, PREVIEW_COVER_MIN),
    );
  });

  // The screen is the other half of what a mark shows: a plain display draws the
  // same mark in a ninth of the device pixels a dense one at full zoom does, and
  // decoding for the dense one there is a phone's memory spent on nobody.
  it("decodes for the screen it is drawn on, and stores for the densest", () => {
    for (const radius of [LEAF_RADIUS, 20, WIDEST_RADIUS]) {
      const plain = markPictureSide(radius, PREVIEW_COVER_MIN, 1);
      const dense = markPictureSide(radius, PREVIEW_COVER_MIN, MAX_DENSITY);
      expect(plain, `${radius}`).toBeLessThan(dense);
      expect(markPictureSide(radius, PREVIEW_COVER_MIN), `${radius}`).toBe(
        dense,
      );
    }
    expect(markPictureSide(WIDEST_RADIUS, PREVIEW_COVER_MAX, 1)).toBeLessThan(
      MARK_PICTURE_PX,
    );
  });

  it("grows the cut with the mark, up to what it stores", () => {
    let below = 0;
    for (const step of MARK_RADII) {
      const cut = markPictureSide(
        WIDEST_RADIUS * MARK_RADIUS_SCALE[step],
        PREVIEW_COVER_MIN,
      );
      expect(cut, step).toBeGreaterThanOrEqual(below);
      expect(cut, step).toBeLessThanOrEqual(MARK_PICTURE_PX);
      below = cut;
    }
  });
});

// DESIGN.md § Edges, "A look a person set": a look draws on the line that is
// already there, and it moves nothing.
describe("a look set on a line", () => {
  const options = { selection: [], palette };
  const parent = note("1");
  const child = { ...note("1a"), parent: parent.ref, origin: parent.ref };
  const built = (edgeLooks?: readonly GraphEdgeLook[]) =>
    buildModel(drawnNodes([parent, child], new Set()), {
      ...options,
      ...(edgeLooks === undefined ? {} : { edgeLooks }),
    });
  const lookOn = (model: ReturnType<typeof buildModel>) =>
    model.graph.getEdgeAttribute(
      model.graph.undirectedEdge(parent.ref, child.ref) as string,
      "look",
    );

  it("reaches the line whichever way round the pair is named", () => {
    const named: GraphEdgeLook = {
      from: child.ref,
      to: parent.ref,
      label: "grew from",
    };
    expect(lookOn(built([named]))).toEqual(named);
    const back: GraphEdgeLook = {
      from: parent.ref,
      to: child.ref,
      stroke: "dotted",
    };
    expect(lookOn(built([back]))).toEqual(back);
  });

  it("leaves every line alone where nobody set one", () => {
    expect(lookOn(built())).toBeUndefined();
    expect(lookOn(built([]))).toBeUndefined();
  });

  // It makes no line: carrying one joins two notes to nothing.
  it("draws nothing on a pair with no line between them", () => {
    const apart = note("2");
    const stranger = { ...note("2a"), parent: apart.ref, origin: apart.ref };
    const model = buildModel(drawnNodes([parent, stranger], new Set()), {
      ...options,
      edgeLooks: [{ from: parent.ref, to: stranger.ref, label: "about" }],
    });
    expect(
      model.graph.undirectedEdge(parent.ref, stranger.ref),
    ).toBeUndefined();
    model.graph.forEachEdge((_edge, attributes) => {
      expect(attributes.look).toBeUndefined();
    });
  });

  // A look is on the same footing as `appearance`: how a thing is drawn, never
  // where — AI.md § "The Genealogy Is the Protocol".
  it("moves no mark and changes no distance", () => {
    const plain = built();
    const looked = built([
      { from: parent.ref, to: child.ref, stroke: "dashed", label: "why" },
    ]);
    for (const ref of [parent.ref, child.ref]) {
      const before = plain.graph.getNodeAttributes(ref);
      const after = looked.graph.getNodeAttributes(ref);
      expect([
        after.x,
        after.y,
        after.anchorX,
        after.anchorY,
        after.radius,
      ]).toEqual([
        before.x,
        before.y,
        before.anchorX,
        before.anchorY,
        before.radius,
      ]);
    }
    const distance = (model: ReturnType<typeof buildModel>) =>
      model.graph.getEdgeAttribute(
        model.graph.undirectedEdge(parent.ref, child.ref) as string,
        "distance",
      );
    expect(distance(looked)).toBe(distance(plain));
  });
});
