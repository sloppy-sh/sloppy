import {
  type Address,
  addressDepth,
  assignTagHueSlots,
  MARK_RADII,
  type NodeAppearance,
  type NodeView,
  type OwnedRef,
  PREVIEW_SIZES,
  type PreviewSize,
  siblingAddress,
  type Tag,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { type DrawnNode, drawnNodes } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { applyLod } from "./lod.js";
import {
  buildModel,
  LEAF_RADIUS,
  LOOK_SCALE,
  lookPicturePx,
  markPicturePx,
  MAX_MARK_PICTURE_PX,
  MAX_MARK_RADIUS,
  MAX_RADIUS,
  PREVIEW_SPAN,
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

  it("draws a genealogical edge only where both ends are drawn", () => {
    const present = new Set(model.order);
    let expected = 0;
    for (const { node } of drawn) {
      if (node.parent !== undefined && present.has(node.parent)) expected += 1;
    }
    let found = 0;
    model.graph.forEachEdge((_e, attributes) => {
      if (attributes.kind === "genealogy") found += 1;
    });
    expect(found).toBe(expected);
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
      expect(node.alpha).toBe(palette.unselectedAlpha);
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

// AI.md § "The Address Is the Protocol": the run between two notes is a
// function of their addresses, so the model derives it and no row carries it.
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
    const byAddress = new Map(
      drawn.map((entry) => [
        `${entry.node.created_by}|${entry.node.address}`,
        entry.node,
      ]),
    );
    let joined = 0;
    for (const { node } of drawn) {
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

  // DESIGN.md § Edges: where somebody has connected two notes already along a
  // run, the connection wins and the line is dashed.
  it("gives way to a connection somebody made along it", () => {
    const first = note("1");
    const second = note("2");
    const drew = buildModel(
      drawnNodes([{ ...first, links: [second.ref] }, second], new Set()),
      { selection: [], palette },
    );
    expect(drew.graph.getEdgeAttributes(first.ref, second.ref).kind).toBe(
      "connection",
    );
    expect(runsOf(drew)).toEqual([]);
  });
});

// DESIGN.md § Edges: a note carries both ways of connecting, and the canvas
// draws their union as one line.
describe("what a connection is drawn from", () => {
  const options = { selection: [], palette };
  const built = (nodes: readonly NodeView[]) =>
    buildModel(drawnNodes(nodes, new Set()), options);
  const connections = (model: ReturnType<typeof buildModel>) => {
    const pairs: [string, string][] = [];
    model.graph.forEachEdge((_edge, attributes, source, target) => {
      if (attributes.kind === "connection") pairs.push([source, target]);
    });
    return pairs;
  };

  // A `[[` in the writing, which the server derived onto the note.
  it("draws one for a note the writing names", () => {
    const from = note("1");
    const cited = note("2a");
    expect(
      connections(built([{ ...from, references: [cited.ref] }, cited])),
    ).toEqual([[from.ref, cited.ref]]);
  });

  // The words went, so the derivation went with them.
  it("draws none once the words that named it are gone", () => {
    const from = note("1");
    const cited = note("2a");
    expect(connections(built([{ ...from, references: [] }, cited]))).toEqual(
      [],
    );
  });

  it("reads an absent derivation as naming nothing", () => {
    const from = note("1");
    const cited = note("2a");
    expect(from).not.toHaveProperty("references");
    expect(connections(built([from, cited]))).toEqual([]);
  });

  // Each way of connecting is independent of the other, so taking one away
  // leaves the line.
  it("draws one line for a pair connected both ways", () => {
    const from = note("1");
    const to = note("2a");
    const both = built([
      { ...from, links: [to.ref], references: [to.ref] },
      to,
    ]);
    expect(connections(both)).toEqual([[from.ref, to.ref]]);
    expect(
      connections(built([{ ...from, links: [to.ref], references: [] }, to])),
    ).toEqual([[from.ref, to.ref]]);
  });

  // A note naming itself is not an edge — the server does not derive one, and
  // nothing here would draw one either.
  it("draws none from a note to itself", () => {
    const alone = note("1");
    expect(connections(built([{ ...alone, references: [alone.ref] }]))).toEqual(
      [],
    );
  });

  // Writing about the note a thought sprang from is ordinary Zettelkasten, so
  // the line is drawn — but how far apart the two sit is the addresses' to say.
  it("draws a connection to a parent without moving it", () => {
    const parent = note("1");
    const child = { ...note("1a"), parent: parent.ref, origin: parent.ref };
    const bare = built([parent, child]);
    const apart = bare.graph.getEdgeAttribute(
      bare.graph.undirectedEdge(parent.ref, child.ref),
      "distance",
    );

    for (const citing of [
      built([parent, { ...child, references: [parent.ref] }]),
      built([{ ...parent, references: [child.ref] }, child]),
      built([parent, { ...child, links: [parent.ref] }]),
    ]) {
      expect(connections(citing)).toEqual([[parent.ref, child.ref]]);
      expect(
        citing.graph.getEdgeAttribute(
          citing.graph.undirectedEdge(parent.ref, child.ref),
          "distance",
        ),
      ).toBe(apart);
    }
  });

  // The same holds along the run, where the gap is the seeds' own.
  it("draws a connection along a run without moving it", () => {
    const first = note("1");
    const second = note("2");
    const bare = built([first, second]);
    const apart = bare.graph.getEdgeAttribute(
      bare.graph.undirectedEdge(first.ref, second.ref),
      "distance",
    );

    const citing = built([{ ...first, references: [second.ref] }, second]);
    expect(connections(citing)).toEqual([[first.ref, second.ref]]);
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
    expect(mark.preview).toBeUndefined();
    expect(mark.previewSize).toBe("small");
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
    expect(mark.preview).toBe("upload-1");
    expect(mark.previewSize).toBe("large");
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
    expect(mark.previewSize).toBe("small");
  });

  // DESIGN.md § "The mark": the cap is the fold's and the author spends theirs
  // on top of it, so a step up the ladder draws bigger at every fold — the ones
  // whose growth is already at the cap included.
  it("draws every step of the ladder bigger than the one below it", () => {
    for (const folded of [0, 1, 20, 103, 900, 7000]) {
      let below = 0;
      for (const mark_radius of MARK_RADII) {
        const drawn = radiusOf([
          {
            ...styled("1", { mark_radius }),
            collapsed: folded > 0,
            folded,
          },
        ]);
        expect(drawn, `${mark_radius} at ${folded}`).toBeGreaterThan(below);
        below = drawn;
      }
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

  // DESIGN.md § "The mark": the cut follows the mark that wears the picture, so
  // a leaf never holds what the top of the ladder needs.
  describe("the square its picture is cut to", () => {
    /** Picture pixels one world unit of a mark's imagery is worth, read off the
     *  largest cut rather than restating the arithmetic under test. */
    const perWorldUnit =
      MAX_MARK_PICTURE_PX / (MAX_MARK_RADIUS * PREVIEW_SPAN.large * 2);
    const shown = (radius: number, size: PreviewSize): number =>
      radius * PREVIEW_SPAN[size] * 2 * perWorldUnit;

    const radii = [
      LEAF_RADIUS * LOOK_SCALE.small,
      LEAF_RADIUS,
      20,
      MAX_RADIUS,
      MAX_MARK_RADIUS,
    ];

    it("covers every pixel the mark draws, and never twice as many", () => {
      for (const radius of radii) {
        for (const size of PREVIEW_SIZES) {
          const cut = markPicturePx(radius, size);
          const draws = shown(radius, size);
          expect(cut, `${radius} ${size}`).toBeGreaterThanOrEqual(draws);
          expect(cut, `${radius} ${size}`).toBeLessThanOrEqual(draws * 2);
        }
      }
    });

    it("costs the smallest mark under a hundredth of the largest one", () => {
      const leaf = markPicturePx(LEAF_RADIUS * LOOK_SCALE.small, "small");
      expect((leaf / MAX_MARK_PICTURE_PX) ** 2).toBeLessThan(0.01);
      expect(markPicturePx(MAX_MARK_RADIUS, "large")).toBe(MAX_MARK_PICTURE_PX);
    });

    it("grows with every step of both ladders", () => {
      for (const size of PREVIEW_SIZES) {
        let below = 0;
        for (const mark_radius of MARK_RADII) {
          const cut = lookPicturePx(mark_radius, size);
          expect(cut, `${mark_radius} ${size}`).toBeGreaterThan(below);
          below = cut;
        }
      }
      for (const mark_radius of MARK_RADII) {
        let below = 0;
        for (const size of PREVIEW_SIZES) {
          const cut = lookPicturePx(mark_radius, size);
          expect(cut, `${mark_radius} ${size}`).toBeGreaterThan(below);
          below = cut;
        }
      }
    });

    // A picture is chosen on a note that may fold a subtree later, so what it is
    // stored at has to cover that note's own mark at every fold it can reach.
    it("stores enough for the note's own mark however much folds under it", () => {
      for (const mark_radius of MARK_RADII) {
        for (const size of PREVIEW_SIZES) {
          for (const folded of [0, 1, 20, 900, 90_000]) {
            const radius = radiusOf([
              {
                ...styled("1", { mark_radius }),
                collapsed: folded > 0,
                folded,
              },
            ]);
            expect(
              markPicturePx(radius, size),
              `${mark_radius} ${size} at ${folded}`,
            ).toBeLessThanOrEqual(lookPicturePx(mark_radius, size));
          }
        }
      }
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

  const gapAt = (node: NodeView) =>
    model.graph.getNodeAttributes(inOther(node).ref).anchorX -
    model.graph.getNodeAttributes(node.ref).anchorX;

  it("keeps a note's place inside its own field, and moves the field", () => {
    for (const { node } of mine) {
      const here = model.graph.getNodeAttributes(node.ref);
      const there = model.graph.getNodeAttributes(inOther(node).ref);
      expect(there.anchorY).toBe(here.anchorY);
      expect(gapAt(node)).toBeCloseTo(gapAt(mine[0].node), 6);
    }
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
  it("draws a connection from a note in one field to a note in the next", () => {
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
      if (attributes.kind === "connection") drawn.push([source, target]);
    });
    expect(drawn).toEqual([[here.ref, away.ref]]);
  });
});
