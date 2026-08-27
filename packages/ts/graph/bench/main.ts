/// <reference types="vite/client" />

// The benchmark this package's performance numbers come from. It mounts the
// real renderer on a corpus the size of the API's seed and drives it with real
// pointer events, because frame time is a GPU-and-browser fact and nothing
// measured in Node would be one.
//
// `pnpm --filter @sloppy/graph bench`, then read the panel or `window.__bench`.

import LayoutWorker from "../src/layout-worker.ts?worker";
import type { GraphLens } from "../src/contract.js";
import { makeCorpus } from "../src/corpus.test-support.js";
import {
  type GraphHandle,
  type GraphMountOptions,
  mountGraph,
} from "../src/mount.js";

interface Sample {
  name: string;
  frameP50: number;
  frameP95: number;
  drawP50: number;
  drawP95: number;
  drawMax: number;
  inputP50: number | null;
  inputP95: number | null;
  marks: number;
  edges: number;
  labels: number;
}

const report = document.getElementById("report") as HTMLPreElement;
const host = document.getElementById("app") as HTMLElement;
const controls = document.getElementById("controls") as HTMLElement;

const lines: string[] = [];
const samples: Sample[] = [];

function say(line: string): void {
  lines.push(line);
  report.textContent = lines.join("\n");
}

function timed<T>(name: string, work: () => T): T {
  const started = performance.now();
  const value = work();
  say(`${name.padEnd(32)} ${(performance.now() - started).toFixed(1)} ms`);
  return value;
}

const corpus = timed("build corpus (2,400 notes)", () => makeCorpus());
/** `?inline` measures what a surface that cannot start a worker settles like. */
const withWorker = !new URLSearchParams(location.search).has("inline");
let lens: GraphLens | null = null;
let handle: GraphHandle;

// Starts empty: level of detail is what bounds the field, and a host that
// folded it first would be measuring its own policy instead of this package's.
const collapsed = new Set<string>();

const props = (): GraphMountOptions => ({
  nodes: corpus.nodes,
  collapsed,
  lens,
  viewer: corpus.owner,
  onOpenNode: (ref) => say(`open ${ref.slice(-8)}`),
  onExpand: (ref) => {
    say(`expand ${ref.slice(-8)}`);
    if (collapsed.delete(ref)) handle.update(props());
  },
  onCollapse: (ref) => {
    say(`collapse ${ref.slice(-8)}`);
    collapsed.add(ref);
    handle.update(props());
  },
  createLayoutWorker: withWorker ? () => new LayoutWorker() : undefined,
});

const frame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame(resolve));

async function frames(count: number): Promise<void> {
  for (let at = 0; at < count; at++) await frame();
}

async function settle(limitMs = 30_000): Promise<number> {
  const started = performance.now();
  while (performance.now() - started < limitMs) {
    await frame();
    if (handle.stats()?.settled) break;
  }
  return performance.now() - started;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function record(name: string, input: readonly number[] = []): void {
  const stats = handle.stats();
  if (!stats) throw new Error("nothing mounted");
  const sample: Sample = {
    name,
    frameP50: stats.frames.frameP50,
    frameP95: stats.frames.frameP95,
    drawP50: stats.frames.cpuP50,
    drawP95: stats.frames.cpuP95,
    drawMax: stats.frames.cpuMax,
    inputP50: input.length > 0 ? percentile(input, 0.5) : null,
    inputP95: input.length > 0 ? percentile(input, 0.95) : null,
    marks: stats.frames.drawn,
    edges: stats.frames.edges,
    labels: stats.frames.labels,
  };
  samples.push(sample);
  say(
    `${name.padEnd(32)} frame ${sample.frameP50.toFixed(1)}/${sample.frameP95.toFixed(1)}` +
      `  draw ${sample.drawP50.toFixed(2)}/${sample.drawP95.toFixed(2)} (max ${sample.drawMax.toFixed(2)})` +
      (sample.inputP50 === null
        ? ""
        : `  input→frame ${sample.inputP50.toFixed(1)}/${sample.inputP95?.toFixed(1)}`) +
      `  ${sample.marks} marks`,
  );
}

const surface = (): HTMLElement =>
  host.querySelector("[data-graph-surface]") as HTMLElement;

function touch(type: string, id: number, x: number, y: number): void {
  surface().dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function panRun(steps: number): Promise<number[]> {
  const box = surface().getBoundingClientRect();
  const latencies: number[] = [];
  const y = box.top + box.height * 0.5;
  let x = box.left + box.width * 0.8;
  touch("pointerdown", 1, x, y);
  for (let at = 0; at < steps; at++) {
    x -= 4;
    const sent = performance.now();
    touch("pointermove", 1, x, y);
    latencies.push((await frame()) - sent);
  }
  touch("pointerup", 1, x, y);
  return latencies;
}

async function pinchRun(steps: number): Promise<number[]> {
  const box = surface().getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const latencies: number[] = [];
  touch("pointerdown", 1, cx - 80, cy);
  touch("pointerdown", 2, cx + 80, cy);
  for (let at = 1; at <= steps; at++) {
    const reach = 80 + at * 2;
    const sent = performance.now();
    touch("pointermove", 1, cx - reach, cy);
    touch("pointermove", 2, cx + reach, cy);
    latencies.push((await frame()) - sent);
  }
  touch("pointerup", 1, cx - 80 - steps * 2, cy);
  touch("pointerup", 2, cx + 80 + steps * 2, cy);
  return latencies;
}

async function measure(
  name: string,
  work: () => Promise<readonly number[] | void>,
): Promise<void> {
  await frames(2);
  handle.resetStats();
  const input = await work();
  record(name, input ?? []);
}

async function run(): Promise<void> {
  const mountedAt = performance.now();
  handle = timed("mount", () => mountGraph(host, props()));

  say("");
  say("name                             frame p50/p95   draw p50/p95 (max)");

  // The reason the layout is off the main thread at all: a graph that is still
  // settling has to still be usable (DESIGN.md § Motion).
  await measure("pan, still settling", () => panRun(120));

  const settledIn = performance.now() - mountedAt;
  await settle();
  const first = handle.stats();
  say(
    `layout on the ${first?.layout} · settled ${settledIn.toFixed(0)} ms after mount · ` +
      `${first?.drawn}/${first?.maxDrawn} marks · ` +
      `${first?.autoFolded} subtrees folded to fit`,
  );

  await measure("idle", async () => {
    await frames(120);
  });
  await measure("pan, one finger", () => panRun(120));
  await measure("pinch, two fingers", () => pinchRun(120));

  say("");
  const dimension = corpus.dimensions.find((d) => d.name === "status")!;
  await measure("lens switch → settled", async () => {
    const started = performance.now();
    lens = { dimension, slot: 2 };
    handle.update(props());
    await frame();
    const toFirstFrame = performance.now() - started;
    const took = await settle();
    say(
      `lens switch → first frame        ${toFirstFrame.toFixed(1)} ms · ` +
        `re-clustered in ${took.toFixed(0)} ms`,
    );
  });
  await measure("idle, under a lens", async () => {
    await frames(120);
  });
  await measure("pan, under a lens", () => panRun(120));

  lens = null;
  handle.update(props());
  await settle();

  say("");
  say("BENCH DONE");
  (window as unknown as { __bench: unknown }).__bench = { samples, lines };
}

const lensNames = [null, ...corpus.dimensions.map((d) => d.name)];

function fit(): void {
  handle.fit();
}

function cycleLens(): void {
  const at = lensNames.indexOf(lens?.dimension.name ?? null);
  const next = lensNames[(at + 1) % lensNames.length];
  const dimension = corpus.dimensions.find((d) => d.name === next);
  lens = dimension
    ? { dimension, slot: ((corpus.dimensions.indexOf(dimension) % 8) + 1) as 1 }
    : null;
  handle.update(props());
}

for (const [label, action] of [
  ["fit", fit],
  ["lens", cycleLens],
] as const) {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = action;
  controls.append(button);
}

Object.assign(window, {
  __fit: fit,
  __lens: cycleLens,
  __stats: () => handle.stats(),
});

void run();
