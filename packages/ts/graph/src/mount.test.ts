import type { OwnedRef, Tag } from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeCorpus } from "./corpus.test-support.js";
import type { BuiltModel } from "./model.js";
import type { LayoutCommand } from "./layout/protocol.js";
import type { GraphMountOptions } from "./mount.js";
import { Viewport } from "./viewport.js";

/**
 * What a mount hands the scene is checked here; how the scene draws it is a GPU
 * fact and `bench/` is where it is measured. This stands in for the two things
 * a mount reads back — what is under a tap, and what a node was last drawn as.
 */
class StandInScene {
  static latest: StandInScene | null = null;
  readonly viewport = new Viewport();
  model: BuiltModel | null = null;
  /** The second half of what a mount says: whether tags are selected. */
  selecting = false;
  /** What the next hit test finds, which is how a test aims a tap. */
  under: string | null = null;

  static async create(): Promise<StandInScene> {
    StandInScene.latest = new StandInScene();
    return StandInScene.latest;
  }

  setModel(model: BuiltModel, selecting: boolean): void {
    this.model = model;
    this.selecting = selecting;
  }

  attributesOf(ref: string) {
    if (!this.model?.graph.hasNode(ref)) return null;
    return this.model.graph.getNodeAttributes(ref);
  }

  hasDrawnChildren(ref: string): boolean {
    return (this.attributesOf(ref)?.children ?? 0) > 0;
  }

  hitTest(): string | null {
    return this.under;
  }

  indexOf(ref: string): number | undefined {
    return this.attributesOf(ref)?.index;
  }

  snapshot() {
    return new Map<string, { x: number; y: number }>();
  }

  positionOf() {
    return { x: 0, y: 0 };
  }

  stats() {
    return {
      cpuP50: 0,
      cpuP95: 0,
      cpuMax: 0,
      frameP50: 0,
      frameP95: 0,
      frames: 0,
      drawn: this.model?.order.length ?? 0,
      edges: 0,
      labels: 0,
    };
  }

  movePosition(): void {}
  setPositions(): void {}
  setPalette(): void {}
  fit(): void {}
  invalidate(): void {}
  centreOn(): void {}
  resetStats(): void {}
  destroy(): void {}
}

vi.mock("./scene.js", () => ({ GraphScene: StandInScene }));

const { mountGraph } = await import("./mount.js");

type Listener = (event: Event) => void;

function element() {
  const listeners = new Map<string, Set<Listener>>();
  const node = {
    dataset: {} as Record<string, string>,
    style: { cssText: "" },
    children: [] as unknown[],
    append(...kids: unknown[]) {
      node.children.push(...kids);
    },
    remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
    addEventListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    send(type: string, event: Partial<PointerEvent>) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as Event);
      }
    },
  };
  return node;
}

type FakeElement = ReturnType<typeof element>;

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => element(),
    documentElement: element(),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("getComputedStyle", () => ({
    fontFamily: "",
    getPropertyValue: () => "",
  }));
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());

const corpus = makeCorpus({
  total: 240,
  roots: 2,
  maxDepth: 6,
  maxSiblings: 5,
});

async function mount(overrides: Partial<GraphMountOptions> = {}) {
  const host = element();
  const expanded: OwnedRef[] = [];
  const opened: OwnedRef[] = [];
  // A worker that never answers, so what a mount SENDS is what is measured.
  const sent: LayoutCommand[] = [];
  const props: GraphMountOptions = {
    nodes: corpus.nodes,
    collapsed: new Set<OwnedRef>(),
    selection: [],
    lod: { depth: 3, maxDrawn: 60 },
    createLayoutWorker: () =>
      ({
        postMessage: (command: LayoutCommand) => sent.push(command),
        terminate() {},
      }) as unknown as Worker,
    onOpenNode: (ref) => opened.push(ref),
    onExpand: (ref) => expanded.push(ref),
    onCollapse: () => {},
    ...overrides,
  };
  const handle = mountGraph(host as unknown as HTMLElement, props);
  await vi.waitFor(() => expect(StandInScene.latest?.model).toBeTruthy());
  const scene = StandInScene.latest as StandInScene;
  const surface = host.children[0] as FakeElement;

  return {
    handle,
    props,
    scene,
    expanded,
    opened,
    /** Settles the layout has been asked to run. */
    starts: (): number =>
      sent.filter((command) => command.kind === "start").length,
    model: (): BuiltModel => scene.model as BuiltModel,
    tap(ref: string): void {
      scene.under = ref;
      const event = {
        pointerId: 1,
        pointerType: "touch",
        clientX: 0,
        clientY: 0,
      };
      surface.send("pointerdown", event as Partial<PointerEvent>);
      surface.send("pointerup", event as Partial<PointerEvent>);
    },
    pen(type: string, x: number, y: number): void {
      surface.send(type, {
        pointerId: 2,
        pointerType: "pen",
        clientX: x,
        clientY: y,
      } as Partial<PointerEvent>);
    },
  };
}

/** A mega-node nobody asked for: level of detail folded it to hold the bound. */
function firstMegaNode(model: BuiltModel): OwnedRef {
  const ref = model.order.find(
    (candidate) => model.graph.getNodeAttributes(candidate).collapsed,
  );
  if (!ref) throw new Error("the budget folded nothing");
  return ref;
}

const childrenOf = (ref: OwnedRef): OwnedRef[] =>
  corpus.nodes.filter((node) => node.parent === ref).map((node) => node.ref);

describe("mountGraph", () => {
  // The headline interaction of the whole-graph view, where every mega-node on
  // screen is one the budget folded rather than one the host collapsed.
  it("opens a mega-node the budget folded on the tap that asks for it", async () => {
    const graph = await mount();
    const mega = firstMegaNode(graph.model());
    const children = childrenOf(mega);
    expect(children.length).toBeGreaterThan(0);
    expect(graph.model().graph.hasNode(children[0])).toBe(false);

    graph.tap(mega);

    expect(graph.expanded).toEqual([mega]);
    expect(graph.model().graph.getNodeAttributes(mega).collapsed).toBe(false);
    expect(graph.model().graph.hasNode(children[0])).toBe(true);
  });

  it("leaves one the host collapsed folded until the host says otherwise", async () => {
    const root = corpus.nodes.find((node) => node.parent === undefined)!.ref;
    const collapsed = new Set<OwnedRef>([root]);
    const graph = await mount({ collapsed });
    expect(graph.model().graph.getNodeAttributes(root).collapsed).toBe(true);

    graph.tap(root);
    expect(graph.expanded).toEqual([root]);
    expect(graph.model().graph.getNodeAttributes(root).collapsed).toBe(true);

    collapsed.delete(root);
    graph.handle.update({ ...graph.props, collapsed });
    expect(graph.model().graph.getNodeAttributes(root).collapsed).toBe(false);
  });

  it("opens the note under a tap that is not a mega-node", async () => {
    const graph = await mount();
    const plain = graph
      .model()
      .order.find(
        (ref) => !graph.model().graph.getNodeAttributes(ref).collapsed,
      )!;

    graph.tap(plain);

    expect(graph.opened).toEqual([plain]);
    expect(graph.expanded).toEqual([]);
  });

  // The editor's ink layer arrives under a graph that is already mounted, and
  // DESIGN.md § "The canvas" leaves a stylus panning until it does.
  it("hands the pen a handler that arrives after mounting", async () => {
    const graph = await mount();
    const inked: { x: number; y: number }[] = [];

    graph.pen("pointerdown", 10, 10);
    graph.pen("pointermove", 40, 10);
    graph.pen("pointerup", 40, 10);
    expect(inked).toEqual([]);
    expect(graph.scene.viewport.x).toBe(30);

    graph.handle.update({
      ...graph.props,
      onInkPointer: (_event, world) => inked.push(world),
    });
    graph.pen("pointerdown", 10, 10);
    graph.pen("pointerup", 10, 10);

    expect(inked).toHaveLength(2);
    expect(graph.scene.viewport.x).toBe(30);
  });

  it("holds the bound an update moves it to", async () => {
    const graph = await mount();
    expect(graph.handle.stats()?.maxDrawn).toBe(60);

    graph.handle.update({ ...graph.props, lod: { depth: 3, maxDrawn: 20 } });

    expect(graph.handle.stats()?.maxDrawn).toBe(20);
    expect(graph.model().order.length).toBeLessThanOrEqual(20);
  });
});

// AI.md: highlight, not filter — "the shape of the graph survives the question".
// A settle restarted to answer a question about colour would shake the field
// out from under the reader's finger, so the one it must never restart on is
// the selection, and the ones it must still restart on are the rest.
describe("selecting tags", () => {
  const selection = ["seed"] as Tag[];

  it("recolours what is drawn without asking the layout to settle again", async () => {
    const graph = await mount();
    const before = graph.starts();
    const wasDrawn = graph.model().order;
    expect(before).toBeGreaterThan(0);

    graph.handle.update({ ...graph.props, selection });

    expect(graph.starts()).toBe(before);
    expect(graph.model().order).toEqual(wasDrawn);
    expect(
      graph
        .model()
        .order.filter((ref) => graph.model().graph.getNodeAttributes(ref).tag),
    ).not.toHaveLength(0);
  });

  it("tells the scene a selection is on, so the tree recedes behind it", async () => {
    const graph = await mount();
    expect(graph.scene.selecting).toBe(false);

    graph.handle.update({ ...graph.props, selection });
    expect(graph.scene.selecting).toBe(true);

    graph.handle.update({ ...graph.props, selection: [] });
    expect(graph.scene.selecting).toBe(false);
  });

  it("still settles again when what is drawn actually moves", async () => {
    const graph = await mount({ selection });
    const before = graph.starts();

    graph.handle.update({
      ...graph.props,
      selection,
      collapsed: new Set<OwnedRef>([graph.model().order[0]]),
    });

    expect(graph.starts()).toBe(before + 1);
  });
});
