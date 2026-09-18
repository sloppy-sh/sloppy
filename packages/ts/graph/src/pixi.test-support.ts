// Pixi, stood in for. What the scene draws is a GPU fact and `bench/` is where
// it is measured; these record what it ASKED to have drawn, so a suite can hold
// the bookkeeping around the GPU without one.

/** What a texture is cut from. Several cuts of one sheet share one of these,
 *  and freeing the sheet is freeing this. */
export class FakeSource {
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }
}

export class FakeTexture {
  destroyed = false;
  readonly source: FakeSource;
  constructor(readonly of: unknown) {
    this.source =
      (of as { source?: FakeSource } | null)?.source ?? new FakeSource();
  }
  destroy(): void {
    this.destroyed = true;
  }
  static from(source: unknown): FakeTexture {
    return new FakeTexture(source);
  }
  static WHITE = new FakeTexture("white");
}

export class FakeContainer {
  readonly children: FakeContainer[] = [];
  eventMode = "auto";
  x = 0;
  y = 0;
  readonly position = {
    set: (x: number, y: number) => {
      this.x = x;
      this.y = y;
    },
  };
  readonly scale = { set: () => {} };
  addChild(...kids: FakeContainer[]): void {
    this.children.push(...kids);
  }
  addChildAt(kid: FakeContainer, at: number): void {
    this.children.splice(at, 0, kid);
  }
  removeChild(kid: FakeContainer): void {
    const at = this.children.indexOf(kid);
    if (at >= 0) this.children.splice(at, 1);
  }
  removeChildren(): FakeContainer[] {
    return this.children.splice(0);
  }
  destroy(): void {}
}

/** One `circle(…).stroke(…)`, which is how a lift and an orbit are drawn. */
export interface StrokedRing {
  x: number;
  y: number;
  radius: number;
  width: number;
  color: number;
  alpha: number;
}

/** One `circle(…).fill(…)`, which is how a mark too big for the sheet is drawn. */
export interface FilledDisc {
  x: number;
  y: number;
  radius: number;
  color: number;
  alpha: number;
}

/** One `moveTo(…).lineTo(…)`, which is how an edge is drawn — and how each dash
 *  of a broken one is. The style is the pass's, filled in when it is stroked. */
export interface StrokedLine {
  from: [number, number];
  to: [number, number];
  width: number;
  color: number;
  alpha: number;
}

export class FakeGraphics extends FakeContainer {
  readonly rings: StrokedRing[] = [];
  readonly discs: FilledDisc[] = [];
  readonly lines: StrokedLine[] = [];
  /** Where each `arc(…)` was struck, which is how a broken ring is drawn. */
  readonly arcs: { x: number; y: number; radius: number }[] = [];
  private pending: { x: number; y: number; radius: number } | null = null;
  private pen: [number, number] | null = null;
  private unstroked: StrokedLine[] = [];
  clear(): this {
    this.rings.length = 0;
    this.discs.length = 0;
    this.lines.length = 0;
    this.arcs.length = 0;
    this.pending = null;
    this.pen = null;
    this.unstroked = [];
    return this;
  }
  circle(x = 0, y = 0, radius = 0): this {
    this.pending = { x, y, radius };
    return this;
  }
  arc(x = 0, y = 0, radius = 0): this {
    this.arcs.push({ x, y, radius });
    this.pending = null;
    return this;
  }
  fill(style?: number | { color?: number; alpha?: number }): this {
    if (this.pending) {
      const ink = typeof style === "number" ? { color: style } : style;
      this.discs.push({
        ...this.pending,
        color: ink?.color ?? 0,
        alpha: ink?.alpha ?? 1,
      });
      this.pending = null;
    }
    return this;
  }
  stroke(style?: { color?: number; alpha?: number; width?: number }): this {
    const drawn = {
      color: style?.color ?? 0,
      alpha: style?.alpha ?? 1,
      width: style?.width ?? 1,
    };
    if (this.pending) {
      this.rings.push({ ...this.pending, ...drawn });
      this.pending = null;
    }
    for (const line of this.unstroked) Object.assign(line, drawn);
    this.unstroked = [];
    return this;
  }
  moveTo(x = 0, y = 0): this {
    this.pen = [x, y];
    return this;
  }
  lineTo(x = 0, y = 0): this {
    if (this.pen !== null) {
      const line: StrokedLine = {
        from: this.pen,
        to: [x, y],
        width: 1,
        color: 0,
        alpha: 1,
      };
      this.lines.push(line);
      this.unstroked.push(line);
    }
    this.pen = [x, y];
    return this;
  }
}

export class FakeParticleContainer extends FakeContainer {
  readonly particleChildren: unknown[] = [];
  texture: FakeTexture | undefined;
  update(): void {}
}

export class FakeParticle {
  texture: FakeTexture | undefined;
  tint = 0;
  alpha = 1;
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  constructor(options: Record<string, unknown>) {
    Object.assign(this, options);
  }
}

export class FakeSprite extends FakeContainer {
  width = 0;
  height = 0;
  alpha = 1;
  visible = true;
  destroyed = false;
  readonly anchor = { set: () => {} };
  constructor(public texture: FakeTexture) {
    super();
  }
  override destroy(): void {
    this.destroyed = true;
  }
}

export class FakeTilingSprite extends FakeContainer {
  width = 0;
  height = 0;
  alpha = 1;
  tint = 0;
  texture: FakeTexture;
  readonly tilePosition = { set: () => {} };
  readonly tileScale = { set: () => {} };
  constructor(options: { texture: FakeTexture }) {
    super();
    this.texture = options.texture;
  }
}

/** A face 7 CSS pixels to the character, so what a layout holds clear of these
 *  words is held clear of a box that grows with them. */
const FAKE_GLYPH = 7;

export class FakeText extends FakeContainer {
  text = "";
  visible = false;
  tint = 0;
  alpha = 1;
  resolution = 1;
  readonly anchor = { set: () => {} };
  constructor(options: { text: string; resolution?: number }) {
    super();
    this.text = options.text;
    this.resolution = options.resolution ?? 1;
  }
  get width(): number {
    return this.text.length * FAKE_GLYPH;
  }
}

export class FakeApplication {
  static latest: FakeApplication | null = null;
  readonly stage = new FakeContainer();
  readonly frames = new Set<() => void>();
  readonly ticker = {
    deltaMS: 16,
    add: (fn: () => void) => this.frames.add(fn),
    remove: (fn: () => void) => this.frames.delete(fn),
  };
  /** What each texture generated off the renderer was rasterised at, so a suite
   *  can hold what the marks and the ground were cut for. */
  readonly cut: number[] = [];
  readonly renderer = {
    screen: { width: 390, height: 740 },
    resolution: 1,
    generateTexture: (options: { resolution: number }) => {
      this.cut.push(options.resolution);
      return new FakeTexture({ source: new FakeSource() });
    },
  };
  constructor() {
    FakeApplication.latest = this;
  }
  async init(): Promise<void> {}
  destroy(): void {}
  tick(): void {
    for (const frame of this.frames) frame();
  }
}

/** The module a `vi.mock("pixi.js", …)` factory hands back. */
export function fakePixi() {
  return {
    Application: FakeApplication,
    Container: FakeContainer,
    Graphics: FakeGraphics,
    ParticleContainer: FakeParticleContainer,
    Particle: FakeParticle,
    Sprite: FakeSprite,
    TilingSprite: FakeTilingSprite,
    Text: FakeText,
    Texture: FakeTexture,
    Rectangle: class {},
  };
}

/** The layer the world draws marks on, of the three the stage holds. */
export function worldOf(app: FakeApplication): FakeContainer {
  const world = app.stage.children.find((child) =>
    child.children.some((kid) => kid instanceof FakeParticleContainer),
  );
  if (!world) throw new Error("The stage has no world on it");
  return world;
}
