// DESIGN.md § Eggs: the hue sweep borrows the facets, leaves the canvas exactly
// as it found it, and is never a thing a reader has to notice.

import {
  type DidSyr,
  type NodeView,
  type OwnedRef,
  TAG_HUE_SLOTS,
} from "@sloppy/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeParticle,
  FakeParticleContainer,
  worldOf,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene, SWEEP_MS, SWEEP_HOLD_MS } = await import("./scene.js");

const OWNER = "did:syr:someone" as DidSyr;
const STRANGER = "did:syr:somebodyelse" as DidSyr;

/** Eight hues far enough apart that the slot a mark lit in is readable off its
 *  tint alone. */
const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: [
    "#c0392b",
    "#d35400",
    "#b7950b",
    "#1e8449",
    "#148f77",
    "#1f618d",
    "#5b2c6f",
    "#a93226",
  ],
});

const FACETS = TAG_HUE_SLOTS.map((slot) => palette.tag(slot));

/** One mark per facet band, so each band has exactly one mark to light. */
const MARKS = 8;

/** Far enough apart to read apart, and close enough that the whole row stands
 *  inside the screen the fake renderer reports. */
const STEP = 40;
/** Clear of the top edge, so every mark is one the viewport is looking at. */
const ROW_Y = 300;

function drawn(at: number, owner = OWNER): DrawnNode {
  const address = `1${"abcdefgh"[at]}`;
  const ref = `${owner}/${address}` as OwnedRef;
  return {
    node: {
      ref,
      created_by: owner,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      address,
      depth: 2,
      origin: ref,
      title: `note ${address}`,
      tags: [],
      links: [],
      published: false,
    } as NodeView,
    collapsed: false,
    folded: 0,
    tags: [],
  };
}

/** A canvas with its marks spread evenly from left to right, which is the axis
 *  the sweep travels. */
async function canvas(
  field: DrawnNode[] = Array.from({ length: MARKS }, (_, at) => drawn(at)),
  viewer?: DidSyr,
  reduced?: MediaQueryList,
) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 1,
    reduced,
  });
  const app = FakeApplication.latest as FakeApplication;
  const model = buildModel(field, { selection: [], palette, viewer });
  scene.setModel(model, false);
  const places = new Float32Array(model.order.length * 2);
  model.order.forEach((_ref, at) => {
    places[at * 2] = at * STEP;
    places[at * 2 + 1] = ROW_Y;
  });
  scene.setPositions(places);
  app.tick();
  return { scene, app, model };
}

/** Every mark's tint, in the order the model holds them — with all the marks
 *  the reader's own there is one particle each and no other layer carries one. */
function tints(app: FakeApplication): number[] {
  return worldOf(app)
    .children.filter(
      (child): child is FakeContainer & { particleChildren: unknown[] } =>
        child instanceof FakeParticleContainer,
    )
    .flatMap((layer) => layer.particleChildren as FakeParticle[])
    .map((particle) => particle.tint);
}

let clock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clock = vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  clock.mockRestore();
});

function at(ms: number, app: FakeApplication): number[] {
  clock.mockReturnValue(ms);
  app.tick();
  return tints(app);
}

describe("the hue sweep", () => {
  it("lights each band's mark in its own facet, left to right", async () => {
    const { scene, app } = await canvas();
    const before = tints(app);
    expect(before).toHaveLength(MARKS);

    scene.sweep();
    /** The facet each mark was ever seen in, over the whole span. */
    const seen = new Array<number | undefined>(MARKS).fill(undefined);
    /** When each one was first seen in it, so the order can be read. */
    const first = new Array<number>(MARKS).fill(Number.POSITIVE_INFINITY);
    for (let ms = 0; ms < SWEEP_MS; ms += 20) {
      at(ms, app).forEach((tint, mark) => {
        if (tint === before[mark]) return;
        seen[mark] = tint;
        first[mark] = Math.min(first[mark], ms);
      });
    }

    expect(seen).toEqual(FACETS);
    // Left to right: no mark lights before the one to its left.
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    scene.destroy();
  });

  it("holds a mark for a moment and then lets it go", async () => {
    const { scene, app } = await canvas();
    const before = tints(app);

    scene.sweep();
    expect(at(0, app)[0]).toBe(FACETS[0]);
    expect(at(SWEEP_HOLD_MS - 20, app)[0]).toBe(FACETS[0]);
    expect(at(SWEEP_HOLD_MS, app)[0]).toBe(before[0]);
    scene.destroy();
  });

  it("leaves every mark as it was drawn", async () => {
    const { scene, app } = await canvas();
    const before = tints(app);

    scene.sweep();
    at(SWEEP_MS / 2, app);
    expect(at(SWEEP_MS, app)).toEqual(before);
    // And stays there, rather than running on past its span.
    expect(at(SWEEP_MS * 3, app)).toEqual(before);
    scene.destroy();
  });

  it("does nothing while one is already running", async () => {
    const { scene, app } = await canvas();
    const before = tints(app);

    scene.sweep();
    // Past the leftmost mark's hold, so a sweep begun again here would light it.
    const midway = at(SWEEP_MS / 2, app);
    expect(midway[0]).toBe(before[0]);
    scene.sweep();
    expect(at(SWEEP_MS / 2, app)).toEqual(midway);
    scene.destroy();
  });

  // DESIGN.md § Motion: the sweep is decoration, and decoration is the first
  // thing to go where a reader has asked for less of it.
  it("runs for nobody who has asked for less motion", async () => {
    const field = Array.from({ length: MARKS }, (_, place) => drawn(place));
    const { scene, app } = await canvas(field, undefined, {
      matches: true,
    } as MediaQueryList);
    const before = tints(app);

    scene.sweep();
    expect(at(0, app)).toEqual(before);
    expect(at(SWEEP_MS / 2, app)).toEqual(before);
    scene.destroy();
  });

  it("asks nothing of a canvas with no marks on it", async () => {
    const { scene, app } = await canvas([]);
    scene.sweep();
    expect(at(0, app)).toEqual([]);
    expect(at(SWEEP_MS, app)).toEqual([]);
    scene.destroy();
  });

  it("lights a mark drawn hollow on the edge that carries its colour", async () => {
    const field = Array.from({ length: MARKS }, (_, place) =>
      drawn(place, STRANGER),
    );
    const { scene, app } = await canvas(field, OWNER);
    const before = tints(app);
    expect(before).toHaveLength(MARKS);

    scene.sweep();
    expect(at(0, app)[0]).toBe(FACETS[0]);
    expect(at(SWEEP_MS, app)).toEqual(before);
    scene.destroy();
  });

  /** The facet each mark was ever seen in over one whole sweep. */
  function facetsOver(
    scene: Awaited<ReturnType<typeof canvas>>["scene"],
    app: FakeApplication,
  ) {
    const before = tints(app);
    scene.sweep();
    const seen = new Array<number | undefined>(before.length).fill(undefined);
    for (let ms = 0; ms < SWEEP_MS; ms += 20) {
      at(ms, app).forEach((tint, mark) => {
        if (tint !== before[mark]) seen[mark] = tint;
      });
    }
    return seen;
  }

  // Zoomed in, a span measured over every mark's x puts the marks on screen
  // inside one band, and the egg reads as a single flash.
  it("lays the bands over the marks on screen rather than the whole field", async () => {
    const { scene, app } = await canvas();
    // The leftmost four marks, which is what 390 screen pixels at this zoom
    // reach; the row itself stays in view.
    scene.viewport.lookAt({ x: 0, y: -ROW_Y, scale: 3 });

    const seen = facetsOver(scene, app);
    const onScreen = seen.slice(0, 4);
    expect(new Set(onScreen).size).toBe(onScreen.length);
    expect(onScreen[0]).toBe(FACETS[0]);
    expect(onScreen.at(-1)).toBe(FACETS.at(-1));
    // A mark off the end of the run lights with the end it is past.
    expect(seen.slice(4)).toEqual(new Array(MARKS - 4).fill(FACETS.at(-1)));
    scene.destroy();
  });

  it("takes the whole field where the canvas is looking at none of it", async () => {
    const { scene, app } = await canvas();
    scene.viewport.lookAt({ x: -100_000, y: -100_000, scale: 1 });

    expect(facetsOver(scene, app)).toEqual(FACETS);
    scene.destroy();
  });

  it("can be asked for again once the one before it is over", async () => {
    const { scene, app } = await canvas();
    const before = tints(app);

    scene.sweep();
    at(SWEEP_MS, app);
    clock.mockReturnValue(SWEEP_MS);
    scene.sweep();
    expect(at(SWEEP_MS, app)[0]).toBe(FACETS[0]);
    expect(at(SWEEP_MS * 2, app)).toEqual(before);
    scene.destroy();
  });
});
