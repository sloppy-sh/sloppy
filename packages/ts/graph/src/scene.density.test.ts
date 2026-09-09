// DESIGN.md § "The mark": the canvas is drawn at the density of the screen in
// front of it, and the sheet the marks are cut from follows the zoom. What is
// checked here is that a pinch moves the sheet in steps rather than every frame,
// and that the few marks a sheet cannot hold are drawn as shapes instead of
// stretched.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeGraphics,
  type FakeParticle,
  FakeParticleContainer,
  FakeText,
  worldOf,
} from "./pixi.test-support.js";
import { MAX_SCALE } from "./viewport.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { FILL_AT, GraphScene, MARK_SHEET_TIERS, markSheetReach, markSheetTier } =
  await import("./scene.js");

const OWNER = "did:syr:someone";
const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc"],
});

function drawn(address: string, folded: number): DrawnNode {
  const ref = `${OWNER}/${address}` as OwnedRef;
  const node = {
    ref,
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: 1,
    origin: ref,
    title: `note ${address}`,
    tags: [],
    links: [],
    published: folded > 0,
    appearance: { ring_weight: "heavy", ring_style: "solid" },
  } as unknown as NodeView;
  return { node, collapsed: folded > 0, folded, tags: [] };
}

/** A leaf and a mega-node at the fold's cap, which is the largest mark the
 *  sheet is ever asked to hold. */
const field = [drawn("1", 0), drawn("2", 4000)];
const model = buildModel(field, { selection: [], palette });
const radiusOf = (at: number): number =>
  model.graph.getNodeAttributes(field[at].node.ref).radius;

async function canvas(resolution: number): Promise<{
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  app: FakeApplication;
}> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(buildModel(field, { selection: [], palette }), false);
  app.tick();
  return { scene, app };
}

/** The two layers a mark too big for the sheet is drawn on: what goes under its
 *  picture, and the provenance edge that goes over it. */
function shapesOf(app: FakeApplication): {
  under: FakeGraphics;
  over: FakeGraphics;
} {
  // Lift, genealogy, runs, connections, the difference, the shapes, their
  // edges, then the orbit.
  const [, , , , , under, over] = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return { under, over };
}

/** The mark fills, biggest first. */
function fillsOf(app: FakeApplication): FakeParticle[] {
  const layer = worldOf(app).children.find(
    (child): child is FakeContainer & { particleChildren: unknown[] } =>
      child instanceof FakeParticleContainer,
  );
  if (!layer) throw new Error("The world holds no marks");
  return [...(layer.particleChildren as FakeParticle[])].sort(
    (one, other) => other.scaleX - one.scaleX,
  );
}

function wordsOf(app: FakeApplication): FakeText[] {
  const layer = app.stage.children.find((child) =>
    child.children.some((kid) => kid instanceof FakeText),
  );
  if (!layer) throw new Error("The stage holds no words");
  return layer.children as FakeText[];
}

function zoomTo(
  scene: Awaited<ReturnType<typeof GraphScene.create>>,
  scale: number,
): void {
  scene.viewport.scale = scale;
  scene.invalidate();
}

describe("the sheet under a pinch", () => {
  const [coarse, , top] = MARK_SHEET_TIERS;

  it("is cut again on a tier, and left alone inside one", async () => {
    const { scene, app } = await canvas(1);
    expect(app.cut).toEqual([coarse]);

    zoomTo(scene, 1.2);
    app.tick();
    expect(app.cut, "recut without crossing a tier").toEqual([coarse]);

    zoomTo(scene, MAX_SCALE);
    app.tick();
    expect(app.cut).toEqual([coarse, top]);

    zoomTo(scene, 1);
    app.tick();
    expect(app.cut).toEqual([coarse, top, coarse]);
    scene.destroy();
  });
});

describe("a mark the sheet cannot hold", () => {
  it("is drawn as a shape, and the marks that fit are not", async () => {
    const { scene, app } = await canvas(3);
    zoomTo(scene, MAX_SCALE);
    app.tick();

    const reach = markSheetReach(markSheetTier(MAX_SCALE, 3), MAX_SCALE, 3);
    expect(radiusOf(1), "the mega-node is past the sheet").toBeGreaterThan(
      reach,
    );
    expect(radiusOf(0), "the leaf is not").toBeLessThan(reach);

    const { under, over } = shapesOf(app);
    expect(under.discs).toHaveLength(1);
    expect(under.discs[0].radius).toBeCloseTo(radiusOf(1) * FILL_AT, 6);
    // Its author's look under the picture, provenance's edge over it.
    expect(under.rings).toHaveLength(1);
    expect(over.rings).toHaveLength(1);
    expect(over.rings[0].radius).toBeGreaterThan(under.rings[0].radius);

    const [mega, leaf] = fillsOf(app);
    expect(mega.alpha, "drawn twice over").toBe(0);
    expect(leaf.alpha).toBe(1);
    scene.destroy();
  });

  it("goes back to the sheet once the zoom leaves it room", async () => {
    const { scene, app } = await canvas(3);
    zoomTo(scene, MAX_SCALE);
    app.tick();
    zoomTo(scene, 1);
    app.tick();

    expect(shapesOf(app).under.discs).toHaveLength(0);
    expect(fillsOf(app)[0].alpha).toBe(1);
    scene.destroy();
  });
});

// A window dragged from a laptop onto a 4K screen is the case: nothing about the
// canvas changes size, and everything on it has to be drawn again denser.
describe("a canvas moved to a screen of another density", () => {
  it("draws the marks, the words and the pictures at the new one", async () => {
    const { scene, app } = await canvas(1);
    const words = wordsOf(app);
    expect(words.every((word) => word.resolution === 1)).toBe(true);

    scene.setResolution(3);
    app.tick();

    expect(app.renderer.resolution).toBe(3);
    expect(words.every((word) => word.resolution === 3)).toBe(true);
    expect(app.cut).toEqual([markSheetTier(1, 1), markSheetTier(1, 3)]);
    scene.destroy();
  });
});
