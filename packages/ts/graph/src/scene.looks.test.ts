// DESIGN.md § Edges, "A look a person set": the three channels a person may set
// on one line, and what each of them is allowed to move. The break is theirs,
// the arrowhead is theirs, the words are theirs — the weight, the lightness and
// where anything sits are not.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphEdgeLook } from "./contract.js";
import { buildModel } from "./model.js";
import { buildPalette } from "./palette.js";
import {
  FakeApplication,
  type FakeContainer,
  FakeGraphics,
  FakeText,
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

interface Passes {
  genealogy: FakeGraphics;
  runs: FakeGraphics;
  connections: FakeGraphics;
}

const span = (line: StrokedLine): number =>
  Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1]);

async function canvasOn(
  field: readonly NodeView[],
  looks: readonly GraphEdgeLook[] = [],
  selecting = false,
) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setModel(
    buildModel(field.map(drawn), {
      selection: [],
      palette,
      edgeLooks: looks,
    }),
    selecting,
  );
  scene.fit();
  app.tick();
  const [, genealogy, runs, connections] = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return { scene, app, passes: { genealogy, runs, connections } as Passes };
}

/** Every word written over the field, whatever is holding it up. */
function writtenOn(app: FakeApplication): FakeText[] {
  const layer = app.stage.children.find((child: FakeContainer) =>
    child.children.some((kid) => kid instanceof FakeText),
  );
  if (!layer) throw new Error("The stage has no text on it");
  return layer.children.filter(
    (kid): kid is FakeText => kid instanceof FakeText && kid.visible,
  );
}

const parent = note("1");
const child = note("1a", { parent: ref("1"), origin: ref("1") });
const lookOn = (over: Partial<GraphEdgeLook> = {}): GraphEdgeLook => ({
  from: parent.ref,
  to: child.ref,
  ...over,
});

describe("the break a look names", () => {
  it("draws a line dotted where the line it is on is drawn whole", async () => {
    const plain = await canvasOn([parent, child]);
    expect(plain.passes.genealogy.lines).toHaveLength(1);
    const whole = span(plain.passes.genealogy.lines[0]);
    plain.scene.destroy();

    const dotted = await canvasOn(
      [parent, child],
      [lookOn({ stroke: "dotted" })],
    );
    const marks = dotted.passes.genealogy.lines;
    expect(marks.length).toBeGreaterThan(1);
    for (const mark of marks) expect(span(mark)).toBeLessThan(whole / 2);
    dotted.scene.destroy();
  });

  // The two breaks have to be told apart at a glance, and they are struck at
  // one weight — so the difference is in the marks and the gaps alone.
  it("draws dotted in more and shorter marks than dashed", async () => {
    const dashed = await canvasOn(
      [parent, child],
      [lookOn({ stroke: "dashed" })],
    );
    const dotted = await canvasOn(
      [parent, child],
      [lookOn({ stroke: "dotted" })],
    );
    const longest = (pass: FakeGraphics) => Math.max(...pass.lines.map(span));

    expect(dotted.passes.genealogy.lines.length).toBeGreaterThan(
      dashed.passes.genealogy.lines.length,
    );
    expect(longest(dotted.passes.genealogy)).toBeLessThan(
      longest(dashed.passes.genealogy),
    );
    dashed.scene.destroy();
    dotted.scene.destroy();
  });

  // A hand link a person drew solid is solid: the break stops saying how the
  // line was made, because they said so on purpose.
  it("closes a hand link somebody drew solid", async () => {
    const linked = [{ ...parent, links: [child.ref] }, child];
    const broken = await canvasOn(linked);
    expect(broken.passes.connections.lines.length).toBeGreaterThan(1);
    broken.scene.destroy();

    const closed = await canvasOn(linked, [lookOn({ stroke: "solid" })]);
    expect(closed.passes.connections.lines).toHaveLength(1);
    closed.scene.destroy();
  });

  // The weight and the lightness are not channels, so the ladder of the four
  // kinds survives every look anybody sets.
  it("leaves the line's weight and lightness where the ladder put them", async () => {
    const plain = await canvasOn([parent, child]);
    const looked = await canvasOn(
      [parent, child],
      [lookOn({ stroke: "dashed", direction: "both", label: "grew out of" })],
    );
    const before = plain.passes.genealogy.lines[0];
    for (const line of looked.passes.genealogy.lines) {
      expect(line.width).toBe(before.width);
      expect(line.alpha).toBe(before.alpha);
      expect(line.color).toBe(before.color);
    }
    plain.scene.destroy();
    looked.scene.destroy();
  });
});

describe("the arrowhead a look names", () => {
  /** The head's own marks: the two barbs, which are the lines the plain canvas
   *  did not draw. */
  const barbs = (pass: FakeGraphics, without: number): StrokedLine[] =>
    pass.lines.slice(without);

  const near = (
    scene: Awaited<ReturnType<typeof canvasOn>>["scene"],
    of: OwnedRef,
    point: [number, number],
  ): number => {
    const at = scene.positionOf(scene.indexOf(of) as number);
    return Math.hypot(point[0] - at.x, point[1] - at.y);
  };

  it("draws no arrowhead where the look names no direction", async () => {
    const plain = await canvasOn([parent, child]);
    const looked = await canvasOn([parent, child], [lookOn({ label: "why" })]);
    expect(looked.passes.genealogy.lines).toHaveLength(
      plain.passes.genealogy.lines.length,
    );
    plain.scene.destroy();
    looked.scene.destroy();
  });

  it("points at the note the look names, and at this one for `from`", async () => {
    const pointing = await canvasOn(
      [parent, child],
      [lookOn({ direction: "to" })],
    );
    const heads = barbs(pointing.passes.genealogy, 1);
    expect(heads).toHaveLength(2);
    // Both barbs meet at the tip, which stands off the mark it points at.
    expect(heads[0].to).toEqual(heads[1].to);
    expect(near(pointing.scene, child.ref, heads[0].to)).toBeLessThan(
      near(pointing.scene, parent.ref, heads[0].to),
    );
    pointing.scene.destroy();

    const back = await canvasOn(
      [parent, child],
      [lookOn({ direction: "from" })],
    );
    const other = barbs(back.passes.genealogy, 1);
    expect(near(back.scene, parent.ref, other[0].to)).toBeLessThan(
      near(back.scene, child.ref, other[0].to),
    );
    back.scene.destroy();
  });

  it("draws one at each end where the look says both", async () => {
    const both = await canvasOn(
      [parent, child],
      [lookOn({ direction: "both" })],
    );
    const heads = barbs(both.passes.genealogy, 1);
    expect(heads).toHaveLength(4);
    both.scene.destroy();
  });

  // It is a mark ON the line, never a second colour and never a second weight.
  it("draws it in the line's own ink at the line's own weight", async () => {
    const pointing = await canvasOn(
      [parent, child],
      [lookOn({ direction: "both" })],
    );
    const styles = new Set(
      pointing.passes.genealogy.lines.map(
        (line) => `${line.color}:${line.alpha}:${line.width}`,
      ),
    );
    expect(styles.size).toBe(1);
    pointing.scene.destroy();
  });

  // Clamped as the width is: the head is one multiple of the line's stroke at
  // every zoom, and the stroke is what stops growing as the field is zoomed out.
  it("keeps one reach for the line's stroke at every zoom", async () => {
    const wide = await canvasOn([parent, child], [lookOn({ direction: "to" })]);
    const perWidth = (): number => {
      const lines = wide.passes.genealogy.lines;
      const heads = barbs(wide.passes.genealogy, 1);
      return Math.max(span(heads[0]), span(heads[1])) / lines[0].width;
    };
    const near = perWidth();
    wide.scene.viewport.zoomAt(0, 0, 0.01);
    wide.app.tick();
    expect(wide.scene.viewport.scale).toBeLessThan(0.1);
    expect(perWidth()).toBeCloseTo(near, 5);
    wide.scene.destroy();
  });
});

describe("the words a look puts on a line", () => {
  it("writes them at the line's middle", async () => {
    const looked = await canvasOn(
      [parent, child],
      [lookOn({ label: "grew out of" })],
    );
    const written = writtenOn(looked.app).find(
      (text) => text.text === "grew out of",
    );
    expect(written).toBeDefined();
    const from = looked.scene.positionOf(
      looked.scene.indexOf(parent.ref) as number,
    );
    const to = looked.scene.positionOf(
      looked.scene.indexOf(child.ref) as number,
    );
    const middle = looked.scene.viewport.toScreen(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
    );
    expect(written?.x).toBeCloseTo(middle.x, 5);
    expect(written?.y).toBeCloseTo(middle.y, 5);
    looked.scene.destroy();
  });

  // A look dims with the line it is on: ticking a tag steps the tree back, and
  // the words on it step back with it.
  it("dims with the line while a tag question is being asked", async () => {
    const plain = await canvasOn([parent, child], [lookOn({ label: "why" })]);
    const asked = await canvasOn(
      [parent, child],
      [lookOn({ label: "why" })],
      true,
    );
    const alpha = (app: FakeApplication) =>
      writtenOn(app).find((text) => text.text === "why")?.alpha ?? 0;

    expect(alpha(plain.app)).toBe(1);
    expect(alpha(asked.app)).toBeLessThan(1);
    expect(alpha(asked.app)).toBeGreaterThan(0);
    plain.scene.destroy();
    asked.scene.destroy();
  });

  it("writes nothing where the words are too long to be a caption", async () => {
    const long = "a".repeat(200);
    const looked = await canvasOn([parent, child], [lookOn({ label: long })]);
    const written = writtenOn(looked.app).map((text) => text.text);
    expect(written).not.toContain(long);
    expect(written.some((text) => text.startsWith("aaa"))).toBe(true);
    looked.scene.destroy();
  });
});

// A look draws on the line that is there, and makes none.
describe("a look on a pair the canvas draws no line between", () => {
  it("draws nothing at all", async () => {
    const other = note("2");
    // Nothing joins `1` and `2a`: not the tree, not the run, and nobody has
    // written or drawn a line between them.
    const stranger = note("2a", { parent: other.ref, origin: other.ref });
    const field = [parent, child, other, stranger];
    const plain = await canvasOn(field);
    const looked = await canvasOn(field, [
      { from: parent.ref, to: stranger.ref, label: "about", direction: "to" },
    ]);
    expect(looked.passes.genealogy.lines.length).toBe(
      plain.passes.genealogy.lines.length,
    );
    expect(looked.passes.runs.lines.length).toBe(
      plain.passes.runs.lines.length,
    );
    expect(looked.passes.connections.lines.length).toBe(
      plain.passes.connections.lines.length,
    );
    expect(writtenOn(looked.app).map((text) => text.text)).not.toContain(
      "about",
    );
    plain.scene.destroy();
    looked.scene.destroy();
  });
});

describe("a tap that landed on a line", () => {
  it("answers with the pair the nearest line joins", async () => {
    const { scene } = await canvasOn([parent, child]);
    const from = scene.positionOf(scene.indexOf(parent.ref) as number);
    const to = scene.positionOf(scene.indexOf(child.ref) as number);
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

    expect(scene.hitEdge(middle)?.sort()).toEqual(
      [parent.ref, child.ref].sort(),
    );
    scene.destroy();
  });

  it("answers with nothing where the tap landed on bare paper", async () => {
    const { scene } = await canvasOn([parent, child]);
    const from = scene.positionOf(scene.indexOf(parent.ref) as number);
    expect(scene.hitEdge({ x: from.x + 4000, y: from.y + 4000 })).toBeNull();
    scene.destroy();
  });
});
