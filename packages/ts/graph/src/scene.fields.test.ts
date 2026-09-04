// DESIGN.md § "Several graphs on one canvas": each graph's name is written over
// its own field, and only where there is more than one field to tell apart.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphField } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  FakeText,
  type FakeContainer,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene, MAX_FIELDS } = await import("./scene.js");

const OWNER = "did:syr:someone";
const HOME = `${OWNER}/00000000000000000000000000` as OwnedRef;
const GARDEN = `${OWNER}/01GARDEN0000000000000000AA` as OwnedRef;

const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc"],
});

function drawn(address: string, graph: OwnedRef): DrawnNode {
  const ref = `${graph}|${address}` as OwnedRef;
  const node = {
    ref,
    created_by: OWNER,
    graph,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: address.length,
    origin: ref,
    title: address,
    tags: [],
    links: [],
    published: false,
  } as NodeView;
  return { node, collapsed: false, folded: 0, tags: [] };
}

async function canvasOn(
  field: DrawnNode[],
  fields?: readonly GraphField[],
): Promise<{
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  app: FakeApplication;
}> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(buildModel(field, { selection: [], palette, fields }), false);
  scene.fit();
  app.tick();
  return { scene, app };
}

/** The field names on screen, in the order the pool holds them. The mark labels
 *  share the layer and are pooled ahead of them. */
function names(app: FakeApplication): { text: string; x: number }[] {
  const layer = app.stage.children.find((child: FakeContainer) =>
    child.children.some((kid) => kid instanceof FakeText),
  );
  if (!layer) throw new Error("The stage has no text on it");
  return layer.children
    .slice(-MAX_FIELDS)
    .filter((kid): kid is FakeText => kid instanceof FakeText && kid.visible)
    .map((kid) => ({ text: kid.text, x: kid.x }));
}

const BOTH = [
  { ref: HOME, title: "Thesis" },
  { ref: GARDEN, title: "Garden" },
];

describe("a graph's name on the canvas", () => {
  const field = [
    drawn("1", HOME),
    drawn("1a", HOME),
    drawn("1", GARDEN),
    drawn("2", GARDEN),
  ];

  it("is written once per graph, over the field it belongs to", async () => {
    const { app } = await canvasOn(field, BOTH);
    const written = names(app);
    expect(written.map((one) => one.text)).toEqual(["Thesis", "Garden"]);
    expect(written[0].x).toBeLessThan(written[1].x);
  });

  // One graph on the canvas answers no question a name could answer, so the
  // chrome carries it and the canvas carries none.
  it("is not written where there is one field", async () => {
    const mine = field.filter((entry) => entry.node.graph === HOME);
    expect(names((await canvasOn(mine, [BOTH[0]])).app)).toEqual([]);
    expect(names((await canvasOn(mine)).app)).toEqual([]);
  });

  // Held over its own field: the reader zoomed into one graph reads that graph's
  // name and no other, however far they pan inside it.
  it("holds the top of the screen inside its own field, and goes outside it", async () => {
    const { scene, app } = await canvasOn(field, BOTH);
    const garden = scene.indexOf(`${GARDEN}|1`);
    if (garden === undefined) throw new Error("The garden was not drawn");
    scene.viewport.scale = 1;
    scene.viewport.centreOn(scene.positionOf(garden), 390, 740);
    scene.invalidate();
    app.tick();

    const written = names(app);
    expect(written.map((one) => one.text)).toEqual(["Garden"]);
    expect(written[0].x).toBeGreaterThanOrEqual(0);
    expect(written[0].x).toBeLessThanOrEqual(390);
  });
});
