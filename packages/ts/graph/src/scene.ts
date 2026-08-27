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
import type { GraphNodeAttributes } from "./model.js";
import type { BuiltModel } from "./model.js";
import type { GraphPalette } from "./palette.js";
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
const LABEL_GAP = 6;

const EDGE_WIDTH = 1.2;
const LINK_DASH = 9;
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
  private edgePairs: number[] = [];
  private linkPairs: number[] = [];
  private labelRefs: (string | null)[] = [];
  private lensActive = false;

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
    private readonly links: Graphics,
    private readonly fills: ParticleContainer,
    private readonly rings: ParticleContainer,
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
    world.addChild(edges, links, fills, rings);

    const labels = new pixi.Container();
    labels.eventMode = "none";
    app.stage.addChild(world, labels);

    const textures = {
      disc: markTexture(pixi, app, "disc"),
      ring: markTexture(pixi, app, "ring"),
      dashed: markTexture(pixi, app, "dashed"),
    };

    // Two runs per label, because DESIGN.md § Typography gives the address its
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
      links,
      fills,
      rings,
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

  setPalette(palette: GraphPalette): void {
    this.options = { ...this.options, palette };
    this.modelDirty = true;
  }

  /**
   * Replace what is drawn. Positions of nodes the previous model also held are
   * kept by the caller, so a lens switch or an expand re-uses them rather than
   * throwing every node back to its seed.
   */
  setModel(model: BuiltModel, lensActive: boolean): void {
    this.model = model;
    this.lensActive = lensActive;
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
    this.edgePairs = [];
    this.linkPairs = [];
    model.graph.forEachEdge((_edge, attributes, source, target) => {
      const a = byRef.get(source);
      const b = byRef.get(target);
      if (a === undefined || b === undefined) return;
      const into = attributes.kind === "link" ? this.linkPairs : this.edgePairs;
      into.push(a, b);
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
    return {
      cpuP50: percentile(this.cpuSamples, 0.5),
      cpuP95: percentile(this.cpuSamples, 0.95),
      cpuMax: this.cpuSamples.reduce((most, ms) => Math.max(most, ms), 0),
      frameP50: percentile(this.frameSamples, 0.5),
      frameP95: percentile(this.frameSamples, 0.95),
      frames: this.frameSamples.length,
      drawn: this.marks.length,
      edges: this.edgePairs.length / 2 + this.linkPairs.length / 2,
      labels: this.labelRefs.filter((ref) => ref !== null).length,
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
      const { provenance, fill } = mark.attributes;
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
            });
      if (mark.fill) this.fills.particleChildren.push(mark.fill);
      if (mark.ring) this.rings.particleChildren.push(mark.ring);
    }

    this.fills.update();
    this.rings.update();
    this.labelRefs = this.labelPool.map(() => null);
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

    this.edges.clear();
    for (let at = 0; at < this.edgePairs.length; at += 2) {
      const a = this.edgePairs[at] * 2;
      const b = this.edgePairs[at + 1] * 2;
      this.edges.moveTo(this.positions[a], this.positions[a + 1]);
      this.edges.lineTo(this.positions[b], this.positions[b + 1]);
    }
    if (this.edgePairs.length > 0) {
      this.edges.stroke({
        color: palette.edge,
        alpha: this.lensActive ? palette.edgeAlphaUnderLens : palette.edgeAlpha,
        width,
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

  private layoutLabels(): void {
    const view = visibleBounds(this.viewport, this.width, this.height, 80);
    const wanted: Mark[] = [];
    for (const mark of this.marks) {
      if (mark.radius * this.viewport.scale < LABEL_MIN_RADIUS) continue;
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      if (x < view.minX || x > view.maxX || y < view.minY || y > view.maxY) {
        continue;
      }
      wanted.push(mark);
      if (wanted.length > MAX_LABELS * 4) break;
    }
    wanted.sort((a, b) => b.radius - a.radius);

    const fill = this.options.palette.ink;
    this.labelPool.forEach((slot, at) => {
      const mark = wanted[at];
      if (!mark) {
        slot.address.visible = false;
        slot.title.visible = false;
        this.labelRefs[at] = null;
        return;
      }
      // Re-rasterising a run costs more than every other thing this frame does,
      // so it happens when the slot changes hands and not once more.
      if (this.labelRefs[at] !== mark.ref) {
        slot.address.text = addressCaption(mark.attributes);
        slot.title.text = mark.attributes.title.trim();
        this.labelRefs[at] = mark.ref;
      }
      const screen = this.viewport.toScreen(
        this.positions[mark.index * 2],
        this.positions[mark.index * 2 + 1],
      );
      const left = screen.x + mark.radius * this.viewport.scale + LABEL_GAP;
      slot.address.position.set(left, screen.y);
      slot.address.tint = fill;
      slot.address.visible = true;
      slot.title.position.set(left + slot.address.width + LABEL_GAP, screen.y);
      slot.title.tint = fill;
      slot.title.visible = slot.title.text !== "";
    });
  }
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

function dashLine(
  graphics: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return;
  const steps = Math.min(Math.ceil(length / (dash * 2)), 60);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  for (let step = 0; step < steps; step++) {
    const start = step * dash * 2;
    const end = Math.min(start + dash, length);
    graphics.moveTo(x1 + ux * start, y1 + uy * start);
    graphics.lineTo(x1 + ux * end, y1 + uy * end);
  }
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[at];
}
