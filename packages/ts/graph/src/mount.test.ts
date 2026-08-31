import type { OwnedRef, Tag } from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GraphHoverAt, GraphPickMarks, MarkPictures } from "./contract.js";
import type { SceneOptions } from "./scene.js";
import { makeCorpus } from "./corpus.test-support.js";
import type { BuiltModel } from "./model.js";
import type { LayoutCommand, LayoutEvent } from "./layout/protocol.js";
import type { GraphMountOptions } from "./mount.js";
import type { Bounds } from "./viewport.js";
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
  /** Where each mark was last drawn, which a drag and the layout both write. */
  positions = new Float32Array(0);
  /** The second half of what a mount says: whether tags are selected. */
  selecting = false;
  /** What the next hit test finds, which is how a test aims a tap. */
  under: string | null = null;
  /** The choice the canvas was last told to outline. */
  picking: GraphPickMarks | null = null;
  /** The paper the canvas was last told to draw on. */
  ground = "none";
  /** The notes the canvas was last told somebody chose to act on. */
  chosen: ReadonlySet<string> | null = null;
  centred: string[] = [];
  /** How many times the canvas has framed the whole field. */
  fits = 0;

  /** What the mount handed the canvas as it started. */
  options: SceneOptions | null = null;

  static async create(
    _canvas: unknown,
    options: SceneOptions,
  ): Promise<StandInScene> {
    StandInScene.latest = new StandInScene();
    StandInScene.latest.options = options;
    return StandInScene.latest;
  }

  setModel(model: BuiltModel, selecting: boolean): void {
    this.model = model;
    this.selecting = selecting;
    this.positions = new Float32Array(model.order.length * 2);
  }

  setPicking(picking: GraphPickMarks | null): void {
    this.picking = picking;
  }

  setChosen(chosen: ReadonlySet<string> | null): void {
    this.chosen = chosen;
  }

  setGround(ground: string): void {
    this.ground = ground;
  }

  marksWithin(bounds: Bounds): string[] {
    return (this.model?.order ?? []).filter((ref) => {
      const { index } = this.model!.graph.getNodeAttributes(ref);
      const x = this.positions[index * 2];
      const y = this.positions[index * 2 + 1];
      return (
        x >= bounds.minX &&
        x <= bounds.maxX &&
        y >= bounds.minY &&
        y <= bounds.maxY
      );
    });
  }

  centreOn(ref: string): void {
    this.centred.push(ref);
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

  positionOf(index: number) {
    return { x: this.positions[index * 2], y: this.positions[index * 2 + 1] };
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

  movePosition(index: number, world: { x: number; y: number }): void {
    this.positions[index * 2] = world.x;
    this.positions[index * 2 + 1] = world.y;
  }
  setPositions(positions: Float32Array): void {
    this.positions.set(positions);
  }
  setPalette(): void {}
  fit(): void {
    this.fits += 1;
  }
  invalidate(): void {}
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
  // A worker that answers only when a test says so, so what a mount SENDS and
  // what it does with an answer are both measured.
  const sent: LayoutCommand[] = [];
  const worker = {
    onmessage: null as ((message: MessageEvent<LayoutEvent>) => void) | null,
    postMessage: (command: LayoutCommand) => sent.push(command),
    terminate() {},
  };
  const props: GraphMountOptions = {
    nodes: corpus.nodes,
    collapsed: new Set<OwnedRef>(),
    selection: [],
    lod: { depth: 3, maxDrawn: 60 },
    createLayoutWorker: () => worker as unknown as Worker,
    onOpenNode: (ref) => opened.push(ref),
    onExpand: (ref) => expanded.push(ref),
    onCollapse: () => {},
    ...overrides,
  };
  const handle = mountGraph(host as unknown as HTMLElement, props);
  await vi.waitFor(() => expect(StandInScene.latest?.model).toBeTruthy());
  const scene = StandInScene.latest as StandInScene;
  const surface = host.children[0] as FakeElement;

  const pressAndRelease = (
    ref: string,
    pointerType: string,
    pointerId: number,
    modifiers: Partial<PointerEvent> = {},
  ): void => {
    scene.under = ref;
    const event = {
      pointerId,
      pointerType,
      button: 0,
      clientX: 0,
      clientY: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...modifiers,
    };
    surface.send("pointerdown", event as Partial<PointerEvent>);
    surface.send("pointerup", event as Partial<PointerEvent>);
  };

  return {
    handle,
    props,
    scene,
    expanded,
    opened,
    /** Settles the layout has been asked to run. */
    starts: (): number =>
      sent.filter((command) => command.kind === "start").length,
    /** What the layout has been told to hold, and to let go of. */
    pins: (): LayoutCommand[] =>
      sent.filter((command) => command.kind === "pin"),
    model: (): BuiltModel => scene.model as BuiltModel,
    tap: (ref: string): void => pressAndRelease(ref, "touch", 1),
    /** The mouse's tap: down and up on `ref` with the pointer never moving. */
    click: (ref: string): void => pressAndRelease(ref, "mouse", 3),
    /** The desk's "and this one too". */
    metaClick: (ref: string): void =>
      pressAndRelease(ref, "mouse", 3, { metaKey: true }),
    /** A finger held still on `ref` until the canvas answers it. */
    press: (ref: string | null): void => {
      vi.useFakeTimers();
      scene.under = ref;
      surface.send("pointerdown", {
        pointerId: 5,
        pointerType: "touch",
        button: 0,
        clientX: 0,
        clientY: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as Partial<PointerEvent>);
      vi.advanceTimersByTime(600);
      vi.useRealTimers();
    },
    /** A mouse resting on `ref` — no button, until the canvas answers for it. */
    rest: (ref: string | null): void => {
      vi.useFakeTimers();
      scene.under = ref;
      surface.send("pointermove", {
        pointerId: 6,
        pointerType: "mouse",
        button: -1,
        clientX: 0,
        clientY: 0,
      } as Partial<PointerEvent>);
      vi.advanceTimersByTime(600);
      vi.useRealTimers();
    },
    /** The right button, which asks for the menu rather than taking hold. */
    rightClick: (ref: string | null, x = 0, y = 0): void => {
      scene.under = ref;
      surface.send("contextmenu", {
        clientX: x,
        clientY: y,
        preventDefault: () => {},
      } as unknown as Partial<PointerEvent>);
    },
    /** A modifier-held mouse sweeping a box over bare canvas. */
    sweep(from: { x: number; y: number }, to: { x: number; y: number }): void {
      scene.under = null;
      const at = (point: { x: number; y: number }, held: boolean) =>
        ({
          pointerId: 4,
          pointerType: "mouse",
          button: held ? 0 : -1,
          clientX: point.x,
          clientY: point.y,
          shiftKey: true,
          ctrlKey: false,
          metaKey: false,
        }) as Partial<PointerEvent>;
      surface.send("pointerdown", at(from, true));
      surface.send("pointermove", at(to, false));
      surface.send("pointerup", at(to, false));
    },
    pen(type: string, x: number, y: number): void {
      surface.send(type, {
        pointerId: 2,
        pointerType: "pen",
        clientX: x,
        clientY: y,
      } as Partial<PointerEvent>);
    },
    /** A mouse taking hold of `ref` and carrying it along `path`. */
    drag(ref: string, path: readonly { x: number; y: number }[]): void {
      scene.under = ref;
      for (const [at, point] of path.entries()) {
        surface.send(at === 0 ? "pointerdown" : "pointermove", {
          pointerId: 3,
          pointerType: "mouse",
          button: at === 0 ? 0 : -1,
          clientX: point.x,
          clientY: point.y,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
        } as Partial<PointerEvent>);
      }
    },
    /** The layout answering the settle it was last asked to run. */
    answer(): void {
      const start = [...sent]
        .reverse()
        .find((command) => command.kind === "start");
      if (!start) throw new Error("nothing was asked to settle");
      worker.onmessage?.({
        data: {
          kind: "positions",
          epoch: start.epoch,
          positions: new Float32Array(start.nodes.length * 2),
          alpha: 0.5,
          settled: false,
        },
      } as MessageEvent<LayoutEvent>);
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

  // Nothing else can resolve one: this package reaches no server, so a mark
  // draws its author's picture only if the host's way of reading one arrives.
  it("hands the canvas the host's way of reading a mark's picture", async () => {
    const pictures: MarkPictures = { read: async () => null };
    const graph = await mount({ pictures });
    expect(graph.scene.options?.pictures).toBe(pictures);
  });

  it("leaves the canvas without one where the host offered none", async () => {
    const graph = await mount();
    expect(graph.scene.options?.pictures).toBeUndefined();
  });
});

// A drag is the reader rearranging one corner, so what is under their hand has
// to be the only thing that moves — the field's own framing included.
describe("dragging a note", () => {
  const plain = (graph: Awaited<ReturnType<typeof mount>>) =>
    graph
      .model()
      .order.find(
        (ref) => !graph.model().graph.getNodeAttributes(ref).collapsed,
      )!;

  it("stops re-framing the canvas the moment a note is taken hold of", async () => {
    const graph = await mount();
    graph.answer();
    expect(graph.scene.fits).toBe(1);

    graph.drag(plain(graph), [
      { x: 0, y: 0 },
      { x: 60, y: 40 },
    ]);
    graph.answer();

    expect(graph.scene.fits).toBe(1);
  });

  // A mouse button going down is not a drag, and on this surface a click is how
  // a note is opened — framing has to survive it, or the settle that follows
  // the next unfold arrives at a canvas that will never frame it.
  it("keeps framing the field through a click that never moves", async () => {
    const graph = await mount();
    graph.answer();
    expect(graph.scene.fits).toBe(1);

    graph.click(plain(graph));
    graph.answer();

    expect(graph.scene.fits).toBe(2);
  });

  it("asks the layout to hold the field only once the pointer moves", async () => {
    const graph = await mount();
    const ref = plain(graph);

    graph.click(ref);
    expect(graph.pins()).toEqual([]);

    graph.drag(ref, [
      { x: 0, y: 0 },
      { x: 60, y: 40 },
    ]);
    expect(graph.pins()).not.toEqual([]);
  });

  // The layout answers a pin that is already a pointer move or two old, so a
  // held note drawn where the answer puts it trails the pointer it is under.
  it("keeps the note under the pointer where the pointer is", async () => {
    const graph = await mount();
    const ref = plain(graph);
    const index = graph.model().graph.getNodeAttributes(ref).index;

    graph.drag(ref, [
      { x: 0, y: 0 },
      { x: 60, y: 40 },
    ]);
    graph.answer();

    expect(graph.scene.positionOf(index)).toEqual({ x: 60, y: 40 });
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

  // A host writes its budget inline, so a fresh object every render is the
  // normal case and not a moved bound — reading it by identity would settle the
  // whole field again on every tick of the rail.
  it("reads the budget by what it says, not by which object said it", async () => {
    const graph = await mount({ lod: { depth: 3, maxDrawn: 60 } });
    const before = graph.starts();

    graph.handle.update({
      ...graph.props,
      selection,
      lod: { depth: 3, maxDrawn: 60 },
    });

    expect(graph.starts()).toBe(before);
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

// The graph IS the picker: linking is pointing at the note you mean, on the
// canvas that already shows where it sits and what it grew out of.
describe("picking a note on the canvas", () => {
  const plain = (graph: Awaited<ReturnType<typeof mount>>, but?: OwnedRef) =>
    graph
      .model()
      .order.find(
        (ref) =>
          ref !== but && !graph.model().graph.getNodeAttributes(ref).collapsed,
      )!;

  /** A mounted graph the host has just asked a choice of, `from` pointing at
   *  `other` already where `linked`. */
  async function asking({ linked = false } = {}) {
    const graph = await mount();
    const from = plain(graph);
    const other = plain(graph, from);
    const picked: OwnedRef[] = [];
    const marks = {
      from,
      taken: new Set(linked ? [other] : []),
      onPick: (ref: OwnedRef) => picked.push(ref),
    };
    graph.handle.update({ ...graph.props, picking: marks });
    return { graph, from, other, picked, marks };
  }

  it("picks the note under a tap instead of opening it", async () => {
    const { graph, picked, other } = await asking();

    graph.tap(other);

    expect(picked).toEqual([other]);
    expect(graph.opened).toEqual([]);
  });

  // A self-link is not a link, and the canvas says so by outlining that note
  // rather than by refusing the tap after it lands.
  it("never picks the note the choice is being made for", async () => {
    const { graph, from, picked } = await asking();

    graph.tap(from);

    expect(picked).toEqual([]);
    expect(graph.opened).toEqual([]);
  });

  // Finding the note is half of pointing at it, so a fold still opens.
  it("still opens a mega-node under a tap", async () => {
    const { graph, picked } = await asking();
    const mega = firstMegaNode(graph.model());

    graph.tap(mega);

    expect(graph.expanded).toEqual([mega]);
    expect(picked).toEqual([]);
  });

  it("outlines the note pointed from and the ones it already points at", async () => {
    const { graph, from, other } = await asking({ linked: true });

    expect(graph.scene.picking?.from).toBe(from);
    expect(graph.scene.picking?.taken.has(other)).toBe(true);
  });

  // A pick a taken note answers is the reader saying the link they want is the
  // one already there; what must never follow is a second copy of it.
  it("picks a note it already points at, so the tap is not a dead end", async () => {
    const { graph, other, picked } = await asking({ linked: true });

    graph.tap(other);

    expect(picked).toEqual([other]);
  });

  // The reader may have left the viewport anywhere; the note they are pointing
  // FROM is what the choice is about, so it is what the canvas comes to — once.
  it("brings the canvas to the note the choice is being made for", async () => {
    const { graph, from, marks } = await asking();

    graph.handle.update({ ...graph.props, picking: { ...marks } });

    expect(graph.scene.centred).toEqual([from]);
  });

  it("goes back to opening a note when the choice is over", async () => {
    const { graph, other } = await asking();

    graph.handle.update({ ...graph.props, picking: undefined });
    graph.tap(other);

    expect(graph.opened).toEqual([other]);
    expect(graph.scene.picking).toBeNull();
  });
});

// DESIGN.md § "The mark": the notes somebody picked out to act on are the chosen
// set, and a canvas is either choosing or picking, never both.
describe("choosing notes to act on", () => {
  const plain = (graph: Awaited<ReturnType<typeof mount>>, but?: OwnedRef) =>
    graph
      .model()
      .order.find(
        (ref) =>
          ref !== but && !graph.model().graph.getNodeAttributes(ref).collapsed,
      )!;

  async function choosing() {
    const graph = await mount();
    const first = plain(graph);
    const second = plain(graph, first);
    const picked: OwnedRef[] = [];
    const swept: OwnedRef[][] = [];
    graph.handle.update({
      ...graph.props,
      chosen: new Set<OwnedRef>(),
      onChoose: (ref) => picked.push(ref),
      onChooseWithin: (refs) => swept.push([...refs]),
    });
    return { graph, first, second, picked, swept };
  }

  it("starts one at a desk without taking the ordinary click away", async () => {
    const graph = await mount();
    const ref = plain(graph);
    const picked: OwnedRef[] = [];
    graph.handle.update({ ...graph.props, onChoose: (r) => picked.push(r) });

    graph.click(ref);
    expect(graph.opened).toEqual([ref]);
    expect(picked).toEqual([]);

    graph.metaClick(ref);
    expect(graph.opened).toEqual([ref]);
    expect(picked).toEqual([ref]);
  });

  it("adds and removes on a plain tap once a set is being chosen", async () => {
    const { graph, first, second, picked } = await choosing();

    graph.tap(first);
    graph.tap(second);

    expect(picked).toEqual([first, second]);
    expect(graph.opened).toEqual([]);
  });

  it("hands the chosen set to the canvas to draw", async () => {
    const { graph, first } = await choosing();
    expect(graph.scene.chosen).toEqual(new Set());

    graph.handle.update({ ...graph.props, chosen: new Set([first]) });
    expect(graph.scene.chosen).toEqual(new Set([first]));

    graph.handle.update({ ...graph.props, chosen: undefined });
    expect(graph.scene.chosen).toBeNull();
  });

  it("adds everything a sweep enclosed", async () => {
    const { graph, swept } = await choosing();

    graph.sweep({ x: -1000, y: -1000 }, { x: 1000, y: 1000 });

    expect(swept).toEqual([graph.model().order]);
  });

  it("keeps picking ahead of choosing, because a canvas is in one mode", async () => {
    const { graph, first, second, picked } = await choosing();
    const onPick: OwnedRef[] = [];
    graph.handle.update({
      ...graph.props,
      chosen: new Set([first]),
      onChoose: (ref) => picked.push(ref),
      picking: { from: first, taken: new Set(), onPick: (r) => onPick.push(r) },
    });

    graph.tap(second);

    expect(onPick).toEqual([second]);
    expect(picked).toEqual([]);
  });
});

describe("asking the canvas for a menu", () => {
  const asking = async () => {
    const graph = await mount();
    const asked: { ref: OwnedRef | null; foldable: boolean }[] = [];
    graph.handle.update({ ...graph.props, onMenu: (at) => asked.push(at) });
    return { graph, asked };
  };

  it("says where it was asked, and what it was asked on", async () => {
    const { graph, asked } = await asking();
    const ref = graph
      .model()
      .order.find(
        (r) => graph.model().graph.getNodeAttributes(r).children > 0,
      )!;

    graph.rightClick(ref, 120, 48);
    graph.rightClick(null, 8, 8);

    expect(asked).toEqual([
      { clientX: 120, clientY: 48, ref, foldable: true },
      { clientX: 8, clientY: 8, ref: null, foldable: false },
    ]);
  });

  it("answers a finger held on the canvas, which is the phone's way in", async () => {
    const { graph, asked } = await asking();

    graph.press(null);

    expect(asked).toEqual([
      { clientX: 0, clientY: 0, ref: null, foldable: false },
    ]);
  });

  it("says a mega-node has nothing left for a fold to gather", async () => {
    const { graph, asked } = await asking();
    const mega = firstMegaNode(graph.model());

    graph.rightClick(mega);
    expect(asked[0].foldable).toBe(false);

    graph.tap(mega);
    graph.rightClick(mega);
    expect(asked[1].foldable).toBe(true);
  });

  // The fold was on the hold before there was a menu to put it in, and a surface
  // that offers no menu must not lose it.
  it("folds on a hold where the host offers no menu", async () => {
    const folded: OwnedRef[] = [];
    const graph = await mount({ onCollapse: (ref) => folded.push(ref) });
    const mega = firstMegaNode(graph.model());
    graph.tap(mega);

    graph.press(mega);

    expect(folded).toEqual([mega]);
  });
});

describe("resting a pointer on a note", () => {
  async function resting(overrides: Partial<GraphMountOptions> = {}) {
    const rested: (GraphHoverAt | null)[] = [];
    const graph = await mount({
      onHover: (at) => rested.push(at),
      ...overrides,
    });
    return { graph, rested };
  }

  it("says which note it is, and where the mark is on the screen", async () => {
    const { graph, rested } = await resting();
    const ref = graph.model().order[0];
    const mark = graph.model().graph.getNodeAttributes(ref);
    graph.scene.movePosition(mark.index, { x: 40, y: 60 });
    graph.scene.viewport.scale = 2;
    graph.scene.viewport.x = 10;
    graph.scene.viewport.y = 5;

    graph.rest(ref);

    expect(rested).toEqual([
      {
        ref,
        clientX: 90,
        clientY: 125,
        radius: mark.radius * 2,
        folded: mark.folded,
        tags: mark.tags,
      },
    ]);

    graph.rest(null);
    expect(rested.at(-1)).toBeNull();
  });

  // A mega-node is lit by the tags of everything it folded, so a preview showing
  // only the one note's would disagree with the mark it is standing beside.
  it("answers for the subtree a mega-node stands for", async () => {
    const { graph, rested } = await resting();
    const mega = firstMegaNode(graph.model());
    const mark = graph.model().graph.getNodeAttributes(mega);

    graph.rest(mega);

    expect(rested[0]?.folded).toBe(mark.folded);
    expect(rested[0]?.folded).toBeGreaterThan(0);
    expect(rested[0]?.tags).toEqual(mark.tags);
    const own = corpus.nodes.find((node) => node.ref === mega)?.tags ?? [];
    expect(rested[0]?.tags.length).toBeGreaterThan(own.length);
  });

  it("says nothing on a canvas somebody is choosing on", async () => {
    const { graph, rested } = await resting({
      chosen: new Set<OwnedRef>(),
      onChoose: () => {},
    });

    graph.rest(graph.model().order[0]);

    expect(rested).toEqual([null]);
  });

  // The mode arrives while the pointer is already resting, so the preview has to
  // be taken back rather than left over the note being reached for.
  it("takes one back the moment the canvas is asked a question", async () => {
    const { graph, rested } = await resting();
    graph.rest(graph.model().order[0]);
    expect(rested.at(-1)).not.toBeNull();

    graph.handle.update({ ...graph.props, chosen: new Set<OwnedRef>() });

    expect(rested.at(-1)).toBeNull();
  });
});

describe("the ground under the graph", () => {
  it("draws none of its own accord", async () => {
    const graph = await mount();
    expect(graph.scene.ground).toBe("none");
  });

  it("draws the one the reader chose, and changes it without a settle", async () => {
    const graph = await mount({ ground: "dots" });
    expect(graph.scene.ground).toBe("dots");
    const settles = graph.starts();

    graph.handle.update({ ...graph.props, ground: "lines" });

    expect(graph.scene.ground).toBe("lines");
    expect(graph.starts()).toBe(settles);
  });
});
