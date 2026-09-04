// Mounting the canvas. This is the whole public surface of the renderer: a host
// hands it the props `contract.ts` describes and gets back a handle it drives.
//
// Nothing here is a framework component on purpose. DESIGN.md § "The canvas"
// puts the line at "Svelte owns which nodes exist, pixi owns runtime pan, zoom
// and drag" — a component that owned the viewport would have to re-render to
// move it, which is the remount this design exists to avoid.

import type { OwnedRef } from "@sloppy/types";
import {
  drawnNodes,
  drawnReading,
  type GraphHoverAt,
  type GraphSurfaceProps,
} from "./contract.js";
import { attachGestures, type ScreenBox } from "./gestures.js";
import { LayoutClient } from "./layout/client.js";
import type { LayoutEvent } from "./layout/protocol.js";
import { applyLod, DEFAULT_BUDGET, type LodBudget } from "./lod.js";
import { buildModel, type GraphEdgeAttributes } from "./model.js";
import {
  buildPalette,
  type GraphPalette,
  paperCeiling,
  type PaletteTokens,
  readPaletteTokens,
} from "./palette.js";
import { type FrameStats, GraphScene } from "./scene.js";
import type { Bounds, Point, Viewport } from "./viewport.js";
import { WallLayer } from "./wall.js";

/** How hard each kind of edge pulls: the tree holds its shape, an association
 *  crossing it barely tugs. */
const SPRING: Record<GraphEdgeAttributes["kind"], number> = {
  genealogy: 0.55,
  run: 0.3,
  link: 0.12,
};

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
  /** Start a fresh timing window, so `stats` describes one thing at a time. */
  resetStats(): void;
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

  // Positioned, so the wallpaper before it in the surface paints beneath it.
  // An unpositioned canvas paints under EVERY positioned sibling, tree order
  // notwithstanding, which would put the picture over the field.
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:relative;display:block;width:100%;height:100%";

  const ink = document.createElement("div");
  ink.dataset.graphInk = "";
  ink.style.cssText = "position:absolute;inset:0;pointer-events:none";

  // The sweep is chrome over the canvas rather than something in the field, so
  // it is drawn in screen coordinates and never enters the scene.
  const sweep = document.createElement("div");
  sweep.dataset.graphSweep = "";
  sweep.style.cssText =
    "position:absolute;display:none;pointer-events:none;" +
    "border:1px solid color-mix(in oklab, currentColor 55%, transparent);" +
    "background:color-mix(in oklab, currentColor 8%, transparent)";

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const wall = new WallLayer(reduced);

  surface.append(wall.element, canvas, ink, sweep);
  host.append(surface);

  const fonts = readFonts(host);

  let props = options;
  let scene: GraphScene | null = null;
  let detachGestures: (() => void) | null = null;
  let tokens: PaletteTokens = readPaletteTokens(host);
  // Held back rather than computed: the walk-up and its bisections cost several
  // milliseconds of the first paint, and buy nothing for a reader who has
  // chosen no picture.
  let ceilingNow: number | null = null;
  const ceiling = (): number => (ceilingNow ??= paperCeiling(tokens));
  let presence = presenceOf(props, ceiling);
  let palette: GraphPalette = buildPalette(tokens, presence);
  // Before the renderer is up: the picture is the reader's ground, and it has
  // nothing to wait for.
  wall.show(options.wallpaper?.picture ?? null, options.pictures, presence);
  let focus = options.focus;
  let epoch = 0;
  let settled = false;
  let budgetFolded: ReadonlySet<OwnedRef> = new Set();
  let mountedKey = options.remountKey;
  let destroyed = false;
  /**
   * Keep the whole field framed while it settles, and stop the moment the
   * reader takes hold of it — a canvas that re-frames itself under somebody's
   * finger is worse than one that starts off-centre.
   */
  let framing = true;
  let dragged: { index: number; world: Point } | null = null;

  const layout = new LayoutClient({
    createWorker: options.createLayoutWorker,
    onPositions: (event: LayoutEvent) => {
      if (event.epoch !== epoch) return;
      settled = event.settled;
      scene?.setPositions(event.positions);
      if (dragged) scene?.movePosition(dragged.index, dragged.world);
      if (framing) scene?.fit();
    },
  });

  const lodBudget = (): LodBudget => ({ ...DEFAULT_BUDGET, ...props.lod });

  /**
   * `relayout` false re-reads the model without disturbing the simulation: the
   * drawn set and its order are a function of the props, so when only the
   * colours have moved the worker's positions still belong to these nodes. A
   * theme change or a tag selection that restarted the settle would shake the
   * whole graph to answer a question about colour.
   */
  const rebuild = (relayout = true): void => {
    if (!scene) return;
    const lod = applyLod(props.nodes, props.collapsed, focus, lodBudget());
    budgetFolded = lod.folded;

    const model = buildModel(drawnNodes(props.nodes, lod.collapsed), {
      selection: props.selection,
      palette,
      viewer: props.viewer,
      keep: scene.snapshot(),
      fields: props.fields,
    });

    scene.setModel(model, props.selection.length > 0);
    scene.setPicking(props.picking ?? null);
    scene.setChosen(props.chosen ?? null);
    scene.setReading(
      props.reading
        ? drawnReading(props.nodes, lod.collapsed, props.reading)
        : null,
    );
    dragged = null;
    if (!relayout) return;

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
      pictures: props.pictures,
    });
    if (destroyed) {
      built.destroy();
      return;
    }
    scene = built;
    built.setGround(props.ground ?? "none");
    detachGestures = attachGestures(surface, built.viewport, {
      hitTest: (world) => built.hitTest(world),
      onTap: (target, _world, withModifier) => {
        if (target === null) return;
        const node = built.attributesOf(target);
        if (!node) return;
        const ref = target as OwnedRef;
        if (node.collapsed) {
          // Opening a mega-node moves the focus to it, so the budget measures
          // from where the reader just looked and the subtree has room to draw.
          focus = ref;
          props.onExpand(ref);
          if (budgetFolded.has(ref)) rebuild();
          return;
        }
        const picking = props.picking;
        if (picking) {
          if (ref !== picking.from) picking.onPick(ref);
          return;
        }
        // A tap adds and removes wherever somebody is already choosing, which is
        // the phone's way in; the modifier is the desk's way of starting.
        if (props.onChoose && (props.chosen !== undefined || withModifier)) {
          props.onChoose(ref);
          return;
        }
        props.onOpenNode(ref);
      },
      onPress: (target, at) => {
        if (props.onMenu) {
          props.onMenu({
            ...at,
            ref: target as OwnedRef | null,
            foldable: target !== null && built.hasDrawnChildren(target),
          });
          return;
        }
        if (target !== null && built.hasDrawnChildren(target)) {
          props.onCollapse(target as OwnedRef);
        }
      },
      onHover: (target) => {
        if (destroyed) return;
        props.onHover?.(
          target === null || asked(props)
            ? null
            : hoverAt(built, surface, target),
        );
      },
      canSweep: () => props.onChooseWithin !== undefined,
      onSweep: (box, done) => {
        framing = false;
        if (!done) {
          showSweep(box);
          return;
        }
        showSweep(null);
        props.onChooseWithin?.(
          built.marksWithin(worldBox(built.viewport, box)) as OwnedRef[],
        );
      },
      onDragStart: (target, world) => {
        framing = false;
        pin(target, world, true);
      },
      onDragMove: (target, world) => pin(target, world, true),
      onDragEnd: (target) => {
        const index = built.indexOf(target);
        if (index !== undefined) {
          pin(target, built.positionOf(index), false);
        }
      },
      onViewportChange: () => {
        framing = false;
        built.invalidate();
      },
      inkTarget: () => props.onInkPointer,
    });
    rebuild();
  };

  const showSweep = (box: ScreenBox | null): void => {
    if (!box) {
      sweep.style.display = "none";
      return;
    }
    sweep.style.display = "block";
    sweep.style.left = `${box.x}px`;
    sweep.style.top = `${box.y}px`;
    sweep.style.width = `${box.width}px`;
    sweep.style.height = `${box.height}px`;
  };

  const pin = (target: string, world: Point, held: boolean): void => {
    const index = scene?.indexOf(target);
    dragged = held && index !== undefined ? { index, world } : null;
    if (!scene || index === undefined) return;
    if (held) scene.movePosition(index, world);
    layout.send({ kind: "pin", epoch, index, x: world.x, y: world.y, held });
  };

  /** The floors are measured on the ground the marks are actually on, so a
   *  theme change and a change to the picture both land here. */
  const repaint = (): void => {
    presence = presenceOf(props, ceiling);
    palette = buildPalette(tokens, presence);
    scene?.setPalette(palette);
    wall.show(props.wallpaper?.picture ?? null, props.pictures, presence);
  };

  const themes = new MutationObserver(() => {
    tokens = readPaletteTokens(host);
    ceilingNow = null;
    repaint();
    rebuild(false);
  });
  themes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-accent", "class"],
  });

  void start();

  return {
    update(next) {
      const remounting = next.remountKey !== mountedKey;
      const moved = layoutMoved(props, next);
      const asking = next.picking?.from !== props.picking?.from;
      const grounded = next.ground !== props.ground;
      const takingOver = asked(next) && !asked(props);
      const papered =
        next.wallpaper?.picture !== props.wallpaper?.picture ||
        next.wallpaper?.strength !== props.wallpaper?.strength;
      props = next;
      if (grounded) scene?.setGround(next.ground ?? "none");
      if (papered) repaint();
      if (takingOver) next.onHover?.(null);
      // The canvas comes to the note the choice is being made for, so the reader
      // is never asked to pick against a viewport they left somewhere else.
      if (asking && next.picking) {
        framing = false;
        scene?.centreOn(next.picking.from);
      }
      if (next.focus !== undefined && next.focus !== focus) focus = next.focus;
      if (remounting) {
        mountedKey = next.remountKey;
        focus = next.focus;
      }
      if (remounting) framing = true;
      rebuild(moved || remounting);
    },
    destroy() {
      destroyed = true;
      themes.disconnect();
      detachGestures?.();
      layout.destroy();
      scene?.destroy();
      wall.destroy();
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
    resetStats() {
      scene?.resetStats();
    },
    stats() {
      if (!scene) return null;
      const frames = scene.stats();
      return {
        frames,
        layout: layout.mode,
        drawn: frames.drawn,
        maxDrawn: lodBudget().maxDrawn,
        autoFolded: budgetFolded.size,
        settled,
      };
    },
  };
}

/**
 * How much of the picture actually reaches the reader: what they asked for, of
 * what this ground can carry. A surface with no picture up is presence 0, so
 * the palette is the plain theme's to the byte.
 */
function presenceOf(props: GraphSurfaceProps, ceiling: () => number): number {
  const paper = props.wallpaper;
  if (!paper || paper.picture === null) return 0;
  return Math.max(0, Math.min(1, paper.strength)) * ceiling();
}

/**
 * Whether anything the layout reads has moved. `selection` is deliberately not
 * one of them: DESIGN.md § Hue answers a tag question in colour, and a field
 * that re-settled under the reader would be answering it somewhere else.
 *
 * `lod` is read field by field because a host naturally writes that bag inline
 * and a fresh object each render is not a moved budget. The collections are
 * compared by identity, which is what a `$derived` gives them.
 */
function layoutMoved(a: GraphMountOptions, b: GraphMountOptions): boolean {
  return (
    a.nodes !== b.nodes ||
    a.collapsed !== b.collapsed ||
    a.viewer !== b.viewer ||
    a.focus !== b.focus ||
    a.lod?.depth !== b.lod?.depth ||
    a.lod?.maxDrawn !== b.lod?.maxDrawn
  );
}

/**
 * Whether the canvas is being asked a question of its own — a note to point at,
 * or notes to choose. A preview then sits over what somebody is reaching for,
 * and answers something they did not ask.
 */
function asked(props: GraphSurfaceProps): boolean {
  return props.picking !== undefined || props.chosen !== undefined;
}

/** Where a mark is on the screen, so a preview can be placed against the mark
 *  rather than against the pointer that found it. */
function hoverAt(
  scene: GraphScene,
  surface: HTMLElement,
  ref: string,
): GraphHoverAt | null {
  const node = scene.attributesOf(ref);
  const index = scene.indexOf(ref);
  if (!node || index === undefined) return null;
  const box = surface.getBoundingClientRect();
  const world = scene.positionOf(index);
  const at = scene.viewport.toScreen(world.x, world.y);
  return {
    ref: ref as OwnedRef,
    clientX: box.left + at.x,
    clientY: box.top + at.y,
    radius: node.radius * scene.viewport.scale,
    folded: node.folded,
    tags: node.tags,
  };
}

function worldBox(viewport: Viewport, box: ScreenBox): Bounds {
  const from = viewport.toWorld(box.x, box.y);
  const to = viewport.toWorld(box.x + box.width, box.y + box.height);
  return { minX: from.x, minY: from.y, maxX: to.x, maxY: to.y };
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
      strength: SPRING[attributes.kind],
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
