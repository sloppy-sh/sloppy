// DESIGN.md § "The mark": the paper under a mark carries whether its note is
// open, at two strengths. What the canvas puts on that paper is held here; the
// geometry the two strengths take is `scene.test.ts`'s.

import type { NodeView, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  FakeGraphics,
  type StrokedRing,
  worldOf,
} from "./pixi.test-support.js";
import { liftInk, liftOf } from "./scene.js";

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

function drawn(address: string, tags: Tag[] = []): DrawnNode {
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
    tags,
    links: [],
    published: false,
  } as NodeView;
  return { node, collapsed: false, folded: 0, tags };
}

const ref = (address: string): OwnedRef => `${OWNER}/${address}` as OwnedRef;

/** What `model.ts` draws an unstyled leaf at, and the zoom a fresh canvas
 *  sits at before anything frames it. */
const LEAF = 9;
const SCALE = 1;

async function canvasOn(
  field: DrawnNode[],
  selection: Tag[] = [],
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
  scene.setModel(
    buildModel(field, { selection, palette }),
    selection.length > 0,
  );
  return { scene, app };
}

/** The layer the lift is laid on: the first the world holds, under every line. */
function liftLayer(app: FakeApplication): FakeGraphics {
  const first = worldOf(app).children[0];
  if (!(first instanceof FakeGraphics)) {
    throw new Error("The world draws something else beneath its marks");
  }
  return first;
}

/** How far the rings around one mark reach, and the ink they lay at its edge. */
function under(rings: StrokedRing[], radius: number) {
  const reach = Math.max(...rings.map((ring) => ring.radius + ring.width / 2));
  const innermost = rings.reduce((closest, ring) =>
    ring.radius < closest.radius ? ring : closest,
  );
  expect(innermost.radius - innermost.width / 2).toBeCloseTo(radius, 6);
  return { reach, ink: innermost.alpha };
}

describe("the paper under a note that is open", () => {
  it("is lifted, and lifted further under the one being read", async () => {
    const field = [drawn("1"), drawn("2"), drawn("3")];
    const { scene, app } = await canvasOn(field);
    scene.setReading({
      open: new Set([ref("1"), ref("2")]),
      active: ref("2"),
    });
    app.tick();

    const byMark = new Map<string, StrokedRing[]>();
    for (const ring of liftLayer(app).rings) {
      const at = `${ring.x},${ring.y}`;
      byMark.set(at, [...(byMark.get(at) ?? []), ring]);
    }
    expect(byMark.size, "only the open notes are lifted").toBe(2);

    const lifts = [...byMark.values()]
      .map((laid) => under(laid, LEAF))
      .sort((a, b) => a.ink - b.ink);
    expect(lifts[0].reach, "an open note casts nothing").toBeGreaterThan(LEAF);
    expect(lifts[0].ink).toBeCloseTo(
      liftInk(liftOf(LEAF, false, SCALE), LEAF),
      6,
    );
    expect(lifts[1].ink).toBeCloseTo(
      liftInk(liftOf(LEAF, true, SCALE), LEAF),
      6,
    );
    expect(
      lifts[1].reach,
      "the note being read reaches no further than one merely open",
    ).toBeGreaterThan(lifts[0].reach);
    scene.destroy();
  });

  it("stays at full strength on a note the reader's tags have dimmed", async () => {
    const lit = "biology" as Tag;
    const field = [drawn("1", [lit]), drawn("2")];
    const { scene, app } = await canvasOn(field, [lit]);
    const dimmed = scene.attributesOf(ref("2"));
    expect(
      dimmed?.alpha,
      "the tag question did not dim this mark",
    ).toBeLessThan(1);

    scene.setReading({ open: new Set([ref("2")]), active: ref("2") });
    app.tick();

    // § Hue's alpha answers the question the reader asked; the lift answers
    // where the reader is, so the question does not fade it.
    expect(under(liftLayer(app).rings, LEAF).ink).toBeCloseTo(
      liftInk(liftOf(LEAF, true, SCALE), LEAF),
      6,
    );
    scene.destroy();
  });

  // A pinch moves the viewport and nothing else, so the lift has to be laid
  // again on the zoom the way the orbit and the labels are: the floor is
  // measured on the screen, and a reach left at the scale it was drawn at is
  // either invisible or a halo over the neighbourhood.
  it("is laid again on a pinch, at both ends of it", async () => {
    const { scene, app } = await canvasOn([drawn("1")]);
    scene.setReading({ open: new Set([ref("1")]), active: ref("1") });
    app.tick();

    const zoomTo = (scale: number) => {
      scene.viewport.zoomAt(0, 0, scale / scene.viewport.scale);
      app.tick();
    };

    zoomTo(1 / 18);
    const spread = under(liftLayer(app).rings, LEAF).reach - LEAF;
    expect(
      LEAF * scene.viewport.scale,
      "the mark is under a pixel",
    ).toBeLessThan(1);
    expect(spread * scene.viewport.scale, "on screen").toBeGreaterThan(4);

    zoomTo(3);
    expect(
      under(liftLayer(app).rings, LEAF).reach,
      "the field reach came back to the mark's own size",
    ).toBeCloseTo(
      Math.max(
        ...liftOf(LEAF, true, 3).map((band) => band.at + band.width / 2),
      ),
      6,
    );
    scene.destroy();
  });

  it("is taken off the paper the moment nothing is open", async () => {
    const { scene, app } = await canvasOn([drawn("1")]);
    scene.setReading({ open: new Set([ref("1")]), active: ref("1") });
    app.tick();
    expect(liftLayer(app).rings.length).toBeGreaterThan(0);

    scene.setReading(null);
    app.tick();
    expect(liftLayer(app).rings).toHaveLength(0);
    scene.destroy();
  });

  it("is drawn in the theme's ink, so it inverts with the paper", async () => {
    const { scene, app } = await canvasOn([drawn("1")]);
    scene.setReading({ open: new Set([ref("1")]), active: null });
    app.tick();

    for (const ring of liftLayer(app).rings) {
      expect(ring.color).toBe(palette.ink);
    }
    scene.destroy();
  });
});
