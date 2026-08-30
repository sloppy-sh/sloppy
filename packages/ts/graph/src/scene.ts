// The pixi half of the ownership line DESIGN.md § "The canvas" draws: this file
// owns runtime pan, zoom and drag; it never decides which nodes exist. It is
// handed a model and a stream of positions, and it draws them.
//
// Marks are particles rather than display objects because the bound is in the
// hundreds and the cost of a container per node is not. Form carries provenance
// (DESIGN.md § Form), which is why there are three of them: a tint cannot make
// one texture read as two shapes.

import type {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Text,
  Texture,
} from "pixi.js";
import { clamp } from "./color.js";
import type { GraphPickMarks } from "./contract.js";
import type { GraphNodeAttributes } from "./model.js";
import type { BuiltModel } from "./model.js";
import { DEPTH_STEPS, type GraphPalette } from "./palette.js";
import {
  type Bounds,
  type Point,
  Viewport,
  visibleBounds,
} from "./viewport.js";

type Pixi = typeof import("pixi.js");

/** Radius the mark textures are drawn at; every mark is a scale of this. */
const TEXTURE_RADIUS = 16;
const TEXTURE_RESOLUTION = 4;

const MAX_LABELS = 56;
/** Below this on screen, a mark is too small to carry words. */
const LABEL_MIN_RADIUS = 7;
/** How far past that a label hangs on, so a pinch does not strobe them. */
const LABEL_HYSTERESIS = 0.75;
/** Slots that may change hands in one frame. */
const LABEL_RETEXT_BUDGET = 6;
const LABEL_GAP = 6;
const LABEL_LINE = 15;
/** A title long enough to crowd its neighbours off the canvas is not a title. */
const TITLE_CHARS = 32;

/** How far outside a mark the orbit sits. Clear of the edge, so nothing drawn
 *  there reads as the provenance ring DESIGN.md § Form draws ON the edge. */
const PICK_GAP = 6;
const PICK_WIDTH = 1.5;
/** DESIGN.md § "The mark": the orbit's two meanings separate by weight —
 *  picking outlines, and choosing fills. */
const CHOSEN_BAND = 4;

const EDGE_WIDTH = 1.2;
/** DESIGN.md § Edges: the run is the line a reader walks, so it is the heaviest. */
const RUN_WEIGHT = 1.8;
const LINK_DASH = 9;
/** The most segments one dashed edge may cost. Reached only by an edge long
 *  enough that the dashes stretch to meet it. */
const MAX_DASHES = 60;

/** Rebuild edge geometry when the zoom has moved enough to show in the stroke. */
const SCALE_REBUILD = 0.08;

export interface SceneFonts {
  ui: string;
  address: string;
}

export interface SceneOptions {
  fonts: SceneFonts;
  palette: GraphPalette;
  resolution: number;
}

export interface FrameStats {
  /** Milliseconds this scene spent in its own draw callback. */
  cpuP50: number;
  cpuP95: number;
  cpuMax: number;
  /** Milliseconds between presented frames. */
  frameP50: number;
  frameP95: number;
  frames: number;
  drawn: number;
  edges: number;
  labels: number;
}

interface Mark {
  ref: string;
  index: number;
  radius: number;
  attributes: GraphNodeAttributes;
  fill: Particle | null;
  ring: Particle | null;
}

interface LabelSlot {
  address: Text;
  title: Text;
}

export class GraphScene {
  readonly viewport = new Viewport();
  private model: BuiltModel | null = null;
  private marks: Mark[] = [];
  private positions = new Float32Array(0);
  /** Genealogy edges as index pairs, one bucket per step of the depth ramp. */
  private edgesByDepth: number[][] = [];
  private runPairs: number[] = [];
  private linkPairs: number[] = [];
  private readonly labelSlots = new Map<string, number>();
  private selecting = false;
  private picking: GraphPickMarks | null = null;
  private chosen: ReadonlySet<string> | null = null;

  private positionsDirty = true;
  private modelDirty = false;
  private lastEdgeScale = 0;

  private readonly cpuSamples: number[] = [];
  private readonly frameSamples: number[] = [];

  private constructor(
    private readonly pixi: Pixi,
    private readonly app: Application,
    private readonly world: Container,
    private readonly edges: Graphics,
    private readonly runs: Graphics,
    private readonly links: Graphics,
    private readonly fills: ParticleContainer,
    private readonly rings: ParticleContainer,
    private readonly picks: Graphics,
    private readonly labels: Container,
    private readonly labelPool: LabelSlot[],
    private readonly textures: {
      disc: Texture;
      ring: Texture;
      dashed: Texture;
    },
    private options: SceneOptions,
  ) {
    this.app.ticker.add(this.draw);
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: SceneOptions,
  ): Promise<GraphScene> {
    const pixi = await import("pixi.js");
    const app = new pixi.Application();
    await app.init({
      canvas,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: options.resolution,
      preference: "webgl",
      powerPreference: "high-performance",
      resizeTo: canvas.parentElement ?? undefined,
    });

    const world = new pixi.Container();
    const edges = new pixi.Graphics();
    const runs = new pixi.Graphics();
    const links = new pixi.Graphics();
    const particleOptions = {
      dynamicProperties: {
        position: true,
        scale: true,
        rotation: false,
        color: true,
      },
    };
    const fills = new pixi.ParticleContainer(particleOptions);
    const rings = new pixi.ParticleContainer(particleOptions);
    const picks = new pixi.Graphics();
    world.addChild(edges, runs, links, fills, rings, picks);

    const labels = new pixi.Container();
    labels.eventMode = "none";
    app.stage.addChild(world, labels);

    const textures = {
      disc: markTexture(pixi, app, "disc"),
      ring: markTexture(pixi, app, "ring"),
      dashed: markTexture(pixi, app, "dashed"),
    };

    // Two texts per label, because DESIGN.md § Typography gives the address its
    // own face at every size: `1a1` against `1al` must never be a question.
    const labelPool = Array.from({ length: MAX_LABELS }, () => {
      const make = (fontFamily: string): Text => {
        const text = new pixi.Text({
          text: "",
          style: { fontFamily, fontSize: 12, fill: 0xffffff },
          resolution: options.resolution,
        });
        text.visible = false;
        text.anchor.set(0, 0.5);
        labels.addChild(text);
        return text;
      };
      return {
        address: make(options.fonts.address),
        title: make(options.fonts.ui),
      };
    });

    return new GraphScene(
      pixi,
      app,
      world,
      edges,
      runs,
      links,
      fills,
      rings,
      picks,
      labels,
      labelPool,
      textures,
      options,
    );
  }

  get width(): number {
    return this.app.renderer.screen.width;
  }

  get height(): number {
    return this.app.renderer.screen.height;
  }

  /** Edges, links and labels. Mark fills live on the model, so they arrive
   *  with the next {@link setModel}. */
  setPalette(palette: GraphPalette): void {
    this.options = { ...this.options, palette };
    this.lastEdgeScale = 0;
    this.positionsDirty = true;
  }

  /** The choice being asked for on the canvas, or null when a tap opens a note. */
  setPicking(picking: GraphPickMarks | null): void {
    this.picking = picking;
    this.positionsDirty = true;
  }

  /** The notes picked out to act on, or null when nobody is choosing. */
  setChosen(chosen: ReadonlySet<string> | null): void {
    this.chosen = chosen;
    this.positionsDirty = true;
  }

  /**
   * Replace what is drawn. Positions of nodes the previous model also held are
   * kept by the caller, so a selection change or an expand re-uses them rather
   * than throwing every node back to its seed.
   */
  setModel(model: BuiltModel, selecting: boolean): void {
    this.model = model;
    this.selecting = selecting;
    this.positions = new Float32Array(model.order.length * 2);

    this.marks = model.order.map((ref, index) => {
      const attributes = model.graph.getNodeAttributes(ref);
      this.positions[index * 2] = attributes.x;
      this.positions[index * 2 + 1] = attributes.y;
      return {
        ref,
        index,
        radius: attributes.radius,
        attributes,
        fill: null,
        ring: null,
      };
    });

    const byRef = new Map(model.order.map((ref, index) => [ref, index]));
    this.edgesByDepth = Array.from({ length: DEPTH_STEPS + 1 }, () => []);
    this.runPairs = [];
    this.linkPairs = [];
    model.graph.forEachEdge((_edge, attributes, source, target) => {
      const a = byRef.get(source);
      const b = byRef.get(target);
      if (a === undefined || b === undefined) return;
      if (attributes.kind === "link") {
        this.linkPairs.push(a, b);
        return;
      }
      if (attributes.kind === "run") {
        this.runPairs.push(a, b);
        return;
      }
      const deeper = Math.max(
        model.graph.getNodeAttributes(source).depth,
        model.graph.getNodeAttributes(target).depth,
      );
      const depth = clamp(Math.round(deeper), 1, DEPTH_STEPS + 1);
      this.edgesByDepth[depth - 1].push(a, b);
    });

    this.modelDirty = true;
    this.positionsDirty = true;
  }

  setPositions(positions: Float32Array): void {
    if (positions.length !== this.positions.length) return;
    this.positions.set(positions);
    this.positionsDirty = true;
  }

  positionOf(index: number): Point {
    return {
      x: this.positions[index * 2] ?? 0,
      y: this.positions[index * 2 + 1] ?? 0,
    };
  }

  movePosition(index: number, world: Point): void {
    if (index * 2 + 1 >= this.positions.length) return;
    this.positions[index * 2] = world.x;
    this.positions[index * 2 + 1] = world.y;
    this.positionsDirty = true;
  }

  indexOf(ref: string): number | undefined {
    if (!this.model?.graph.hasNode(ref)) return undefined;
    return this.model.graph.getNodeAttributes(ref).index;
  }

  attributesOf(ref: string): GraphNodeAttributes | null {
    if (!this.model?.graph.hasNode(ref)) return null;
    return this.model.graph.getNodeAttributes(ref);
  }

  hasDrawnChildren(ref: string): boolean {
    return (this.attributesOf(ref)?.children ?? 0) > 0;
  }

  /** Where each mark is now, so an update can carry survivors' positions. */
  snapshot(): Map<string, Point> {
    const at = new Map<string, Point>();
    for (const mark of this.marks)
      at.set(mark.ref, this.positionOf(mark.index));
    return at;
  }

  /** The mark under a world point, largest first so a mega-node wins a tie. */
  hitTest(world: Point): string | null {
    let best: string | null = null;
    let bestRadius = -1;
    // A finger is bigger than a leaf mark at any sensible zoom, so the target
    // grows back to a touchable size as the canvas shrinks.
    const slack = Math.max(0, 11 / this.viewport.scale - 4);
    for (const mark of this.marks) {
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      const reach = mark.radius + slack;
      if (Math.hypot(world.x - x, world.y - y) > reach) continue;
      if (mark.radius > bestRadius) {
        bestRadius = mark.radius;
        best = mark.ref;
      }
    }
    return best;
  }

  bounds(): Bounds {
    if (this.marks.length === 0) {
      return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const mark of this.marks) {
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      minX = Math.min(minX, x - mark.radius);
      minY = Math.min(minY, y - mark.radius);
      maxX = Math.max(maxX, x + mark.radius);
      maxY = Math.max(maxY, y + mark.radius);
    }
    return { minX, minY, maxX, maxY };
  }

  fit(): void {
    this.viewport.fit(this.bounds(), this.width, this.height);
    this.positionsDirty = true;
  }

  centreOn(ref: string): void {
    const index = this.indexOf(ref);
    if (index === undefined) return;
    this.viewport.centreOn(this.positionOf(index), this.width, this.height);
    this.positionsDirty = true;
  }

  invalidate(): void {
    this.positionsDirty = true;
  }

  stats(): FrameStats {
    const genealogy = this.edgesByDepth.reduce(
      (total, pairs) => total + pairs.length,
      0,
    );
    return {
      cpuP50: percentile(this.cpuSamples, 0.5),
      cpuP95: percentile(this.cpuSamples, 0.95),
      cpuMax: this.cpuSamples.reduce((most, ms) => Math.max(most, ms), 0),
      frameP50: percentile(this.frameSamples, 0.5),
      frameP95: percentile(this.frameSamples, 0.95),
      frames: this.frameSamples.length,
      drawn: this.marks.length,
      edges: (genealogy + this.runPairs.length + this.linkPairs.length) / 2,
      labels: this.labelSlots.size,
    };
  }

  resetStats(): void {
    this.cpuSamples.length = 0;
    this.frameSamples.length = 0;
  }

  destroy(): void {
    this.app.ticker.remove(this.draw);
    this.app.destroy(true, { children: true, texture: true });
  }

  private readonly draw = (): void => {
    const started = performance.now();
    this.frameSamples.push(this.app.ticker.deltaMS);

    if (this.modelDirty) this.rebuildMarks();

    const scaleMoved =
      Math.abs(this.viewport.scale - this.lastEdgeScale) >
      this.lastEdgeScale * SCALE_REBUILD;

    if (this.positionsDirty) this.syncMarks();
    if (this.positionsDirty || scaleMoved) this.rebuildEdges();
    if (this.positionsDirty || scaleMoved) this.drawOrbit();
    if (this.positionsDirty || scaleMoved) this.layoutLabels();

    this.world.position.set(this.viewport.x, this.viewport.y);
    this.world.scale.set(this.viewport.scale);
    this.positionsDirty = false;

    this.cpuSamples.push(performance.now() - started);
    if (this.cpuSamples.length > 600) this.cpuSamples.shift();
    if (this.frameSamples.length > 600) this.frameSamples.shift();
  };

  private rebuildMarks(): void {
    this.fills.particleChildren.length = 0;
    this.rings.particleChildren.length = 0;

    for (const mark of this.marks) {
      const scale = mark.radius / TEXTURE_RADIUS;
      const { provenance, fill, alpha } = mark.attributes;
      mark.fill =
        provenance === "pulled"
          ? null
          : new this.pixi.Particle({
              texture: this.textures.disc,
              anchorX: 0.5,
              anchorY: 0.5,
              scaleX: scale,
              scaleY: scale,
              tint: fill,
              alpha,
            });
      mark.ring =
        provenance === "own"
          ? null
          : new this.pixi.Particle({
              texture:
                provenance === "pulled"
                  ? this.textures.dashed
                  : this.textures.ring,
              anchorX: 0.5,
              anchorY: 0.5,
              scaleX: scale,
              scaleY: scale,
              tint: provenance === "pulled" ? fill : this.options.palette.ink,
              alpha,
            });
      if (mark.fill) this.fills.particleChildren.push(mark.fill);
      if (mark.ring) this.rings.particleChildren.push(mark.ring);
    }

    this.fills.update();
    this.rings.update();
    this.labelSlots.clear();
    for (const slot of this.labelPool) {
      slot.address.visible = false;
      slot.title.visible = false;
    }
    this.modelDirty = false;
  }

  private syncMarks(): void {
    for (const mark of this.marks) {
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      if (mark.fill) {
        mark.fill.x = x;
        mark.fill.y = y;
      }
      if (mark.ring) {
        mark.ring.x = x;
        mark.ring.y = y;
      }
    }
  }

  private rebuildEdges(): void {
    const { palette } = this.options;
    const width = Math.min(12, Math.max(0.5, EDGE_WIDTH / this.viewport.scale));

    const edgeAlpha = this.selecting
      ? palette.edgeAlphaWhileSelecting
      : palette.edgeAlpha;
    this.edges.clear();
    this.edgesByDepth.forEach((pairs, step) => {
      if (pairs.length === 0) return;
      for (let at = 0; at < pairs.length; at += 2) {
        const a = pairs[at] * 2;
        const b = pairs[at + 1] * 2;
        this.edges.moveTo(this.positions[a], this.positions[a + 1]);
        this.edges.lineTo(this.positions[b], this.positions[b + 1]);
      }
      this.edges.stroke({
        color: palette.depth(step + 1),
        alpha: edgeAlpha,
        width,
      });
    });

    this.runs.clear();
    for (let at = 0; at < this.runPairs.length; at += 2) {
      const a = this.runPairs[at] * 2;
      const b = this.runPairs[at + 1] * 2;
      this.runs.moveTo(this.positions[a], this.positions[a + 1]);
      this.runs.lineTo(this.positions[b], this.positions[b + 1]);
    }
    if (this.runPairs.length > 0) {
      this.runs.stroke({
        color: palette.run,
        alpha: this.selecting
          ? palette.runAlphaWhileSelecting
          : palette.runAlpha,
        width: width * RUN_WEIGHT,
      });
    }

    this.links.clear();
    const dash = LINK_DASH / this.viewport.scale;
    for (let at = 0; at < this.linkPairs.length; at += 2) {
      const a = this.linkPairs[at] * 2;
      const b = this.linkPairs[at + 1] * 2;
      dashLine(
        this.links,
        this.positions[a],
        this.positions[a + 1],
        this.positions[b],
        this.positions[b + 1],
        dash,
      );
    }
    if (this.linkPairs.length > 0) {
      this.links.stroke({
        color: palette.link,
        alpha: palette.linkAlpha,
        width,
      });
    }

    this.lastEdgeScale = this.viewport.scale;
  }

  /**
   * The orbit outside each mark, which DESIGN.md § "The mark" gives to the mode
   * the canvas is in. Picking outlines and choosing fills, and a canvas is only
   * ever in one of the two.
   */
  private drawOrbit(): void {
    this.picks.clear();
    const { ink } = this.options.palette;
    const gap = PICK_GAP / this.viewport.scale;

    const chosen = this.chosen;
    if (chosen) {
      const band = CHOSEN_BAND / this.viewport.scale;
      for (const mark of this.marks) {
        if (!chosen.has(mark.ref)) continue;
        this.picks.circle(
          this.positions[mark.index * 2],
          this.positions[mark.index * 2 + 1],
          mark.radius + gap + band / 2,
        );
        this.picks.stroke({ color: ink, alpha: 0.9, width: band });
      }
      return;
    }

    const picking = this.picking;
    if (!picking) return;
    const width = PICK_WIDTH / this.viewport.scale;
    for (const mark of this.marks) {
      const from = mark.ref === picking.from;
      if (!from && !picking.taken.has(mark.ref)) continue;
      this.picks.circle(
        this.positions[mark.index * 2],
        this.positions[mark.index * 2 + 1],
        mark.radius + gap,
      );
      this.picks.stroke({
        color: ink,
        alpha: from ? 0.95 : 0.4,
        width: from ? width * 2 : width,
      });
    }
  }

  /** Every mark whose centre falls inside a world rectangle, in drawn order. */
  marksWithin(bounds: Bounds): string[] {
    const found: string[] = [];
    for (const mark of this.marks) {
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      if (x < bounds.minX || x > bounds.maxX) continue;
      if (y < bounds.minY || y > bounds.maxY) continue;
      found.push(mark.ref);
    }
    return found;
  }

  /**
   * Setting a `Text`'s string re-rasterises it, and that is by far the most
   * expensive thing a frame here can do — a pinch that re-seats every slot costs
   * more than drawing everything else put together. So a mark keeps the slot it
   * had, holds it through a margin either side of the threshold, and only a few
   * slots may change hands in any one frame.
   */
  private layoutLabels(): void {
    const view = visibleBounds(this.viewport, this.width, this.height, 80);
    const held = this.labelSlots;
    const enter = LABEL_MIN_RADIUS / this.viewport.scale;
    const leave = enter * LABEL_HYSTERESIS;

    const wanted: Mark[] = [];
    for (const mark of this.marks) {
      if (mark.radius < (held.has(mark.ref) ? leave : enter)) continue;
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      if (x < view.minX || x > view.maxX || y < view.minY || y > view.maxY) {
        continue;
      }
      wanted.push(mark);
    }
    wanted.sort((a, b) => b.radius - a.radius);
    wanted.length = Math.min(wanted.length, MAX_LABELS);
    const keeping = new Set(wanted.map((mark) => mark.ref));

    for (const [ref, at] of held) {
      if (keeping.has(ref)) continue;
      held.delete(ref);
      this.labelPool[at].address.visible = false;
      this.labelPool[at].title.visible = false;
    }

    const taken = new Set(held.values());
    const free: number[] = [];
    for (let at = 0; at < this.labelPool.length; at++) {
      if (!taken.has(at)) free.push(at);
    }

    let budget = LABEL_RETEXT_BUDGET;
    for (const mark of wanted) {
      if (held.has(mark.ref) || budget <= 0) continue;
      const at = free.pop();
      if (at === undefined) break;
      budget -= 1;
      const slot = this.labelPool[at];
      slot.address.text = addressCaption(mark.attributes);
      slot.title.text = shorten(mark.attributes.title.trim(), TITLE_CHARS);
      held.set(mark.ref, at);
    }

    // Placed biggest first, and a label that would land on one already placed is
    // dropped for this frame rather than overprinted. It keeps its slot, so the
    // next pan brings it back without paying to rasterise it again.
    const fill = this.options.palette.ink;
    const placed: number[] = [];
    for (const mark of wanted) {
      const at = held.get(mark.ref);
      if (at === undefined) continue;
      const slot = this.labelPool[at];
      const screen = this.viewport.toScreen(
        this.positions[mark.index * 2],
        this.positions[mark.index * 2 + 1],
      );
      const left = screen.x + mark.radius * this.viewport.scale + LABEL_GAP;
      const width =
        slot.address.width +
        (slot.title.text === "" ? 0 : LABEL_GAP + slot.title.width);

      if (overlaps(placed, left, screen.y, width)) {
        slot.address.visible = false;
        slot.title.visible = false;
        continue;
      }
      placed.push(left, screen.y, width);

      slot.address.position.set(left, screen.y);
      slot.address.tint = fill;
      slot.address.visible = true;
      slot.title.position.set(left + slot.address.width + LABEL_GAP, screen.y);
      slot.title.tint = fill;
      slot.title.visible = slot.title.text !== "";
    }
  }
}

/** `placed` is a flat `[left, midY, width, …]`; boxes are one line tall. */
function overlaps(
  placed: readonly number[],
  left: number,
  midY: number,
  width: number,
): boolean {
  for (let at = 0; at < placed.length; at += 3) {
    if (Math.abs(placed[at + 1] - midY) >= LABEL_LINE) continue;
    if (left < placed[at] + placed[at + 2] && placed[at] < left + width) {
      return true;
    }
  }
  return false;
}

function shorten(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function addressCaption(attributes: GraphNodeAttributes): string {
  return attributes.folded > 0
    ? `${attributes.address} +${attributes.folded}`
    : attributes.address;
}

function markTexture(
  pixi: Pixi,
  app: Application,
  form: "disc" | "ring" | "dashed",
): Texture {
  const graphics = new pixi.Graphics();
  const r = TEXTURE_RADIUS;
  if (form === "disc") {
    graphics.circle(r, r, r - 1).fill(0xffffff);
  } else if (form === "ring") {
    graphics.circle(r, r, r - 1.6).stroke({ color: 0xffffff, width: 2.2 });
  } else {
    const dashes = 14;
    for (let step = 0; step < dashes; step++) {
      const from = ((step * 2) / (dashes * 2)) * Math.PI * 2;
      const to = from + (Math.PI * 2) / (dashes * 2);
      graphics.arc(r, r, r - 1.6, from, to);
      graphics.stroke({ color: 0xffffff, width: 2.2 });
    }
  }
  return app.renderer.generateTexture({
    target: graphics,
    resolution: TEXTURE_RESOLUTION,
    antialias: true,
  });
}

/**
 * Where each dash of a link falls, as distances along the line. The segment
 * count is capped for cost, and the SPACING absorbs the cap — so a long edge
 * draws longer dashes rather than stopping partway and leaving a link that
 * appears to go nowhere.
 */
export function dashSegments(
  length: number,
  dash: number,
): { from: number; to: number }[] {
  if (length < 1) return [];
  const steps = Math.min(Math.ceil(length / (dash * 2)), MAX_DASHES);
  const period = length / steps;
  return Array.from({ length: steps }, (_unused, step) => {
    const from = step * period;
    // The last dash runs to the end: the gap a uniform duty cycle would leave
    // there sits over the note, where it reads as a line that stopped short.
    return { from, to: step === steps - 1 ? length : from + period * 0.5 };
  });
}

function dashLine(
  graphics: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  for (const { from, to } of dashSegments(length, dash)) {
    graphics.moveTo(x1 + ux * from, y1 + uy * from);
    graphics.lineTo(x1 + ux * to, y1 + uy * to);
  }
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[at];
}
