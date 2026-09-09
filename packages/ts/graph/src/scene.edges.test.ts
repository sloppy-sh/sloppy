// DESIGN.md § Edges: four kinds of line cross the canvas, and which one a reader
// is looking at has to be answerable at a glance. Hue is the tags' channel, so
// they separate by weight, by lightness and by whether the line is broken. What
// the model calls each pair is `model.test.ts`'s; what the canvas draws is here.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  FakeGraphics,
  type StrokedLine,
  worldOf,
} from "./pixi.test-support.js";

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

const drawn = (node: NodeView): DrawnNode => ({
  node,
  collapsed: false,
  folded: 0,
  tags: [],
});

/** The three line layers the world holds, in the order it draws them: the tree,
 *  the run, and the two lines a person made. */
interface Passes {
  genealogy: FakeGraphics;
  runs: FakeGraphics;
  connections: FakeGraphics;
}

/** How far one drawn segment reaches, in world units. */
const span = (line: StrokedLine): number =>
  Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1]);

async function canvasOn(
  field: readonly NodeView[],
  selecting = false,
): Promise<{
  scene: Awaited<ReturnType<typeof GraphScene.create>>;
  passes: Passes;
}> {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(
    buildModel(field.map(drawn), { selection: [], palette }),
    selecting,
  );
  app.tick();
  // Lift, genealogy, runs, connections, the difference, the shapes, their edges,
  // then the orbit — `scene.ts` adds them in that order and nothing else on the
  // world is a graphics.
  const [, genealogy, runs, connections] = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return { scene, passes: { genealogy, runs, connections } };
}

describe("a note's own words and a line somebody drew", () => {
  const from = note("1");
  const cited = note("2a", { parent: ref("2"), origin: ref("2") });

  it("draws the writing's line whole and the hand's broken", async () => {
    const writing = await canvasOn([
      { ...from, references: [cited.ref] },
      cited,
    ]);
    // One segment, from the one mark to the other: a line drawn whole.
    expect(writing.passes.connections.lines).toHaveLength(1);
    writing.scene.destroy();

    const hand = await canvasOn([{ ...from, links: [cited.ref] }, cited]);
    const dashes = hand.passes.connections.lines;
    expect(dashes.length).toBeGreaterThan(1);
    // Every dash is shorter than the whole, which is what a gap between them is.
    const whole = span(writing.passes.connections.lines[0]);
    for (const dash of dashes) expect(span(dash)).toBeLessThan(whole);
    hand.scene.destroy();
  });

  // The break is the only thing that says how the line was made, so the two are
  // otherwise the same line: same ink, same weight.
  it("draws both at one weight and one lightness", async () => {
    const other = note("3a", { parent: ref("3"), origin: ref("3") });
    const { scene, passes } = await canvasOn([
      { ...from, references: [cited.ref], links: [other.ref] },
      cited,
      other,
    ]);
    const styles = new Set(
      passes.connections.lines.map(
        (line) => `${line.color}:${line.alpha}:${line.width}`,
      ),
    );
    expect(styles.size).toBe(1);
    scene.destroy();
  });

  // A pair may be several of these at once, and the reader is told the pair is
  // connected rather than shown an inventory of the ways it is.
  it("draws a pair connected both ways once, as the hand's broken line", async () => {
    const { scene, passes } = await canvasOn([
      { ...from, references: [cited.ref], links: [cited.ref] },
      cited,
    ]);
    expect(passes.connections.lines.length).toBeGreaterThan(1);
    scene.destroy();
  });
});

// The three solid kinds are three steps of one ladder, and they move on both
// channels at once: a line's width is clamped as a field is zoomed out, so the
// reader who has lost the width still has the order.
describe("the ladder the solid lines climb", () => {
  const field = [
    note("1"),
    note("2"),
    note("1a", { parent: ref("1"), origin: ref("1") }),
    note("3a", {
      parent: ref("3"),
      origin: ref("3"),
      references: [ref("1")],
    }),
  ];

  it("steps in weight and in lightness together", async () => {
    const { scene, passes } = await canvasOn(field);
    const step = (pass: FakeGraphics): StrokedLine => {
      expect(pass.lines.length).toBeGreaterThan(0);
      return pass.lines[0];
    };
    const tree = step(passes.genealogy);
    const run = step(passes.runs);
    const written = step(passes.connections);

    expect(tree.width).toBeLessThan(written.width);
    expect(written.width).toBeLessThan(run.width);
    expect(tree.alpha).toBeLessThan(written.alpha);
    expect(written.alpha).toBeLessThan(run.alpha);
    scene.destroy();
  });

  // With tags selected the lines recede so the sets can be read, and the ladder
  // keeps its order on the way down: a reference drawn darker than the run is a
  // reference read as the run, which is the one thing the order is for.
  it("keeps its order while the reader is asking a tag question", async () => {
    const plain = await canvasOn(field);
    const asked = await canvasOn(field, true);
    const rungs = (passes: Passes) => ({
      tree: passes.genealogy.lines[0].alpha,
      written: passes.connections.lines[0].alpha,
      run: passes.runs.lines[0].alpha,
    });
    const before = rungs(plain.passes);
    const after = rungs(asked.passes);

    for (const rung of ["tree", "written", "run"] as const) {
      expect(after[rung], rung).toBeLessThan(before[rung]);
    }
    expect(after.tree).toBeLessThan(after.written);
    expect(after.written).toBeLessThan(after.run);
    plain.scene.destroy();
    asked.scene.destroy();
  });
});
