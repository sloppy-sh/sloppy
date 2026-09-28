// DESIGN.md § "The mark" and § "What the code left behind": the one thing a
// mark says on its own. A note whose author has read it against the code, and
// whose code has moved since, carries a dot on its rim — one dot, no hue, no
// count, and nothing at all on a note nobody has read.

import type { NodeView, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphDifference } from "./contract.js";
import {
  buildModel,
  LEAF_RADIUS,
  LOOK_RING_AT,
  LOOK_RING_WIDTH,
} from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FilledDisc,
  FakeGraphics,
  worldOf,
} from "./pixi.test-support.js";
import {
  CODE_MOVED_RADIUS,
  EDGE_RING_AT,
  EDGE_RING_WIDTH,
  LOOK_MIN_RADIUS,
} from "./scene.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene } = await import("./scene.js");

const OWNER = "did:syr:someone";
const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc"],
});

const ref = (address: string): OwnedRef => `${OWNER}/${address}` as OwnedRef;

function drawn(address: string, over: Partial<NodeView> = {}): DrawnNode {
  const node = {
    ref: ref(address),
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: 1,
    origin: ref(address),
    title: address,
    tags: [] as Tag[],
    links: [],
    published: false,
    ...over,
  } as NodeView;
  return { node, collapsed: false, folded: 0, tags: [] };
}

async function canvasOn(
  field: DrawnNode[],
  options: {
    codeMoved?: ReadonlySet<OwnedRef>;
    difference?: GraphDifference;
  } = {},
) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(
    buildModel(field, { selection: [], palette, ...options }),
    false,
  );
  app.tick();
  return { scene, app };
}

/** The layer the rim's dots are laid on: the last the world holds, over the
 *  orbit and everything under it. */
function dots(app: FakeApplication): FilledDisc[] {
  const held = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return held[held.length - 1].discs;
}

describe("the dot a mark carries where the code has moved", () => {
  it("draws one on the rim of a note the code has moved under, and none on the rest", async () => {
    const moved = ref("1");
    const { scene, app } = await canvasOn([drawn("1"), drawn("2")], {
      codeMoved: new Set([moved]),
    });
    const at = scene.positionOf(scene.indexOf(moved) as number);

    expect(dots(app)).toHaveLength(1);
    const [dot] = dots(app);
    expect(dot.x).toBeCloseTo(at.x, 6);
    // Due south, centred on the mark's own edge.
    expect(dot.y - at.y).toBeCloseTo(LEAF_RADIUS * EDGE_RING_AT, 6);
    expect(dot.radius).toBeCloseTo(LEAF_RADIUS * CODE_MOVED_RADIUS, 6);
    scene.destroy();
  });

  it("spends no hue: it is the field's ink, whatever the mark is filled with", async () => {
    const { scene, app } = await canvasOn([drawn("1")], {
      codeMoved: new Set([ref("1")]),
    });

    expect(dots(app)[0].color).toBe(palette.ink);
    scene.destroy();
  });

  it("says nothing about a note nobody has read", async () => {
    const { scene, app } = await canvasOn([drawn("1"), drawn("2")]);

    expect(dots(app)).toHaveLength(0);
    scene.destroy();
  });

  it("is drawn over the band a chosen mark stands in", async () => {
    const chosen = ref("1");
    const { scene, app } = await canvasOn([drawn("1")], {
      codeMoved: new Set([chosen]),
    });
    scene.setChosen(new Set([chosen]));
    app.tick();
    const held = worldOf(app).children.filter(
      (child): child is FakeGraphics => child instanceof FakeGraphics,
    );
    const orbit = held[held.length - 2];

    expect(orbit.rings).toHaveLength(1);
    expect(held[held.length - 1].discs).toHaveLength(1);
    scene.destroy();
  });

  it("clears the look's ring at the weight that reaches furthest", async () => {
    const { scene, app } = await canvasOn(
      [
        drawn("1", {
          appearance: { ringWeight: "heavy", ringStyle: "solid" },
        } as Partial<NodeView>),
      ],
      { codeMoved: new Set([ref("1")]) },
    );
    const [dot] = dots(app);
    const inner = LEAF_RADIUS * EDGE_RING_AT - dot.radius;
    const lookOuter =
      LEAF_RADIUS *
      (LOOK_RING_AT + Math.max(...Object.values(LOOK_RING_WIDTH)) / 2);

    expect(inner).toBeGreaterThan(lookOuter);
    scene.destroy();
  });

  // Straddling the provenance edge is what makes it an addition rather than a
  // break in it, so it has to be plainly wider than that stroke.
  it("is wider than the provenance stroke it sits on", async () => {
    const { scene, app } = await canvasOn(
      [drawn("1", { published: true } as Partial<NodeView>)],
      { codeMoved: new Set([ref("1")]) },
    );

    expect(dots(app)[0].radius * 2).toBeGreaterThan(
      LEAF_RADIUS * EDGE_RING_WIDTH * 2,
    );
    scene.destroy();
  });

  it("goes when the look goes, rather than smudging the rim", async () => {
    const { scene, app } = await canvasOn([drawn("1")], {
      codeMoved: new Set([ref("1")]),
    });
    scene.viewport.zoomAt(0, 0, (LOOK_MIN_RADIUS / LEAF_RADIUS) * 0.5);
    scene.invalidate();
    app.tick();

    expect(scene.viewport.scale * LEAF_RADIUS).toBeLessThan(LOOK_MIN_RADIUS);
    expect(dots(app)).toHaveLength(0);
    scene.destroy();
  });

  it("carries none on a note a difference says went: there is no mark to mark", async () => {
    const gone = drawn("2");
    const { scene, app } = await canvasOn([drawn("1")], {
      codeMoved: new Set([ref("1"), gone.node.ref]),
      difference: {
        added: new Set(),
        removed: [gone.node],
        changed: new Set(),
        moved: [],
      },
    });

    expect(dots(app)).toHaveLength(1);
    scene.destroy();
  });
});
