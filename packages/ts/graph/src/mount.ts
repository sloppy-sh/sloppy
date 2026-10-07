// Mounting the canvas. This is the whole public surface of the renderer: a host
// hands it the props `contract.ts` describes and gets back a handle it drives.
//
// Nothing here is a framework component on purpose. DESIGN.md § "The canvas"
// puts the line at "Svelte owns which nodes exist, pixi owns runtime pan, zoom
// and drag" — a component that owned the viewport would have to re-render to
// move it, which is the remount this design exists to avoid.

import type { OwnedRef } from "@sloppy/types";
import {
  comparingStates,
  drawnRefs,
  drawnNodes,
  drawnReading,
  type GraphDifference,
  type GraphField,
  type GraphEdgeLook,
  type GraphFieldInset,
  type GraphHoverAt,
  type GraphSurfaceProps,
  type GraphTransform,
  nodesWithGone,
} from "./contract.js";
import { screenDensity } from "./density.js";
import { attachGestures, type ScreenBox } from "./gestures.js";
import { LayoutClient } from "./layout/client.js";
import type { LayoutEvent } from "./layout/protocol.js";
import { DEFAULT_BUDGET, type LodBudget, makeFold } from "./lod.js";
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
 *  crossing it barely tugs. The two a person made pull alike — how far apart two
 *  notes sit is the genealogy's to set (DESIGN.md § Edges), so which way somebody
 *  made the line cannot move them differently. */
const SPRING: Record<GraphEdgeAttributes["kind"], number> = {
  genealogy: 0.55,
  run: 0.3,
  reference: 0.12,
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
  /**
   * Bring the canvas to a mark the reader opened, holding the ask until the
   * mark is drawn and until the layout has settled under it. A mark already on
   * screen is left where it is.
   */
  bringTo(ref: OwnedRef): void;
  fit(): void;
  /** Where the field is looking, in {@link GraphTransform}'s coordinates;
   *  `null` before the renderer is up, which is nowhere yet rather than the
   *  origin. */
  viewport(): GraphTransform | null;
  /**
   * Put the field at a pan and zoom it was read at before. Asked before or
   * while the first framing runs it WINS over that frame — a reader coming
   * back to a place is not coming back to a fresh fit — and asked after, it
   * applies at once.
   */
  lookAt(at: GraphTransform): void;
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
    "pointer-events:none;user-select:none;-webkit-user-select:none;" +
    "-webkit-tap-highlight-color:transparent";

  // The box the marks are drawn in: the surface less the room the host's chrome
  // takes. Every screen-to-world reading measures THIS, never the surface, which
  // the picture behind the chrome goes on covering.
  const field = document.createElement("div");
  field.dataset.graphField = "";
  field.style.cssText =
    "position:absolute;left:0;right:0;overflow:hidden;pointer-events:auto;" +
    "touch-action:none;overscroll-behavior:contain";

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%";

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

  const frame = (inset: GraphFieldInset | undefined): void => {
    field.style.top = inset?.top ?? "0px";
    field.style.bottom = inset?.bottom ?? "0px";
  };
  frame(options.inset);

  field.append(canvas, ink, sweep);
  // Both positioned and neither given a z-index, so tree order alone is what
  // holds the picture under the field rather than over it.
  surface.append(wall.element, field);
  host.append(surface);

  const fonts = readFonts(host);

  let props = options;
  let scene: GraphScene | null = null;
  let detachGestures: (() => void) | null = null;
  const resized = new ResizeObserver(() => scene?.resize());
  resized.observe(field);
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
  wall.show(
    options.wallpaper?.picture ?? null,
    options.pictures,
    presence,
    options.wallpaper?.transition,
  );
  let focus = options.focus;
  let epoch = 0;
  let settled = false;
  let budgetFolded: ReadonlySet<OwnedRef> = new Set();
  let mountedKey = options.remountKey;
  let destroyed = false;
  // A window dragged onto another screen changes density without changing size,
  // and there is no event for it: what stops matching is a query on the density
  // the window had.
  let densities: MediaQueryList | null = null;
  const onDensityChange = (): void => {
    scene?.setResolution(screenDensity());
    watchDensity();
  };
  const watchDensity = (): void => {
    if (destroyed) return;
    densities?.removeEventListener("change", onDensityChange);
    densities = matchMedia(`(resolution: ${globalThis.devicePixelRatio}dppx)`);
    densities.addEventListener("change", onDensityChange);
  };
  /**
   * Keep the whole field framed while it settles, and stop the moment the
   * reader takes hold of it — a canvas that re-frames itself under somebody's
   * finger is worse than one that starts off-centre.
   */
  let framing = true;
  let framed = false;
  let dragged: { index: number; world: Point } | null = null;
  let bringing: OwnedRef | null = null;

  let told: GraphTransform | null = null;

  /** The ink layer is not in the scene, so nothing carries it along with a pan,
   *  a zoom or a frame: every place that moves the viewport says so here. */
  const tellTransform = (): void => {
    const view = scene?.viewport;
    if (!view || !props.onTransform) return;
    if (told?.x === view.x && told.y === view.y && told.scale === view.scale) {
      return;
    }
    told = { x: view.x, y: view.y, scale: view.scale };
    props.onTransform(told);
  };

  const frameAll = (): void => {
    if (!scene) return;
    framed = true;
    scene.fit();
    tellTransform();
  };

  /** A note is often asked for before its mark exists — a citation arrives while
   *  the graph is still being read — so the ask waits rather than being spent on
   *  a canvas that has not drawn it. Answers whether the mark was there. */
  const arrive = (): boolean => {
    if (bringing === null || scene === null) return false;
    if (scene.indexOf(bringing) === undefined) return false;
    // A frame still on its way puts the mark on screen with the rest of the
    // field, so the ask is answered by it rather than taking the viewport off it.
    if (framing && !framed) return true;
    if (!scene.inView(bringing)) {
      framing = false;
      scene.centreOn(bringing);
      tellTransform();
    }
    return true;
  };

  const takeViewport = (): void => {
    framing = false;
    bringing = null;
  };

  /** A place asked for before the renderer was up, which is where the field
   *  looks first once it is. */
  let looking: GraphTransform | null = null;

  const look = (at: GraphTransform): void => {
    takeViewport();
    if (!scene) {
      looking = at;
      return;
    }
    scene.viewport.lookAt(at);
    scene.invalidate();
    tellTransform();
  };

  const layout = new LayoutClient({
    createWorker: options.createLayoutWorker,
    onPositions: (event: LayoutEvent) => {
      if (event.epoch !== epoch) return;
      settled = event.settled;
      scene?.setPositions(event.positions);
      if (dragged) scene?.movePosition(dragged.index, dragged.world);
      // Spent on the settle that follows the ask, never on the rest the field
      // was already in: opening a note is itself a relayout, which would then
      // carry the note back off screen with nothing holding it.
      if (arrive() && settled) bringing = null;
      if (framing) frameAll();
    },
  });

  const fold = makeFold();
  const lodBudget = (): LodBudget => ({ ...DEFAULT_BUDGET, ...props.lod });
  const comparing = (): boolean => comparingStates(props.difference);

  /**
   * Everything the marks now on the canvas were drawn from EXCEPT the reader's
   * tags. While all of it stands still a rebuild has only colours to write, and
   * takes {@link GraphScene.setTints} instead of replacing what is drawn.
   */
  let drawnFrom: {
    nodes: GraphMountOptions["nodes"];
    collapsed: GraphMountOptions["collapsed"];
    viewer: GraphMountOptions["viewer"];
    fields: GraphMountOptions["fields"];
    edgeLooks: GraphMountOptions["edgeLooks"];
    difference: GraphMountOptions["difference"];
    focus: OwnedRef | undefined;
    palette: GraphPalette;
    budget: LodBudget;
  } | null = null;

  /**
   * `relayout` false re-reads the model without disturbing the simulation: the
   * drawn set and its order are a function of the props, so when only the
   * colours have moved the worker's positions still belong to these nodes. A
   * theme change or a tag selection that restarted the settle would shake the
   * whole graph to answer a question about colour.
   */
  const rebuild = (relayout = true): void => {
    if (!scene) return;
    const budget = lodBudget();
    const standing = drawnFrom;
    const recolour =
      !relayout &&
      standing !== null &&
      standing.nodes === props.nodes &&
      standing.collapsed === props.collapsed &&
      standing.viewer === props.viewer &&
      sameLooks(standing.edgeLooks, props.edgeLooks) &&
      sameDifference(standing.difference, props.difference) &&
      sameFields(standing.fields, props.fields) &&
      standing.focus === focus &&
      standing.palette === palette &&
      standing.budget.depth === budget.depth &&
      standing.budget.maxDrawn === budget.maxDrawn;

    // The notes the difference says went stand in the region alongside it, so
    // every mark on the canvas is seeded and folded by the one rule.
    const nodes = nodesWithGone(props.nodes, props.difference);
    const lod = fold(nodes, props.collapsed, focus, budget);
    budgetFolded = lod.folded;

    const model = buildModel(drawnNodes(nodes, lod.collapsed), {
      selection: props.selection,
      ...(props.codeMoved === undefined
        ? {}
        : { codeMoved: drawnRefs(nodes, lod.collapsed, props.codeMoved) }),
      palette,
      viewer: props.viewer,
      keep: scene.snapshot(),
      fields: props.fields,
      difference: props.difference,
      edgeLooks: props.edgeLooks,
    });

    const questioned = props.selection.length > 0;
    if (recolour) scene.setTints(model, questioned);
    else scene.setModel(model, questioned);
    drawnFrom = {
      nodes: props.nodes,
      collapsed: props.collapsed,
      viewer: props.viewer,
      fields: props.fields,
      edgeLooks: props.edgeLooks,
      difference: props.difference,
      focus,
      palette,
      budget,
    };
    scene.setPicking(props.picking ?? null);
    scene.setChosen(props.chosen ?? null);
    scene.setReading(
      props.reading ? drawnReading(nodes, lod.collapsed, props.reading) : null,
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
      resolution: screenDensity(),
      pictures: props.pictures,
      reduced,
    });
    if (destroyed) {
      built.destroy();
      return;
    }
    scene = built;
    if (looking !== null) {
      const at = looking;
      looking = null;
      look(at);
    }
    built.setGround(props.ground ?? "none");
    watchDensity();
    detachGestures = attachGestures(field, built.viewport, {
      hitTest: (world) => built.hitTest(world),
      onTap: (target, world, withModifier) => {
        if (target === null) {
          // A line is what is left where a tap landed on no mark, and only
          // where nothing else has already said what a tap means.
          if (props.onEdge === undefined || comparing()) return;
          if (props.picking !== undefined || props.chosen !== undefined) return;
          const pair = built.hitEdge(world);
          if (pair) props.onEdge(pair[0] as OwnedRef, pair[1] as OwnedRef);
          return;
        }
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
        // A note that went is not in the state the reader is on, so there is no
        // note behind its mark to open — DESIGN.md § "A difference between two
        // states".
        if (node.difference === "gone") return;
        // Picking and choosing are acts, and a canvas comparing two states is
        // not in either mode: the orbit is the difference's while one is up, so
        // a tap opens rather than pointing at or taking.
        if (!comparing()) {
          const picking = props.picking;
          if (picking) {
            if (ref !== picking.from) picking.onPick(ref);
            return;
          }
          // A tap adds and removes wherever somebody is already choosing, which
          // is the phone's way in; the modifier is the desk's way of starting.
          if (props.onChoose && (props.chosen !== undefined || withModifier)) {
            props.onChoose(ref);
            return;
          }
        }
        props.onOpenNode(ref);
      },
      onPress: (target, at) => {
        if (
          target !== null &&
          built.attributesOf(target)?.difference === "gone"
        ) {
          return;
        }
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
            : hoverAt(built, field, target),
        );
      },
      canSweep: () => !comparing() && props.onChooseWithin !== undefined,
      canSweepByFinger: () =>
        !comparing() &&
        props.chosen !== undefined &&
        props.onChooseWithin !== undefined,
      onSweep: (box, done) => {
        takeViewport();
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
        takeViewport();
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
        takeViewport();
        built.invalidate();
        tellTransform();
      },
      inkTarget: () => props.onInkPointer,
    });
    rebuild();
    tellTransform();
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
    wall.show(
      props.wallpaper?.picture ?? null,
      props.pictures,
      presence,
      props.wallpaper?.transition,
    );
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

  // A mark wearing several pictures shows whichever one the clock says, read
  // when the graph opens and when the app comes back — DESIGN.md § "A picture
  // that takes turns".
  const returned = (): void => {
    if (!document.hidden) scene?.takeTurns();
  };
  document.addEventListener("visibilitychange", returned);

  void start();

  return {
    update(next) {
      const remounting = next.remountKey !== mountedKey;
      const moved = layoutMoved(props, next);
      const relayout = moved || remounting;
      const asking = next.picking?.from !== props.picking?.from;
      const grounded = next.ground !== props.ground;
      const takingOver = asked(next) && !asked(props);
      const papered =
        next.wallpaper?.picture !== props.wallpaper?.picture ||
        next.wallpaper?.strength !== props.wallpaper?.strength ||
        next.wallpaper?.transition !== props.wallpaper?.transition;
      const reframed =
        next.inset?.top !== props.inset?.top ||
        next.inset?.bottom !== props.inset?.bottom;
      // A host that wires the ink layer up after the canvas is running is owed
      // where the field is looking now, not where it goes next.
      const listening =
        next.onTransform !== undefined && props.onTransform === undefined;
      props = next;
      if (listening) told = null;
      if (reframed) frame(next.inset);
      if (grounded) scene?.setGround(next.ground ?? "none");
      if (papered) repaint();
      if (takingOver) next.onHover?.(null);
      // The canvas comes to the note the choice is being made for, so the reader
      // is never asked to pick against a viewport they left somewhere else.
      if (asking && next.picking) {
        takeViewport();
        scene?.centreOn(next.picking.from);
      }
      if (next.focus !== undefined && next.focus !== focus) focus = next.focus;
      if (remounting) {
        mountedKey = next.remountKey;
        focus = next.focus;
        framing = true;
        framed = false;
      }
      rebuild(relayout);
      // An act that starts no settle has nothing that could carry the mark off
      // screen, so the ask ends with the act rather than waiting for whatever
      // the reader does next.
      if (!relayout && arrive()) bringing = null;
      tellTransform();
    },
    destroy() {
      destroyed = true;
      document.removeEventListener("visibilitychange", returned);
      densities?.removeEventListener("change", onDensityChange);
      themes.disconnect();
      resized.disconnect();
      detachGestures?.();
      layout.destroy();
      scene?.destroy();
      wall.destroy();
      surface.remove();
    },
    ink,
    toWorld(clientX, clientY) {
      const box = field.getBoundingClientRect();
      const view = scene?.viewport;
      if (!view) return { x: clientX - box.left, y: clientY - box.top };
      return view.toWorld(clientX - box.left, clientY - box.top);
    },
    bringTo(ref) {
      bringing = ref;
      arrive();
    },
    fit() {
      bringing = null;
      frameAll();
    },
    viewport() {
      const view = scene?.viewport;
      return view ? { x: view.x, y: view.y, scale: view.scale } : null;
    },
    lookAt(at) {
      look(at);
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
 * that re-settled under the reader would be answering it somewhere else. A
 * difference IS one, because the notes it says went stand in the field.
 *
 * `lod` and `difference` are read rather than compared by identity, because a
 * host naturally writes either bag inline and a fresh object each render is not
 * a moved budget or a fresh question. `nodes` and `collapsed` are compared by
 * identity, which is what a `$derived` gives them.
 */
function layoutMoved(a: GraphMountOptions, b: GraphMountOptions): boolean {
  return (
    a.nodes !== b.nodes ||
    a.collapsed !== b.collapsed ||
    a.viewer !== b.viewer ||
    !sameDifference(a.difference, b.difference) ||
    a.focus !== b.focus ||
    a.lod?.depth !== b.lod?.depth ||
    a.lod?.maxDrawn !== b.lod?.maxDrawn
  );
}

/**
 * Whether the same two states are being compared. Read rather than compared by
 * identity for the reason the fields are: a host writes this bag inline, and a
 * fresh object each render is not a fresh question.
 */
function sameDifference(
  a: GraphDifference | undefined,
  b: GraphDifference | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    sameRefs(a.added, b.added) &&
    sameRefs(a.changed, b.changed) &&
    a.removed.length === b.removed.length &&
    a.removed.every((node, at) => node.ref === b.removed[at].ref) &&
    a.moved.length === b.moved.length &&
    a.moved.every(
      (note, at) =>
        note.ref === b.moved[at].ref && note.from === b.moved[at].from,
    )
  );
}

function sameRefs(a: ReadonlySet<OwnedRef>, b: ReadonlySet<OwnedRef>): boolean {
  if (a.size !== b.size) return false;
  for (const ref of a) if (!b.has(ref)) return false;
  return true;
}

/**
 * Whether the lines are drawn under the same looks. Read rather than compared
 * by identity for the reason the fields are: a host resolves these off its own
 * notes, so the same canvas arrives as a fresh list every update.
 */
function sameLooks(
  a: readonly GraphEdgeLook[] | undefined,
  b: readonly GraphEdgeLook[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (look, at) =>
      look.from === b[at].from &&
      look.to === b[at].to &&
      look.label === b[at].label &&
      look.direction === b[at].direction &&
      look.stroke === b[at].stroke,
  );
}

/**
 * Whether the same graphs stand on the canvas, in the same order and under the
 * same names. Read rather than compared by identity: a host names its fields
 * off its own listing, so the same canvas arrives as a fresh list every update.
 */
function sameFields(
  a: readonly GraphField[] | undefined,
  b: readonly GraphField[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (field, at) => field.ref === b[at].ref && field.title === b[at].title,
  );
}

/**
 * Whether the canvas is being asked a question of its own — a note to point at,
 * or notes to choose. A preview then sits over what somebody is reaching for,
 * and answers something they did not ask. Neither is asked while two states are
 * being compared, whatever a host left bound.
 */
function asked(props: GraphSurfaceProps): boolean {
  if (comparingStates(props.difference)) return false;
  return props.picking !== undefined || props.chosen !== undefined;
}

/** Where a mark is on the screen, so a preview can be placed against the mark
 *  rather than against the pointer that found it. */
function hoverAt(
  scene: GraphScene,
  field: HTMLElement,
  ref: string,
): GraphHoverAt | null {
  const node = scene.attributesOf(ref);
  const index = scene.indexOf(ref);
  if (!node || index === undefined) return null;
  if (node.difference === "gone") return null;
  const box = field.getBoundingClientRect();
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
