// DESIGN.md § Edges, "Lit before it is edited": what the canvas draws for the
// lines a reader lit, and which lines a tap on a bundle lights.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import { drawnNodes } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeGraphics,
  FakeText,
  worldOf,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene, CHOSEN_INK } = await import("./scene.js");

const OWNER = "did:syr:someone";
const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc"],
});

const ref = (address: string): OwnedRef => `${OWNER}/${address}` as OwnedRef;

function note(
  address: string,
  parent?: string,
  links: string[] = [],
): NodeView {
  return {
    ref: ref(address),
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: address.length,
    origin: ref(parent ?? address),
    ...(parent === undefined ? {} : { parent: ref(parent) }),
    title: `Note ${address}`,
    tags: [],
    links: links.map(ref),
    published: false,
  } as NodeView;
}

/** A root over two branches, three leaves under each; each leaf on the left
 *  linked by hand to the one across from it — a bundle of three — and one
 *  more hand link that stays on its own side. */
const PLACES: Record<string, [number, number]> = {
  "1": [0, 0],
  "1a": [-400, 300],
  "1b": [400, 300],
  "1a1": [-700, 700],
  "1a2": [-500, 900],
  "1a3": [-250, 1100],
  "1b1": [700, 700],
  "1b2": [500, 900],
  "1b3": [300, 1100],
};

const field = (): NodeView[] => [
  note("1"),
  note("1a", "1"),
  note("1b", "1"),
  note("1a1", "1a", ["1b1", "1a3"]),
  note("1a2", "1a", ["1b2"]),
  note("1a3", "1a", ["1b3"]),
  note("1b1", "1b"),
  note("1b2", "1b"),
  note("1b3", "1b"),
];

/** Where the bundle runs closest to the root, between the two branches. */
const CORD = { x: 0, y: 100 };

const BUNDLE = [
  ["1a1", "1b1"],
  ["1a2", "1b2"],
  ["1a3", "1b3"],
].map(([a, b]) => [ref(a), ref(b)].sort().join(" "));

async function canvas(bundled = true) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", heading: "heading", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  const nodes = field();
  const model = buildModel(drawnNodes(nodes, new Set()), {
    selection: [],
    palette,
    folds: { nodes, collapsed: new Set() },
  });
  scene.setModel(model, false);
  scene.setPositions(
    Float32Array.from(
      model.order.flatMap((at) => PLACES[at.slice(OWNER.length + 1)]),
    ),
    true,
  );
  scene.fit();
  if (bundled) scene.setBundling(1);
  app.tick();
  const layers = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  const [, , genealogy, , connections] = layers;
  return { scene, app, layers, genealogy, connections };
}

const unordered = (pairs: readonly (readonly [string, string])[]) =>
  pairs.map((pair) => [...pair].sort().join(" ")).sort();

function written(app: FakeApplication): string[] {
  return app.stage.children
    .flatMap((child: FakeContainer) => child.children)
    .filter((kid): kid is FakeText => kid instanceof FakeText && kid.visible)
    .map((kid) => kid.text);
}

describe("a tap on a bundle", () => {
  it("finds every line bundled through the stretch it landed on", async () => {
    const { scene } = await canvas();
    const found = scene.bundleAt(CORD);
    expect(unordered(found)).toEqual([...BUNDLE].sort());
    expect(BUNDLE).toContain([...found[0]].sort().join(" "));
    scene.destroy();
  });

  it("finds the one line where the tap lands on a line nobody bundles", async () => {
    const { scene } = await canvas(false);
    const [x0, y0] = PLACES["1a1"];
    const [x1, y1] = PLACES["1b1"];
    expect(scene.bundleAt({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 })).toEqual([
      [ref("1a1"), ref("1b1")],
    ]);
    expect(scene.bundleAt({ x: 5000, y: 5000 })).toEqual([]);
    scene.destroy();
  });
});

describe("a lit line", () => {
  it("is struck in full ink while every other line recedes", async () => {
    const { scene, app, genealogy, connections } = await canvas(false);
    scene.setLit([[ref("1a1"), ref("1b1")]]);
    app.tick();

    const [x0, y0] = PLACES["1a1"];
    const [x1, y1] = PLACES["1b1"];
    const lit = connections.lines.filter(
      (line) => line.alpha === palette.readingAlpha,
    );
    expect(lit.length).toBeGreaterThan(0);
    for (const piece of lit) {
      expect([piece.from[1], piece.to[1]]).toEqual([y0, y1]);
      expect(Math.min(piece.from[0], piece.to[0])).toBeGreaterThanOrEqual(x0);
      expect(Math.max(piece.from[0], piece.to[0])).toBeLessThanOrEqual(x1);
    }
    const rest = [...genealogy.lines, ...connections.lines].filter(
      (line) => line.alpha !== palette.readingAlpha,
    );
    expect(rest.length).toBeGreaterThan(8);
    expect(new Set(rest.map((line) => line.alpha))).toEqual(
      new Set([palette.edgeAlphaWhileSelecting]),
    );
    scene.destroy();
  });

  it("orbits and titles the two notes it joins", async () => {
    const { scene, app, layers } = await canvas(false);
    scene.setLit([[ref("1a1"), ref("1b1")]]);
    app.tick();
    const orbits = layers
      .flatMap((layer) => layer.rings)
      .filter((ring) => ring.alpha === CHOSEN_INK);
    expect(
      orbits.map((ring) => [ring.x, ring.y]).sort((a, b) => a[0] - b[0]),
    ).toEqual([PLACES["1a1"], PLACES["1b1"]]);
    expect(written(app)).toEqual(
      expect.arrayContaining(["Note 1a1", "Note 1b1"]),
    );
    scene.destroy();
  });

  it("says how many are lit where a bundle is", async () => {
    const { scene, app } = await canvas();
    scene.setLit(scene.bundleAt(CORD));
    app.tick();
    expect(written(app)).toContain("3 lines");
    scene.destroy();
  });

  it("goes back to the field as it was once nothing is lit", async () => {
    const { scene, app, connections } = await canvas(false);
    const before = connections.lines.map((line) => line.alpha);
    scene.setLit([[ref("1a1"), ref("1b1")]]);
    app.tick();
    scene.setLit(null);
    app.tick();
    expect(connections.lines.map((line) => line.alpha)).toEqual(before);
    scene.destroy();
  });
});
