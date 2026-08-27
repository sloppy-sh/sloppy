// Mounting the canvas. This is the whole public surface of the renderer: a host
// hands it the props `contract.ts` describes and gets back a handle it drives.
//
// Nothing here is a framework component on purpose. DESIGN.md § "The canvas"
// puts the line at "Svelte owns which nodes exist, pixi owns runtime pan, zoom
// and drag" — a component that owned the viewport would have to re-render to
// move it, which is the remount this design exists to avoid.

import type { OwnedRef } from "@sloppy/types";
import { drawnNodes, type GraphSurfaceProps } from "./contract.js";
import { attachGestures } from "./gestures.js";
import { LayoutClient } from "./layout/client.js";
import type { LayoutEvent } from "./layout/protocol.js";
import { applyLod, DEFAULT_BUDGET, type LodBudget } from "./lod.js";
import { buildModel } from "./model.js";
import { type GraphPalette, readPalette } from "./palette.js";
import { type FrameStats, GraphScene } from "./scene.js";
import type { Point } from "./viewport.js";

/** Genealogy edges pull harder than the links that cross them. */
const GENEALOGY_SPRING = 0.55;
const LINK_SPRING = 0.12;

export interface GraphMountOptions extends GraphSurfaceProps {
  /**
   * Build the layout worker. Without one the same layout runs on the main
   * thread in slices — rougher while it settles, never absent.
   */
  createLayoutWorker?: () => Worker;
  lod?: Partial<LodBudget>;
}

export interface GraphStats {
  frames: FrameStats;
  layout: "worker" | "inline";
  /** Marks drawn, against the bound level of detail is holding them under. */
  drawn: number;
  maxDrawn: number;
  /** Subtrees the budget folded beyond what the host asked for. */
  autoFolded: number;
  settled: boolean;
}

export interface GraphHandle {
  update(next: GraphMountOptions): void;
  destroy(): void;
  /**
   * The layer over the canvas for ink. Positioned but empty: the editor owns
   * what is drawn into it, this owns the surface and the gesture split.
   */
  readonly ink: HTMLElement;
  /** World coordinates for a client point, so a stroke sticks to the graph. */
  toWorld(clientX: number, clientY: number): Point;
  focusOn(ref: OwnedRef): void;
  fit(): void;
  stats(): GraphStats | null;
}

/**
 * Mount a graph into `host`. Returns synchronously — the renderer starts up in
 * the background and the handle queues anything that arrives meanwhile, so a
 * caller never has to hold a promise to tear one down.
 */
export function mountGraph(
  host: HTMLElement,
  options: GraphMountOptions,
): GraphHandle {
  const surface = document.createElement("div");
  surface.dataset.graphSurface = "";
  surface.style.cssText =
    "position:relative;width:100%;height:100%;overflow:hidden;" +
    "touch-action:none;overscroll-behavior:contain;user-select:none;" +
    "-webkit-user-select:none;-webkit-tap-highlight-color:transparent";

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%";

  const ink = document.createElement("div");
  ink.dataset.graphInk = "";
  ink.style.cssText = "position:absolute;inset:0;pointer-events:none";

  surface.append(canvas, ink);
  host.append(surface);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fonts = readFonts(host);

  let props = options;
  let scene: GraphScene | null = null;
  let detachGestures: (() => void) | null = null;
  let palette: GraphPalette = readPalette(host);
  let focus = options.focus;
  let epoch = 0;
  let settled = false;
  let autoFolded = 0;
  let mountedKey = options.remountKey;
  let destroyed = false;
  let firstFit = true;

  const layout = new LayoutClient({
    createWorker: options.createLayoutWorker,
    onPositions: (event: LayoutEvent) => {
      if (event.epoch !== epoch) return;
      settled = event.settled;
      scene?.setPositions(event.positions);
      if (firstFit && scene) {
        firstFit = false;
        scene.fit();
      }
    },
  });

  const budget: LodBudget = { ...DEFAULT_BUDGET, ...options.lod };

  const rebuild = (): void => {
    if (!scene) return;
    const lod = applyLod(props.nodes, props.collapsed, focus, budget);
    autoFolded = lod.folded.size;

    const model = buildModel(drawnNodes(props.nodes, lod.collapsed), {
      lens: props.lens,
      palette,
      viewer: props.viewer,
      keep: scene.snapshot(),
    });

    scene.setModel(model, props.lens !== null);
    epoch += 1;
    settled = false;
    layout.send({
      kind: "start",
      epoch,
      settleAtOnce: reduced.matches,
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
      edges: edgeInputs(model),
    });
  };

  const start = async (): Promise<void> => {
    const built = await GraphScene.create(canvas, {
      fonts,
      palette,
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
    if (destroyed) {
      built.destroy();
      return;
    }
    scene = built;
    detachGestures = attachGestures(surface, built.viewport, {
      hitTest: (world) => built.hitTest(world),
      onTap: (target) => {
        if (target === null) return;
        const node = built.attributesOf(target);
        if (!node) return;
        if (node.collapsed) {
          // Opening a mega-node moves the focus to it, so the budget measures
          // from where the reader just looked and the subtree has room to draw.
          focus = target as OwnedRef;
          props.onExpand(target as OwnedRef);
          return;
        }
        props.onOpenNode(target as OwnedRef);
      },
      onPress: (target) => {
        if (built.hasDrawnChildren(target))
          props.onCollapse(target as OwnedRef);
      },
      onDragStart: (target, world) => pin(target, world, true),
      onDragMove: (target, world) => pin(target, world, true),
      onDragEnd: (target) => {
        const index = built.indexOf(target);
        if (index !== undefined) {
          pin(target, built.positionOf(index), false);
        }
      },
      onViewportChange: () => built.invalidate(),
      onInk: props.onInkPointer,
    });
    rebuild();
  };

  const pin = (target: string, world: Point, held: boolean): void => {
    if (!scene) return;
    const index = scene.indexOf(target);
    if (index === undefined) return;
    if (held) scene.movePosition(index, world);
    layout.send({ kind: "pin", epoch, index, x: world.x, y: world.y, held });
  };

  const themes = new MutationObserver(() => {
    palette = readPalette(host);
    scene?.setPalette(palette);
    rebuild();
  });
  themes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-accent", "class"],
  });

  void start();

  return {
    update(next) {
      const remounting = next.remountKey !== mountedKey;
      props = next;
      if (next.focus !== undefined && next.focus !== focus) focus = next.focus;
      if (remounting) {
        mountedKey = next.remountKey;
        focus = next.focus;
        firstFit = true;
      }
      rebuild();
    },
    destroy() {
      destroyed = true;
      themes.disconnect();
      detachGestures?.();
      layout.destroy();
      scene?.destroy();
      surface.remove();
    },
    ink,
    toWorld(clientX, clientY) {
      const box = surface.getBoundingClientRect();
      const view = scene?.viewport;
      if (!view) return { x: clientX - box.left, y: clientY - box.top };
      return view.toWorld(clientX - box.left, clientY - box.top);
    },
    focusOn(ref) {
      focus = ref;
      scene?.centreOn(ref);
      rebuild();
    },
    fit() {
      scene?.fit();
    },
    stats() {
      if (!scene) return null;
      const frames = scene.stats();
      return {
        frames,
        layout: layout.mode,
        drawn: frames.drawn,
        maxDrawn: budget.maxDrawn,
        autoFolded,
        settled,
      };
    },
  };
}

function edgeInputs(model: ReturnType<typeof buildModel>) {
  const inputs: {
    source: number;
    target: number;
    distance: number;
    strength: number;
  }[] = [];
  model.graph.forEachEdge((_edge, attributes, source, target) => {
    inputs.push({
      source: model.graph.getNodeAttributes(source).index,
      target: model.graph.getNodeAttributes(target).index,
      distance: attributes.distance,
      strength: attributes.kind === "link" ? LINK_SPRING : GENEALOGY_SPRING,
    });
  });
  return inputs;
}

function readFonts(host: Element): { ui: string; address: string } {
  const computed = getComputedStyle(host);
  const ui = computed.fontFamily || "system-ui, sans-serif";
  const address =
    computed.getPropertyValue("--font-address").trim() || "ui-monospace";
  return { ui, address };
}
