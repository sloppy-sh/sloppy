// The pixi half of the ownership line DESIGN.md § "The canvas" draws: this file
// owns runtime pan, zoom and drag; it never decides which nodes exist. It is
// handed a model and a stream of positions, and it draws them.
//
// Marks are particles rather than display objects because the bound is in the
// hundreds and the cost of a container per node is not. Form carries provenance
// and the author's look (DESIGN.md § Form), so each gets a shape of its own: a
// tint cannot make one texture read as two shapes.

import {
  type EdgeKind,
  type EdgeStroke,
  pictureTurn,
  RING_STYLES,
  type RingStyle,
  type RingWeight,
  TAG_HUE_SLOTS,
} from "@sloppy/types";
import type {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Text,
  Texture,
  TextureSource,
} from "pixi.js";
import { clamp } from "./color.js";
import {
  edgeLookKey,
  type GraphEdgeLook,
  type GraphPickMarks,
  type GraphReadingMarks,
  type GraphPictures,
} from "./contract.js";
import type { GraphGround } from "./ground.js";
import { GroundLayer } from "./ground-layer.js";
import type { GraphNodeAttributes } from "./model.js";
import {
  type BuiltModel,
  type DifferenceLines,
  LOOK_RING_AT,
  LOOK_RING_BREAK,
  LOOK_RING_WIDTH,
  markPictureSide,
  MAX_RADIUS,
  type NamedField,
} from "./model.js";
import { DEPTH_STEPS, type GraphPalette } from "./palette.js";
import { pictureStep, shownAt, TURN_MS } from "./turn.js";
import {
  type Bounds,
  type Point,
  Viewport,
  visibleBounds,
} from "./viewport.js";

type Pixi = typeof import("pixi.js");

/** Radius the mark textures are drawn at; every mark is a scale of this. */
const TEXTURE_RADIUS = 16;
/** Empty margin around each shape on the sheet, so sampling one never catches
 *  the shape beside it. */
const SHEET_PAD = 4;
const SHEET_CELL = TEXTURE_RADIUS * 2 + SHEET_PAD * 2;
/** A disc, the two provenance edges, and one per ring weight and style. */
const SHEET_CELLS =
  3 + Object.keys(LOOK_RING_WIDTH).length * RING_STYLES.length;
const SHEET_COLUMNS = Math.ceil(Math.sqrt(SHEET_CELLS));
/** The sheet's side before its density is applied. */
const SHEET_SIDE = SHEET_COLUMNS * SHEET_CELL;
/**
 * **2048 device pixels is the smallest a GPU Sloppy runs on is guaranteed to
 * hold**, and past it the atlas is refused on the phones least able to say why
 * — so a ring weight or a style added here is bounded by this, and
 * `scene.test.ts` is what keeps that true rather than hoped.
 */
const SHEET_LIMIT_PX = 2048;
/**
 * The densities the sheet may be cut at, coarsest first, up to the most the GPU
 * floor above leaves room for. Tiers rather than the zoom itself, so a pinch
 * crosses a boundary now and then instead of recutting every frame.
 */
export const MARK_SHEET_TIERS = [1, 2, 3].map(
  (step) => (step * Math.floor(SHEET_LIMIT_PX / SHEET_SIDE)) / 3,
);
const SHEET_TIER_TOP = MARK_SHEET_TIERS[MARK_SHEET_TIERS.length - 1];
/** The sheet's side in device pixels at its densest cut. */
export const MARK_SHEET_PX = SHEET_SIDE * SHEET_TIER_TOP;
/** How far inside the coarser tier's own reach the zoom falls before the sheet
 *  is cut back down, so a pinch held at a boundary recuts once. */
const SHEET_TIER_HOLD = 0.8;
/** The most a mark's texture is stretched on screen before the mark is drawn as
 *  a shape for that frame instead — DESIGN.md § "The mark". */
export const MARK_UPSAMPLE_MAX = 1.25;

/**
 * What the mark sheet is cut at for a viewport at `scale` on a screen drawing
 * `density` device pixels per CSS pixel, holding the tier it is already cut at
 * where the zoom has not moved far enough to be worth another cut.
 */
export function markSheetTier(
  scale: number,
  density: number,
  held: number | null = null,
): number {
  // The tier covers a mark at the fold's cap; a look that scales one past what
  // the tier holds is drawn as a shape, so nothing is stretched past a quarter.
  const wanted = (MAX_RADIUS * scale * density) / TEXTURE_RADIUS;
  const tier =
    MARK_SHEET_TIERS.find((step) => step >= wanted) ?? SHEET_TIER_TOP;
  if (held === null || tier >= held) return tier;
  return wanted <= tier * SHEET_TIER_HOLD ? tier : held;
}

/**
 * How far a mark may reach, in world units, before a sheet cut at `tier` cannot
 * hold it within {@link MARK_UPSAMPLE_MAX} at this zoom on this screen. Past it
 * the mark is drawn as a shape instead.
 */
export function markSheetReach(
  tier: number,
  scale: number,
  density: number,
): number {
  return (TEXTURE_RADIUS * tier * MARK_UPSAMPLE_MAX) / (scale * density);
}

const MAX_LABELS = 56;
/** Below this on screen, a mark is too small to carry words. */
const LABEL_MIN_RADIUS = 7;
/** How far past that a label hangs on, so a pinch does not strobe them. */
const LABEL_HYSTERESIS = 0.75;
/** Slots that may change hands in one frame. */
const LABEL_RETEXT_BUDGET = 6;
const LABEL_GAP = 6;
/** The height one line of words fills, in CSS pixels. */
export const LABEL_LINE = 15;
/** A title long enough to crowd its neighbours off the canvas is not a title. */
const TITLE_CHARS = 32;

/** How many graphs may stand on one canvas, which is how many names this scene
 *  keeps to write over them. */
export const MAX_FIELDS = 6;
/** A graph's name is written over its field, quiet enough to stay ground: it
 *  says which of them you are in, and nothing about any note. */
const FIELD_NAME_SIZE = 15;
const FIELD_NAME_ALPHA = 0.55;
const FIELD_NAME_CHARS = 36;
/** What a name held against a screen edge keeps clear of it. */
const FIELD_NAME_GAP = 10;

/** How far outside a mark the orbit sits. Clear of the edge, so nothing drawn
 *  there reads as the provenance ring DESIGN.md § Form draws ON the edge. */
export const PICK_GAP = 6;
const PICK_WIDTH = 1.5;
/** DESIGN.md § "The mark": the orbit's two meanings separate by weight —
 *  picking outlines, and choosing fills. */
export const CHOSEN_BAND = 4;
/** What the band lays. Heavy enough to read over the paper a lift puts under it,
 *  which shares its ground — DESIGN.md § "The mark". */
export const CHOSEN_INK = 0.9;

/** How far a lift spreads, as a multiple of the mark's radius, and the ink it
 *  lays where it begins. DESIGN.md § "The mark" — one channel at two strengths:
 *  a note that is open, and the one being read. */
const LIFT_REACH = { open: 1.7, active: 2.4 };
const LIFT_INK = { open: 0.26, active: 0.5 };
/** What a lift holds clear of the mark before laying anything, in CSS pixels.
 *  Half the orbit's: ink tangent to the rim reads as the mark's own edge, which
 *  is provenance, and paper held as far off as the orbit stops reading as the
 *  mark's own. */
const LIFT_GAP = PICK_GAP / 2;
/** What that spread may never fall below, in CSS pixels — DESIGN.md § "The mark". */
const LIFT_FLOOR = { open: 5, active: 8 };
/** Rings the lift is laid down as. Enough that its outer edge is not a line. */
const LIFT_BANDS = 16;

/** Three steps of one ladder — genealogy, then the two lines a person made,
 *  then the run. It climbs in lightness too, and those alphas are the palette's;
 *  DESIGN.md § Edges is the doc of record for both channels. */
const EDGE_WIDTH = 1.2;
const CONNECTION_WEIGHT = 1.4;
const RUN_WEIGHT = 1.8;
/** What a line reaching the note being read gains on its own weight. */
const READING_WEIGHT = 1.6;
const CONNECTION_DASH = 9;
/** The most segments one dashed edge may cost. Reached only by an edge long
 *  enough that the dashes stretch to meet it. */
const MAX_DASHES = 60;
/** How often a dotted line is marked, in CSS pixels, and how much of each step
 *  it lays down — short enough that dotted is never read as dashed at the same
 *  weight. DESIGN.md § Edges, "A look a person set". */
const LOOK_DOT = 5;
const LOOK_DOT_DUTY = 0.3;

/** The break each kind of line already has, which a look's `stroke` replaces
 *  and an absent one leaves alone — DESIGN.md § Edges. */
const EDGE_BREAK: Record<EdgeKind, EdgeStroke> = {
  genealogy: "solid",
  run: "solid",
  reference: "solid",
  link: "dashed",
};

/** An arrowhead's reach back down the line, as a multiple of that line's
 *  stroke: taking the weight is what clamps it, since the weight is clamped. */
const ARROW_REACH = 6;
/** How far each barb stands off the line, in radians. */
const ARROW_SPREAD = 0.42;

/** How close to a line a tap lands and still means that line, in CSS pixels —
 *  a finger's reach, the way {@link GraphScene.hitTest} gives a leaf mark one. */
const EDGE_TAP = 11;

/** How many lines may carry their words at once. Fewer than the marks: a label
 *  over a line has the whole field to collide with. */
const MAX_EDGE_LABELS = 24;
/** Below this drawn length, in CSS pixels, a line is too short to be read as
 *  carrying the words at its middle. */
const EDGE_LABEL_MIN_SPAN = 56;
/** Words long enough to cross the field they are written over are not a
 *  caption. */
const EDGE_LABEL_CHARS = 24;
/** How much bare paper stands between the words and the line they are on, in
 *  CSS pixels: measured from the edge of the box the words fill, so no line is
 *  ever struck through them. */
const EDGE_LABEL_GAP = 13;

/** The band a difference lays in the orbit, at the weight choosing takes: a
 *  canvas is never comparing and choosing at once, so the two never meet. */
export const DIFFERENCE_BAND = CHOSEN_BAND;
export const DIFFERENCE_INK = CHOSEN_INK;
/** What the line a note left is struck at, a little under half the ink the line
 *  it joined takes — DESIGN.md § "A difference between two states" separates the
 *  two on ink and leaves the figure here. */
export const DIFFERENCE_GONE_INK = 0.4;
/** How a note that is not as it was breaks its band. Wide gaps, so a band is
 *  read as broken or closed at a glance and never as nearly one — DESIGN.md
 *  § "A difference between two states". */
export const DIFFERENCE_BREAK = { dashes: 8, duty: 0.55 };
/** The weight the lines a difference draws take, of the three the solid lines
 *  climb: the heaviest, over a canvas that has receded to be compared. */
const DIFFERENCE_WEIGHT = RUN_WEIGHT;

/** Below this drawn radius, in CSS pixels, a mark is too small to carry its
 *  author's look — DESIGN.md § "The mark", where the look is the first thing to
 *  go. `scene.test.ts` holds the figure against the view a graph opens on. */
export const LOOK_MIN_RADIUS = 4;
/** How far past that a look hangs on, so a pinch does not strobe it. */
const LOOK_HYSTERESIS = 0.75;

/** Dashes around a broken provenance edge; the look's own count is geometry a
 *  swatch has to match, so `model.ts` owns that one. */
const EDGE_DASHES = 14;

/** Where the mark's fill stops, as a fraction of its radius. */
export const FILL_AT = (TEXTURE_RADIUS - 1) / TEXTURE_RADIUS;

/** Provenance's own edge, as fractions of the mark's radius — its centre line
 *  and its stroke. A look draws inside it, and `scene.test.ts` holds the gap. */
export const EDGE_RING_AT = (TEXTURE_RADIUS - 1.6) / TEXTURE_RADIUS;
export const EDGE_RING_WIDTH = 2.2 / TEXTURE_RADIUS;

/**
 * How wide the dot the code having moved takes is, as a fraction of the mark's
 * radius. Its centre is {@link EDGE_RING_AT}, due south — DESIGN.md § "The
 * mark". `scene.code.test.ts` holds it clear of the look's ring and wider than
 * the provenance stroke it straddles, which is what keeps it an addition
 * rather than a break in that edge.
 */
export const CODE_MOVED_RADIUS = 0.17;

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
  /** Absent draws every mark without its author's picture. */
  pictures?: GraphPictures;
  /** Absent lets a picture change on a mark move; DESIGN.md § Motion has it
   *  change without moving where a reader has asked for less motion. */
  reduced?: MediaQueryList;
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

/** How long a hue sweep takes to cross the field — DESIGN.md § Eggs. */
const SWEEP_MS = 1500;
/** How long one mark holds the hue the sweep lit it in. */
const SWEEP_HOLD_MS = 300;

/** A hue sweep crossing the field: when it began, and the band of x it crosses,
 *  measured once so a settling layout cannot move a mark's hue under it. */
interface Sweep {
  since: number;
  left: number;
  span: number;
}

/** One picture giving way to the next on a mark: the one going, the sprite still
 *  drawing it, and when the change began. */
interface Turn {
  from: string;
  sprite: Sprite;
  since: number;
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
  /** Which of its author's pictures it is the turn of, read off the clock by
   *  {@link GraphScene.takeTurns}. */
  showing: string | undefined;
  /** What {@link Mark.preview} is actually drawing, which trails `showing` from
   *  the moment a turn comes round until the bytes for it land. */
  drawing: string | undefined;
  preview: Sprite | null;
  turn: Turn | null;
  /** Whether the look is being drawn, which {@link looksDrawn} latches. Carried
   *  across a rebuild the way positions are, so selecting a tag does not take a
   *  look off a mark sitting inside the latch's own margin. */
  looking: boolean;
}

interface LabelSlot {
  address: Text;
  title: Text;
}

/**
 * A line somebody set a look on: the two marks it reaches as indices into
 * {@link GraphScene.positions}, oriented the way the look names them so an
 * arrowhead knows which end is which, and what the line would have been drawn
 * as without it.
 */
interface LookedLine {
  from: number;
  to: number;
  kind: EdgeKind;
  /** The step of the depth ramp a genealogy line is struck at; 0 on the rest. */
  step: number;
  look: GraphEdgeLook;
}

/** What one line is struck in: its ink, and what a look drawn on it takes. */
interface LineInk {
  color: number;
  alpha: number;
  width: number;
  /** What a caption on this line is drawn at — a mark's caption takes the ink
   *  whole, and this is the share the line itself has receded by. */
  captionAlpha: number;
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
  /** The two lines a person made, kept apart because one is drawn whole and the
   *  other broken — DESIGN.md § Edges. */
  private referencePairs: number[] = [];
  private linkPairs: number[] = [];
  /** The lines a person set a look on, drawn one at a time because each one is
   *  broken, headed and captioned on its own. */
  private lookedLines: LookedLine[] = [];
  /** Every pair a line is drawn between, whatever kind and whether or not a
   *  look is on it — what {@link hitEdge} answers a tap against. */
  private linePairs: number[] = [];
  private differenceLines: DifferenceLines = { arrived: [], gone: [] };
  private comparing = false;
  /** The hue sweep running, and `null` while none is. */
  private sweeping: Sweep | null = null;
  private readonly labelSlots = new Map<string, number>();
  /** Which slot each line's words are written in, keyed by {@link edgeLookKey}. */
  private readonly edgeLabelSlots = new Map<string, number>();
  private fieldNames: readonly NamedField[] = [];
  private selecting = false;
  private readonly ground: GroundLayer;
  private picking: GraphPickMarks | null = null;
  private chosen: ReadonlySet<string> | null = null;
  private reading: GraphReadingMarks | null = null;

  private positionsDirty = true;
  private modelDirty = false;
  private previewsDirty = false;
  private lastEdgeScale = 0;
  /** Whether the last pass left a mark drawn as a shape. */
  private shapesShown = false;

  /** One texture per picture, however many marks wear it, cut for the biggest
   *  of them — `side` is what it was cut at. `null` is a picture that will not
   *  draw, held so it is asked for once. */
  private readonly previewTextures = new Map<
    string,
    { texture: Texture | null; side: number }
  >();
  private readonly previewsAsked = new Map<string, number>();
  /** Cuts a bigger one took the place of, freed once no sprite draws them. */
  private readonly retiredTextures: Texture[] = [];
  /** The sheet a denser or coarser cut replaced. Freed a frame later: until the
   *  renderer has drawn once without it, it is still bound to a shader. */
  private spentSheet: TextureSource | null = null;
  /** Marks with a change under way, so an idle frame costs nothing to find
   *  them and a field where nothing is turning costs nothing at all. */
  private readonly turning = new Set<Mark>();
  private destroyed = false;

  private readonly cpuSamples: number[] = [];
  private readonly frameSamples: number[] = [];

  private constructor(
    private readonly pixi: Pixi,
    private readonly app: Application,
    private readonly world: Container,
    private readonly lift: Graphics,
    private readonly edges: Graphics,
    private readonly runs: Graphics,
    private readonly connections: Graphics,
    private readonly diffs: Graphics,
    private readonly fills: ParticleContainer,
    private readonly shapes: Graphics,
    private readonly previews: Container,
    private readonly rings: ParticleContainer,
    private readonly looks: ParticleContainer,
    private readonly shapeRings: Graphics,
    private readonly picks: Graphics,
    private readonly codeMoved: Graphics,
    private readonly labels: Container,
    private readonly labelPool: LabelSlot[],
    private readonly edgeLabelPool: Text[],
    private readonly fieldPool: Text[],
    private textures: MarkTextures,
    private sheetTier: number,
    private options: SceneOptions,
  ) {
    this.ground = new GroundLayer(pixi, app);
    this.ground.setInk(options.palette.ink);
    app.stage.addChildAt(this.ground.container, 0);
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
    const lift = new pixi.Graphics();
    const edges = new pixi.Graphics();
    const runs = new pixi.Graphics();
    const connections = new pixi.Graphics();
    const diffs = new pixi.Graphics();
    const particleOptions = {
      dynamicProperties: {
        position: true,
        scale: true,
        rotation: false,
        color: true,
      },
    };
    const fills = new pixi.ParticleContainer(particleOptions);
    const shapes = new pixi.Graphics();
    const previews = new pixi.Container();
    const rings = new pixi.ParticleContainer(particleOptions);
    const looks = new pixi.ParticleContainer(particleOptions);
    const shapeRings = new pixi.Graphics();
    const picks = new pixi.Graphics();
    const codeMoved = new pixi.Graphics();
    // The lift is under everything: it is paper, not a line drawn on the field.
    // The author's ring is UNDER their picture, so widening the cover past it
    // takes it — which is what the cover slider is for. Provenance is OVER the
    // picture, so no cover can take that: it is the graph's word, not the
    // author's. DESIGN.md § "The mark". A mark too big for the sheet is drawn as
    // a shape beside the particles it stands in for, so it keeps that order.
    world.addChild(
      lift,
      edges,
      runs,
      connections,
      diffs,
      fills,
      looks,
      shapes,
      previews,
      rings,
      shapeRings,
      picks,
      codeMoved,
    );

    const labels = new pixi.Container();
    labels.eventMode = "none";
    app.stage.addChild(world, labels);

    const sheetTier = markSheetTier(1, options.resolution);
    const textures = markTextures(pixi, app, sheetTier);

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

    // Before the field names, so those stay the last words on the layer: what a
    // line carries is a caption like a mark's, and it is written in the same
    // face — DESIGN.md § Edges, "A look a person set".
    const edgeLabelPool = Array.from({ length: MAX_EDGE_LABELS }, () => {
      const text = new pixi.Text({
        text: "",
        style: {
          fontFamily: options.fonts.ui,
          fontSize: 12,
          fill: 0xffffff,
        },
        resolution: options.resolution,
      });
      text.visible = false;
      text.anchor.set(0.5, 0.5);
      labels.addChild(text);
      return text;
    });

    const fieldPool = Array.from({ length: MAX_FIELDS }, () => {
      const text = new pixi.Text({
        text: "",
        style: {
          fontFamily: options.fonts.ui,
          fontSize: FIELD_NAME_SIZE,
          fill: 0xffffff,
        },
        resolution: options.resolution,
      });
      text.visible = false;
      text.alpha = FIELD_NAME_ALPHA;
      text.anchor.set(0.5, 1);
      labels.addChild(text);
      return text;
    });

    return new GraphScene(
      pixi,
      app,
      world,
      lift,
      edges,
      runs,
      connections,
      diffs,
      fills,
      shapes,
      previews,
      rings,
      looks,
      shapeRings,
      picks,
      codeMoved,
      labels,
      labelPool,
      edgeLabelPool,
      fieldPool,
      textures,
      sheetTier,
      options,
    );
  }

  get width(): number {
    return this.app.renderer.screen.width;
  }

  get height(): number {
    return this.app.renderer.screen.height;
  }

  /** Edges, connections and labels. Mark fills live on the model, so they
   *  arrive with the next {@link setModel}. */
  setPalette(palette: GraphPalette): void {
    this.options = { ...this.options, palette };
    this.ground.setInk(palette.ink);
    this.lastEdgeScale = 0;
    this.positionsDirty = true;
  }

  /**
   * How many device pixels a CSS pixel of canvas is drawn with, for a window
   * that has moved to a screen of another density. Everything cut for the screen
   * — the sheet, the words and the pictures — is asked for again at the new one.
   */
  setResolution(resolution: number): void {
    if (resolution === this.options.resolution) return;
    this.options = { ...this.options, resolution };
    this.app.renderer.resolution = resolution;
    for (const slot of this.labelPool) {
      slot.address.resolution = resolution;
      slot.title.resolution = resolution;
    }
    for (const label of this.edgeLabelPool) label.resolution = resolution;
    for (const name of this.fieldPool) name.resolution = resolution;
    this.previewsDirty = true;
    this.positionsDirty = true;
  }

  /** The paper the field is drawn on, which the reader chooses and nothing about
   *  the notes decides. */
  setGround(ground: GraphGround): void {
    this.ground.setGround(ground);
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

  /** The notes open on the reading surface, or null when none is. */
  setReading(reading: GraphReadingMarks | null): void {
    this.reading = reading;
    this.positionsDirty = true;
  }

  /**
   * Re-colour the marks already up: `fill` and `alpha` are all a tag question
   * moves — DESIGN.md § Hue. The caller must have established that this model's
   * drawn set and order are the standing one's, because everything else a mark
   * is drawn from stays on the particles this leaves in place.
   */
  setTints(model: BuiltModel, selecting: boolean): void {
    this.model = model;
    this.selecting = selecting;
    for (const mark of this.marks) {
      const attributes = model.graph.getNodeAttributes(mark.ref);
      mark.attributes = attributes;
      const { provenance, fill, alpha } = attributes;
      if (mark.fill) {
        mark.fill.tint = fill;
        mark.fill.alpha = alpha;
      }
      if (mark.ring) {
        mark.ring.tint =
          provenance === "pulled" ? fill : this.options.palette.ink;
        mark.ring.alpha = alpha;
      }
      if (mark.look) {
        mark.look.tint = this.options.palette.lookRing(
          provenance === "pulled" ? this.options.palette.paper : fill,
        );
      }
    }
    this.fills.update();
    this.rings.update();
    this.looks.update();
    this.readComparing();
    this.positionsDirty = true;
  }

  /**
   * Run a hue sweep over the marks already up: each takes the facet of the band
   * it stands in as the sweep reaches its x, holds it, and goes back to what it
   * was drawn in. One at a time — asked again while one runs, nothing happens —
   * and nothing is left behind, so the canvas ends as it began.
   *
   * Decoration, so a reader who has asked for less motion gets none of it.
   */
  sweep(): void {
    if (this.sweeping !== null || this.marks.length === 0) return;
    if (this.options.reduced?.matches) return;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const mark of this.marks) {
      const x = this.positions[mark.index * 2];
      if (x < left) left = x;
      if (x > right) right = x;
    }
    this.sweeping = { since: performance.now(), left, span: right - left };
  }

  private advanceSweep(): void {
    const sweep = this.sweeping;
    if (sweep === null) return;
    const since = performance.now() - sweep.since;
    const done = since >= SWEEP_MS;
    if (done) this.sweeping = null;

    for (const mark of this.marks) {
      // A pulled mark is drawn hollow, so its colour is on its edge; a mark that
      // went carries neither.
      const carrier = mark.fill ?? mark.ring;
      if (carrier === null) continue;
      const across =
        sweep.span > 0
          ? (this.positions[mark.index * 2] - sweep.left) / sweep.span
          : 0;
      const lights = across * (SWEEP_MS - SWEEP_HOLD_MS);
      const lit = !done && since >= lights && since < lights + SWEEP_HOLD_MS;
      carrier.tint = lit
        ? this.options.palette.tag(bandAt(across))
        : mark.attributes.fill;
    }
    this.fills.update();
    this.rings.update();
  }

  private readComparing(): void {
    this.comparing = this.marks.some(
      (mark) => mark.attributes.difference !== undefined,
    );
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

    const looking = new Map(this.marks.map((mark) => [mark.ref, mark.looking]));
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
        showing: undefined,
        drawing: undefined,
        preview: null,
        turn: null,
        looking: looking.get(ref) ?? false,
      };
    });
    // A model change is not a turn: every sprite goes, so the picture whose turn
    // it is now is simply the one the next frame draws.
    this.takeTurns();
    // The sprites go first: a texture freed under one still on the display list
    // is drawn from freed memory the next time anything renders.
    this.dropPreviewSprites();
    this.forgetUnwantedPictures();

    const byRef = new Map(model.order.map((ref, index) => [ref, index]));
    this.edgesByDepth = Array.from({ length: DEPTH_STEPS + 1 }, () => []);
    this.runPairs = [];
    this.referencePairs = [];
    this.linkPairs = [];
    this.lookedLines = [];
    this.linePairs = [];
    model.graph.forEachEdge((_edge, attributes, source, target) => {
      const a = byRef.get(source);
      const b = byRef.get(target);
      if (a === undefined || b === undefined) return;
      // A note that went keeps its edges so the settle puts it back where it
      // hung, and draws none of them: the one line reaching it is the one
      // `drawDifference` strikes — DESIGN.md § "A difference between two states".
      if (
        model.graph.getNodeAttributes(source).difference === "gone" ||
        model.graph.getNodeAttributes(target).difference === "gone"
      ) {
        return;
      }
      this.linePairs.push(a, b);
      const deeper = Math.max(
        model.graph.getNodeAttributes(source).depth,
        model.graph.getNodeAttributes(target).depth,
      );
      const step = clamp(Math.round(deeper), 1, DEPTH_STEPS + 1) - 1;
      if (attributes.look !== undefined) {
        const from = byRef.get(attributes.look.from);
        this.lookedLines.push({
          from: from === a ? a : b,
          to: from === a ? b : a,
          kind: attributes.kind,
          step,
          look: attributes.look,
        });
        return;
      }
      if (attributes.kind === "link") {
        this.linkPairs.push(a, b);
        return;
      }
      if (attributes.kind === "reference") {
        this.referencePairs.push(a, b);
        return;
      }
      if (attributes.kind === "run") {
        this.runPairs.push(a, b);
        return;
      }
      this.edgesByDepth[step].push(a, b);
    });

    this.differenceLines = model.difference;
    this.readComparing();
    this.nameFields(model.fields);
    this.modelDirty = true;
    this.positionsDirty = true;
  }

  /** Setting a `Text`'s string re-rasterises it, so the names are written once
   *  per model rather than once per frame — only their placing moves. */
  private nameFields(fields: readonly NamedField[]): void {
    this.fieldNames = fields.slice(0, this.fieldPool.length);
    this.fieldPool.forEach((text, at) => {
      const field = this.fieldNames[at];
      text.text =
        field === undefined ? "" : shorten(field.title, FIELD_NAME_CHARS);
      text.visible = false;
    });
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

  /** Whether a mark is drawn, and drawn whole inside the box on screen. */
  inView(ref: string): boolean {
    const index = this.indexOf(ref);
    if (index === undefined) return false;
    const at = this.positionOf(index);
    return wholeInView(
      this.viewport.toScreen(at.x, at.y),
      (this.attributesOf(ref)?.radius ?? 0) * this.viewport.scale,
      this.width,
      this.height,
    );
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

  /** Re-read the box the canvas is drawn in. pixi's own `resizeTo` hears the
   *  window and nothing else, so a host that moves that box has to say so. */
  resize(): void {
    this.app.resize();
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
      edges: this.linePairs.length / 2,
      labels: this.labelSlots.size,
    };
  }

  resetStats(): void {
    this.cpuSamples.length = 0;
    this.frameSamples.length = 0;
  }

  destroy(): void {
    this.destroyed = true;
    this.freeSpentSheet();
    this.app.ticker.remove(this.draw);
    this.ground.destroy();
    this.dropPreviewSprites();
    for (const held of this.previewTextures.values()) {
      held.texture?.destroy(true);
    }
    this.previewTextures.clear();
    for (const texture of this.retiredTextures) texture.destroy(true);
    this.retiredTextures.length = 0;
    this.app.destroy(true, { children: true, texture: true });
  }

  private readonly draw = (): void => {
    const started = performance.now();
    this.frameSamples.push(this.app.ticker.deltaMS);
    this.freeSpentSheet();

    const rebuilt = this.modelDirty;
    if (this.modelDirty) this.rebuildMarks();
    if (this.previewsDirty) this.rebuildPreviews();

    const scaleMoved =
      Math.abs(this.viewport.scale - this.lastEdgeScale) >
      this.lastEdgeScale * SCALE_REBUILD;

    this.ground.update(this.viewport, this.width, this.height);
    const turning = this.turning.size > 0;
    const recut = this.cutSheet();
    if (this.positionsDirty) this.syncMarks();
    if (turning) this.advanceTurns();
    if (this.sweeping !== null) this.advanceSweep();
    if (this.positionsDirty || scaleMoved || rebuilt || recut) {
      this.drawShapes();
    }
    if (this.positionsDirty || scaleMoved) this.drawLift();
    if (this.positionsDirty || scaleMoved) this.rebuildEdges();
    if (this.positionsDirty || scaleMoved) this.drawDifference();
    if (this.positionsDirty || scaleMoved) this.drawOrbit();
    if (this.positionsDirty || scaleMoved) this.drawCodeMoved();
    if (this.positionsDirty || scaleMoved) this.layoutLabels();
    if (this.positionsDirty || scaleMoved) this.layoutFieldNames();

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
      const gone = mark.attributes.difference === "gone";
      mark.fill =
        gone || provenance === "pulled"
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
        gone || provenance === "own"
          ? null
          : new this.pixi.Particle({
              texture: this.ringTexture(mark),
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
      // Latched for every mark, not only the ones with something inside them:
      // the rim's dot goes when the look goes, and a mark with no look at all
      // still carries one.
      mark.looking = looksDrawn(
        mark.radius * this.viewport.scale,
        mark.looking,
      );
      if (mark.look === null && mark.preview === null) continue;
      if (mark.look) {
        mark.look.x = x;
        mark.look.y = y;
        mark.look.alpha = mark.looking ? mark.attributes.alpha : 0;
      }
      if (mark.preview) this.placePictures(mark);
    }
  }

  /**
   * Cuts the sheet again where the zoom or the screen has carried the marks onto
   * another tier, and says whether it did. The cuts are frames of one source, so
   * every particle drawing from the old one is handed the new one here.
   */
  private cutSheet(): boolean {
    const tier = markSheetTier(
      this.viewport.scale,
      this.options.resolution,
      this.sheetTier,
    );
    if (tier === this.sheetTier) return false;

    this.spentSheet = this.textures.disc.source;
    this.textures = markTextures(this.pixi, this.app, tier);
    this.sheetTier = tier;
    for (const mark of this.marks) {
      if (mark.fill) mark.fill.texture = this.textures.disc;
      if (mark.ring) mark.ring.texture = this.ringTexture(mark);
      const look = this.lookTexture(
        mark.attributes.ringWeight,
        mark.attributes.ringStyle,
      );
      if (mark.look && look) mark.look.texture = look;
    }
    for (const layer of [this.fills, this.rings, this.looks]) {
      // Which cut it is handed does not matter: they are frames of one source,
      // and a container binds the source rather than the frame.
      layer.texture = this.textures.disc;
      layer.update();
    }
    return true;
  }

  private freeSpentSheet(): void {
    this.spentSheet?.destroy();
    this.spentSheet = null;
  }

  private get sheetReach(): number {
    return markSheetReach(
      this.sheetTier,
      this.viewport.scale,
      this.options.resolution,
    );
  }

  /**
   * The marks the sheet cannot hold, drawn as shapes for this frame so a
   * mega-node at full zoom has an edge rather than a stair. Their particles are
   * held at nothing rather than taken off the containers: which marks these are
   * changes with the zoom, and a rebuild per pinched frame is what particles are
   * here to avoid.
   */
  private drawShapes(): void {
    const reach = this.sheetReach;
    let sharp = 0;
    for (const mark of this.marks) if (mark.radius > reach) sharp++;
    // A field with nothing past the sheet is most of them, and clearing a
    // graphics is a frame's worth of work for a layer that draws nothing.
    if (sharp === 0 && !this.shapesShown) return;

    this.shapes.clear();
    this.shapeRings.clear();
    for (const mark of this.marks) {
      const drawn = mark.radius > reach;
      const alpha = drawn ? 0 : mark.attributes.alpha;
      if (mark.fill) mark.fill.alpha = alpha;
      if (mark.ring) mark.ring.alpha = alpha;
      if (mark.look) {
        mark.look.alpha = drawn || !mark.looking ? 0 : mark.attributes.alpha;
      }
      if (drawn) this.drawShape(mark);
    }
    this.shapesShown = sharp > 0;
  }

  /** One mark, as the shapes its cells hold — the same geometry the sheet is
   *  cut from, at the mark's own radius. */
  private drawShape(mark: Mark): void {
    const x = this.positions[mark.index * 2];
    const y = this.positions[mark.index * 2 + 1];
    if (mark.attributes.difference === "gone") return;
    const { provenance, fill, alpha, ringWeight, ringStyle } = mark.attributes;
    const { palette } = this.options;

    if (provenance !== "pulled") {
      this.shapes
        .circle(x, y, mark.radius * FILL_AT)
        .fill({ color: fill, alpha });
    }
    if (mark.looking && ringWeight !== "none") {
      const { dashes, duty } = LOOK_RING_BREAK[ringStyle];
      strokeRing(
        this.shapes,
        x,
        y,
        mark.radius * LOOK_RING_AT,
        mark.radius * LOOK_RING_WIDTH[ringWeight],
        dashes,
        duty,
        {
          color: palette.lookRing(
            provenance === "pulled" ? palette.paper : fill,
          ),
          alpha,
        },
      );
    }
    if (provenance !== "own") {
      strokeRing(
        this.shapeRings,
        x,
        y,
        mark.radius * EDGE_RING_AT,
        mark.radius * EDGE_RING_WIDTH,
        provenance === "pulled" ? EDGE_DASHES : 0,
        0.5,
        { color: provenance === "pulled" ? fill : palette.ink, alpha },
      );
    }
  }

  /** Where a mark's imagery is drawn: the picture whose turn it is, and the one
   *  giving way while a change is under way. */
  private placePictures(mark: Mark): void {
    const x = this.positions[mark.index * 2];
    const y = this.positions[mark.index * 2 + 1];
    const { alpha, previewCover, preview } = mark.attributes;
    const across = mark.radius * previewCover;
    if (mark.turn === null) {
      if (!mark.preview) return;
      lay(mark.preview, x, y, across * 2, alpha, mark.looking);
      return;
    }

    const progress = this.turnProgress(mark.turn);
    const layers = [
      ["arriving", mark.preview],
      ["leaving", mark.turn.sprite],
    ] as const;
    for (const [role, sprite] of layers) {
      if (!sprite) continue;
      const step = pictureStep(
        preview.transition,
        role,
        shownAt(role, progress),
      );
      // A mark has no clip to slide a picture behind, so the travel is the room
      // the mark leaves it rather than the picture's own width: the imagery
      // crosses the face of the mark and never leaves it.
      lay(
        sprite,
        x + step.shift * (mark.radius - across),
        y,
        across * 2 * step.scale,
        alpha * step.opacity,
        mark.looking,
      );
    }
  }

  /** How far through its change a mark is, 0–1. A change takes no time at all
   *  where the reader has asked for less motion — DESIGN.md § Motion. */
  private turnProgress(turn: Turn): number {
    const over = this.options.reduced?.matches ? 0 : TURN_MS;
    return over === 0
      ? 1
      : Math.min(1, (performance.now() - turn.since) / over);
  }

  /**
   * Separate from {@link rebuildMarks} because a picture lands long after the
   * model does, and rebuilding the marks would drop every label placed since.
   *
   * Only the marks whose picture actually changed hands are touched: pictures
   * land one at a time across a load, and rebuilding every sprite for each
   * arrival costs a square of the pictured marks on screen.
   */
  private rebuildPreviews(): void {
    this.previewsDirty = false;
    let moved = false;
    let view: Bounds | null = null;
    for (const mark of this.marks) {
      const wanted = mark.showing;
      let texture: Texture | null = null;
      if (wanted !== undefined) {
        const side = this.sideFor(mark);
        const held = this.previewTextures.get(wanted);
        if (held === undefined) {
          // Still on its way, so the mark goes on drawing what it has rather
          // than blanking until the next picture lands.
          this.wantPicture(wanted, side);
          continue;
        }
        // A mark bigger than the cut the canvas holds asks for its own, and
        // draws this one meanwhile.
        if (held.side < side) this.wantPicture(wanted, side);
        texture = held.texture;
      }
      if ((mark.preview?.texture ?? null) === texture) continue;

      moved = true;
      const before = mark.preview;
      const leaving = mark.drawing;
      mark.preview = texture === null ? null : this.laySprite(texture);
      mark.drawing = texture === null ? undefined : wanted;
      this.endTurn(mark);
      // A picture arriving where none was drawn is the graph opening rather than
      // a turn, so only a mark that had one already draws the change. Nor is a
      // bigger cut of the SAME picture, which is what folding a mark asks for:
      // the texture is a new one, the picture is not, and nobody turned.
      view ??= visibleBounds(this.viewport, this.width, this.height);
      if (
        before !== null &&
        leaving !== undefined &&
        leaving !== wanted &&
        texture !== null &&
        this.turnDrawn(mark, view)
      ) {
        mark.turn = { from: leaving, sprite: before, since: performance.now() };
        this.turning.add(mark);
      } else {
        this.drop(before);
      }
    }
    if (moved) this.positionsDirty = true;
    // A mark exchanges its picture whether or not anybody watches the change,
    // so what it turned away from cannot be freed off the animation alone.
    this.forgetUnwantedPictures();
  }

  /**
   * Whose turn it is on every mark wearing more than one picture. Read off the
   * clock rather than off a timer — DESIGN.md § "A picture that takes turns" —
   * so a host calls this when the graph opens and when the app comes back from
   * the background.
   */
  takeTurns(at = Date.now()): void {
    for (const mark of this.marks) {
      const next = pictureTurn(mark.attributes.preview, at);
      if (next === mark.showing) continue;
      mark.showing = next;
      this.previewsDirty = true;
    }
  }

  /** Whether a change on this mark is drawn rather than simply made. Nobody is
   *  watching a mark too small to carry its look or one off the screen, which is
   *  what holds a whole field's turn to the cost of what is on the screen. */
  private turnDrawn(mark: Mark, view: Bounds): boolean {
    if (this.options.reduced?.matches) return false;
    if (!looksDrawn(mark.radius * this.viewport.scale, mark.looking)) {
      return false;
    }
    const x = this.positions[mark.index * 2];
    const y = this.positions[mark.index * 2 + 1];
    return x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
  }

  /** The one place a change ends, so the frame that draws it and the frame that
   *  finishes it cannot disagree about which sprites are on the canvas. */
  private advanceTurns(): void {
    for (const mark of [...this.turning]) {
      this.placePictures(mark);
      if (mark.turn !== null && this.turnProgress(mark.turn) >= 1) {
        this.endTurn(mark);
      }
    }
    if (this.turning.size === 0) this.forgetUnwantedPictures();
  }

  private endTurn(mark: Mark): void {
    if (mark.turn === null) return;
    this.drop(mark.turn.sprite);
    mark.turn = null;
    this.turning.delete(mark);
  }

  private laySprite(texture: Texture): Sprite {
    // Added last, so the picture arriving is drawn over the one giving way.
    const sprite = new this.pixi.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    this.previews.addChild(sprite);
    return sprite;
  }

  private drop(sprite: Sprite | null): void {
    if (sprite === null) return;
    this.previews.removeChild(sprite);
    sprite.destroy();
  }

  /** What this mark decodes its picture at — the mark's own size on this
   *  screen, never the largest one a look could reach on the densest. */
  private sideFor(mark: Mark): number {
    return markPictureSide(
      mark.radius,
      mark.attributes.previewCover,
      this.options.resolution,
    );
  }

  /** Marks share one texture per picture, so a sprite goes without its own. */
  private dropPreviewSprites(): void {
    for (const sprite of this.previews.removeChildren()) sprite.destroy();
    for (const mark of this.marks) {
      mark.preview = null;
      mark.drawing = undefined;
      mark.turn = null;
    }
    this.turning.clear();
  }

  private wantPicture(preview: string, side: number): void {
    const pictures = this.options.pictures;
    if (pictures === undefined) return;
    if ((this.previewTextures.get(preview)?.side ?? 0) >= side) return;
    if ((this.previewsAsked.get(preview) ?? 0) >= side) return;
    this.previewsAsked.set(preview, side);
    void pictures
      .read(preview)
      .then(async (held) => {
        if (held === null) return null;
        try {
          return await markPicture(this.pixi, held.src, side);
        } finally {
          held.release();
        }
      })
      // A picture that will not draw leaves the mark drawing as one with no
      // picture, which is also what a picture since deleted leaves behind.
      .catch(() => null)
      .then((texture) => {
        // A cut a bigger ask has since gone out for is dropped rather than
        // stored: two marks of different sizes wearing one picture ask twice,
        // and the canvas keeps one texture, the bigger of them.
        if (
          this.destroyed ||
          (this.previewsAsked.get(preview) ?? 0) > side ||
          (this.previewTextures.get(preview)?.side ?? 0) >= side
        ) {
          texture?.destroy(true);
          return;
        }
        const displaced = this.previewTextures.get(preview)?.texture ?? null;
        // A picture that will not draw is held at every size, so a bigger mark
        // wearing it does not send the host after it again.
        this.previewTextures.set(preview, {
          texture,
          side: texture === null ? Number.POSITIVE_INFINITY : side,
        });
        if (displaced !== null) this.retiredTextures.push(displaced);
        this.previewsDirty = true;
      });
  }

  /**
   * Textures no mark is drawing, and the cuts a bigger one took the place of.
   * What every live sprite draws is kept: a sprite outliving its texture is
   * drawn from freed memory.
   */
  private forgetUnwantedPictures(): void {
    if (this.previewTextures.size === 0 && this.retiredTextures.length === 0) {
      return;
    }
    const drawn = new Set<Texture>();
    const wanted = new Set<string>();
    for (const mark of this.marks) {
      if (mark.preview !== null) drawn.add(mark.preview.texture);
      if (mark.showing !== undefined) wanted.add(mark.showing);
      if (mark.drawing !== undefined) wanted.add(mark.drawing);
      if (mark.turn !== null) {
        drawn.add(mark.turn.sprite.texture);
        wanted.add(mark.turn.from);
      }
    }

    for (let at = this.retiredTextures.length - 1; at >= 0; at--) {
      const texture = this.retiredTextures[at];
      if (drawn.has(texture)) continue;
      texture.destroy(true);
      this.retiredTextures.splice(at, 1);
    }

    for (const [preview, held] of this.previewTextures) {
      if (wanted.has(preview)) continue;
      if (held.texture !== null && drawn.has(held.texture)) continue;
      held.texture?.destroy(true);
      this.previewTextures.delete(preview);
      this.previewsAsked.delete(preview);
    }
  }

  /** Provenance's own edge: broken where the region was pulled. */
  private ringTexture(mark: Mark): Texture {
    return mark.attributes.provenance === "pulled"
      ? this.textures.dashed
      : this.textures.ring;
  }

  /** `null` is no look at all: a weight of `none`, and any pair this build has
   *  no shape for — the mark's own edge belongs to provenance. */
  private lookTexture(weight: RingWeight, style: RingStyle): Texture | null {
    if (weight === "none") return null;
    return this.textures.looks.get(lookKey(weight, style)) ?? null;
  }

  /** What one step of the edge ladder is struck at, held between a hairline and
   *  a stroke wide enough to close a mark as the field is zoomed out. */
  private get lineWidth(): number {
    return Math.min(12, Math.max(0.5, EDGE_WIDTH / this.viewport.scale));
  }

  /**
   * What one line is struck in. `receding` is the canvas stepping back from a
   * question — DESIGN.md § Edges recedes three of the four kinds and leaves the
   * hand link where it was, which is why the alpha is read per kind.
   */
  private lineInk(kind: EdgeKind, step: number, receding: boolean): LineInk {
    const { palette } = this.options;
    const width = this.lineWidth;
    const ink = (
      color: number,
      alpha: number,
      standing: number,
      weight = 1,
    ): LineInk => ({
      color,
      alpha,
      width: width * weight,
      captionAlpha: alpha / standing,
    });
    switch (kind) {
      case "run":
        return ink(
          palette.run,
          receding ? palette.runAlphaWhileSelecting : palette.runAlpha,
          palette.runAlpha,
          RUN_WEIGHT,
        );
      case "reference":
        return ink(
          palette.connection,
          receding
            ? palette.connectionAlphaWhileSelecting
            : palette.connectionAlpha,
          palette.connectionAlpha,
          CONNECTION_WEIGHT,
        );
      case "link":
        return ink(
          palette.connection,
          palette.connectionAlpha,
          palette.connectionAlpha,
          CONNECTION_WEIGHT,
        );
      default:
        return ink(
          palette.depth(step + 1),
          receding ? palette.edgeAlphaWhileSelecting : palette.edgeAlpha,
          palette.edgeAlpha,
        );
    }
  }

  private rebuildEdges(): void {
    // Both questions take their answer off the same field: the notes a
    // difference names are left as they are and everything else dims, the lines
    // the addresses and the writing make included — DESIGN.md § "A difference
    // between two states". A hand link is the one thing that stays, as it stays
    // through a tag question.
    const receding = this.selecting || this.comparing;

    this.edges.clear();
    this.edgesByDepth.forEach((pairs, step) => {
      if (pairs.length === 0) return;
      for (let at = 0; at < pairs.length; at += 2) {
        const a = pairs[at] * 2;
        const b = pairs[at + 1] * 2;
        this.edges.moveTo(this.positions[a], this.positions[a + 1]);
        this.edges.lineTo(this.positions[b], this.positions[b + 1]);
      }
      this.edges.stroke(this.lineInk("genealogy", step, receding));
    });

    this.runs.clear();
    for (let at = 0; at < this.runPairs.length; at += 2) {
      const a = this.runPairs[at] * 2;
      const b = this.runPairs[at + 1] * 2;
      this.runs.moveTo(this.positions[a], this.positions[a + 1]);
      this.runs.lineTo(this.positions[b], this.positions[b + 1]);
    }
    if (this.runPairs.length > 0) {
      this.runs.stroke(this.lineInk("run", 0, receding));
    }

    // Two strokes, because the two do not recede together. A reference is
    // solid, so while a tag question is being asked it steps back with the
    // lines the genealogy draws; a hand link is the one somebody made and stays
    // where it was — DESIGN.md § Edges.
    this.connections.clear();
    for (let at = 0; at < this.referencePairs.length; at += 2) {
      const a = this.referencePairs[at] * 2;
      const b = this.referencePairs[at + 1] * 2;
      this.connections.moveTo(this.positions[a], this.positions[a + 1]);
      this.connections.lineTo(this.positions[b], this.positions[b + 1]);
    }
    if (this.referencePairs.length > 0) {
      this.connections.stroke(this.lineInk("reference", 0, receding));
    }

    const dash = CONNECTION_DASH / this.viewport.scale;
    for (let at = 0; at < this.linkPairs.length; at += 2) {
      const a = this.linkPairs[at] * 2;
      const b = this.linkPairs[at + 1] * 2;
      dashLine(
        this.connections,
        this.positions[a],
        this.positions[a + 1],
        this.positions[b],
        this.positions[b + 1],
        dash,
      );
    }
    if (this.linkPairs.length > 0) {
      this.connections.stroke(this.lineInk("link", 0, receding));
    }

    const reading = this.readingIndex();
    this.drawLooks(receding, reading);
    if (reading !== undefined) this.drawReadingLines(reading);
    this.lastEdgeScale = this.viewport.scale;
  }

  /** The mark of the note being read, where one is and is drawn. */
  private readingIndex(): number | undefined {
    const active = this.reading?.active;
    return active ? this.indexOf(active) : undefined;
  }

  /** A line's ink where it reaches the note being read: its own weight a step
   *  up and the full ink, whatever is receding — DESIGN.md § Edges. */
  private readingInk(kind: EdgeKind, step: number): LineInk {
    const { palette } = this.options;
    const [color, weight] =
      kind === "run"
        ? [palette.run, RUN_WEIGHT]
        : kind === "genealogy"
          ? [palette.depth(step + 1), 1]
          : [palette.connection, CONNECTION_WEIGHT];
    return {
      color,
      alpha: palette.readingAlpha,
      width: this.lineWidth * weight * READING_WEIGHT,
      captionAlpha: 1,
    };
  }

  /**
   * The lines reaching the note being read, struck again over the rest — the
   * ones a look is set on are already struck that way by `drawLooks`.
   */
  private drawReadingLines(at: number): void {
    const looked = new Set(
      this.lookedLines.map((line) => `${line.from}:${line.to}`),
    );
    const touches = (a: number, b: number): boolean =>
      (a === at || b === at) && !looked.has(`${a}:${b}`);
    const segment = (into: Graphics, a: number, b: number): void => {
      into.moveTo(this.positions[a * 2], this.positions[a * 2 + 1]);
      into.lineTo(this.positions[b * 2], this.positions[b * 2 + 1]);
    };

    this.edgesByDepth.forEach((pairs, step) => {
      let any = false;
      for (let i = 0; i < pairs.length; i += 2) {
        if (!touches(pairs[i], pairs[i + 1])) continue;
        segment(this.edges, pairs[i], pairs[i + 1]);
        any = true;
      }
      if (any) this.edges.stroke(this.readingInk("genealogy", step));
    });

    let runs = false;
    for (let i = 0; i < this.runPairs.length; i += 2) {
      if (!touches(this.runPairs[i], this.runPairs[i + 1])) continue;
      segment(this.runs, this.runPairs[i], this.runPairs[i + 1]);
      runs = true;
    }
    if (runs) this.runs.stroke(this.readingInk("run", 0));

    let references = false;
    for (let i = 0; i < this.referencePairs.length; i += 2) {
      if (!touches(this.referencePairs[i], this.referencePairs[i + 1]))
        continue;
      segment(
        this.connections,
        this.referencePairs[i],
        this.referencePairs[i + 1],
      );
      references = true;
    }
    if (references) this.connections.stroke(this.readingInk("reference", 0));

    const dash = CONNECTION_DASH / this.viewport.scale;
    let links = false;
    for (let i = 0; i < this.linkPairs.length; i += 2) {
      const a = this.linkPairs[i];
      const b = this.linkPairs[i + 1];
      if (!touches(a, b)) continue;
      dashLine(
        this.connections,
        this.positions[a * 2],
        this.positions[a * 2 + 1],
        this.positions[b * 2],
        this.positions[b * 2 + 1],
        dash,
      );
      links = true;
    }
    if (links) this.connections.stroke(this.readingInk("link", 0));
  }

  /** The layer each kind of line is drawn on, so a look stays on the line it is
   *  set on rather than over the field. */
  private layerFor(kind: EdgeKind): Graphics {
    if (kind === "run") return this.runs;
    return kind === "genealogy" ? this.edges : this.connections;
  }

  /**
   * The lines somebody set a look on, each struck on its own: the break the
   * look names or the one the line already has, and an arrowhead at whichever
   * end it names — DESIGN.md § Edges, "A look a person set".
   */
  private drawLooks(receding: boolean, reading?: number): void {
    for (const line of this.lookedLines) {
      const into = this.layerFor(line.kind);
      const ink =
        line.from === reading || line.to === reading
          ? this.readingInk(line.kind, line.step)
          : this.lineInk(line.kind, line.step, receding);
      const from = this.positionOf(line.from);
      const to = this.positionOf(line.to);
      const span = Math.hypot(to.x - from.x, to.y - from.y);
      const stroke = line.look.stroke ?? EDGE_BREAK[line.kind];
      if (stroke === "solid") {
        into.moveTo(from.x, from.y);
        into.lineTo(to.x, to.y);
      } else {
        brokenLine(
          into,
          from,
          to,
          stroke === "dashed"
            ? dashSegments(span, CONNECTION_DASH / this.viewport.scale)
            : dotSegments(span, LOOK_DOT / this.viewport.scale),
        );
      }
      const { direction } = line.look;
      if (direction === "to" || direction === "both") {
        this.arrowInto(into, from, to, line.to, ink.width);
      }
      if (direction === "from" || direction === "both") {
        this.arrowInto(into, to, from, line.from, ink.width);
      }
      into.stroke(ink);
    }
  }

  /**
   * An arrowhead where the line reaches the mark at `at`, held off that mark so
   * the head is not drawn under it. Its reach is the line's own stroke, which is
   * clamped — so a field zoomed out draws hairline heads rather than the
   * loudest thing on it.
   */
  private arrowInto(
    into: Graphics,
    from: Point,
    to: Point,
    at: number,
    width: number,
  ): void {
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    if (span < 1) return;
    const ux = (to.x - from.x) / span;
    const uy = (to.y - from.y) / span;
    const clear = Math.min(this.marks[at]?.radius ?? 0, span / 2);
    const reach = Math.min(width * ARROW_REACH, span - clear);
    if (reach <= 0) return;
    const tipX = to.x - ux * clear;
    const tipY = to.y - uy * clear;
    const angle = Math.atan2(uy, ux);
    for (const spread of [ARROW_SPREAD, -ARROW_SPREAD]) {
      into.moveTo(
        tipX - Math.cos(angle + spread) * reach,
        tipY - Math.sin(angle + spread) * reach,
      );
      into.lineTo(tipX, tipY);
    }
  }

  /**
   * The pair a tap landed on the LINE between, and `null` where it landed on
   * none. The nearest line within a finger's reach wins; a tap on a mark is the
   * mark's, which {@link hitTest} answers first.
   */
  hitEdge(world: Point): [string, string] | null {
    let best: [string, string] | null = null;
    let nearest = EDGE_TAP / this.viewport.scale;
    for (let at = 0; at < this.linePairs.length; at += 2) {
      const a = this.linePairs[at];
      const b = this.linePairs[at + 1];
      const away = awayFromLine(world, this.positionOf(a), this.positionOf(b));
      if (away > nearest) continue;
      nearest = away;
      best = [this.marks[a].ref, this.marks[b].ref];
    }
    return best;
  }

  /**
   * The paper under each open note, which DESIGN.md § "The mark" gives to the
   * fact that it is open.
   */
  private drawLift(): void {
    this.lift.clear();
    const reading = this.reading;
    if (!reading) return;
    const { ink } = this.options.palette;
    for (const mark of this.marks) {
      if (!reading.open.has(mark.ref)) continue;
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      const bands = liftOf(
        mark.radius,
        mark.ref === reading.active,
        this.viewport.scale,
      );
      for (const band of bands) {
        this.lift
          .circle(x, y, band.at)
          .stroke({ color: ink, alpha: band.alpha, width: band.width });
      }
    }
  }

  /**
   * The lines a difference draws — the one a note joined and the one it left,
   * both whole, both in ink and at one weight, over a field that has receded to
   * be compared. The line it left is the fainter, which is the channel that
   * survives a zoom-out. DESIGN.md § "A difference between two states".
   */
  private drawDifference(): void {
    this.diffs.clear();
    const { arrived, gone } = this.differenceLines;
    if (arrived.length === 0 && gone.length === 0) return;
    const { ink } = this.options.palette;
    const width = this.lineWidth * DIFFERENCE_WEIGHT;

    const strike = (pairs: readonly number[], alpha: number): void => {
      if (pairs.length === 0) return;
      for (let at = 0; at < pairs.length; at += 2) {
        const from = pairs[at] * 2;
        const to = pairs[at + 1] * 2;
        this.diffs.moveTo(this.positions[from], this.positions[from + 1]);
        this.diffs.lineTo(this.positions[to], this.positions[to + 1]);
      }
      this.diffs.stroke({ color: ink, alpha, width });
    };

    strike(gone, DIFFERENCE_GONE_INK);
    strike(arrived, DIFFERENCE_INK);
  }

  /**
   * The orbit outside each mark, which DESIGN.md § "The mark" gives to the mode
   * the canvas is in. Picking outlines, choosing fills, and comparing two states
   * bands; a canvas is only ever in one of the three.
   */
  private drawOrbit(): void {
    this.picks.clear();
    const { ink } = this.options.palette;
    const gap = PICK_GAP / this.viewport.scale;

    if (this.comparing) {
      const band = DIFFERENCE_BAND / this.viewport.scale;
      for (const mark of this.marks) {
        const kind = mark.attributes.difference;
        if (kind === undefined || kind === "moved") continue;
        const { dashes, duty } =
          kind === "changed" ? DIFFERENCE_BREAK : { dashes: 0, duty: 1 };
        strokeRing(
          this.picks,
          this.positions[mark.index * 2],
          this.positions[mark.index * 2 + 1],
          mark.radius + gap + band / 2,
          band,
          dashes,
          duty,
          { color: ink, alpha: DIFFERENCE_INK },
        );
      }
      return;
    }

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
        this.picks.stroke({ color: ink, alpha: CHOSEN_INK, width: band });
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

  /**
   * The dot on the rim of each mark whose code has moved since its author read
   * the note against it — DESIGN.md § "The mark". Drawn over the orbit and the
   * lift it stands inside, in ink and never in a hue, and it goes at the size
   * the look's ring goes: past that a dot on a rim is a smudge.
   */
  private drawCodeMoved(): void {
    this.codeMoved.clear();
    const { ink } = this.options.palette;
    for (const mark of this.marks) {
      if (!mark.attributes.codeMoved || !mark.looking) continue;
      const x = this.positions[mark.index * 2];
      const y = this.positions[mark.index * 2 + 1];
      this.codeMoved
        .circle(
          x,
          y + mark.radius * EDGE_RING_AT,
          mark.radius * CODE_MOVED_RADIUS,
        )
        .fill({ color: ink, alpha: mark.attributes.alpha });
    }
  }

  /** Every mark whose centre falls inside a world rectangle, in drawn order.
   *  Never a note that went: there is nothing behind it to hand back. */
  marksWithin(bounds: Bounds): string[] {
    const found: string[] = [];
    for (const mark of this.marks) {
      if (mark.attributes.difference === "gone") continue;
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
   * slots are written in any one frame — whether they changed hands or the mark
   * holding one was given an address, retitled or folded under.
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
      if (budget <= 0) break;
      let at = held.get(mark.ref);
      if (at === undefined) {
        at = free.pop();
        if (at === undefined) break;
        held.set(mark.ref, at);
      }
      const slot = this.labelPool[at];
      const caption = markCaption(mark.attributes);
      if (
        slot.address.text === caption.label &&
        slot.title.text === caption.title
      ) {
        continue;
      }
      budget -= 1;
      slot.address.text = caption.label;
      slot.title.text = caption.title;
    }

    // The marks are placed first, so a line's words give way to a note's name
    // rather than the other way round.
    this.layoutEdgeLabels(this.placeMarkLabels(wanted));
  }

  /**
   * The words a person wrote on a line, at its middle — a caption, held to the
   * rules a mark's caption is held to, so a field of labelled lines is never a
   * wall of text. DESIGN.md § Edges, "A look a person set".
   */
  private layoutEdgeLabels(placed: number[]): void {
    const held = this.edgeLabelSlots;
    const enter = EDGE_LABEL_MIN_SPAN;
    const leave = enter * LABEL_HYSTERESIS;
    const receding = this.selecting || this.comparing;

    const wanted: {
      key: string;
      line: LookedLine;
      middle: Point;
      ends: [Point, Point];
      span: number;
    }[] = [];
    for (const line of this.lookedLines) {
      const words = line.look.label;
      if (words === undefined || words === "") continue;
      const from = this.positionOf(line.from);
      const to = this.positionOf(line.to);
      const span =
        Math.hypot(to.x - from.x, to.y - from.y) * this.viewport.scale;
      const key = edgeLookKey(line.look.from, line.look.to);
      if (span < (held.has(key) ? leave : enter)) continue;
      const middle = this.viewport.toScreen(
        (from.x + to.x) / 2,
        (from.y + to.y) / 2,
      );
      if (
        middle.x < 0 ||
        middle.x > this.width ||
        middle.y < 0 ||
        middle.y > this.height
      ) {
        continue;
      }
      wanted.push({
        key,
        line,
        middle,
        ends: [
          this.viewport.toScreen(from.x, from.y),
          this.viewport.toScreen(to.x, to.y),
        ],
        span,
      });
    }
    wanted.sort((a, b) => b.span - a.span);
    wanted.length = Math.min(wanted.length, this.edgeLabelPool.length);
    const keeping = new Set(wanted.map((entry) => entry.key));

    for (const [key, at] of held) {
      if (keeping.has(key)) continue;
      held.delete(key);
      this.edgeLabelPool[at].visible = false;
    }

    const taken = new Set(held.values());
    const free: number[] = [];
    for (let at = 0; at < this.edgeLabelPool.length; at++) {
      if (!taken.has(at)) free.push(at);
    }

    for (const entry of wanted) {
      let at = held.get(entry.key);
      if (at === undefined) {
        at = free.pop();
        if (at === undefined) break;
        held.set(entry.key, at);
      }
      const text = this.edgeLabelPool[at];
      const words = shorten(entry.line.look.label ?? "", EDGE_LABEL_CHARS);
      if (text.text !== words) text.text = words;
      const where = beside(
        entry.middle,
        entry.ends[0],
        entry.ends[1],
        text.width,
      );
      const left = where.x - text.width / 2;
      if (overlaps(placed, left, where.y, text.width)) {
        text.visible = false;
        continue;
      }
      placed.push(left, where.y, text.width);
      text.position.set(where.x, where.y);
      text.tint = this.options.palette.ink;
      text.alpha = this.lineInk(
        entry.line.kind,
        entry.line.step,
        receding,
      ).captionAlpha;
      text.visible = true;
    }
  }

  /**
   * A graph's name, held over the field it belongs to: pinned to the top of the
   * screen while the reader is inside that field, gone once the field is not.
   * DESIGN.md § "Several graphs on one canvas".
   */
  private layoutFieldNames(): void {
    for (const [at, text] of this.fieldPool.entries()) {
      const field = this.fieldNames[at];
      if (field === undefined || text.text === "") {
        text.visible = false;
        continue;
      }
      const left = this.viewport.toScreen(field.minX, field.y).x;
      const right = this.viewport.toScreen(field.maxX, field.y).x;
      if (right < 0 || left > this.width) {
        text.visible = false;
        continue;
      }
      // Held inside its own field as well as inside the screen, so a name never
      // drifts over the field beside it.
      const edge = text.width / 2 + FIELD_NAME_GAP;
      const lowest = Math.max(edge, left);
      const highest = Math.min(this.width - edge, right);
      const where = this.viewport.toScreen(field.x, field.y);
      text.position.set(
        highest < lowest ? (left + right) / 2 : clamp(where.x, lowest, highest),
        Math.max(where.y, FIELD_NAME_SIZE + FIELD_NAME_GAP),
      );
      text.tint = this.options.palette.ink;
      text.visible = true;
    }
  }

  /** Answers the boxes it took, so whatever is written next keeps clear of
   *  them. */
  private placeMarkLabels(wanted: readonly Mark[]): number[] {
    const held = this.labelSlots;
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
      // A note with no address draws its title alone, where the address would
      // have started, rather than one gap along from an empty caption.
      const captioned = slot.address.text !== "";
      const titled = slot.title.text !== "";
      const indent = captioned ? slot.address.width + LABEL_GAP : 0;
      const width =
        (captioned ? slot.address.width : 0) +
        (titled ? (captioned ? LABEL_GAP : 0) + slot.title.width : 0);

      if (overlaps(placed, left, screen.y, width)) {
        slot.address.visible = false;
        slot.title.visible = false;
        continue;
      }
      placed.push(left, screen.y, width);

      slot.address.position.set(left, screen.y);
      slot.address.tint = fill;
      slot.address.visible = captioned;
      slot.title.position.set(left + indent, screen.y);
      slot.title.tint = fill;
      slot.title.visible = titled;
    }
    return placed;
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

/**
 * The two texts beside a mark, in the two faces DESIGN.md § Typography gives
 * them. A note is named by its address where it has one and by its title where
 * it has none — `noteLabel` in `@sloppy/types` — so a mega-node's count follows
 * whichever of the two named it rather than standing ahead of the title.
 */
function markCaption(attributes: GraphNodeAttributes): {
  label: string;
  title: string;
} {
  const name = attributes.title.trim();
  const count = attributes.folded === 0 ? "" : `+${attributes.folded}`;
  const address = attributes.address;
  if (address !== undefined) {
    return {
      label: count === "" ? address : `${address} ${count}`,
      title: shorten(name, TITLE_CHARS),
    };
  }
  if (count === "") return { label: "", title: shorten(name, TITLE_CHARS) };
  const title = shorten(name, TITLE_CHARS - count.length - 1);
  return title === ""
    ? { label: count, title: "" }
    : { label: "", title: `${title} ${count}` };
}

/** One ring of a lift: the circle stroked, in world units from the mark's
 *  centre, how wide the stroke is, and the ink it lays. */
export interface LiftBand {
  at: number;
  width: number;
  alpha: number;
}

/**
 * The lift an open note's mark casts on the paper — DESIGN.md § "The mark".
 * Rings rather than one disc, innermost first, so a mark drawn hollow because
 * it was pulled stays hollow, and so the ink fades outward.
 *
 * `radius` and the result are world units; `scale` is what the viewport is
 * drawing at, which sets the clearance held off the mark and only ever widens
 * the spread — {@link LIFT_GAP}, {@link LIFT_FLOOR}.
 */
export function liftOf(
  radius: number,
  active: boolean,
  scale: number,
): LiftBand[] {
  const strength = active ? "active" : "open";
  const from = radius + LIFT_GAP / scale;
  const spread = Math.max(
    radius * (LIFT_REACH[strength] - 1),
    LIFT_FLOOR[strength] / scale,
  );
  const width = spread / LIFT_BANDS;
  return Array.from({ length: LIFT_BANDS }, (_unused, band) => ({
    at: from + (band + 0.5) * width,
    width,
    alpha: (LIFT_INK[strength] * (LIFT_BANDS - band)) / LIFT_BANDS,
  }));
}

/** The ink a lift lays `at` world units from the mark's centre. */
export function liftInk(bands: readonly LiftBand[], at: number): number {
  const on = bands.find(
    (band) => at >= band.at - band.width / 2 && at < band.at + band.width / 2,
  );
  return on?.alpha ?? 0;
}

/** One picture sprite, sized rather than scaled: a mark's imagery is drawn at a
 *  width in world units, and scaling would fight the width the size sets. */
function lay(
  sprite: Sprite,
  x: number,
  y: number,
  across: number,
  alpha: number,
  shown: boolean,
): void {
  sprite.position.set(x, y);
  sprite.width = across;
  sprite.height = across;
  sprite.alpha = alpha;
  sprite.visible = shown;
}

/** Whether a disc of `radius` screen pixels at screen point `on` falls whole
 *  inside the field, `across` by `down` — the box the marks are drawn in, which
 *  is already the surface less the chrome. */
export function wholeInView(
  on: Point,
  radius: number,
  across: number,
  down: number,
): boolean {
  return (
    on.x - radius >= 0 &&
    on.y - radius >= 0 &&
    on.x + radius <= across &&
    on.y + radius <= down
  );
}

/** Whether a mark drawn at `radius` screen pixels carries its look. The latch is
 *  the caller's: pass whether it is carrying one now, or it will strobe. */
export function looksDrawn(radius: number, looking: boolean): boolean {
  return radius >= LOOK_MIN_RADIUS * (looking ? LOOK_HYSTERESIS : 1);
}

function lookKey(weight: RingWeight, style: RingStyle): string {
  return `${weight}:${style}`;
}

/** The facet band a point `across` the field — 0 at its left edge, 1 at its
 *  right — stands in: the eight hues laid over it in order. */
function bandAt(across: number): (typeof TAG_HUE_SLOTS)[number] {
  const at = clamp(
    Math.floor(across * TAG_HUE_SLOTS.length),
    0,
    TAG_HUE_SLOTS.length - 1,
  );
  return TAG_HUE_SLOTS[at];
}

/** A picture cut to the disc it is drawn on, decoded at `at` — the size the mark
 *  wearing it shows, which `markPictureSide` in `model.ts` sets. */
async function markPicture(
  pixi: Pixi,
  src: string,
  at: number,
): Promise<Texture | null> {
  const picture = new Image();
  picture.src = src;
  await picture.decode();

  // Never larger than the picture can fill: one stored below the bound draws at
  // what it has rather than being enlarged into a disc it cannot cover.
  const side = Math.max(1, Math.min(at, picture.width, picture.height));
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const onto = canvas.getContext("2d");
  if (!onto) return null;

  const half = side / 2;
  onto.beginPath();
  onto.arc(half, half, half, 0, Math.PI * 2);
  onto.clip();
  // Short side fills the disc, so a picture is cropped rather than squashed.
  const cover = side / Math.min(picture.width, picture.height);
  const width = picture.width * cover;
  const height = picture.height * cover;
  onto.drawImage(picture, half - width / 2, half - height / 2, width, height);
  return pixi.Texture.from(canvas);
}

/**
 * Every mark texture, cut from ONE source at `resolution` texels per texture
 * pixel. A `ParticleContainer` draws all its particles with a single texture, so
 * a second source would silently put one mark's ring on every other mark in the
 * same container.
 */
function markTextures(
  pixi: Pixi,
  app: Application,
  resolution: number,
): MarkTextures {
  const cells: Graphics[] = [];
  const cell = (draw: (into: Graphics) => void): number => {
    const graphics = new pixi.Graphics();
    draw(graphics);
    cells.push(graphics);
    return cells.length - 1;
  };

  const disc = cell((into) => {
    into
      .circle(TEXTURE_RADIUS, TEXTURE_RADIUS, TEXTURE_RADIUS * FILL_AT)
      .fill(0xffffff);
  });
  const edgeAt = TEXTURE_RADIUS * EDGE_RING_AT;
  const edgeWidth = TEXTURE_RADIUS * EDGE_RING_WIDTH;
  const centre = TEXTURE_RADIUS;
  const ring = cell((into) =>
    strokeRing(into, centre, centre, edgeAt, edgeWidth, 0),
  );
  const dashed = cell((into) =>
    strokeRing(into, centre, centre, edgeAt, edgeWidth, EDGE_DASHES),
  );
  // One cell per weight and style both, so the sheet grows with the product of
  // the two — DESIGN.md § "The mark" is where a style has to earn that.
  const looks = new Map<string, number>();
  for (const [weight, fraction] of Object.entries(LOOK_RING_WIDTH)) {
    for (const style of RING_STYLES) {
      const { dashes, duty } = LOOK_RING_BREAK[style];
      looks.set(
        lookKey(weight as RingWeight, style),
        cell((into) =>
          strokeRing(
            into,
            centre,
            centre,
            TEXTURE_RADIUS * LOOK_RING_AT,
            TEXTURE_RADIUS * fraction,
            dashes,
            duty,
          ),
        ),
      );
    }
  }

  // Squared off rather than laid in one row: a row of it would run past the
  // smallest texture a GPU Sloppy runs on will hold at the densities the sheet
  // is cut at, and a square wastes the least of what it does hold.
  const corner = (at: number): { x: number; y: number } => ({
    x: (at % SHEET_COLUMNS) * SHEET_CELL + SHEET_PAD,
    y: Math.floor(at / SHEET_COLUMNS) * SHEET_CELL + SHEET_PAD,
  });
  for (const [at, graphics] of cells.entries()) {
    const { x, y } = corner(at);
    graphics.x = x;
    graphics.y = y;
  }

  const sheet = new pixi.Container();
  sheet.addChild(...cells);
  const { source } = app.renderer.generateTexture({
    target: sheet,
    frame: new pixi.Rectangle(
      0,
      0,
      SHEET_SIDE,
      Math.ceil(cells.length / SHEET_COLUMNS) * SHEET_CELL,
    ),
    resolution,
    antialias: true,
  });
  sheet.destroy({ children: true });
  const cut = (at: number): Texture => {
    const { x, y } = corner(at);
    return new pixi.Texture({
      source,
      frame: new pixi.Rectangle(x, y, TEXTURE_RADIUS * 2, TEXTURE_RADIUS * 2),
    });
  };

  return {
    disc: cut(disc),
    ring: cut(ring),
    dashed: cut(dashed),
    looks: new Map([...looks].map(([key, at]) => [key, cut(at)])),
  };
}

/** `dashes` of 0 strokes the ring whole; `duty` is the share of each dash's
 *  turn that is drawn. White is the sheet's, whose cells a mark tints. */
function strokeRing(
  into: Graphics,
  x: number,
  y: number,
  radius: number,
  width: number,
  dashes: number,
  duty = 0.5,
  ink: { color: number; alpha: number } = { color: 0xffffff, alpha: 1 },
): void {
  const style = { ...ink, width };
  if (dashes === 0) {
    into.circle(x, y, radius).stroke(style);
    return;
  }
  const turn = (Math.PI * 2) / dashes;
  for (let step = 0; step < dashes; step++) {
    const from = step * turn;
    into.arc(x, y, radius, from, from + turn * duty);
    into.stroke(style);
  }
}

/**
 * Where each dash of a connection falls, as distances along the line. The
 * segment count is capped for cost, and the SPACING absorbs the cap — so a long
 * edge draws longer dashes rather than stopping partway and leaving a line that
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

/**
 * Where each mark of a dotted line falls, as distances along it: one every
 * `step`, laid down for {@link LOOK_DOT_DUTY} of it. Capped for cost the way
 * {@link dashSegments} is, and the spacing absorbs the cap.
 */
export function dotSegments(
  length: number,
  step: number,
): { from: number; to: number }[] {
  if (length < 1) return [];
  const steps = Math.min(Math.ceil(length / step), MAX_DASHES);
  const period = length / steps;
  return Array.from({ length: steps }, (_unused, at) => ({
    from: at * period,
    to: at * period + period * LOOK_DOT_DUTY,
  }));
}

function brokenLine(
  graphics: Graphics,
  from: Point,
  to: Point,
  segments: readonly { from: number; to: number }[],
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  for (const segment of segments) {
    graphics.moveTo(from.x + ux * segment.from, from.y + uy * segment.from);
    graphics.lineTo(from.x + ux * segment.to, from.y + uy * segment.to);
  }
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
  brokenLine(
    graphics,
    { x: x1, y: y1 },
    { x: x2, y: y2 },
    dashSegments(length, dash),
  );
}

/** Where to centre a `width` × {@link LABEL_LINE} box of words so that the whole
 *  box stands {@link EDGE_LABEL_GAP} clear of the line through `from` and `to`,
 *  on the upper side of it: the box's own reach across the line is what the gap
 *  is measured from, so a steep line stands off its words as far as a flat one
 *  does. */
function beside(at: Point, from: Point, to: Point, width: number): Point {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (span === 0) return at;
  const nx = -(to.y - from.y) / span;
  const ny = (to.x - from.x) / span;
  const up = ny > 0 ? -1 : 1;
  const off =
    EDGE_LABEL_GAP +
    Math.abs(nx) * (width / 2) +
    Math.abs(ny) * (LABEL_LINE / 2);
  return { x: at.x + nx * up * off, y: at.y + ny * up * off };
}

/** How far a point lies off the segment between two others, which is what a tap
 *  on a line is measured by. */
function awayFromLine(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = dx * dx + dy * dy;
  const along =
    span === 0
      ? 0
      : clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / span, 0, 1);
  return Math.hypot(
    point.x - (from.x + dx * along),
    point.y - (from.y + dy * along),
  );
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[at];
}
