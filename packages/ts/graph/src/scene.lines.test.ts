// DESIGN.md § Edges, "Lines a reader can turn off" and "A dense field recedes
// around the note in hand": what the canvas draws for the lines a reader turned
// off, and how a crowd of hand links steps back from the note in hand.

import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import type { DrawnNode, GraphEdgeLook, GraphHiddenLines } from "./contract.js";
import { UNLABELLED_LINE } from "./contract.js";
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

const { GraphScene, handLinksDense, DENSE_LINKS_MOST, DENSE_LINKS_PER_MARK } =
  await import("./scene.js");

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

async function canvasOn(
  field: readonly NodeView[],
  looks: readonly GraphEdgeLook[] = [],
  hidden?: GraphHiddenLines,
) {
  const scene = await GraphScene.create({} as HTMLCanvasElement, {
    fonts: { ui: "ui", heading: "heading", address: "mono" },
    palette,
    resolution: 2,
  });
  const app = FakeApplication.latest as FakeApplication;
  scene.setHiddenLines(hidden);
  scene.setModel(
    buildModel(field.map(drawn), { selection: [], palette, edgeLooks: looks }),
    false,
  );
  scene.fit();
  app.tick();
  const [, , genealogy, runs, connections] = worldOf(app).children.filter(
    (child): child is FakeGraphics => child instanceof FakeGraphics,
  );
  return { scene, app, passes: { genealogy, runs, connections } };
}

function writtenOn(app: FakeApplication): string[] {
  const layer = app.stage.children.find((child: FakeContainer) =>
    child.children.some((kid) => kid instanceof FakeText),
  );
  return (layer?.children ?? [])
    .filter((kid): kid is FakeText => kid instanceof FakeText && kid.visible)
    .map((text) => text.text);
}

/** A crowd: every one of `addresses` linked by hand to every other. */
function crowd(addresses: readonly string[]): NodeView[] {
  return addresses.map((address, at) =>
    note(address, { links: addresses.slice(at + 1).map(ref) }),
  );
}

/** Each pair of a crowd, by address. */
function pairsOf(addresses: readonly string[]): [string, string][] {
  return addresses.flatMap((a, at) =>
    addresses.slice(at + 1).map((b): [string, string] => [a, b]),
  );
}

describe("the lines a reader turned off", () => {
  const parent = note("1");
  const child = note("1a", { parent: ref("1"), origin: ref("1") });
  const linked = note("2", { links: [ref("1a")] });
  const named = note("3", { links: [ref("1")] });
  const field = [parent, child, linked, named];
  const looks: GraphEdgeLook[] = [
    { from: named.ref, to: parent.ref, label: "uses" },
  ];

  it("draws nothing for a kind turned off, and leaves the rest as they were", async () => {
    const all = await canvasOn(field, looks);
    const off = await canvasOn(field, looks, {
      kinds: new Set(["genealogy"]),
      labels: new Set(),
    });
    expect(all.passes.genealogy.lines.length).toBeGreaterThan(0);
    expect(off.passes.genealogy.lines).toHaveLength(0);
    expect(off.passes.connections.lines).toEqual(all.passes.connections.lines);
    all.scene.destroy();
    off.scene.destroy();
  });

  it("writes no words on a hand link whose label is turned off", async () => {
    const pair = [parent, { ...child, links: [parent.ref] }];
    const words: GraphEdgeLook[] = [
      { from: child.ref, to: parent.ref, label: "uses" },
    ];
    const on = await canvasOn(pair, words);
    expect(writtenOn(on.app)).toContain("uses");
    const off = await canvasOn(pair, words, {
      kinds: new Set(),
      labels: new Set(["uses"]),
    });
    expect(writtenOn(off.app)).not.toContain("uses");
    on.scene.destroy();
    off.scene.destroy();
  });

  it("draws nothing for a hand link whose label is turned off", async () => {
    const all = await canvasOn(field, looks);
    const off = await canvasOn(field, looks, {
      kinds: new Set(),
      labels: new Set(["uses"]),
    });
    expect(off.passes.connections.lines.length).toBeGreaterThan(0);
    expect(off.passes.connections.lines.length).toBeLessThan(
      all.passes.connections.lines.length,
    );

    const none = await canvasOn(field, looks, {
      kinds: new Set(),
      labels: new Set(["uses", UNLABELLED_LINE]),
    });
    expect(none.passes.connections.lines).toHaveLength(0);
    for (const one of [all, off, none]) one.scene.destroy();
  });

  it("answers no tap on a line it is not drawing", async () => {
    const { scene } = await canvasOn([parent, child], [], {
      kinds: new Set(["genealogy"]),
      labels: new Set(),
    });
    const a = scene.positionOf(scene.indexOf(parent.ref) as number);
    const b = scene.positionOf(scene.indexOf(child.ref) as number);
    expect(scene.hitEdge({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(
      null,
    );
    scene.setHiddenLines(undefined);
    expect(
      scene.hitEdge({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    ).not.toBeNull();
    scene.destroy();
  });

  it("puts a line back when it is turned on again", async () => {
    const { scene, app, passes } = await canvasOn(field, looks, {
      kinds: new Set(["genealogy", "link"]),
      labels: new Set(),
    });
    expect(passes.connections.lines).toHaveLength(0);
    scene.setHiddenLines(undefined);
    app.tick();
    expect(passes.connections.lines.length).toBeGreaterThan(0);
    expect(passes.genealogy.lines.length).toBeGreaterThan(0);
    scene.destroy();
  });
});

describe("how many hand links make a field dense", () => {
  it("is more than the most, or more than so many for every mark", () => {
    expect(handLinksDense(DENSE_LINKS_MOST, 10_000)).toBe(false);
    expect(handLinksDense(DENSE_LINKS_MOST + 1, 10_000)).toBe(true);
    expect(handLinksDense(10 * DENSE_LINKS_PER_MARK, 10)).toBe(false);
    expect(handLinksDense(10 * DENSE_LINKS_PER_MARK + 1, 10)).toBe(true);
    expect(handLinksDense(0, 0)).toBe(false);
  });
});

describe("a dense field around the note in hand", () => {
  // Two crowds of six: 30 hand links over 12 marks is more than two a mark.
  const near = ["1", "2", "3", "4", "5", "6"];
  const far = ["7", "8", "9", "10", "11", "12"];
  const field = [...crowd(near), ...crowd(far)];

  /** The pair of addresses a dash was laid along. */
  function pairOf(
    scene: Awaited<ReturnType<typeof canvasOn>>["scene"],
    line: StrokedLine,
  ): string {
    const mid = {
      x: (line.from[0] + line.to[0]) / 2,
      y: (line.from[1] + line.to[1]) / 2,
    };
    let best = "";
    let nearest = Number.POSITIVE_INFINITY;
    for (const [a, b] of [...pairsOf(near), ...pairsOf(far)]) {
      const p = scene.positionOf(scene.indexOf(ref(a)) as number);
      const q = scene.positionOf(scene.indexOf(ref(b)) as number);
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const away =
        Math.abs((q.x - p.x) * (p.y - mid.y) - (p.x - mid.x) * (q.y - p.y)) /
        length;
      const along =
        ((mid.x - p.x) * (q.x - p.x) + (mid.y - p.y) * (q.y - p.y)) /
        (length * length);
      if (along < 0 || along > 1 || away >= nearest) continue;
      nearest = away;
      best = `${a}-${b}`;
    }
    return best;
  }

  /** The alphas each pair's dashes were struck at. */
  function alphasByPair(
    scene: Awaited<ReturnType<typeof canvasOn>>["scene"],
    lines: readonly StrokedLine[],
  ): Map<string, Set<number>> {
    const by = new Map<string, Set<number>>();
    for (const line of lines) {
      const pair = pairOf(scene, line);
      const alphas = by.get(pair) ?? new Set<number>();
      alphas.add(line.alpha);
      by.set(pair, alphas);
    }
    return by;
  }

  it("draws every hand link quieter while nothing is in hand", async () => {
    const { scene, passes } = await canvasOn(field);
    const alphas = new Set(passes.connections.lines.map((line) => line.alpha));
    expect(alphas).toEqual(new Set([palette.connectionAlphaWhileSelecting]));
    expect(palette.connectionAlphaWhileSelecting).toBeLessThan(
      palette.connectionAlpha,
    );
    scene.destroy();
  });

  it("leaves a field that is not dense as it was", async () => {
    const { scene, app, passes } = await canvasOn(crowd(near.slice(0, 5)));
    const before = passes.connections.lines.map((line) => line.alpha);
    expect(new Set(before)).toEqual(new Set([palette.connectionAlpha]));
    scene.setPointed(ref("1"));
    app.tick();
    expect(passes.connections.lines.map((line) => line.alpha)).toEqual(before);
    scene.destroy();
  });

  it("strikes the mark under the pointer's lines whole, stands its neighbours' and leaves the rest quiet", async () => {
    const { scene, app, passes } = await canvasOn(field);
    scene.setPointed(ref("1"));
    app.tick();
    const by = alphasByPair(scene, passes.connections.lines);

    for (const [a, b] of pairsOf(near)) {
      const expected =
        a === "1" ? palette.readingAlpha : palette.connectionAlpha;
      expect(by.get(`${a}-${b}`), `${a}-${b}`).toEqual(new Set([expected]));
    }
    for (const [a, b] of pairsOf(far)) {
      expect(by.get(`${a}-${b}`), `${a}-${b}`).toEqual(
        new Set([palette.connectionAlphaWhileSelecting]),
      );
    }

    scene.setPointed(null);
    app.tick();
    expect(new Set(passes.connections.lines.map((line) => line.alpha))).toEqual(
      new Set([palette.connectionAlphaWhileSelecting]),
    );
    scene.destroy();
  });

  it("stands the neighbourhood of the note being read the same way", async () => {
    const { scene, app, passes } = await canvasOn(field);
    scene.setReading({ open: new Set([ref("7")]), active: ref("7") });
    app.tick();
    const by = alphasByPair(scene, passes.connections.lines);

    for (const [a, b] of pairsOf(far)) {
      const alphas = by.get(`${a}-${b}`);
      if (a === "7")
        expect(alphas?.has(palette.readingAlpha), a + b).toBe(true);
      else
        expect(alphas, `${a}-${b}`).toEqual(new Set([palette.connectionAlpha]));
    }
    for (const [a, b] of pairsOf(near)) {
      expect(by.get(`${a}-${b}`)).toEqual(
        new Set([palette.connectionAlphaWhileSelecting]),
      );
    }
    scene.destroy();
  });

  it("captions the lines in hand first, and never a quiet one", async () => {
    const looks = [...pairsOf(near), ...pairsOf(far)].map(
      ([a, b]): GraphEdgeLook => ({
        from: ref(a),
        to: ref(b),
        label: `${a} to ${b}`,
      }),
    );
    const { scene, app } = await canvasOn(field, looks);
    expect(writtenOn(app).filter((text) => text.includes(" to "))).toEqual([]);

    scene.setPointed(ref("7"));
    app.tick();
    const captions = writtenOn(app).filter((text) => text.includes(" to "));
    expect(captions.length).toBeGreaterThan(0);
    for (const words of captions) {
      const [a, b] = words.split(" to ");
      expect(far, words).toContain(a);
      expect(far, words).toContain(b);
    }
    scene.destroy();
  });
});
