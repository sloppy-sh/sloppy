import {
  assignTagHueSlots,
  type NodeView,
  type OwnedRef,
  type Tag,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { drawnNodes } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { applyLod } from "./lod.js";
import { buildModel } from "./model.js";
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
