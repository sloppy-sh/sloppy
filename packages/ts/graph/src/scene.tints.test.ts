// DESIGN.md § Hue: a tag question is answered on the marks that are already up.
// What is checked here is that answering one leaves them up — the same particles,
// the same pictures and the same words — and moves nothing but colour.

import type { NodeView, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeParticle,
  FakeParticleContainer,
  FakeText,
  worldOf,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene } = await import("./scene.js");

const OWNER = "did:syr:someone";
const STRANGER = "did:syr:somebodyelse";
const palette = buildPalette({
  ink: "#101010",
  paper: "#fdfdfd",
  hues: ["#4455cc", "#cc5544"],
});

function drawn(
  address: string,
  tags: string[],
  owner = OWNER,
  folded = 0,
): DrawnNode {
  const ref = `${owner}/${address}` as OwnedRef;
  const node = {
    ref,
    created_by: owner,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: address.length,
    origin: ref,
    title: `note ${address}`,
    tags,
    links: [],
    published: false,
  } as NodeView;
  return { node, collapsed: folded > 0, folded, tags: tags as Tag[] };
}

/** More marks than `LABEL_RETEXT_BUDGET`, so a rebuild of the marks is a canvas
 *  that has to trickle its words back over several frames. */
const field: DrawnNode[] = [
  drawn("1", ["seed"]),
  ...Array.from({ length: 12 }, (_, at) =>
    drawn(`1${"abcdefghijkl"[at]}`, at % 2 === 0 ? ["seed"] : ["method"]),
  ),
  drawn("2", [], STRANGER, 4),
];

async function canvas(): Promise<{
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  app: FakeApplication;
}> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(buildModel(field, { selection: [], palette }), false);
  scene.fit();
  // Only a few label slots may change hands in a frame, so the canvas is left
  // with every word it wants on it before anything below moves.
  for (let frame = 0; frame < field.length; frame++) {
    scene.invalidate();
    app.tick();
  }
  return { scene, app };
}

const model = (selection: readonly Tag[]) =>
  buildModel(field, { selection, palette });

/** Every particle on the canvas, in the order the layers hold them. */
function particles(app: FakeApplication): FakeParticle[] {
  return worldOf(app)
    .children.filter(
      (child): child is FakeContainer & { particleChildren: unknown[] } =>
        child instanceof FakeParticleContainer,
    )
    .flatMap((layer) => layer.particleChildren as FakeParticle[]);
}

/** The words on the canvas: what a rebuild of the marks takes off it and hands
 *  back a few slots a frame. */
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

describe("answering a tag question on the marks already up", () => {
  it("keeps the same particles and the same words", async () => {
    const { scene, app } = await canvas();
    const before = particles(app);
    const said = words(app);
    expect(before.length).toBeGreaterThan(0);
    expect(said.length).toBeGreaterThan(0);

    scene.setTints(model(["seed"] as Tag[]), true);
    app.tick();

    expect(particles(app)).toEqual(before);
    expect(words(app)).toEqual(said);
  });

  // The cost the path above exists to spare: replacing the model empties the
  // particle layers and every label slot, and the words come back a few a frame.
  it("is what replacing the model costs, and does not pay it", async () => {
    const { scene, app } = await canvas();
    const before = particles(app);
    const said = words(app);

    scene.setModel(model(["seed"] as Tag[]), true);
    app.tick();

    expect(particles(app)).not.toEqual(before);
    expect(words(app).length).toBeLessThan(said.length);
  });

  it("dims what carries none of the tags and lights what does", async () => {
    const { scene, app } = await canvas();
    const plain = particles(app).map((particle) => particle.alpha);
    expect(new Set(plain)).toEqual(new Set([1]));

    scene.setTints(model(["seed"] as Tag[]), true);
    app.tick();

    const lit = particles(app);
    expect(lit.some((particle) => particle.alpha === 1)).toBe(true);
    expect(
      lit.some((particle) => particle.alpha === palette.unselectedAlpha),
    ).toBe(true);
  });

  it("writes the hue the model gave each mark", async () => {
    const { scene, app } = await canvas();
    const answer = model(["seed"] as Tag[]);

    scene.setTints(answer, true);
    app.tick();

    for (const ref of answer.order) {
      const attributes = answer.graph.getNodeAttributes(ref);
      // A mark somebody else wrote is drawn hollow, so its fill is the ring's.
      const on = particles(app).filter(
        (particle) => particle.tint === attributes.fill,
      );
      expect(
        on.length,
        `${attributes.address} was left uncoloured`,
      ).toBeGreaterThan(0);
    }
  });

  it("clears back to the genealogical view when the tags are let go", async () => {
    const { scene, app } = await canvas();
    const plain = particles(app).map((particle) => ({
      tint: particle.tint,
      alpha: particle.alpha,
    }));

    scene.setTints(model(["seed"] as Tag[]), true);
    app.tick();
    scene.setTints(model([]), false);
    app.tick();

    expect(
      particles(app).map((particle) => ({
        tint: particle.tint,
        alpha: particle.alpha,
      })),
    ).toEqual(plain);
  });
});
