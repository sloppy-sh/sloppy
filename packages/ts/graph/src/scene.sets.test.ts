// DESIGN.md § "Sets — the tags as places": the regions are a wash on the paper
// under the marks, and nothing else about the canvas changes. What is checked
// here is what the scene ASKED to have drawn — the figure itself is a GPU fact
// and `bench/` is where it is looked at.

import type { NodeView, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeGraphics,
  FakeText,
  worldOf,
} from "./pixi.test-support.js";
import { packSets, SETS_STEP, type SetsStanding } from "./sets/pack.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene } = await import("./scene.js");

const OWNER = "did:syr:someone";
const TAGS = ["biology", "seed"] as Tag[];
const tokens = {
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc", "#cc5544", "#44aa66", "#aa8822"],
};
const palette = buildPalette(tokens, 0, TAGS.length);

function drawn(serial: number, tags: Tag[]): DrawnNode {
  const ref = `${OWNER}/${serial.toString(36).padStart(26, "0")}` as OwnedRef;
  return {
    node: {
      ref,
      created_by: OWNER,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      address: `1a${serial + 1}`,
      depth: 2,
      origin: ref,
      title: `note ${serial}`,
      tags: [...tags],
      links: [],
      published: false,
    } as NodeView,
    collapsed: false,
    folded: 0,
    tags,
  };
}

/** A field with something standing in each of the four regions. */
const field: DrawnNode[] = [
  ...Array.from({ length: 4 }, (_unused, at) => drawn(at, [])),
  ...Array.from({ length: 4 }, (_unused, at) => drawn(10 + at, [TAGS[0]])),
  ...Array.from({ length: 4 }, (_unused, at) => drawn(20 + at, [TAGS[1]])),
  ...Array.from({ length: 4 }, (_unused, at) => drawn(30 + at, [...TAGS])),
];

function sets(selection: readonly Tag[] = TAGS) {
  return buildModel(field, {
    arrangement: "sets",
    sets: packSets({
      notes: field.map((entry) => ({
        ref: entry.node.ref,
        graph: OWNER as OwnedRef,
        tags: entry.tags,
        created_at: entry.node.created_at,
      })),
      fields: [],
      selection,
      spacing: SETS_STEP,
      most: 400,
      gutter: 900,
    }),
    selection,
    palette,
  });
}

async function canvas() {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(sets(), true);
  scene.fit();
  for (let frame = 0; frame < field.length; frame++) {
    scene.invalidate();
    app.tick();
  }
  return { scene, app };
}

/** The layers the world holds, in the order `scene.ts` adds them. */
function layers(app: FakeApplication): FakeGraphics[] {
  return worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
}

/** Every word on the canvas that is actually shown. */
function words(app: FakeApplication): string[] {
  const said = (of: FakeContainer): string[] =>
    of.children.flatMap((child) =>
      child instanceof FakeText
        ? child.visible && child.text !== ""
          ? [child.text]
          : []
        : said(child),
    );
  return said(app.stage);
}

describe("the drawn sets as places on the paper", () => {
  it("washes one region per drawn tag, under everything else", async () => {
    const { scene, app } = await canvas();
    const [regions] = layers(app);

    expect(regions.paths).toHaveLength(TAGS.length);
    expect(regions.paths.map((path) => path.color)).toEqual([
      palette.setsFill(1),
      palette.setsFill(2),
    ]);
    for (const path of regions.paths) {
      expect(path.alpha).toBeCloseTo(palette.setsWash, 12);
      expect(path.points.length).toBeGreaterThan(8);
    }
    scene.destroy();
  });

  // The wash owes no floor; the hairline does, so it takes the colour a mark of
  // that slot takes rather than the wash's own.
  it("runs a hairline round each one in the colour a mark takes", async () => {
    const { scene, app } = await canvas();
    const [regions] = layers(app);
    const struck = new Set(regions.lines.map((line) => line.color));

    expect(struck).toEqual(new Set([palette.tag(1), palette.tag(2)]));
    for (const line of regions.lines) {
      expect(line.alpha).toBeLessThan(1);
      expect(line.width).toBeGreaterThan(0);
    }
    scene.destroy();
  });

  it("names each set where the figure is framed", async () => {
    const { scene, app } = await canvas();
    for (const tag of TAGS) expect(words(app)).toContain(tag);
    scene.destroy();
  });

  // A mark's own caption is drawn exactly as it is in the genealogy, so the
  // marks have to be big enough on screen to carry one — which is what the
  // framed figure is not.
  it("keeps a mark's caption beside it", async () => {
    const { scene, app } = await canvas();
    const ref = sets().order[0];
    scene.viewport.zoomAt(0, 0, 1 / scene.viewport.scale);
    scene.centreOn(ref);
    for (let frame = 0; frame < field.length; frame++) {
      scene.invalidate();
      app.tick();
    }

    expect(
      words(app).filter((one) => one.startsWith("1a")).length,
    ).toBeGreaterThan(0);
    scene.destroy();
  });

  it("draws no line between the marks", async () => {
    const { scene, app } = await canvas();
    const [, , genealogy, runs, connections] = layers(app);

    expect(genealogy.lines).toEqual([]);
    expect(runs.lines).toEqual([]);
    expect(connections.lines).toEqual([]);
    scene.destroy();
  });

  it("lights the region a held mark is over, and lets it go", async () => {
    const { scene, app } = await canvas();
    const [regions] = layers(app);
    const both: SetsStanding = { field: 0, region: 0b11 };

    scene.setSetsDrop(both);
    app.tick();
    expect(regions.rects.length).toBeGreaterThan(0);
    for (const box of regions.rects) {
      expect(box.color).toBe(palette.ink);
      expect(box.alpha).toBeCloseTo(palette.setsLit, 12);
    }

    scene.setSetsDrop(null);
    app.tick();
    expect(regions.rects).toEqual([]);
    scene.destroy();
  });

  it("frames a region for the fold that stands for it, and nothing else", async () => {
    const scene = await GraphScene.create({} as HTMLCanvasElement, {
      fonts: { ui: "ui", address: "mono" },
      palette,
      resolution: 2,
    });
    // Too little room to stand them in, so each region folds to one mark.
    const model = buildModel(field, {
      arrangement: "sets",
      sets: packSets({
        notes: field.map((entry) => ({
          ref: entry.node.ref,
          graph: OWNER as OwnedRef,
          tags: entry.tags,
          created_at: entry.node.created_at,
        })),
        fields: [],
        selection: TAGS,
        spacing: SETS_STEP,
        most: 2,
        gutter: 900,
      }),
      selection: TAGS,
      palette,
    });
    scene.setModel(model, true);
    const fold = [...(model.sets?.folds ?? [])][0];
    const standing = model.order.find((ref) => !model.sets?.folds.has(ref));

    const before = { ...scene.viewport };
    expect(scene.frameRegion(fold)).toBe(true);
    expect({ ...scene.viewport }).not.toEqual(before);
    if (standing !== undefined) {
      expect(scene.frameRegion(standing)).toBe(false);
    }
    scene.destroy();
  });

  it("washes nothing where the host asked for the genealogy", async () => {
    const scene = await GraphScene.create({} as HTMLCanvasElement, {
      fonts: { ui: "ui", address: "mono" },
      palette,
      resolution: 2,
    });
    const app = FakeApplication.latest as FakeApplication;
    scene.setModel(buildModel(field, { selection: TAGS, palette }), true);
    app.tick();

    const [regions] = layers(app);
    expect(regions.paths).toEqual([]);
    expect(regions.rects).toEqual([]);
    expect(words(app)).not.toContain(TAGS[0]);
    scene.destroy();
  });
});
