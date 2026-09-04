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
      strength: attributes.kind === "connection" ? 0.12 : 0.55,
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

/** The node with the most edges, which is the most a drag can disturb. */
function busiest(start: LayoutStart): number {
  const degree = new Map<number, number>();
  for (const edge of start.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  let found = 0;
  let most = -1;
  for (const [index, count] of degree) {
    if (count > most) {
      most = count;
      found = index;
    }
  }
  return found;
}

function within(start: LayoutStart, index: number, reach: number): Set<number> {
  const found = new Set([index]);
  let frontier = [index];
  for (let hop = 0; hop < reach; hop++) {
    const next: number[] = [];
    for (const edge of start.edges) {
      for (const [end, other] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ]) {
        if (!frontier.includes(end) || found.has(other)) continue;
        found.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return found;
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

  // The whole point of a drag being local: the reader rearranges one corner
  // without losing their place in the rest of the field.
  it("moves the held node and what it is joined to, and nothing else", () => {
    const field = startFor(600);
    const engine = new LayoutEngine(field);
    engine.settle();
    const before = new Float32Array(engine.positions());

    const held = busiest(field);
    const joined = within(field, held, 2);
    const carried = 320;
    let x = before[held * 2];
    const y = before[held * 2 + 1];
    for (let frame = 0; frame < 20; frame++) {
      x += carried / 20;
      engine.pin(held, x, y, true);
      engine.tick(5);
    }

    const after = engine.positions();
    const still: number[] = [];
    const moved: number[] = [];
    for (let at = 0; at < field.nodes.length; at++) {
      const distance = Math.hypot(
        after[at * 2] - before[at * 2],
        after[at * 2 + 1] - before[at * 2 + 1],
      );
      (joined.has(at) ? moved : still).push(distance);
    }
    expect(Math.max(...still)).toBe(0);
    // The other half of the same claim: a neighbourhood that held still would
    // read as a note lifted out of a photograph rather than dragged through it.
    moved.sort((a, b) => a - b);
    expect(moved[Math.floor(moved.length / 2)]).toBeGreaterThan(carried / 4);
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

  // DESIGN.md § Motion: reduced motion jumps to the converged positions. It
  // gets there in one answer rather than in frames, and it is still a drag.
  it("holds the far field through a reduced-motion drag too", () => {
    const events: LayoutEvent[] = [];
    const field: LayoutStart = {
      ...startFor(400),
      epoch: 3,
      settleAtOnce: true,
    };
    const accept = serveLayout((event) => events.push(event), { sliceMs: 1 });
    accept(field);
    const settled = [...events[0].positions];

    const held = busiest(field);
    const joined = within(field, held, 2);
    accept({
      kind: "pin",
      epoch: 3,
      index: held,
      x: settled[held * 2] + 400,
      y: settled[held * 2 + 1],
      held: true,
    });

    const after = [...events[1].positions];
    for (let at = 0; at < field.nodes.length; at++) {
      if (joined.has(at)) continue;
      expect([after[at * 2], after[at * 2 + 1]]).toEqual([
        settled[at * 2],
        settled[at * 2 + 1],
      ]);
    }
    expect(after[held * 2]).toBeCloseTo(settled[held * 2] + 400, 6);
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
