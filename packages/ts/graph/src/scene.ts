// The pixi half of the ownership line DESIGN.md § "The canvas" draws: this file
// owns runtime pan, zoom and drag; it never decides which nodes exist. It is
// handed a model and a stream of positions, and it draws them.
//
// Marks are particles rather than display objects because the bound is in the
// hundreds and the cost of a container per node is not. Form carries provenance
// and the author's look (DESIGN.md § Form), so each gets a shape of its own: a
// tint cannot make one texture read as two shapes.

import type { RingStyle, RingWeight } from "@sloppy/types";
import type {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { clamp } from "./color.js";
import type { GraphPickMarks } from "./contract.js";
import type { GraphNodeAttributes } from "./model.js";
import {
  type BuiltModel,
  LOOK_RING_AT,
  LOOK_RING_DASHES,
  LOOK_RING_DUTY,
  LOOK_RING_WIDTH,
  MARK_PICTURE_PX,
  PREVIEW_AT,
} from "./model.js";
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
/** Empty margin around each shape on the sheet, so sampling one never catches
 *  the shape beside it. */
const SHEET_PAD = 4;
const SHEET_CELL = TEXTURE_RADIUS * 2 + SHEET_PAD * 2;

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

/** How far outside a mark its picking outline sits. Clear of the edge, so it
 *  never reads as the provenance ring DESIGN.md § Form draws ON the edge. */
const PICK_GAP = 6;
const PICK_WIDTH = 1.5;

const EDGE_WIDTH = 1.2;
/** DESIGN.md § Edges: the run is the line a reader walks, so it is the heaviest. */
const RUN_WEIGHT = 1.8;
const LINK_DASH = 9;
/** The most segments one dashed edge may cost. Reached only by an edge long
 *  enough that the dashes stretch to meet it. */
const MAX_DASHES = 60;

/** Below this on screen, a mark is too small to carry its author's look —
 *  DESIGN.md § "The mark", where the look is the first thing to go. */
const LOOK_MIN_RADIUS = 8;
/** How far past that a look hangs on, so a pinch does not strobe it. */
const LOOK_HYSTERESIS = 0.75;

/** Dashes around a broken provenance edge; the look's own count is geometry a
 *  swatch has to match, so `model.ts` owns that one. */
const EDGE_DASHES = 14;

/** Provenance's own edge, as fractions of the mark's radius — its centre line
 *  and its stroke. A look draws inside it, and `scene.test.ts` holds the gap. */
export const EDGE_RING_AT = (TEXTURE_RADIUS - 1.6) / TEXTURE_RADIUS;
export const EDGE_RING_WIDTH = 2.2 / TEXTURE_RADIUS;

/** Rebuild edge geometry when the zoom has moved enough to show in the stroke. */
const SCALE_REBUILD = 0.08;

export interface SceneFonts {
  ui: string;
  address: string;
}

/**
 * How a mark's preview picture reaches the canvas: the host resolves one,
 * because this package reaches no server and a raw remote URL in a texture is
 * the privacy bug it is in an `<img>`.
 *
 * `null` is nothing to draw — a picture the store no longer holds included — and
 * the mark then draws exactly as a mark with no picture. `release` frees
 * whatever `src` held; the canvas calls it once the bytes are on the GPU.
 */
export interface MarkPictures {
  read(preview: string): Promise<{ src: string; release: () => void } | null>;
}

export interface SceneOptions {
  fonts: SceneFonts;
  palette: GraphPalette;
  resolution: number;
  /** Absent draws every mark without its author's picture. */
  pictures?: MarkPictures;
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
  /** Provenance, on the mark's own edge. */
  ring: Particle | null;
  /** The author's look, drawn inside the mark. */
  look: Particle | null;
  preview: Sprite | null;
  /** Whether the look is being drawn, which {@link looksDrawn} latches. */
  looking: boolean;
}

interface LabelSlot {
  address: Text;
  title: Text;
}

interface MarkTextures {
  disc: Texture;
  ring: Texture;
  dashed: Texture;
  /** Keyed by {@link lookKey}. */
  looks: Map<string, Texture>;
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

  private positionsDirty = true;
  private modelDirty = false;
  private previewsDirty = false;
  private lastEdgeScale = 0;

  /** One texture per picture, however many marks wear it; `null` is one that
   *  will not draw, cached so it is asked for once. */
  private readonly previewTextures = new Map<string, Texture | null>();
  private readonly previewsAsked = new Set<string>();
  private destroyed = false;

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
    private readonly previews: Container,
    private readonly rings: ParticleContainer,
    private readonly looks: ParticleContainer,
    private readonly picks: Graphics,
    private readonly labels: Container,
    private readonly labelPool: LabelSlot[],
    private readonly textures: MarkTextures,
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
    const previews = new pixi.Container();
    const rings = new pixi.ParticleContainer(particleOptions);
    const looks = new pixi.ParticleContainer(particleOptions);
    const picks = new pixi.Graphics();
    world.addChild(edges, runs, links, fills, previews, rings, looks, picks);

    const labels = new pixi.Container();
    labels.eventMode = "none";
    app.stage.addChild(world, labels);

    const textures = markTextures(pixi, app);

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
      previews,
      rings,
      looks,
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
        look: null,
        preview: null,
        looking: false,
      };
    });
    this.forgetUnwantedPictures();

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
    this.destroyed = true;
    this.app.ticker.remove(this.draw);
    for (const texture of this.previewTextures.values()) texture?.destroy(true);
    this.previewTextures.clear();
    this.app.destroy(true, { children: true, texture: true });
  }

  private readonly draw = (): void => {
    const started = performance.now();
    this.frameSamples.push(this.app.ticker.deltaMS);

    if (this.modelDirty) this.rebuildMarks();
    if (this.previewsDirty) this.rebuildPreviews();

    const scaleMoved =
      Math.abs(this.viewport.scale - this.lastEdgeScale) >
      this.lastEdgeScale * SCALE_REBUILD;

    if (this.positionsDirty) this.syncMarks();
    if (this.positionsDirty || scaleMoved) this.rebuildEdges();
    if (this.positionsDirty || scaleMoved) this.drawPicking();
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
    this.looks.particleChildren.length = 0;

    for (const mark of this.marks) {
      const scale = mark.radius / TEXTURE_RADIUS;
      const { provenance, fill, alpha, ringWeight, ringStyle } =
        mark.attributes;
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
      const look = this.lookTexture(ringWeight, ringStyle);
      mark.look =
        look === null
          ? null
          : new this.pixi.Particle({
              texture: look,
              anchorX: 0.5,
              anchorY: 0.5,
              scaleX: scale,
              scaleY: scale,
              // A pulled mark is drawn hollow, so a look inside one is on paper.
              tint: this.options.palette.lookRing(
                provenance === "pulled" ? this.options.palette.paper : fill,
              ),
              alpha: 0,
            });
      mark.looking = false;
      if (mark.fill) this.fills.particleChildren.push(mark.fill);
      if (mark.ring) this.rings.particleChildren.push(mark.ring);
      if (mark.look) this.looks.particleChildren.push(mark.look);
    }

    this.fills.update();
    this.rings.update();
    this.looks.update();
    this.labelSlots.clear();
    for (const slot of this.labelPool) {
      slot.address.visible = false;
      slot.title.visible = false;
    }
    this.modelDirty = false;
    this.rebuildPreviews();
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
      if (mark.look === null && mark.preview === null) continue;

      mark.looking = looksDrawn(
        mark.radius * this.viewport.scale,
        mark.looking,
      );
      if (mark.look) {
        mark.look.x = x;
        mark.look.y = y;
        mark.look.alpha = mark.looking ? mark.attributes.alpha : 0;
      }
      if (mark.preview) {
        mark.preview.position.set(x, y);
        mark.preview.visible = mark.looking;
      }
    }
  }

  /** Separate from {@link rebuildMarks} because a picture lands long after the
   *  model does, and rebuilding the marks would drop every label placed since. */
  private rebuildPreviews(): void {
    this.previewsDirty = false;
    for (const sprite of this.previews.removeChildren()) sprite.destroy();

    for (const mark of this.marks) {
      mark.preview = null;
      const { preview, alpha } = mark.attributes;
      if (preview === undefined) continue;
      const texture = this.previewTextures.get(preview);
      if (texture === undefined) {
        this.wantPicture(preview);
        continue;
      }
      if (texture === null) continue;
      const sprite = new this.pixi.Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.width = mark.radius * PREVIEW_AT * 2;
      sprite.height = sprite.width;
      sprite.alpha = alpha;
      sprite.visible = false;
      mark.preview = sprite;
      this.previews.addChild(sprite);
    }
    this.positionsDirty = true;
  }

  private wantPicture(preview: string): void {
    const pictures = this.options.pictures;
    if (pictures === undefined || this.previewsAsked.has(preview)) return;
    this.previewsAsked.add(preview);
    void pictures
      .read(preview)
      .then(async (held) => {
        if (held === null) return null;
        try {
          return await markPicture(this.pixi, held.src);
        } finally {
          held.release();
        }
      })
      // A picture that will not draw leaves the mark drawing as one with no
      // picture, which is also what a picture since deleted leaves behind.
      .catch(() => null)
      .then((texture) => {
        if (this.destroyed) {
          texture?.destroy(true);
          return;
        }
        this.previewTextures.set(preview, texture);
        this.previewsDirty = true;
      });
  }

  private forgetUnwantedPictures(): void {
    if (this.previewTextures.size === 0) return;
    const wanted = new Set(
      this.marks
        .map((mark) => mark.attributes.preview)
        .filter((preview) => preview !== undefined),
    );
    for (const [preview, texture] of this.previewTextures) {
      if (wanted.has(preview)) continue;
      texture?.destroy(true);
      this.previewTextures.delete(preview);
      this.previewsAsked.delete(preview);
    }
  }

  /** `null` is no look at all: a weight of `none`, and any pair this build has
   *  no shape for — the mark's own edge belongs to provenance. */
  private lookTexture(weight: RingWeight, style: RingStyle): Texture | null {
    if (weight === "none") return null;
    return this.textures.looks.get(lookKey(weight, style)) ?? null;
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

  private drawPicking(): void {
    this.picks.clear();
    const picking = this.picking;
    if (!picking) return;

    const { ink } = this.options.palette;
    const gap = PICK_GAP / this.viewport.scale;
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

/** Whether a mark drawn at `radius` screen pixels carries its look. The latch is
 *  the caller's: pass whether it is carrying one now, or it will strobe. */
export function looksDrawn(radius: number, looking: boolean): boolean {
  return radius >= LOOK_MIN_RADIUS * (looking ? LOOK_HYSTERESIS : 1);
}

function lookKey(weight: RingWeight, style: RingStyle): string {
  return `${weight}:${style}`;
}

/** A picture cut to the disc it is drawn on and decoded at the size a mark shows
 *  it, which `MARK_PICTURE_PX` in `model.ts` bounds. */
async function markPicture(pixi: Pixi, src: string): Promise<Texture | null> {
  const picture = new Image();
  picture.src = src;
  await picture.decode();

  const canvas = document.createElement("canvas");
  canvas.width = MARK_PICTURE_PX;
  canvas.height = MARK_PICTURE_PX;
  const onto = canvas.getContext("2d");
  if (!onto) return null;

  const half = MARK_PICTURE_PX / 2;
  onto.beginPath();
  onto.arc(half, half, half, 0, Math.PI * 2);
  onto.clip();
  // Short side fills the disc, so a picture is cropped rather than squashed.
  const cover = MARK_PICTURE_PX / Math.min(picture.width, picture.height);
  const width = picture.width * cover;
  const height = picture.height * cover;
  onto.drawImage(picture, half - width / 2, half - height / 2, width, height);
  return pixi.Texture.from(canvas);
}

/**
 * Every mark texture, cut from ONE source. A `ParticleContainer` draws all its
 * particles with a single texture, so a second source would silently put one
 * mark's ring on every other mark in the same container.
 */
function markTextures(pixi: Pixi, app: Application): MarkTextures {
  const cells: Graphics[] = [];
  const cell = (draw: (into: Graphics) => void): number => {
    const graphics = new pixi.Graphics();
    draw(graphics);
    graphics.x = cells.length * SHEET_CELL + SHEET_PAD;
    graphics.y = SHEET_PAD;
    cells.push(graphics);
    return cells.length - 1;
  };

  const disc = cell((into) => {
    into
      .circle(TEXTURE_RADIUS, TEXTURE_RADIUS, TEXTURE_RADIUS - 1)
      .fill(0xffffff);
  });
  const edgeAt = TEXTURE_RADIUS * EDGE_RING_AT;
  const edgeWidth = TEXTURE_RADIUS * EDGE_RING_WIDTH;
  const ring = cell((into) => strokeRing(into, edgeAt, edgeWidth, 0));
  const dashed = cell((into) =>
    strokeRing(into, edgeAt, edgeWidth, EDGE_DASHES),
  );
  const looks = new Map<string, number>();
  for (const [weight, fraction] of Object.entries(LOOK_RING_WIDTH)) {
    for (const style of ["solid", "dashed"] as const) {
      looks.set(
        lookKey(weight as RingWeight, style),
        cell((into) =>
          strokeRing(
            into,
            TEXTURE_RADIUS * LOOK_RING_AT,
            TEXTURE_RADIUS * fraction,
            style === "dashed" ? LOOK_RING_DASHES : 0,
            LOOK_RING_DUTY,
          ),
        ),
      );
    }
  }

  const sheet = new pixi.Container();
  sheet.addChild(...cells);
  const { source } = app.renderer.generateTexture({
    target: sheet,
    frame: new pixi.Rectangle(0, 0, cells.length * SHEET_CELL, SHEET_CELL),
    resolution: TEXTURE_RESOLUTION,
    antialias: true,
  });
  const cut = (at: number): Texture =>
    new pixi.Texture({
      source,
      frame: new pixi.Rectangle(
        at * SHEET_CELL + SHEET_PAD,
        SHEET_PAD,
        TEXTURE_RADIUS * 2,
        TEXTURE_RADIUS * 2,
      ),
    });

  return {
    disc: cut(disc),
    ring: cut(ring),
    dashed: cut(dashed),
    looks: new Map([...looks].map(([key, at]) => [key, cut(at)])),
  };
}

/** `dashes` of 0 strokes the ring whole; `duty` is the share of each dash's
 *  turn that is drawn. */
function strokeRing(
  into: Graphics,
  radius: number,
  width: number,
  dashes: number,
  duty = 0.5,
): void {
  const centre = TEXTURE_RADIUS;
  if (dashes === 0) {
    into.circle(centre, centre, radius).stroke({ color: 0xffffff, width });
    return;
  }
  const turn = (Math.PI * 2) / dashes;
  for (let step = 0; step < dashes; step++) {
    const from = step * turn;
    into.arc(centre, centre, radius, from, from + turn * duty);
    into.stroke({ color: 0xffffff, width });
  }
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
