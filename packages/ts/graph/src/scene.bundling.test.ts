// DESIGN.md § Edges, "Bundled along the tree" and "Lines into a folded branch":
// what the canvas strokes for a hand link once it is routed along the tree, and
// for the hand links a fold stands in for. The geometry is `bundling.test.ts`'s.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import {
  drawnNodes,
  type GraphEdgeLook,
  type GraphHiddenLines,
} from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeGraphics,
  FakeText,
  type StrokedLine,
  worldOf,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene, carriedCaption, carriedWeight } = await import(
  "./scene.js"
);

const OWNER = "did:syr:someone";
const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc"],
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

const under = (address: string, parent: string, over: Partial<NodeView> = {}) =>
  note(address, { parent: ref(parent), origin: ref(parent), ...over });

/** Where each mark stands, by address — a root over two branches, wide apart. */
const PLACES: Record<string, [number, number]> = {
  "1": [0, 0],
  "1a": [-400, 300],
  "1b": [400, 300],
  "1a1": [-500, 700],
  "1b1": [500, 700],
  "2": [900, 0],
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, at): [string, [number, number]] => [
      String(3 + at),
      [2000 + 150 * at, 2000 + 40 * (at % 2)],
    ]),
  ),
};

/** Nine notes each linked by hand to every other, far from the tree: enough to
 *  make any field here dense — DESIGN.md § "A dense field recedes around the
 *  note in hand". */
const crowd = (): NodeView[] => {
  const names = Array.from({ length: 9 }, (_, at) => String(3 + at));
  return names.map((name, at) =>
    note(name, { links: names.slice(at + 1).map(ref) }),
  );
};

const tree = (links: Record<string, string[]> = {}): NodeView[] =>
  [
    note("1"),
    under("1a", "1"),
    under("1b", "1"),
    under("1a1", "1a"),
    under("1b1", "1b"),
  ].map((node) => ({
    ...node,
    links: (links[node.address ?? ""] ?? []).map(ref),
  }));

async function canvasOn(
  nodes: readonly NodeView[],
  collapsed: ReadonlySet<OwnedRef> = new Set(),
  edgeLooks: readonly GraphEdgeLook[] = [],
  hidden?: GraphHiddenLines,
) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", heading: "heading", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setHiddenLines(hidden);
  const model = buildModel(drawnNodes(nodes, collapsed), {
    selection: [],
    palette,
    folds: { nodes, collapsed },
    edgeLooks,
  });
  scene.setModel(model, false);
  const place = (settled = true) =>
    scene.setPositions(
      Float32Array.from(
        model.order.flatMap((at) => PLACES[at.slice(OWNER.length + 1)]),
      ),
      settled,
    );
  place();
  scene.fit();
  app.tick();
  const [, , genealogy, runs, connections] = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return { scene, app, place, passes: { genealogy, runs, connections } };
}

/** How far a stroked piece strays off the straight line between two places. */
function offChord(line: StrokedLine, [fx, fy]: number[], [tx, ty]: number[]) {
  const span = Math.hypot(tx - fx, ty - fy);
  return Math.max(
    ...[line.from, line.to].map(
      ([x, y]) => Math.abs((tx - fx) * (fy - y) - (fx - x) * (ty - fy)) / span,
    ),
  );
}

const furthest = (lines: readonly StrokedLine[]) =>
  Math.max(
    ...lines.map((line) => offChord(line, PLACES["1a1"], PLACES["1b1"])),
  );

const copy = (lines: readonly StrokedLine[]) =>
  lines.map((line) => ({ ...line, from: [...line.from], to: [...line.to] }));

function writtenOn(app: FakeApplication): string[] {
  return app.stage.children
    .flatMap((child: FakeContainer) => child.children)
    .filter((kid): kid is FakeText => kid instanceof FakeText && kid.visible)
    .map((kid) => kid.text);
}

describe("a hand link bundled along the tree", () => {
  it("is drawn straight while bundling is off", async () => {
    const { scene, passes } = await canvasOn(tree({ "1a1": ["1b1"] }));
    expect(passes.connections.lines.length).toBeGreaterThan(1);
    expect(furthest(passes.connections.lines)).toBeLessThan(1e-3);
    scene.destroy();
  });

  it("runs up toward the ancestor the two share once it is on", async () => {
    const { scene, app, passes } = await canvasOn(tree({ "1a1": ["1b1"] }));
    scene.setBundling(1);
    app.tick();
    expect(furthest(passes.connections.lines)).toBeGreaterThan(200);
    // Still broken: a hand made it.
    expect(passes.connections.lines.length).toBeGreaterThan(2);
    scene.destroy();
  });

  it("bends less as it is loosened", async () => {
    const { scene, app, passes } = await canvasOn(tree({ "1a1": ["1b1"] }));
    scene.setBundling(1);
    app.tick();
    const tight = furthest(passes.connections.lines);
    scene.setBundling(0.3);
    app.tick();
    const loose = furthest(passes.connections.lines);
    expect(loose).toBeGreaterThan(20);
    expect(loose).toBeLessThan(tight);
    scene.destroy();
  });

  it("draws exactly what it drew before once it is turned off again", async () => {
    const { scene, app, passes } = await canvasOn(tree({ "1a1": ["1b1"] }));
    const before = copy(passes.connections.lines);
    scene.setBundling(0.85);
    app.tick();
    scene.setBundling(null);
    app.tick();
    expect(copy(passes.connections.lines)).toEqual(before);
    scene.destroy();
  });

  it("leaves the tree's own lines straight", async () => {
    const { scene, app, passes } = await canvasOn(tree({ "1a1": ["1b1"] }));
    const genealogy = copy(passes.genealogy.lines);
    scene.setBundling(1);
    app.tick();
    expect(copy(passes.genealogy.lines)).toEqual(genealogy);
    scene.destroy();
  });

  it("is drawn straight while the field is still settling", async () => {
    const { scene, app, place, passes } = await canvasOn(
      tree({ "1a1": ["1b1"] }),
    );
    scene.setBundling(1);
    place(false);
    app.tick();
    expect(furthest(passes.connections.lines)).toBeLessThan(1e-3);
    place(true);
    app.tick();
    expect(furthest(passes.connections.lines)).toBeGreaterThan(200);
    scene.destroy();
  });

  it("writes a line's words at the middle of the curve it is drawn as", async () => {
    const { scene, app } = await canvasOn(tree({ "1a1": ["1b1"] }), new Set(), [
      { from: ref("1a1"), to: ref("1b1"), label: "why" },
    ]);
    const wordsAt = () => {
      const words = app.stage.children
        .flatMap((child: FakeContainer) => child.children)
        .find(
          (kid): kid is FakeText =>
            kid instanceof FakeText && kid.visible && kid.text === "why",
        );
      if (!words) throw new Error("The line carries no words");
      return scene.viewport.toWorld(words.x, words.y);
    };
    expect(wordsAt().y).toBeGreaterThan(600);
    scene.setBundling(1);
    app.tick();
    expect(wordsAt().y).toBeLessThan(400);
    scene.destroy();
  });

  it("answers a tap on the curve rather than on the straight line", async () => {
    const { scene, app, passes } = await canvasOn(tree({ "1a1": ["1b1"] }));
    scene.setBundling(1);
    app.tick();
    const middle = passes.connections.lines.reduce((best, line) =>
      offChord(line, PLACES["1a1"], PLACES["1b1"]) >
      offChord(best, PLACES["1a1"], PLACES["1b1"])
        ? line
        : best,
    );
    const [x, y] = middle.from;
    expect(scene.hitEdge({ x, y })).toEqual([ref("1a1"), ref("1b1")]);
    expect(scene.hitEdge({ x: 0, y: 700 })).toBeNull();
    scene.destroy();
  });
});

describe("hand links into a folded branch", () => {
  const field = (): NodeView[] => [
    note("1"),
    under("1a", "1"),
    under("1a1", "1a", { links: [ref("2")] }),
    under("1b1", "1a", { links: [ref("2")] }),
    under("1b", "1", { links: [ref("2")] }),
    note("2"),
  ];

  it("draws them as one line, heavier than one, captioned with the count", async () => {
    const folded = await canvasOn(field(), new Set([ref("1a")]));
    const opened = await canvasOn(field());
    // `1b`'s own link to `2` stands beside the two that `1a` folded.
    const widths = [
      ...new Set(folded.passes.connections.lines.map((line) => line.width)),
    ].sort((x, y) => x - y);
    expect(widths).toHaveLength(2);
    expect(widths[1] / widths[0]).toBeCloseTo(carriedWeight(2), 5);
    expect(writtenOn(folded.app)).toContain("2 lines");
    expect(writtenOn(opened.app)).not.toContain("2 lines");
    folded.scene.destroy();
    opened.scene.destroy();
  });

  it("is still a hand's line: broken, and in a hand link's ink", async () => {
    const folded = await canvasOn(field(), new Set([ref("1a")]));
    const lines = folded.passes.connections.lines;
    expect(lines.length).toBeGreaterThan(2);
    expect(
      new Set(lines.map((line) => `${line.color}:${line.alpha}`)).size,
    ).toBe(1);
    folded.scene.destroy();
  });
});

describe("the weight and words of a line standing for several", () => {
  it("steps its weight with the count, and never down", () => {
    expect(carriedWeight(1)).toBe(1);
    const steps = [1, 2, 4, 5, 9, 10, 500].map(carriedWeight);
    for (let at = 1; at < steps.length; at++) {
      expect(steps[at]).toBeGreaterThanOrEqual(steps[at - 1]);
    }
    expect(new Set(steps).size).toBe(4);
  });

  it("says how many lines it is, and nothing for one", () => {
    expect(carriedCaption(7)).toBe("7 lines");
    expect(carriedCaption(1)).toBeUndefined();
  });
});

// DESIGN.md § Edges, "How the four compose".
describe("turning off, receding, bundling and folding together", () => {
  const off = (...labels: string[]): GraphHiddenLines => ({
    kinds: new Set(),
    labels: new Set(labels),
  });
  /** The pieces stroked near the tree, leaving the crowd out. */
  const nearTree = (lines: readonly StrokedLine[]) =>
    lines.filter((line) => line.from[1] < 1000 && line.to[1] < 1000);

  it("neither draws, bundles nor answers a tap for a relation turned off", async () => {
    const { scene, app, passes } = await canvasOn(
      tree({ "1a1": ["1b1"] }),
      new Set(),
      [{ from: ref("1a1"), to: ref("1b1"), label: "uses" }],
      off("uses"),
    );
    scene.setBundling(1);
    app.tick();
    expect(passes.connections.lines).toHaveLength(0);
    expect(writtenOn(app)).not.toContain("uses");
    expect(scene.hitEdge({ x: 0, y: 700 })).toBeNull();
    scene.setHiddenLines(undefined);
    app.tick();
    expect(furthest(passes.connections.lines)).toBeGreaterThan(200);
    scene.destroy();
  });

  it("recedes a bundled hand link on a dense field, and strikes it whole and curved when its end is in hand", async () => {
    const { scene, app, passes } = await canvasOn([
      ...tree({ "1a1": ["1b1"] }),
      ...crowd(),
    ]);
    scene.setBundling(1);
    app.tick();
    const quiet = nearTree(passes.connections.lines);
    expect(new Set(quiet.map((line) => line.alpha))).toEqual(
      new Set([palette.connectionAlphaWhileSelecting]),
    );
    expect(furthest(quiet)).toBeGreaterThan(200);

    scene.setReading({ open: new Set([ref("1a1")]), active: ref("1a1") });
    app.tick();
    const struck = nearTree(passes.connections.lines).filter(
      (line) => line.alpha === palette.readingAlpha,
    );
    expect(struck.length).toBeGreaterThan(2);
    expect(furthest(struck)).toBeGreaterThan(200);

    scene.setReading(null);
    scene.setPointed(ref("1b1"));
    app.tick();
    const pointed = nearTree(passes.connections.lines);
    expect(new Set(pointed.map((line) => line.alpha))).toEqual(
      new Set([palette.readingAlpha]),
    );
    expect(furthest(pointed)).toBeGreaterThan(200);
    scene.destroy();
  });

  describe("into a folded branch", () => {
    const field = (): NodeView[] => [
      note("1"),
      under("1a", "1"),
      under("1a1", "1a", { links: [ref("2")] }),
      under("1b1", "1a", { links: [ref("2")] }),
      under("1b", "1", { links: [ref("2")] }),
      note("2"),
    ];
    const looks: GraphEdgeLook[] = [
      { from: ref("1a1"), to: ref("2"), label: "uses" },
      { from: ref("1b1"), to: ref("2"), label: "used by" },
    ];
    const folded = new Set([ref("1a")]);
    const widths = (lines: readonly StrokedLine[]) =>
      [...new Set(lines.map((line) => line.width))].sort((x, y) => x - y);

    it("drops a relation turned off out of the count, and the cord with its last line", async () => {
      const all = await canvasOn(field(), folded, looks);
      expect(writtenOn(all.app)).toContain("2 lines");

      const one = await canvasOn(field(), folded, looks, off("uses"));
      expect(writtenOn(one.app)).not.toContain("2 lines");
      // Standing for one, the cord is as heavy as `1b`'s own link beside it.
      expect(widths(one.passes.connections.lines)).toHaveLength(1);

      const none = await canvasOn(
        field(),
        folded,
        looks,
        off("uses", "used by"),
      );
      const plain = await canvasOn(
        field().map((node) =>
          node.address === "1a1" || node.address === "1b1"
            ? { ...node, links: [] }
            : node,
        ),
        folded,
      );
      expect(copy(none.passes.connections.lines)).toEqual(
        copy(plain.passes.connections.lines),
      );
      for (const each of [all, one, none, plain]) each.scene.destroy();
    });

    it("draws no cord while the lines drawn by hand are off", async () => {
      const { scene, passes, app } = await canvasOn(field(), folded, looks, {
        kinds: new Set(["link"]),
        labels: new Set(),
      });
      expect(passes.connections.lines).toHaveLength(0);
      expect(writtenOn(app)).not.toContain("2 lines");
      scene.destroy();
    });

    it("says how many it stands for over the words set on one of them, and gives those back once it stands for one", async () => {
      const nodes = field().map((node) =>
        node.address === "1a" ? { ...node, links: [ref("2")] } : node,
      );
      const direct: GraphEdgeLook[] = [
        ...looks,
        { from: ref("1a"), to: ref("2"), label: "why" },
      ];
      const several = await canvasOn(nodes, folded, direct);
      expect(writtenOn(several.app)).toContain("3 lines");
      expect(writtenOn(several.app)).not.toContain("why");

      const alone = await canvasOn(
        nodes,
        folded,
        direct,
        off("uses", "used by"),
      );
      expect(writtenOn(alone.app)).toContain("why");

      const its = await canvasOn(nodes, folded, direct, off("why"));
      expect(writtenOn(its.app)).toContain("2 lines");
      expect(writtenOn(its.app)).not.toContain("why");
      for (const each of [several, alone, its]) each.scene.destroy();
    });

    it("captions a cord on a dense field only once it stands out", async () => {
      const { scene, app } = await canvasOn([...field(), ...crowd()], folded);
      expect(writtenOn(app)).not.toContain("2 lines");
      scene.setPointed(ref("2"));
      app.tick();
      expect(writtenOn(app)).toContain("2 lines");
      scene.destroy();
    });

    it("recedes on a dense field like any hand link, its weight kept", async () => {
      const { scene, app, passes } = await canvasOn(
        [...field(), ...crowd()],
        folded,
      );
      const cords = nearTree(passes.connections.lines);
      expect(new Set(cords.map((line) => line.alpha))).toEqual(
        new Set([palette.connectionAlphaWhileSelecting]),
      );
      expect(widths(cords)).toHaveLength(2);
      scene.setPointed(ref("2"));
      app.tick();
      expect(
        new Set(nearTree(passes.connections.lines).map((line) => line.alpha)),
      ).toEqual(new Set([palette.readingAlpha]));
      scene.destroy();
    });
  });
});
