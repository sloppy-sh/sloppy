// The one path in `scene.ts` that reaches outside the package: a host resolves
// a picture, the canvas cuts it to the disc and puts it on a mark. Pixi is stood
// in for, because what is checked here is the bookkeeping around the GPU — who
// is asked, what is freed, and what is left holding it — never the pixels.

import { type NodeView, type OwnedRef, PREVIEW_SIZES } from "@sloppy/types";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphPictures } from "./contract.js";
import {
  buildModel,
  LEAF_RADIUS,
  markPicturePx,
  PREVIEW_AT,
  PREVIEW_SPAN,
} from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  FakeContainer,
  FakeSprite,
  worldOf,
} from "./pixi.test-support.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { GraphScene } = await import("./scene.js");

/** What each decoded picture measures, keyed by the `src` it was handed. */
const decoded = new Map<string, { width: number; height: number }>();
/** Every `drawImage` a cut made: the destination box inside the square. */
let painted: { canvas: number; box: number[] }[] = [];

beforeAll(() => {
  vi.stubGlobal(
    "Image",
    class {
      width = 0;
      height = 0;
      #src = "";
      set src(value: string) {
        this.#src = value;
        const size = decoded.get(value) ?? { width: 400, height: 400 };
        this.width = size.width;
        this.height = size.height;
      }
      get src(): string {
        return this.#src;
      }
      async decode(): Promise<void> {}
    },
  );
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => context };
      const context = {
        beginPath: () => {},
        arc: () => {},
        clip: () => {},
        drawImage: (_source: unknown, ...box: number[]) =>
          painted.push({ canvas: canvas.width, box }),
      };
      return canvas;
    },
  });
});

afterEach(() => {
  decoded.clear();
  painted = [];
});

const OWNER = "did:syr:someone";
const palette = buildPalette({ ink: "#000", paper: "#fff", hues: [] });

/** The square a leaf with nothing else set shows its picture in. */
const LEAF_CUT = markPicturePx(LEAF_RADIUS, "small");

function drawn(
  address: string,
  preview?: string,
  preview_size?: string,
  mark_radius?: string,
): DrawnNode {
  const ref = `${OWNER}/${address}` as OwnedRef;
  const node = {
    ref,
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: 1,
    origin: ref,
    title: address,
    tags: [],
    links: [],
    published: false,
    ...(preview === undefined
      ? {}
      : { appearance: { preview, preview_size, mark_radius } }),
  } as NodeView;
  return { node, collapsed: false, folded: 0, tags: [] };
}

async function sceneOn(
  field: DrawnNode[],
  pictures?: GraphPictures,
): Promise<{
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  app: FakeApplication;
}> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
    pictures,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(buildModel(field, { selection: [], palette }), false);
  app.tick();
  return { scene, app };
}

/** The layer the preview sprites live on: the one plain container under the
 *  world, where every other child is a graphics or a particle layer. */
function previewsOf(app: FakeApplication): FakeContainer {
  const layer = worldOf(app).children.find(
    (child) => child.constructor === FakeContainer,
  );
  if (!layer) throw new Error("The world has no preview layer on it");
  return layer;
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/** A host that answers with a picture and counts what it was asked for. */
function host(): GraphPictures & { asked: string[]; released: string[] } {
  const asked: string[] = [];
  const released: string[] = [];
  return {
    asked,
    released,
    async read(preview: string) {
      asked.push(preview);
      return { src: `blob:${preview}`, release: () => released.push(preview) };
    },
  };
}

describe("a picture reaching a mark", () => {
  it("is asked for once however many marks wear it, and let go once it is on the canvas", async () => {
    const pictures = host();
    const { scene, app } = await sceneOn(
      [drawn("1", "up_a"), drawn("2", "up_a"), drawn("3", "up_b"), drawn("4")],
      pictures,
    );

    expect(pictures.asked).toEqual(["up_a", "up_b"]);
    await settle();
    expect(pictures.released.sort()).toEqual(["up_a", "up_b"]);

    app.tick();
    expect(previewsOf(app).children).toHaveLength(3);
    scene.destroy();
  });

  it("is drawn at the share of the mark DESIGN.md § the mark gives it", async () => {
    const field = [drawn("1", "up_a")];
    const { scene, app } = await sceneOn(field, host());
    await settle();
    app.tick();

    const model = buildModel(field, { selection: [], palette });
    const { radius } = model.graph.getNodeAttributes(field[0].node.ref);
    const sprite = previewsOf(app).children[0] as FakeSprite;
    expect(sprite.width).toBeCloseTo(radius * PREVIEW_AT * 2, 6);
    expect(sprite.height).toBe(sprite.width);
    scene.destroy();
  });

  // DESIGN.md § "The mark": how much of the mark a picture covers is a channel
  // its author spends, and the sizes are what `PREVIEW_SPAN` holds.
  it("grows to the share its author asked for", async () => {
    const field = PREVIEW_SIZES.map((size, at) =>
      drawn(`${at + 1}`, `up_${size}`, size),
    );
    const { scene, app } = await sceneOn(field, host());
    await settle();
    app.tick();

    const model = buildModel(field, { selection: [], palette });
    const sprites = previewsOf(app).children as FakeSprite[];
    let widest = 0;
    field.forEach((entry, at) => {
      const { radius } = model.graph.getNodeAttributes(entry.node.ref);
      expect(sprites[at].width, PREVIEW_SIZES[at]).toBeCloseTo(
        radius * PREVIEW_SPAN[PREVIEW_SIZES[at]] * 2,
        6,
      );
      expect(sprites[at].width).toBeGreaterThan(widest);
      widest = sprites[at].width;
    });
    scene.destroy();
  });

  it("covers the disc from its short side, and is never enlarged to do it", async () => {
    // Both sides past the cut, so the square is the cut's own.
    decoded.set("blob:wide", {
      width: LEAF_CUT * 2,
      height: LEAF_CUT * 1.5,
    });
    decoded.set("blob:small", { width: LEAF_CUT - 20, height: LEAF_CUT - 30 });
    const { scene } = await sceneOn(
      [drawn("1", "wide"), drawn("2", "small")],
      host(),
    );
    await settle();

    const wide = painted.find((cut) => cut.canvas === LEAF_CUT);
    expect(
      wide,
      "the picture with room to spare fills the square",
    ).toBeDefined();
    // Centred, and wider than the square by exactly its aspect ratio.
    expect(wide?.box[2]).toBeCloseTo((LEAF_CUT * 4) / 3, 6);
    expect(wide?.box[3]).toBeCloseTo(LEAF_CUT, 6);
    expect(wide?.box[1]).toBeCloseTo(0, 6);

    const small = painted.find((cut) => cut.canvas === LEAF_CUT - 30);
    expect(small, "one below the cut draws at what it has").toBeDefined();
    expect(small?.box[3]).toBeCloseTo(LEAF_CUT - 30, 6);
    scene.destroy();
  });

  // DESIGN.md § "The mark": a picture is cut for the mark that wears it, so one
  // picture on two marks of different sizes is two cuts and not the larger one
  // twice — which is what would put a mega-node's bytes behind every leaf.
  it("is cut again where another mark shows it bigger", async () => {
    decoded.set("blob:up_a", { width: 4000, height: 4000 });
    const pictures = host();
    const { scene } = await sceneOn(
      [
        drawn("1", "up_a"),
        {
          ...drawn("2", "up_a", "large", "giant"),
          collapsed: true,
          folded: 5_000,
        },
      ],
      pictures,
    );
    await settle();

    expect(pictures.asked).toEqual(["up_a", "up_a"]);
    const sides = painted.map((cut) => cut.canvas).sort((a, b) => a - b);
    expect(sides).toHaveLength(2);
    expect(sides[0]).toBe(LEAF_CUT);
    expect(sides[0] * 4, "a leaf pays a giant's bytes").toBeLessThan(sides[1]);
    scene.destroy();
  });

  it("leaves the mark drawing as one with no picture where the host has none", async () => {
    const { scene, app } = await sceneOn([drawn("1", "up_a")], {
      read: async () => null,
    });
    await settle();
    app.tick();

    expect(previewsOf(app).children).toHaveLength(0);
    scene.destroy();
  });

  it("is never asked for by a canvas no host gave a way to resolve one", async () => {
    const { scene, app } = await sceneOn([drawn("1", "up_a")]);
    await settle();
    app.tick();

    expect(previewsOf(app).children).toHaveLength(0);
    scene.destroy();
  });
});

describe("what a picture landing costs the marks already wearing one", () => {
  it("leaves their sprites alone rather than rebuilding every one of them", async () => {
    const held = new Map<string, () => void>();
    const pictures: GraphPictures = {
      read: (preview) =>
        new Promise((answer) => {
          held.set(preview, () =>
            answer({ src: `blob:${preview}`, release: () => {} }),
          );
        }),
    };
    const { scene, app } = await sceneOn(
      [drawn("1", "up_a"), drawn("2", "up_b")],
      pictures,
    );

    held.get("up_a")?.();
    await settle();
    app.tick();
    const first = previewsOf(app).children[0] as FakeSprite;

    held.get("up_b")?.();
    await settle();
    app.tick();

    expect(previewsOf(app).children).toHaveLength(2);
    expect(first.destroyed, "the first mark's sprite was rebuilt").toBe(false);
    expect(previewsOf(app).children).toContain(first);
    scene.destroy();
  });
});

describe("a picture the graph no longer draws", () => {
  it("is freed, and nothing on the canvas is left holding it", async () => {
    const field = [drawn("1", "up_a"), drawn("2", "up_b")];
    const { scene, app } = await sceneOn(field, host());
    await settle();
    app.tick();

    const sprites = previewsOf(app).children as FakeSprite[];
    const textures = sprites.map((sprite) => sprite.texture);
    expect(textures.every((texture) => !texture.destroyed)).toBe(true);

    scene.setModel(
      buildModel([drawn("1", "up_a")], { selection: [], palette }),
      false,
    );

    // Before anything renders again, not merely before the next model arrives.
    expect(
      previewsOf(app).children,
      "a sprite outlived the texture it drew from",
    ).toHaveLength(0);
    expect(textures.some((texture) => texture.destroyed)).toBe(true);

    await settle();
    app.tick();
    expect(previewsOf(app).children).toHaveLength(1);
    scene.destroy();
  });

  it("goes with the canvas when it is torn down", async () => {
    const { scene, app } = await sceneOn([drawn("1", "up_a")], host());
    await settle();
    app.tick();

    const sprite = previewsOf(app).children[0] as FakeSprite;
    scene.destroy();
    expect(sprite.destroyed).toBe(true);
    expect(sprite.texture.destroyed).toBe(true);
  });
});
