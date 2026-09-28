// DESIGN.md § "A difference between two states": three values in the orbit, and
// a move on the lines. What the model decides is `difference.test.ts`'s; what
// the canvas strikes for each of them is here.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import {
  type DrawnNode,
  type GraphDifference,
  nodesWithGone,
} from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  FakeGraphics,
  FakeParticleContainer,
  type StrokedLine,
  worldOf,
} from "./pixi.test-support.js";
import {
  CHOSEN_BAND,
  DIFFERENCE_BREAK,
  DIFFERENCE_GONE_INK,
  DIFFERENCE_INK,
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

function note(address: string, over: Partial<NodeView> = {}): NodeView {
  return {
    ref: ref(address),
    created_by: OWNER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: address.length,
    origin: ref(address),
    title: address,
    tags: [],
    links: [],
    published: false,
    ...over,
  } as NodeView;
}

const drawn = (nodes: readonly NodeView[]): DrawnNode[] =>
  nodes.map((node) => ({ node, collapsed: false, folded: 0, tags: [] }));

const nothing: GraphDifference = {
  added: new Set(),
  removed: [],
  moved: [],
  changed: new Set(),
};

const asking = (over: Partial<GraphDifference>): GraphDifference => ({
  ...nothing,
  ...over,
});

const field = [
  note("1"),
  note("1a", { parent: ref("1") }),
  note("2"),
  note("2a", { parent: ref("2") }),
];

interface Canvas {
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  app: FakeApplication;
}

async function canvasOn(
  difference: GraphDifference | undefined,
  region: readonly NodeView[] = field,
): Promise<Canvas> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(
    buildModel(drawn(nodesWithGone(region, difference)), {
      selection: [],
      palette,
      difference,
    }),
    false,
  );
  app.tick();
  return { scene, app };
}

/** The graphics the world holds, in the order `scene.ts` adds them: the lift,
 *  the three line passes, the difference, the shapes, their edges, the orbit,
 *  and the rim's dots over it. */
function layers(app: FakeApplication): {
  genealogy: FakeGraphics;
  runs: FakeGraphics;
  connections: FakeGraphics;
  difference: FakeGraphics;
  orbit: FakeGraphics;
} {
  const held = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return {
    genealogy: held[1],
    runs: held[2],
    connections: held[3],
    difference: held[4],
    orbit: held[held.length - 2],
  };
}

/** The mark fills the canvas put up, which is what stands inside a band. */
function fillCount(app: FakeApplication): number {
  const layer = worldOf(app).children.find(
    (child): child is FakeParticleContainer =>
      child instanceof FakeParticleContainer,
  );
  if (!layer) throw new Error("The world holds no marks");
  return layer.particleChildren.length;
}

describe("the orbit while two states are compared", () => {
  it("closes a band round a note that arrived, with the mark inside it", async () => {
    const { scene, app } = await canvasOn(
      asking({ added: new Set([field[1].ref]) }),
    );
    const { orbit } = layers(app);
    expect(orbit.rings).toHaveLength(1);
    expect(orbit.arcs).toHaveLength(0);
    expect(orbit.rings[0].alpha).toBe(DIFFERENCE_INK);
    expect(fillCount(app)).toBe(field.length);
    scene.destroy();
  });

  // The one mark on any canvas drawn as a band around nothing, so it cannot be
  // read as a hollow pulled mark.
  it("closes a band round nothing at all for a note that went", async () => {
    const gone = note("1b", { parent: ref("1") });
    const { scene, app } = await canvasOn(asking({ removed: [gone] }));
    const { orbit } = layers(app);
    expect(orbit.rings).toHaveLength(1);
    expect(orbit.arcs).toHaveLength(0);
    // Four marks drawn and five bands' worth of notes on the canvas: the note
    // that went put nothing inside its own.
    expect(fillCount(app)).toBe(field.length);
    scene.destroy();
  });

  it("breaks the band round a note that is not as it was", async () => {
    const { scene, app } = await canvasOn(
      asking({ changed: new Set([field[1].ref]) }),
    );
    const { orbit } = layers(app);
    expect(orbit.rings).toHaveLength(0);
    expect(orbit.arcs).toHaveLength(DIFFERENCE_BREAK.dashes);
    scene.destroy();
  });

  it("bands a note that only moved not at all", async () => {
    const { scene, app } = await canvasOn(
      asking({ moved: [{ ref: field[3].ref, from: field[0].ref }] }),
    );
    const { orbit } = layers(app);
    expect(orbit.rings).toHaveLength(0);
    expect(orbit.arcs).toHaveLength(0);
    scene.destroy();
  });

  // The orbit's three modes are one channel, so the band a difference lays and
  // the band a chosen note wears stand the same distance off the mark.
  it("lays the band where the orbit's other modes lay theirs", async () => {
    const { scene, app } = await canvasOn(
      asking({ added: new Set([field[1].ref]) }),
    );
    const banded = layers(app).orbit.rings[0];
    scene.destroy();

    const plain = await canvasOn(undefined);
    plain.scene.setChosen(new Set([field[1].ref]));
    plain.app.tick();
    const chosen = layers(plain.app).orbit.rings[0];
    expect(banded.radius).toBeCloseTo(chosen.radius, 6);
    expect(banded.width).toBeCloseTo(CHOSEN_BAND, 6);
    expect(banded.width).toBeCloseTo(chosen.width, 6);
    plain.scene.destroy();
  });

  it("leaves the orbit alone where the two states are the same", async () => {
    const { scene, app } = await canvasOn(nothing);
    const { orbit, difference } = layers(app);
    expect(orbit.rings).toHaveLength(0);
    expect(orbit.arcs).toHaveLength(0);
    expect(difference.lines).toHaveLength(0);
    scene.destroy();
  });
});

describe("the lines a difference draws", () => {
  it("draws the line a note arrived with whole", async () => {
    const { scene, app } = await canvasOn(
      asking({ added: new Set([field[1].ref]) }),
    );
    const { difference } = layers(app);
    expect(difference.lines).toHaveLength(1);
    expect(difference.lines[0].alpha).toBe(DIFFERENCE_INK);
    expect(difference.lines[0].color).toBe(palette.ink);
    scene.destroy();
  });

  // The break belongs to the hand that drew a line and says nothing else
  // (DESIGN.md § Edges), so the two move lines separate on ink instead: one
  // whole line each, and the fainter is the one the note left.
  it("draws both lines whole, at one weight, and separates them on ink", async () => {
    const { scene, app } = await canvasOn(
      asking({ moved: [{ ref: field[1].ref, from: field[2].ref }] }),
    );
    const lines = layers(app).difference.lines;
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((line) => line.color))).toEqual(
      new Set([palette.ink]),
    );
    expect(new Set(lines.map((line) => line.width)).size).toBe(1);
    expect(new Set(lines.map((line) => line.alpha))).toEqual(
      new Set([DIFFERENCE_INK, DIFFERENCE_GONE_INK]),
    );
    scene.destroy();
  });

  // Both stand clear of the loudest line under them, which is the run's while
  // the field has receded to be compared.
  it("strikes both over everything the receded field draws", async () => {
    const { scene, app } = await canvasOn(
      asking({ moved: [{ ref: field[1].ref, from: field[2].ref }] }),
    );
    const under = layers(app).runs.lines[0].alpha;
    for (const line of layers(app).difference.lines) {
      expect(line.alpha).toBeGreaterThan(under);
    }
    scene.destroy();
  });
});

describe("the field a difference is read against", () => {
  it("recedes every line the addresses and the writing make", async () => {
    const plain = await canvasOn(undefined);
    const before = layers(plain.app);
    const alphas = {
      genealogy: before.genealogy.lines[0].alpha,
      runs: before.runs.lines[0].alpha,
    };
    plain.scene.destroy();

    const { scene, app } = await canvasOn(
      asking({ changed: new Set([field[1].ref]) }),
    );
    const receded = layers(app);
    expect(receded.genealogy.lines[0].alpha).toBeLessThan(alphas.genealogy);
    expect(receded.runs.lines[0].alpha).toBeLessThan(alphas.runs);
    scene.destroy();
  });

  it("leaves every line where it was where the two states are the same", async () => {
    const plain = await canvasOn(undefined);
    const before = layers(plain.app);
    const alphas = [
      before.genealogy.lines[0].alpha,
      before.runs.lines[0].alpha,
    ];
    plain.scene.destroy();

    const { scene, app } = await canvasOn(nothing);
    const held = layers(app);
    expect([held.genealogy.lines[0].alpha, held.runs.lines[0].alpha]).toEqual(
      alphas,
    );
    scene.destroy();
  });
});

// The later state's own shape survives the question: nothing but the line a
// difference strikes reaches a note this state does not hold, and the notes
// either side of one read as consecutive, because they are.
describe("a note that went, against the lines the state itself draws", () => {
  const gone = note("1b", { parent: ref("1") });

  it("draws no ordinary line to it", async () => {
    const { scene, app } = await canvasOn(asking({ removed: [gone] }));
    const held = layers(app);
    const ends = (lines: readonly StrokedLine[]) =>
      lines.flatMap((line) => [line.from, line.to]);
    const at = held.difference.lines[0].from;
    for (const point of ends([...held.genealogy.lines, ...held.runs.lines])) {
      expect(point).not.toEqual(at);
    }
    expect(held.difference.lines).toHaveLength(1);
    scene.destroy();
  });

  it("leaves the notes either side of it reading as consecutive", async () => {
    const run = [note("1"), note("1a", { parent: ref("1") })];
    const later = [...run, note("1c", { parent: ref("1") })];
    const between = note("1b", { parent: ref("1") });

    const plain = await canvasOn(undefined, later);
    const held = layers(plain.app).runs.lines.length;
    plain.scene.destroy();

    const { scene, app } = await canvasOn(
      asking({ removed: [between] }),
      later,
    );
    expect(layers(app).runs.lines).toHaveLength(held);
    scene.destroy();
  });

  it("hands nothing back for it out of a sweep", async () => {
    const { scene } = await canvasOn(asking({ removed: [gone] }));
    const swept = scene.marksWithin({
      minX: -1e6,
      minY: -1e6,
      maxX: 1e6,
      maxY: 1e6,
    });
    expect(swept).toHaveLength(field.length);
    expect(swept).not.toContain(gone.ref);
    scene.destroy();
  });
});
