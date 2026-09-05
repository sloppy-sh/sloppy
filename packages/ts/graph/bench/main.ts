/// <reference types="vite/client" />

// The benchmark this package's performance numbers come from. It mounts the
// real renderer on a corpus the size of the API's seed and drives it with real
// pointer events, because frame time is a GPU-and-browser fact and nothing
// measured in Node would be one.
//
// `pnpm --filter @sloppy/graph bench`, then read the panel or `window.__bench`.

import type { Tag } from "@sloppy/types";
import LayoutWorker from "../src/layout-worker.ts?worker";
import { makeCorpus } from "../src/corpus.test-support.js";
import type { GraphPictures, GraphWallpaper } from "../src/contract.js";
import type { GraphGround } from "../src/ground.js";
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
const asked = new URLSearchParams(location.search);
/** `?inline` measures what a surface that cannot start a worker settles like. */
const withWorker = !asked.has("inline");
/**
 * `?drawn=N` lifts the level-of-detail bound, which otherwise decides the mark
 * count before any of this does — the way to measure a pass at a size the
 * product never draws, rather than measuring the budget.
 */
const maxDrawn = Number(asked.get("drawn")) || undefined;
let selection: Tag[] = [];
let ground: GraphGround = "none";
let wallpaper: GraphWallpaper = { picture: null, strength: 1 };
let handle: GraphHandle;

/**
 * A stand-in for the reader's own picture: soft colour over a full frame, with
 * both ends of the tone scale in it, because what a wallpaper has to survive is
 * the darkest and lightest pixel it holds.
 */
const painted = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1000;
  const onto = canvas.getContext("2d") as CanvasRenderingContext2D;
  onto.fillStyle = "#101820";
  onto.fillRect(0, 0, canvas.width, canvas.height);
  const blobs: [number, number, number, string][] = [
    [420, 300, 620, "#ffd8a8"],
    [1180, 260, 520, "#8fd3ff"],
    [860, 880, 700, "#ffffff"],
    [180, 880, 460, "#2b1a3d"],
  ];
  for (const [x, y, r, colour] of blobs) {
    const glow = onto.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, colour);
    glow.addColorStop(1, "transparent");
    onto.fillStyle = glow;
    onto.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/jpeg", 0.85);
})();

const pictures: GraphPictures = {
  read: async (picture) =>
    picture === "painted" ? { src: painted, release: () => {} } : null,
};

// Starts empty: level of detail is what bounds the field, and a host that
// folded it first would be measuring its own policy instead of this package's.
const collapsed = new Set<string>();

const props = (): GraphMountOptions => ({
  nodes: corpus.nodes,
  collapsed,
  selection,
  ground,
  wallpaper,
  pictures,
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
  lod: maxDrawn === undefined ? undefined : { maxDrawn, depth: 99 },
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

const field = (): HTMLElement =>
  host.querySelector("[data-graph-field]") as HTMLElement;

function touch(type: string, id: number, x: number, y: number): void {
  field().dispatchEvent(
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
  const box = field().getBoundingClientRect();
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
  const box = field().getBoundingClientRect();
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

  // The ground is two tiled fills over the whole viewport, so what it costs is
  // fill rate rather than geometry — measured against the same passes with none.
  say("");
  for (const paper of ["dots", "lines"] as const) {
    ground = paper;
    handle.update(props());
    await measure(`idle, ground: ${paper}`, async () => {
      await frames(120);
    });
    await measure(`pan, ground: ${paper}`, () => panRun(120));
  }
  ground = "none";
  handle.update(props());

  // A picture is one composited layer behind a canvas that already clears
  // transparent, so what it costs is measured against the same passes with none.
  say("");
  wallpaper = { picture: "painted", strength: 1 };
  handle.update(props());
  await measure("idle, wallpaper", async () => {
    await frames(120);
  });
  await measure("pan, wallpaper", () => panRun(120));
  ground = "dots";
  handle.update(props());
  await measure("idle, wallpaper + dots", async () => {
    await frames(120);
  });
  await measure("pan, wallpaper + dots", () => panRun(120));
  ground = "none";
  wallpaper = { picture: null, strength: 1 };
  handle.update(props());

  say("");
  // The number the tag rail is judged on: a reader ticks a tag and the answer
  // has to be on the canvas before the next frame, with the field where they
  // left it — so `settled` staying true is as much the measurement as the ms.
  for (const [at, tag] of corpus.tags.slice(0, 3).entries()) {
    await measure(`select "${tag}" → first frame`, async () => {
      const started = performance.now();
      selection = corpus.tags.slice(0, at + 1);
      handle.update(props());
      await frame();
      const took = performance.now() - started;
      const carriers = corpus.nodes.filter((node) =>
        node.tags.some((held) => selection.includes(held)),
      ).length;
      say(
        `select "${tag}"`.padEnd(32) +
          `${took.toFixed(1)} ms to first frame · ` +
          `${carriers} notes carry any of ${selection.length} · ` +
          `field ${handle.stats()?.settled ? "held" : "RE-SETTLING"}`,
      );
      return [took];
    });
  }
  await measure("idle, three tags selected", async () => {
    await frames(120);
  });
  await measure("pan, three tags selected", () => panRun(120));

  await measure("clear the selection → first frame", async () => {
    const started = performance.now();
    selection = [];
    handle.update(props());
    await frame();
    return [performance.now() - started];
  });

  say("");
  say("BENCH DONE");
  (window as unknown as { __bench: unknown }).__bench = { samples, lines };
}

function fit(): void {
  handle.fit();
}

function cycleSelection(): void {
  selection =
    selection.length >= 3 ? [] : corpus.tags.slice(0, selection.length + 1);
  handle.update(props());
  say(`selected ${selection.length ? selection.join(", ") : "nothing"}`);
}

function cycleGround(): void {
  const grounds: GraphGround[] = ["none", "dots", "lines"];
  ground = grounds[(grounds.indexOf(ground) + 1) % grounds.length];
  handle.update(props());
  say(`ground ${ground}`);
}

for (const [label, action] of [
  ["fit", fit],
  ["select a tag", cycleSelection],
  ["ground", cycleGround],
] as const) {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = action;
  controls.append(button);
}

Object.assign(window, {
  __fit: fit,
  __select: cycleSelection,
  __ground: (paper: GraphGround) => {
    ground = paper;
    handle.update(props());
  },
  __wallpaper: (strength: number | null) => {
    wallpaper = {
      picture: strength === null ? null : "painted",
      strength: strength ?? 1,
    };
    handle.update(props());
  },
  __dark: (on: boolean) => {
    // `data-theme` and not a name of this file's own: the renderer re-reads its
    // tokens off that attribute, so anything else swaps the page and not the
    // canvas.
    document.documentElement.setAttribute("data-theme", on ? "dark" : "light");
  },
  __tags: (count: number) => {
    selection = corpus.tags.slice(0, count);
    handle.update(props());
  },
  __stats: () => handle.stats(),
});

void run();
