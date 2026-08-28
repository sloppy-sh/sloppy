import type { OwnedRef } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import { drawnNodes } from "../contract.js";
import { makeCorpus } from "../corpus.test-support.js";
import { applyLod } from "../lod.js";
import { buildModel } from "../model.js";
import { buildPalette } from "../palette.js";
import { LayoutClient } from "./client.js";
import { LayoutEngine } from "./engine.js";
import type { LayoutEvent, LayoutStart } from "./protocol.js";
import { serveLayout } from "./serve.js";

const corpus = makeCorpus();
const palette = buildPalette({
  ink: "oklch(0.21 0.01 60)",
  paper: "oklch(0.98 0.006 85)",
  hues: [],
});

function startFor(count: number): LayoutStart {
  const nodes = corpus.nodes.slice(0, count);
  const drawn = drawnNodes(
    nodes,
    applyLod(nodes, new Set<OwnedRef>(), undefined).collapsed,
  );
  const model = buildModel(drawn, { selection: [], palette });
  const index = (ref: string) => model.graph.getNodeAttributes(ref).index;
  const edges: LayoutStart["edges"] = [];
  model.graph.forEachEdge((_edge, attributes, source, target) => {
    edges.push({
      source: index(source),
      target: index(target),
      distance: attributes.distance,
      strength: attributes.kind === "link" ? 0.12 : 0.55,
    });
  });
  return {
    kind: "start",
    epoch: 1,
    settleAtOnce: false,
    nodes: model.order.map((ref) => {
      const node = model.graph.getNodeAttributes(ref);
      return {
        x: node.x,
        y: node.y,
        radius: node.radius,
        anchorX: node.anchorX,
        anchorY: node.anchorY,
        anchorStrength: node.anchorStrength,
      };
    }),
    edges,
  };
}

describe("LayoutEngine", () => {
  const start = startFor(400);

  it("settles, and every node it settles is somewhere real", () => {
    const engine = new LayoutEngine(start);
    engine.settle();
    expect(engine.settled).toBe(true);
    const positions = engine.positions();
    expect(positions).toHaveLength(start.nodes.length * 2);
    for (const value of positions) expect(Number.isFinite(value)).toBe(true);
  });

  // The seed is what the protocol fixes, and the settle has to be a function of
  // it — d3-force jiggles coincident points with Math.random, so two engines
  // disagreeing here would mean two peers drawing the same graph differently.
  it("settles the same way twice", () => {
    const first = new LayoutEngine(startFor(400));
    const second = new LayoutEngine(startFor(400));
    first.settle();
    second.settle();
    expect([...second.positions()]).toEqual([...first.positions()]);
  });

  it("holds a node where a drag put it, and lets it go again", () => {
    const engine = new LayoutEngine(startFor(120));
    engine.tick(30);
    engine.pin(4, 1234, -567, true);
    engine.tick(20);
    expect(engine.positions()[8]).toBeCloseTo(1234, 6);
    expect(engine.positions()[9]).toBeCloseTo(-567, 6);
    engine.pin(4, 1234, -567, false);
    engine.tick(60);
    expect(engine.positions()[8]).not.toBeCloseTo(1234, 6);
  });

  it("answers an empty region rather than spinning on it", () => {
    const engine = new LayoutEngine({
      kind: "start",
      epoch: 0,
      settleAtOnce: false,
      nodes: [],
      edges: [],
    });
    engine.settle();
    expect(engine.positions()).toHaveLength(0);
  });
});

describe("the layout service", () => {
  it("answers a reduced-motion start once, already settled", () => {
    const events: LayoutEvent[] = [];
    const accept = serveLayout((event) => events.push(event), { sliceMs: 1 });
    accept({ ...startFor(200), settleAtOnce: true });
    expect(events).toHaveLength(1);
    expect(events[0].settled).toBe(true);
    expect(events[0].alpha).toBeLessThan(0.01);
  });

  it("streams a settle, and stops when it has settled", async () => {
    vi.useFakeTimers();
    try {
      const events: LayoutEvent[] = [];
      const accept = serveLayout((event) => events.push(event), { sliceMs: 1 });
      accept(startFor(200));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(events.length).toBeGreaterThan(1);
      expect(events.at(-1)?.settled).toBe(true);
      const before = events.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(events).toHaveLength(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands every reply the epoch it belongs to", async () => {
    vi.useFakeTimers();
    try {
      const events: LayoutEvent[] = [];
      const accept = serveLayout((event) => events.push(event), { sliceMs: 1 });
      accept({ ...startFor(80), epoch: 7 });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(events.every((event) => event.epoch === 7)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a pin aimed at a region it has already replaced", () => {
    const events: LayoutEvent[] = [];
    const accept = serveLayout((event) => events.push(event), { sliceMs: 1 });
    accept({ ...startFor(80), epoch: 2, settleAtOnce: true });
    const settled = [...events[0].positions];
    accept({ kind: "pin", epoch: 1, index: 0, x: 999, y: 999, held: true });
    expect(events).toHaveLength(1);
    accept({ kind: "pin", epoch: 2, index: 0, x: 999, y: 999, held: true });
    expect(events).toHaveLength(2);
    expect([...events[1].positions]).not.toEqual(settled);
  });
});

describe("LayoutClient", () => {
  it("runs the layout on this thread when there is no worker", async () => {
    const events: LayoutEvent[] = [];
    const client = new LayoutClient({ onPositions: (e) => events.push(e) });
    expect(client.mode).toBe("inline");
    client.send({ ...startFor(120), settleAtOnce: true });
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].settled).toBe(true);
    client.destroy();
  });

  it("falls back rather than leaving the region unsettled", async () => {
    const events: LayoutEvent[] = [];
    const worker = fakeWorker();
    const client = new LayoutClient({
      createWorker: () => worker as unknown as Worker,
      onPositions: (e) => events.push(e),
    });
    expect(client.mode).toBe("worker");

    client.send({ ...startFor(120), settleAtOnce: true });
    expect(events).toHaveLength(0);

    worker.onerror?.();
    await Promise.resolve();
    expect(client.mode).toBe("inline");
    expect(events).toHaveLength(1);
    expect(events[0].settled).toBe(true);
    client.destroy();
  });

  it("says nothing more once it is destroyed", async () => {
    const events: LayoutEvent[] = [];
    const client = new LayoutClient({ onPositions: (e) => events.push(e) });
    client.destroy();
    client.send({ ...startFor(40), settleAtOnce: true });
    await Promise.resolve();
    expect(events).toHaveLength(0);
  });
});

function fakeWorker() {
  return {
    onmessage: null as ((message: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    posted: [] as unknown[],
    postMessage(command: unknown) {
      this.posted.push(command);
    },
    terminate() {},
  };
}
