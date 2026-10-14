// DESIGN.md § Hue: a mark wears a band per drawn set it stands in, side by side
// in the rail's order, and falls back to the first of them where they are too
// narrow to be told apart. What is checked here is what the scene ASKED to have
// drawn — the figure itself is a GPU fact and `bench/` is where it is looked at.

import type {
  DidSyr,
  NodeView,
  OwnedRef,
  Tag,
  TagHueSlot,
} from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphDifference } from "./contract.js";
import {
  type BuiltModel,
  buildModel,
  LEAF_RADIUS,
  MARK_BANDS_MOST,
  MAX_RADIUS,
} from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  FakeGraphics,
  type FakeParticle,
  FakeParticleContainer,
  type FakeRectangle,
  worldOf,
} from "./pixi.test-support.js";
import { packSets, SETS_STEP } from "./sets/pack.js";
import { MAX_SCALE } from "./viewport.js";

vi.mock("pixi.js", async () => {
  const { fakePixi } = await import("./pixi.test-support.js");
  return fakePixi();
});

const { BAND_MIN_WIDTH, bandsDrawn, bandWidth, FILL_AT, GraphScene } =
  await import("./scene.js");

const OWNER = "did:syr:someone" as DidSyr;
const STRANGER = "did:syr:somebodyelse" as DidSyr;

/** Eight hues far enough apart that the slot a band is drawn in is readable off
 *  its tint alone. */
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

/** One more tag than there are hue slots, so a mark can be asked to stand in
 *  one more set than the bands go up to. */
const TAGS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
] as Tag[];

function note(
  address: string,
  tags: readonly Tag[],
  owner: DidSyr = OWNER,
): NodeView {
  const ref = `${owner}/${address}` as OwnedRef;
  return {
    ref,
    created_by: owner,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: 1,
    origin: ref,
    title: `note ${address}`,
    tags: [...tags],
    links: [],
    published: false,
  } as NodeView;
}

function drawn(
  address: string,
  tags: readonly Tag[],
  owner: DidSyr = OWNER,
  folded = 0,
): DrawnNode {
  return {
    node: note(address, tags, owner),
    collapsed: folded > 0,
    folded,
    tags: [...tags],
  };
}

interface Canvas {
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  app: FakeApplication;
}

async function sceneOver(
  model: BuiltModel,
  selecting: boolean,
  resolution = 1,
): Promise<Canvas> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", heading: "heading", address: "mono" },
    palette,
    resolution,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(model, selecting);
  app.tick();
  return { scene, app };
}

async function canvas(
  field: readonly DrawnNode[],
  selection: readonly Tag[],
  over: { resolution?: number; viewer?: DidSyr } = {},
): Promise<Canvas> {
  return sceneOver(
    buildModel([...field], { selection, palette, viewer: over.viewer }),
    selection.length > 0,
    over.resolution ?? 1,
  );
}

/** The particle layers the world holds, in the order `scene.ts` adds them: the
 *  mark fills, the bands over them, the looks, then provenance. */
function layers(app: FakeApplication): FakeParticleContainer[] {
  return worldOf(app).children.filter(
    (child): child is FakeParticleContainer =>
      child instanceof FakeParticleContainer,
  );
}

const fillsOf = (app: FakeApplication): FakeParticle[] =>
  layers(app)[0].particleChildren as FakeParticle[];
const bandsOf = (app: FakeApplication): FakeParticle[] =>
  layers(app)[1].particleChildren as FakeParticle[];
const ringsOf = (app: FakeApplication): FakeParticle[] =>
  layers(app)[3].particleChildren as FakeParticle[];

/** The window on the sheet a band is read through. */
function frameOf(band: FakeParticle): FakeRectangle {
  const { frame } = band.texture?.of as { frame: FakeRectangle };
  return frame;
}

const hues = (slots: readonly TagHueSlot[]) =>
  slots.map((at) => palette.tag(at));

/** The layer a mark too big for the sheet is drawn on, of the ten the world
 *  holds: the regions, the lift, the three kinds of line, the difference, then
 *  the shapes. */
function shapesOf(app: FakeApplication): FakeGraphics {
  const held = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return held[6];
}

function zoomTo(scene: Canvas["scene"], scale: number): void {
  scene.viewport.scale = scale;
  scene.invalidate();
}

describe("a mark standing in several drawn sets", () => {
  it("wears a band per set, in the rail's order and each in its hue", async () => {
    const { scene, app } = await canvas(
      [drawn("1", [TAGS[2], TAGS[0]])],
      [TAGS[0], TAGS[1], TAGS[2]],
    );

    const bands = bandsOf(app);
    expect(bands).toHaveLength(2);
    // The first and the third selected, so slots 1 and 3 — left to right in
    // the order the rail lists them, whatever order the note carries them in.
    expect(bands.map((band) => band.tint)).toEqual(hues([1, 3]));
    expect(bands.every((band) => band.alpha === 1)).toBe(true);
    // The whole disc stays under them, at nothing: it is the hue the mark falls
    // back to below the width floor.
    expect(fillsOf(app)).toHaveLength(1);
    expect(fillsOf(app)[0].alpha).toBe(0);
    expect(fillsOf(app)[0].tint).toBe(palette.tag(1));
    scene.destroy();
  });

  it("stands its bands side by side across the mark", async () => {
    const { scene, app } = await canvas(
      [drawn("1", TAGS.slice(0, 4))],
      TAGS.slice(0, 4),
    );

    const bands = bandsOf(app);
    expect(bands).toHaveLength(4);
    const frames = bands.map(frameOf);
    // Each band is its own window on the sheet, and the four tile one mark:
    // same width, each starting where the one before it ended.
    for (const frame of frames) {
      expect(frame.width).toBeCloseTo(frames[0].width, 6);
      expect(frame.height).toBe(frames[0].height);
      expect(frame.y).toBe(frames[0].y);
    }
    for (let at = 1; at < frames.length; at++) {
      expect(frames[at].x).toBeCloseTo(frames[at - 1].x + frames[0].width, 6);
    }
    // And they stand where the fill stands, each anchored its own share of the
    // way across it, so the four read as one disc.
    const [fill] = fillsOf(app);
    for (const band of bands) {
      expect(band.x).toBe(fill.x);
      expect(band.y).toBe(fill.y);
      expect(band.scaleX).toBe(fill.scaleX);
      expect(band.scaleY).toBe(fill.scaleY);
    }
    scene.destroy();
  });

  it("is the whole disc where it stands in one of them", async () => {
    const { scene, app } = await canvas(
      [drawn("1", [TAGS[1]])],
      [TAGS[0], TAGS[1]],
    );

    expect(bandsOf(app)).toHaveLength(0);
    const [fill] = fillsOf(app);
    expect(fill.alpha).toBe(1);
    expect(fill.tint).toBe(palette.tag(2));
    scene.destroy();
  });

  it("wears none where it stands in none of them", async () => {
    const { scene, app } = await canvas([drawn("1", [])], [TAGS[0], TAGS[1]]);

    expect(bandsOf(app)).toHaveLength(0);
    expect(fillsOf(app)[0].alpha).toBeLessThan(1);
    scene.destroy();
  });

  // DESIGN.md § Hue: every unselected mark gives up the same share of its own
  // fill, and a mark wearing bands gives up that share on every one of them.
  it("gives up the same share of every band where it is dimmed", async () => {
    const field = [drawn("1", [TAGS[0], TAGS[1]]), drawn("2", [TAGS[0]])];
    const difference: GraphDifference = {
      added: new Set([field[1].node.ref]),
      removed: [],
      moved: [],
      changed: new Set(),
    };
    const scene = await GraphScene.create({} as HTMLCanvasElement, {
      fonts: { ui: "ui", heading: "heading", address: "mono" },
      palette,
      resolution: 1,
    });
    const app = FakeApplication.latest as FakeApplication;
    // A canvas comparing two states recedes everything neither state moved, so
    // a mark in both selected sets is dimmed while still standing in them.
    const model = buildModel(field, {
      selection: [TAGS[0], TAGS[1]],
      palette,
      difference,
    });
    scene.setModel(model, true);
    app.tick();

    const dimmed = model.graph.getNodeAttributes(field[0].node.ref);
    expect(dimmed.alpha).toBeLessThan(1);
    expect(dimmed.slots).toHaveLength(2);
    const bands = bandsOf(app);
    expect(bands).toHaveLength(2);
    expect(bands.map((band) => band.alpha)).toEqual([
      dimmed.alpha,
      dimmed.alpha,
    ]);
    scene.destroy();
  });

  // A ring is no disc to divide, so a mark somebody else wrote keeps the one
  // hue on its edge and the rail says the rest — DESIGN.md § Hue.
  it("keeps one hue on the edge of a mark drawn hollow", async () => {
    const { scene, app } = await canvas(
      [drawn("1", [TAGS[0], TAGS[1]], STRANGER)],
      [TAGS[0], TAGS[1]],
      { viewer: OWNER },
    );

    expect(bandsOf(app)).toHaveLength(0);
    expect(fillsOf(app)).toHaveLength(0);
    const [ring] = ringsOf(app);
    expect(ring.tint).toBe(palette.tag(1));
    scene.destroy();
  });

  // A mega-node answers for the subtree it replaced, so it wears the bands of
  // the selected tags its subtree carries — DESIGN.md § "The mark".
  it("wears the bands of a fold's whole subtree", async () => {
    const { scene, app } = await canvas(
      [drawn("1", [TAGS[0], TAGS[1]], OWNER, 12)],
      [TAGS[0], TAGS[1]],
    );

    expect(bandsOf(app).map((band) => band.tint)).toEqual(hues([1, 2]));
    scene.destroy();
  });

  // Past the slots the hues repeat (DESIGN.md § Hue), and a band in a hue the
  // mark already wears says nothing.
  it("wears no more bands than there are hues", async () => {
    const model = buildModel([drawn("1", TAGS)], { selection: TAGS, palette });
    const node = model.graph.getNodeAttributes(`${OWNER}/1` as OwnedRef);
    expect(TAGS.length).toBeGreaterThan(MARK_BANDS_MOST);
    expect(node.slots).toHaveLength(MARK_BANDS_MOST);
    expect(node.slots).toEqual(
      Array.from({ length: MARK_BANDS_MOST }, (_unused, at) => at + 1),
    );
  });
});

// DESIGN.md § Hue: a tag question is answered on the marks already up, so the
// bands arrive and leave on that same path.
describe("selecting another tag", () => {
  const field = [drawn("1", [TAGS[0], TAGS[1]]), drawn("2", [TAGS[0]])];
  const asked = (selection: readonly Tag[]) =>
    buildModel(field, { selection, palette });

  it("puts the bands up and takes them down again", async () => {
    const { scene, app } = await canvas(field, [TAGS[0]]);
    expect(bandsOf(app)).toHaveLength(0);
    const standing = fillsOf(app).map((fill) => fill.texture);

    scene.setTints(asked([TAGS[0], TAGS[1]]), true);
    app.tick();
    expect(bandsOf(app).map((band) => band.tint)).toEqual(hues([1, 2]));
    expect(fillsOf(app)[0].alpha).toBe(0);
    expect(fillsOf(app)[1].alpha).toBe(1);
    // The marks themselves are the ones that were already up.
    expect(fillsOf(app).map((fill) => fill.texture)).toEqual(standing);

    scene.setTints(asked([TAGS[0]]), true);
    app.tick();
    expect(bandsOf(app)).toHaveLength(0);
    expect(fillsOf(app)[0].alpha).toBe(1);
    expect(fillsOf(app)[0].tint).toBe(palette.tag(1));
    scene.destroy();
  });
});

// DESIGN.md § Hue: the bands go before the mark does, and the floor is drawn
// width — a pinch brings them back.
describe("a mark drawn too small for its bands", () => {
  const field = [drawn("1", [TAGS[0], TAGS[1]])];
  const selection = [TAGS[0], TAGS[1]];

  it("falls back to the first hue, and takes the bands back on a pinch", async () => {
    const { scene, app } = await canvas(field, selection);
    /** What is drawn at a zoom: the whole disc, or the bands. */
    const drawnAt = (scale: number) => {
      zoomTo(scene, scale);
      app.tick();
      return {
        disc: fillsOf(app)[0].alpha,
        bands: bandsOf(app).map((band) => band.alpha),
      };
    };

    expect(drawnAt(1)).toEqual({ disc: 0, bands: [1, 1] });

    // Inside the latch's own margin, so a mark drifting across the line keeps
    // what it has.
    const holding = (BAND_MIN_WIDTH * 0.8 * 2) / (LEAF_RADIUS * FILL_AT * 2);
    expect(bandWidth(LEAF_RADIUS * holding, 2)).toBeLessThan(BAND_MIN_WIDTH);
    expect(bandsDrawn(bandWidth(LEAF_RADIUS * holding, 2), true)).toBe(true);
    expect(drawnAt(holding)).toEqual({ disc: 0, bands: [1, 1] });

    // Past it, the mark is one hue.
    const gone = holding / 2;
    expect(bandsDrawn(bandWidth(LEAF_RADIUS * gone, 2), true)).toBe(false);
    expect(drawnAt(gone)).toEqual({ disc: 1, bands: [0, 0] });

    // And the margin holds the other way: the width that kept them does not win
    // them back.
    expect(drawnAt(holding)).toEqual({ disc: 1, bands: [0, 0] });
    expect(drawnAt(1)).toEqual({ disc: 0, bands: [1, 1] });
    scene.destroy();
  });

  // The look is held against the view a graph opens on; the bands are not, so a
  // leaf on a framed field may well show one hue.
  it("keeps the bands it was built with, to put back on a pinch", async () => {
    const { scene, app } = await canvas(field, selection);
    zoomTo(scene, 0.1);
    app.tick();
    expect(bandsOf(app)).toHaveLength(2);
    expect(bandsOf(app).every((band) => band.alpha === 0)).toBe(true);
    zoomTo(scene, 1);
    app.tick();
    expect(bandsOf(app).every((band) => band.alpha === 1)).toBe(true);
    scene.destroy();
  });
});

describe("a banded mark too big for the sheet", () => {
  it("is drawn as the same chords, in the same order", async () => {
    const field = [
      drawn("1", [TAGS[0], TAGS[1]], OWNER, 4000),
      drawn("2", [TAGS[0]]),
    ];
    const { scene, app } = await canvas(field, [TAGS[0], TAGS[1]], {
      resolution: 3,
    });
    zoomTo(scene, MAX_SCALE);
    app.tick();

    const shapes = shapesOf(app);
    expect(shapes.discs, "a banded mark is never one disc").toHaveLength(0);
    expect(shapes.paths).toHaveLength(2);
    expect(shapes.paths.map((path) => path.color)).toEqual(hues([1, 2]));
    // Two arcs of the mark's own circle for each band: the top of it and the
    // bottom, which is what closes the chord.
    expect(shapes.arcs).toHaveLength(4);
    const across = MAX_RADIUS * FILL_AT;
    for (const arc of shapes.arcs) expect(arc.radius).toBeCloseTo(across, 6);

    const spans = shapes.paths.map((path) => ({
      from: Math.min(...path.points.map(([x]) => x)),
      to: Math.max(...path.points.map(([x]) => x)),
    }));
    for (const span of spans)
      expect(span.to - span.from).toBeCloseTo(across, 6);
    expect(spans[0].to).toBeCloseTo(spans[1].from, 6);
    // The leaf beside it is small enough to stay on the sheet.
    expect(bandsOf(app)).toHaveLength(2);
    scene.destroy();
  });
});

describe("the sheet the bands are read off", () => {
  it("costs the marks' own sheet nothing: the bands are windows on the disc", async () => {
    const plain = await canvas([drawn("1", [TAGS[0]])], [TAGS[0]]);
    const [discFrame] = fillsOf(plain.app).map(frameOf);
    expect(plain.app.cut).toHaveLength(1);
    plain.scene.destroy();

    for (let count = 2; count <= MARK_BANDS_MOST; count++) {
      const { scene, app } = await canvas(
        [drawn("1", TAGS.slice(0, count))],
        TAGS.slice(0, count),
      );
      const frames = bandsOf(app).map(frameOf);
      expect(frames, `${count} bands`).toHaveLength(count);
      // One cut, whatever a mark wears: no band is a cell of its own.
      expect(app.cut, `${count} bands`).toHaveLength(1);
      for (const frame of frames) {
        expect(frame.x).toBeGreaterThanOrEqual(discFrame.x);
        expect(frame.x + frame.width).toBeLessThanOrEqual(
          discFrame.x + discFrame.width,
        );
        expect(frame.y).toBe(discFrame.y);
        expect(frame.height).toBe(discFrame.height);
      }
      // The bands cover the fill, and only the fill.
      expect(frames[0].x).toBeCloseTo(
        discFrame.x + (discFrame.width * (1 - FILL_AT)) / 2,
        6,
      );
      const last = frames[count - 1];
      expect(last.x + last.width).toBeCloseTo(
        discFrame.x + discFrame.width - (discFrame.width * (1 - FILL_AT)) / 2,
        6,
      );
      scene.destroy();
    }
  });
});

// DESIGN.md § "Sets — the tags as places": a fold stands for every note in its
// region, so it wears the bands of that region's own sets.
describe("a fold over a region", () => {
  it("wears the bands of the sets its region stands in", async () => {
    const selection = [TAGS[0], TAGS[1]];
    const field = [
      ...Array.from({ length: 6 }, (_unused, at) =>
        drawn(`1a${at}`, selection),
      ),
      ...Array.from({ length: 3 }, (_unused, at) =>
        drawn(`1b${at}`, [TAGS[0]]),
      ),
    ];
    const packing = packSets({
      notes: field.map((entry) => ({
        ref: entry.node.ref,
        graph: `${OWNER}/graph` as OwnedRef,
        tags: entry.tags,
        created_at: entry.node.created_at,
      })),
      fields: [],
      selection,
      spacing: SETS_STEP,
      // Fewer places than notes, so the crowded region folds.
      most: 4,
      gutter: 900,
    });
    const folds = packing.marks.filter((mark) => mark.holds.length > 0);
    expect(folds.length).toBeGreaterThan(0);

    const model = buildModel(field, {
      arrangement: "sets",
      sets: packing,
      selection,
      palette,
    });
    for (const fold of folds) {
      const node = model.graph.getNodeAttributes(fold.ref);
      const standing = [fold.ref, ...fold.holds];
      const sets = selection.filter((tag) =>
        standing.every(
          (ref) =>
            field.find((entry) => entry.node.ref === ref)?.tags.includes(tag) ??
            false,
        ),
      );
      expect(node.slots).toEqual(sets.map((tag) => selection.indexOf(tag) + 1));
    }
  });
});

// DESIGN.md § Hue: in the sets reading the drawing is the question, so a mark
// wears a band of every region it stands in whether or not that set was
// selected — while the dim stays where § Hue leaves it.
describe("the sets reading", () => {
  const field = [
    drawn("1", [TAGS[0], TAGS[1]]),
    drawn("2", [TAGS[0]]),
    drawn("3", [TAGS[1]]),
    drawn("4", []),
  ];
  const [both, one, other, none] = field.map((entry) => entry.node.ref);

  /** The field packed into regions, and the model drawn over that packing. */
  function packed(selection: readonly Tag[]): {
    model: BuiltModel;
    drawnSets: readonly Tag[];
  } {
    const packing = packSets({
      notes: field.map((entry) => ({
        ref: entry.node.ref,
        graph: `${OWNER}/graph` as OwnedRef,
        tags: entry.tags,
        created_at: entry.node.created_at,
      })),
      fields: [],
      selection,
      spacing: SETS_STEP,
      most: 64,
      gutter: 900,
    });
    return {
      model: buildModel(field, {
        arrangement: "sets",
        sets: packing,
        selection,
        palette,
      }),
      drawnSets: packing.drawn.tags,
    };
  }

  const slotsOf = (model: BuiltModel, ref: OwnedRef) =>
    model.graph.getNodeAttributes(ref).slots;

  it("bands a mark in two sets before anything is selected", async () => {
    const { model, drawnSets } = packed([]);
    expect(drawnSets).toEqual([TAGS[0], TAGS[1]]);
    expect(slotsOf(model, both)).toEqual([1, 2]);

    const { scene, app } = await sceneOver(model, false);
    // Only the mark standing in two of them wears bands; the others are each
    // one disc in their own set's hue.
    expect(bandsOf(app).map((band) => band.tint)).toEqual(hues([1, 2]));
    const fills = fillsOf(app);
    const at = (ref: OwnedRef) => fills[model.order.indexOf(ref)];
    expect(at(one).tint).toBe(palette.tag(1));
    expect(at(one).alpha).toBe(1);
    expect(at(other).tint).toBe(palette.tag(2));
    expect(at(other).alpha).toBe(1);
    scene.destroy();
  });

  it("lights a mark standing in a set nobody selected", () => {
    const { model, drawnSets } = packed([TAGS[1]]);
    // Selected first, then the rest by how many notes carry them.
    expect(drawnSets).toEqual([TAGS[1], TAGS[0]]);
    // The unselected set is drawn, so the mark standing in it alone wears its
    // hue and stands at full presence.
    expect(slotsOf(model, one)).toEqual([2]);
    expect(model.graph.getNodeAttributes(one).fill).toBe(palette.tag(2));
    expect(model.graph.getNodeAttributes(one).alpha).toBe(1);
  });

  it("reads the bands off the drawn sets and the dim off the regions", () => {
    const { model } = packed([TAGS[1]]);
    // The bands are in the order the figure draws the sets, which the
    // selection leads: the selected one on the left.
    expect(slotsOf(model, both)).toEqual([1, 2]);
    // And the dim is unmoved by any of it: only the mark standing in no drawn
    // set at all recedes.
    expect(slotsOf(model, none)).toEqual([]);
    expect(model.graph.getNodeAttributes(none).alpha).toBeLessThan(1);
    for (const ref of [both, one, other])
      expect(model.graph.getNodeAttributes(ref).alpha).toBe(1);
  });

  // The genealogy asks a different question: there the bands and the dim are
  // both the selection's — DESIGN.md § Hue.
  it("leaves the genealogy reading asking only what was selected", () => {
    const asked = buildModel(field, { selection: [TAGS[1]], palette });
    expect(asked.graph.getNodeAttributes(both).slots).toEqual([1]);
    expect(asked.graph.getNodeAttributes(other).slots).toEqual([1]);
    // A note in no selected tag wears no band and dims, whatever else it
    // carries.
    for (const ref of [one, none]) {
      expect(asked.graph.getNodeAttributes(ref).slots).toEqual([]);
      expect(asked.graph.getNodeAttributes(ref).alpha).toBeLessThan(1);
    }

    const quiet = buildModel(field, { selection: [], palette });
    for (const ref of [both, one, other, none]) {
      expect(quiet.graph.getNodeAttributes(ref).slots).toEqual([]);
      expect(quiet.graph.getNodeAttributes(ref).alpha).toBe(1);
    }
  });
});
