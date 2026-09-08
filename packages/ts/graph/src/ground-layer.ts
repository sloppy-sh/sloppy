// The two tiled fills that draw the ground: one for the lattice a reader keeps
// as they zoom out, one for the half-step marks that fade into it. `ground.ts`
// says where they fall; DESIGN.md § "The ground" is the doc of record.

import type {
  Application,
  Container,
  Graphics,
  Texture,
  TilingSprite,
} from "pixi.js";
import { MAX_DENSITY } from "./density.js";
import {
  CELL,
  type GraphGround,
  type GroundTiling,
  groundTiling,
  type Paper,
  STAMPS,
  stampScale,
} from "./ground.js";

type Pixi = typeof import("pixi.js");

/** Fixed at the most any canvas draws at rather than at this screen's, so a
 *  repeat lands on the same texel wherever it is drawn. */
const CELL_RESOLUTION = MAX_DENSITY;

const DOT_RADIUS = 1.1;
const RULE_WIDTH = 0.7;

/** One cut of the pattern: the lattice a reader keeps, and the half-step marks
 *  that fade into it. */
interface Cut {
  coarse: Texture;
  fine: Texture;
}

/** One quad each, and a frame writes nothing but their offset, their scale and
 *  two alphas. */
export class GroundLayer {
  readonly container: Container;
  private readonly coarse: TilingSprite;
  private readonly fine: TilingSprite;
  /** Every cut of a kind, taken together the first time a reader asks for that
   *  paper, so no frame is ever the one that pays for one. */
  private readonly held = new Map<Paper, Cut[]>();
  private cuts: Cut[] = [];
  private kind: GraphGround = "none";
  private stamp = -1;
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
    this.stamp = -1;
    this.container.visible = kind !== "none";
    if (kind === "none") return;
    const cuts = this.held.get(kind) ?? this.build(kind);
    this.held.set(kind, cuts);
    this.cuts = cuts;
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
    const kind = this.kind;
    if (kind === "none") return;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      for (const sprite of [this.coarse, this.fine]) {
        sprite.width = width;
        sprite.height = height;
      }
    }
    const at = groundTiling(viewport.x, viewport.y, viewport.scale, kind);
    if (same(at, this.drawn)) return;
    this.drawn = at;

    if (at.stamp !== this.stamp) {
      this.stamp = at.stamp;
      this.coarse.texture = this.cuts[at.stamp].coarse;
      this.fine.texture = this.cuts[at.stamp].fine;
    }
    for (const sprite of [this.coarse, this.fine]) {
      sprite.tilePosition.set(at.offsetX, at.offsetY);
      sprite.tileScale.set(at.mark, at.mark);
    }
    this.coarse.alpha = at.weight;
    this.fine.alpha = at.weight * at.fine;
  }

  /** The sprites go first, so nothing is left holding a freed texture. */
  destroy(): void {
    this.container.destroy({ children: true, texture: false });
    for (const cuts of this.held.values()) {
      for (const cut of cuts) {
        cut.coarse.destroy(true);
        cut.fine.destroy(true);
      }
    }
    this.held.clear();
    this.cuts = [];
  }

  private build(kind: Paper): Cut[] {
    return Array.from({ length: STAMPS }, (_unused, stamp) => {
      // Every cut draws the SAME mark and differs only in the cell around it, so
      // a fill is always laid down at about 1:1 and a cut can never change what
      // a mark weighs — only a cut whose marks were resized could.
      const cell = CELL * stampScale(stamp);
      const half = cell / 2;
      const at = cell / 4;
      const dot = (into: Graphics, x: number, y: number): Graphics =>
        into.circle(x, y, DOT_RADIUS).fill(0xffffff);
      const rules = (into: Graphics, from: number): Graphics =>
        into
          .moveTo(from, 0)
          .lineTo(from, cell)
          .moveTo(0, from)
          .lineTo(cell, from)
          .stroke({ color: 0xffffff, width: RULE_WIDTH });

      return kind === "dots"
        ? {
            coarse: this.cut(cell, (into) => dot(into, at, at)),
            fine: this.cut(cell, (into) => {
              dot(into, at + half, at);
              dot(into, at, at + half);
              dot(into, at + half, at + half);
            }),
          }
        : {
            coarse: this.cut(cell, (into) => rules(into, at)),
            fine: this.cut(cell, (into) => rules(into, at + half)),
          };
    });
  }

  /** Its own source, never a cell of a sheet: a tiled fill repeats the WHOLE
   *  texture, so a neighbour sharing the source would be sampled into it. */
  private cut(cell: number, draw: (into: Graphics) => void): Texture {
    const graphics = new this.pixi.Graphics();
    draw(graphics);
    const texture = this.app.renderer.generateTexture({
      target: graphics,
      frame: new this.pixi.Rectangle(0, 0, cell, cell),
      resolution: CELL_RESOLUTION,
      antialias: true,
    });
    graphics.destroy();
    return texture;
  }
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
