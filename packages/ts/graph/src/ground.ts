// The ground the graph sits on. DESIGN.md § "The ground" is the doc of record:
// it is paper, not a feature, so it carries no hue and never a weight of its own.
//
// The lattice is pinned to the WORLD — a dot keeps the world point it sits on
// through a pan and a zoom — and its period doubles whenever it would otherwise
// draw closer together than {@link GROUND_MIN_STEP} on screen. Doubling leaves
// every surviving point where it was, because the coarser lattice is a subset of
// the finer one, and the half-step points fade out as they approach that bound
// rather than being dropped at it.

import type {
  Application,
  Container,
  Graphics,
  Texture,
  TilingSprite,
} from "pixi.js";

type Pixi = typeof import("pixi.js");

export const GRAPH_GROUNDS = ["none", "dots", "lines"] as const;
export type GraphGround = (typeof GRAPH_GROUNDS)[number];

/** Screen pixels the lattice never draws closer together than. Below it the
 *  world period doubles, which is what keeps a field of thousands of marks off
 *  a moiré ground. */
export const GROUND_MIN_STEP = 32;

/** The texture's cell, in CSS pixels: two lattice steps, so one cell carries the
 *  point the coarse lattice keeps and the three the fine one adds. */
const CELL = GROUND_MIN_STEP * 2;
/** Fixed rather than the screen's, so a cell is always 128 device pixels and a
 *  repeat lands on the same texel wherever it is drawn. */
const CELL_RESOLUTION = 2;

/** Where the fine lattice reaches full weight, as a share of the band above
 *  {@link GROUND_MIN_STEP}. */
const FINE_FADE = 0.6;

const DOT_RADIUS = 1.1;
const RULE_WIDTH = 0.7;

/** Ink's share. A dot covers a small fraction of what a rule does, so it takes
 *  more of it to read as the same weight of ground. */
const ALPHA: Record<Exclude<GraphGround, "none">, number> = {
  dots: 0.28,
  lines: 0.1,
};

export interface GroundTiling {
  /** The cell's side on screen, in CSS pixels: two lattice steps. */
  cell: number;
  /** Where the cell holding the world origin starts on screen. */
  offsetX: number;
  offsetY: number;
  /** How much of the half-step lattice is drawn, 0 to 1. */
  fine: number;
}

/**
 * Where the lattice falls for a viewport, in screen coordinates. `cell` stays
 * within [2, 4) × {@link GROUND_MIN_STEP} at every scale, which is the whole of
 * the aliasing guarantee.
 */
export function groundTiling(
  x: number,
  y: number,
  scale: number,
): GroundTiling {
  const step = 2 ** Math.ceil(Math.log2(GROUND_MIN_STEP / scale)) * scale;
  const cell = step * 2;
  const share = Math.min(
    1,
    Math.max(0, (step / GROUND_MIN_STEP - 1) / FINE_FADE),
  );
  return {
    cell,
    offsetX: wrap(x - cell / 4, cell),
    offsetY: wrap(y - cell / 4, cell),
    fine: share * share * (3 - 2 * share),
  };
}

function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

function same(at: GroundTiling, last: GroundTiling | null): boolean {
  return (
    last !== null &&
    at.cell === last.cell &&
    at.offsetX === last.offsetX &&
    at.offsetY === last.offsetY &&
    at.fine === last.fine
  );
}

/**
 * The two tiled fills that draw it: the lattice a reader keeps as they zoom out,
 * and the half-step marks that fade into it. One quad each, and a frame writes
 * nothing but their offset, their scale and one alpha.
 */
export class GroundLayer {
  readonly container: Container;
  private readonly coarse: TilingSprite;
  private readonly fine: TilingSprite;
  private readonly textures = new Map<
    GraphGround,
    { coarse: Texture; fine: Texture }
  >();
  private kind: GraphGround = "none";
  private width = 0;
  private height = 0;
  private drawn: GroundTiling | null = null;

  constructor(
    private readonly pixi: Pixi,
    private readonly app: Application,
  ) {
    const sprite = (): TilingSprite =>
      new pixi.TilingSprite({
        texture: pixi.Texture.WHITE,
        width: 1,
        height: 1,
      });
    this.coarse = sprite();
    this.fine = sprite();
    this.container = new pixi.Container();
    this.container.eventMode = "none";
    this.container.visible = false;
    this.container.addChild(this.coarse, this.fine);
  }

  setGround(kind: GraphGround): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.drawn = null;
    this.container.visible = kind !== "none";
    if (kind === "none") return;
    const held = this.textures.get(kind) ?? this.build(kind);
    this.coarse.texture = held.coarse;
    this.fine.texture = held.fine;
    this.coarse.alpha = ALPHA[kind];
  }

  setInk(ink: number): void {
    this.coarse.tint = ink;
    this.fine.tint = ink;
  }

  /** Meant for every frame: a viewport that has not moved writes nothing, and
   *  writing a tile transform is what a frame would otherwise pay for. */
  update(
    viewport: { x: number; y: number; scale: number },
    width: number,
    height: number,
  ): void {
    if (this.kind === "none") return;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      for (const sprite of [this.coarse, this.fine]) {
        sprite.width = width;
        sprite.height = height;
      }
    }
    const at = groundTiling(viewport.x, viewport.y, viewport.scale);
    if (same(at, this.drawn)) return;
    this.drawn = at;

    const scale = at.cell / CELL;
    for (const sprite of [this.coarse, this.fine]) {
      sprite.tilePosition.set(at.offsetX, at.offsetY);
      sprite.tileScale.set(scale, scale);
    }
    this.fine.alpha = ALPHA[this.kind] * at.fine;
  }

  /** The sprites go first, so nothing is left holding a freed texture. */
  destroy(): void {
    this.container.destroy({ children: true, texture: false });
    for (const held of this.textures.values()) {
      held.coarse.destroy(true);
      held.fine.destroy(true);
    }
    this.textures.clear();
  }

  private build(kind: GraphGround): { coarse: Texture; fine: Texture } {
    const half = CELL / 2;
    const at = CELL / 4;
    const dot = (into: Graphics, x: number, y: number): Graphics =>
      into.circle(x, y, DOT_RADIUS).fill(0xffffff);
    const rules = (into: Graphics, from: number): Graphics =>
      into
        .moveTo(from, 0)
        .lineTo(from, CELL)
        .moveTo(0, from)
        .lineTo(CELL, from)
        .stroke({ color: 0xffffff, width: RULE_WIDTH });

    const held =
      kind === "dots"
        ? {
            coarse: this.cut((into) => dot(into, at, at)),
            fine: this.cut((into) => {
              dot(into, at + half, at);
              dot(into, at, at + half);
              dot(into, at + half, at + half);
            }),
          }
        : {
            coarse: this.cut((into) => rules(into, at)),
            fine: this.cut((into) => rules(into, at + half)),
          };
    this.textures.set(kind, held);
    return held;
  }

  /** Its own source, never a cell of a sheet: a tiled fill repeats the WHOLE
   *  texture, so a neighbour sharing the source would be sampled into it. */
  private cut(draw: (into: Graphics) => void): Texture {
    const graphics = new this.pixi.Graphics();
    draw(graphics);
    const texture = this.app.renderer.generateTexture({
      target: graphics,
      frame: new this.pixi.Rectangle(0, 0, CELL, CELL),
      resolution: CELL_RESOLUTION,
      antialias: true,
    });
    graphics.destroy();
    return texture;
  }
}
