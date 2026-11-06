// The second half of a sets figure's fit: the discs the pairs placed, walked
// down the error in every combination the notes carry, each allowed to move,
// turn and be drawn out into an ellipse of the same area. DESIGN.md § "Sets —
// the tags as places" is the doc of record.
//
// Nothing here reads a clock or a random number: the search is a fixed budget
// of steps in a fixed order, each taken only where it lowers the error.

import { gaugeOf, type SetsOutline, shapeBounds } from "./shape.js";

/** What the refinement is asked to honour, in the figure's own units. */
export interface RefineAsk {
  /** Notes carrying both of a pair, at `a * count + b`. */
  shared: readonly number[];
  /** Notes carrying exactly each combination, as `[mask, notes]`. */
  exact: readonly (readonly [number, number])[];
  /** One note's share of the paper, in square world units. */
  unit: number;
  /** The paper one mark stands on at the lattice's floor, in square world
   *  units. */
  cell: number;
  /** How far inside a place a mark's centre stands, in world units. */
  reach: number;
  /** How far apart two shapes stand for their lens to be what they share, at
   *  `a * count + b`: where each is tried when it is stood again. */
  apart: readonly number[];
}

/** The grid, per side, every combination's area and room is measured on. */
const GRID = 48;

/** How many times the search halves its steps, and how many passes over every
 *  shape it takes at each before halving. */
const LEVELS = 6;
const PASSES = 4;

/** How many of the first levels also try standing each shape somewhere else
 *  altogether, and how many ways round each other shape it is tried. */
const RELOCATING_LEVELS = 2;
const RELOCATING_TURNS = 12;

/** The most a shape is drawn out of round, as its `stretch`: its long
 *  half-axis over its short is the square of this. */
const STRETCH_MOST = 2;

/** What drawing a shape out of round costs, in notes squared per squared log
 *  of the half-axis ratio: a disc is kept wherever stretching buys less. */
const STRETCH_COST = 2;

/** How much more a combination standing short of its notes' share costs than
 *  one standing over it. */
const SHORT_WEIGHT = 4;

/** What each note a combination has no room for costs, squared: a note with no
 *  room in its own place stands in a place of a set it does not carry. */
const ROOM_WEIGHT = 2;

/** What each note with no room in any place inside every set it carries
 *  costs, squared: a note standing outside a set it carries. */
const HOMELESS_WEIGHT = 20;

/** What a combination some note carries costs where the figure leaves no room
 *  in it at all, in notes squared. */
const MISSING_COST = 16;

/** How much wider than the discs it starts from a figure may be drawn, so the
 *  areas are never bought with paper a reader has to zoom out for. */
const SPAN_MOST = 1.15;

/** What each world unit past that costs, and what a pair sharing notes drawn
 *  apart costs: no figure that does either is ever the cheaper. */
const SPAN_PAST_COST = 1e4;
const APART_COST = 1e6;

/** Where a grid point stands against one shape. */
const INSIDE = 1;
const RIM = 2;

/** The shapes refined against the ask, how many notes they leave without room
 *  in a place of every set they carry, and what they still cost. Fewer than
 *  two have nothing to honour. */
export function refine(
  start: readonly SetsOutline[],
  ask: RefineAsk,
): { shapes: SetsOutline[]; homeless: number; cost: number } {
  if (start.length < 2) return { shapes: [...start], homeless: 0, cost: 0 };
  const search = new Search(start, ask);
  const shapes = search.run();
  search.lay();
  return {
    shapes,
    homeless: search.homeless(),
    cost: search.costOf(search.area, search.deep, shapes),
  };
}

/** How many notes the shapes as they stand leave without room in a place of
 *  every set they carry. */
export function homelessIn(
  shapes: readonly SetsOutline[],
  ask: RefineAsk,
): number {
  if (shapes.length < 2) return 0;
  const search = new Search(shapes, ask);
  search.lay();
  return search.homeless();
}

class Search {
  readonly count: number;
  readonly masks: number;
  readonly want: Float64Array;
  /** For each combination some note carries, every place inside all its sets. */
  readonly within: number[][];
  readonly pairs: number[] = [];
  readonly shapes: SetsOutline[];
  readonly spanMost: number;
  readonly xs = new Float64Array(GRID * GRID);
  readonly ys = new Float64Array(GRID * GRID);
  /** Each point's standing against each shape, `INSIDE | RIM`. */
  readonly status: Uint8Array;
  readonly held = new Int32Array(GRID * GRID);
  readonly rims = new Uint8Array(GRID * GRID);
  readonly area: Float64Array;
  readonly deep: Float64Array;
  /** One grid cell, in notes' shares and in marks' room. */
  inNotes = 0;
  inMarks = 0;
  /** Where the grid starts and how far apart its points stand. */
  fromX = 0;
  fromY = 0;
  stepX = 1;
  stepY = 1;

  constructor(
    start: readonly SetsOutline[],
    readonly ask: RefineAsk,
  ) {
    this.count = start.length;
    this.masks = 1 << this.count;
    this.want = new Float64Array(this.masks);
    for (const [mask, notes] of ask.exact) {
      if (mask > 0 && mask < this.masks) this.want[mask] = notes;
    }
    this.within = Array.from({ length: this.masks }, (_unused, mask) => {
      if (this.want[mask] <= 0) return [];
      const places: number[] = [];
      for (let place = mask; place < this.masks; place++) {
        if ((place & mask) === mask) places.push(place);
      }
      return places;
    });
    for (let a = 0; a < this.count; a++) {
      for (let b = a + 1; b < this.count; b++) {
        if ((ask.shared[a * this.count + b] ?? 0) > 0) {
          this.pairs.push((1 << a) | (1 << b));
        }
      }
    }
    this.shapes = start.map((shape) => ({ ...shape }));
    this.spanMost = SPAN_MOST * spanOf(this.shapes);
    this.status = new Uint8Array(GRID * GRID * this.count);
    this.area = new Float64Array(this.masks);
    this.deep = new Float64Array(this.masks);
  }

  run(): SetsOutline[] {
    const mean =
      this.shapes.reduce((sum, shape) => sum + shape.r, 0) / this.count;
    let move = mean / 2;
    let spin = Math.PI / 6;
    let draw = Math.log(1.5);
    for (let level = 0; level < LEVELS; level++) {
      if (level < RELOCATING_LEVELS) this.relocate();
      for (let pass = 0; pass < PASSES; pass++) {
        if (!this.pass(move, spin, draw)) break;
      }
      move /= 2;
      spin /= 2;
      draw /= 2;
    }
    return this.shapes;
  }

  /** Each shape lifted and stood again wherever that lowers the error most. */
  relocate(): void {
    this.lay();
    let cost = this.costOf(this.area, this.deep, this.shapes);
    for (let which = 0; which < this.count; which++) {
      let best: SetsOutline | null = null;
      for (const tried of this.relocations(which)) {
        const after = this.tryOn(which, tried);
        if (after < cost - 1e-9) {
          cost = after;
          best = tried;
        }
      }
      if (best !== null) this.take(which, best);
    }
  }

  /** One pass of the compass over every shape; whether anything moved. */
  pass(move: number, spin: number, draw: number): boolean {
    this.lay();
    let cost = this.costOf(this.area, this.deep, this.shapes);
    let moved = false;
    for (let which = 0; which < this.count; which++) {
      for (const tried of nudges(this.shapes[which], move, spin, draw)) {
        const after = this.tryOn(which, tried);
        if (after < cost - 1e-9) {
          this.take(which, tried);
          cost = after;
          moved = true;
        }
      }
    }
    return moved;
  }

  /** The shapes `which` shares notes with. */
  partnersOf(which: number): number[] {
    const found: number[] = [];
    for (let other = 0; other < this.count; other++) {
      if (other === which) continue;
      if ((this.ask.shared[which * this.count + other] ?? 0) > 0) {
        found.push(other);
      }
    }
    return found;
  }

  /** Where shape `which` is tried when it is lifted and stood again: round
   *  each shape it shares notes with — or round every other, where it shares
   *  with none — at the distance their shared count asks for. */
  relocations(which: number): SetsOutline[] {
    const tries: SetsOutline[] = [];
    const partners = this.partnersOf(which);
    for (let other = 0; other < this.count; other++) {
      if (other === which) continue;
      if (partners.length > 0 && !partners.includes(other)) continue;
      const reach = this.ask.apart[which * this.count + other];
      for (let turn = 0; turn < RELOCATING_TURNS; turn++) {
        const angle = (turn / RELOCATING_TURNS) * Math.PI * 2;
        const at = {
          ...this.shapes[which],
          cx: this.shapes[other].cx + reach * Math.cos(angle),
          cy: this.shapes[other].cy + reach * Math.sin(angle),
        };
        tries.push(at);
        // Drawn out towards the shape it is stood against, which reaches into
        // it without crossing the ones beside it.
        tries.push({ ...at, turn: angle, stretch: Math.max(at.stretch, 1.4) });
      }
    }
    return tries;
  }

  /** The grid laid over the figure as it stands, and every point measured. */
  lay(): void {
    const reach = this.shapes.map(shapeBounds);
    const margin =
      Math.max(...this.shapes.map((shape) => shape.r)) * 0.1 + this.ask.reach;
    const minX = Math.min(...reach.map((at) => at.minX)) - margin;
    const maxX = Math.max(...reach.map((at) => at.maxX)) + margin;
    const minY = Math.min(...reach.map((at) => at.minY)) - margin;
    const maxY = Math.max(...reach.map((at) => at.maxY)) + margin;
    const stepX = (maxX - minX) / GRID;
    const stepY = (maxY - minY) / GRID;
    this.fromX = minX;
    this.fromY = minY;
    this.stepX = stepX;
    this.stepY = stepY;
    this.inNotes = (stepX * stepY) / this.ask.unit;
    this.inMarks = (stepX * stepY) / this.ask.cell;
    this.area.fill(0);
    this.deep.fill(0);
    const gauges = this.shapes.map(gaugeOf);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const at = gy * GRID + gx;
        this.xs[at] = minX + (gx + 0.5) * stepX;
        this.ys[at] = minY + (gy + 0.5) * stepY;
        let mask = 0;
        let rims = 0;
        for (let bit = 0; bit < this.count; bit++) {
          const standing = this.standingOf(gauges[bit], at);
          this.status[at * this.count + bit] = standing;
          if (standing & INSIDE) mask |= 1 << bit;
          if (standing & RIM) rims += 1;
        }
        this.held[at] = mask;
        this.rims[at] = rims;
        this.area[mask] += 1;
        if (rims === 0) this.deep[mask] += 1;
      }
    }
  }

  standingOf(gauge: (x: number, y: number) => number, at: number): number {
    const gap = gauge(this.xs[at], this.ys[at]);
    return (gap <= 0 ? INSIDE : 0) | (Math.abs(gap) < this.ask.reach ? RIM : 0);
  }

  /** The cost of the figure with shape `which` drawn as `moved` instead. */
  tryOn(which: number, moved: SetsOutline): number {
    const area = Float64Array.from(this.area);
    const deep = Float64Array.from(this.deep);
    this.walk(which, moved, area, deep, false);
    return this.costOf(
      area,
      deep,
      this.shapes.map((shape, at) => (at === which ? moved : shape)),
    );
  }

  take(which: number, moved: SetsOutline): void {
    this.walk(which, moved, this.area, this.deep, true);
    this.shapes[which] = moved;
  }

  /** Every point whose standing against shape `which` changes when it is drawn
   *  as `moved`, counted out of one place and into another. */
  walk(
    which: number,
    moved: SetsOutline,
    area: Float64Array,
    deep: Float64Array,
    keep: boolean,
  ): void {
    const bit = 1 << which;
    const gauge = gaugeOf(moved);
    // A point clear of both outlines by more than the reach stands outside
    // either way, so only the box round the two is walked.
    const was = shapeBounds(this.shapes[which]);
    const now = shapeBounds(moved);
    const reach = this.ask.reach + Math.max(this.stepX, this.stepY);
    const cols = this.span(
      Math.min(was.minX, now.minX) - reach,
      Math.max(was.maxX, now.maxX) + reach,
      this.fromX,
      this.stepX,
    );
    const rows = this.span(
      Math.min(was.minY, now.minY) - reach,
      Math.max(was.maxY, now.maxY) + reach,
      this.fromY,
      this.stepY,
    );
    for (let gy = rows[0]; gy < rows[1]; gy++) {
      for (let gx = cols[0]; gx < cols[1]; gx++) {
        this.shift(gy * GRID + gx, which, bit, gauge, area, deep, keep);
      }
    }
  }

  /** The run of grid indices between two coordinates. */
  span(
    from: number,
    to: number,
    start: number,
    step: number,
  ): [number, number] {
    return [
      Math.max(0, Math.floor((from - start) / step)),
      Math.min(GRID, Math.ceil((to - start) / step) + 1),
    ];
  }

  shift(
    at: number,
    which: number,
    bit: number,
    gauge: (x: number, y: number) => number,
    area: Float64Array,
    deep: Float64Array,
    keep: boolean,
  ): void {
    const slot = at * this.count + which;
    const was = this.status[slot];
    const now = this.standingOf(gauge, at);
    if (was === now) return;
    const mask = this.held[at];
    const rims = this.rims[at];
    const nextMask = now & INSIDE ? mask | bit : mask & ~bit;
    const nextRims = rims - (was & RIM ? 1 : 0) + (now & RIM ? 1 : 0);
    area[mask] -= 1;
    area[nextMask] += 1;
    if (rims === 0) deep[mask] -= 1;
    if (nextRims === 0) deep[nextMask] += 1;
    if (keep) {
      this.status[slot] = now;
      this.held[at] = nextMask;
      this.rims[at] = nextRims;
    }
  }

  /** How many notes have no room in any place inside every set they carry,
   *  each combination counted as if it had those places to itself. */
  homeless(): number {
    let short = 0;
    for (let mask = 1; mask < this.masks; mask++) {
      if (this.want[mask] <= 0) continue;
      let room = 0;
      for (const place of this.within[mask]) room += this.deep[place];
      short += Math.max(0, this.want[mask] - Math.floor(room * this.inMarks));
    }
    return short;
  }

  costOf(
    area: Float64Array,
    deep: Float64Array,
    drawn: readonly SetsOutline[],
  ): number {
    let sum = 0;
    for (let mask = 1; mask < this.masks; mask++) {
      const want = this.want[mask];
      const off = area[mask] * this.inNotes - want;
      sum += off * off * (off < 0 ? SHORT_WEIGHT : 1);
      if (want <= 0) continue;
      const short = want - deep[mask] * this.inMarks;
      if (short > 0) sum += ROOM_WEIGHT * short * short;
      if (deep[mask] === 0) sum += MISSING_COST;
      let room = 0;
      for (const place of this.within[mask]) room += deep[place];
      const homeless = want - room * this.inMarks;
      if (homeless > 0) sum += HOMELESS_WEIGHT * homeless * homeless;
    }
    for (const pair of this.pairs) {
      let met = false;
      for (let mask = pair; mask < this.masks && !met; mask++) {
        met = (mask & pair) === pair && area[mask] > 0;
      }
      if (!met) sum += APART_COST;
    }
    for (const shape of drawn) {
      const log = Math.log(shape.stretch);
      sum += STRETCH_COST * log * log;
    }
    const past = spanOf(drawn) - this.spanMost;
    return sum + (past > 0 ? SPAN_PAST_COST * past : 0);
  }
}

/** The wider side of the box round a run of shapes. */
function spanOf(shapes: readonly SetsOutline[]): number {
  const reach = shapes.map(shapeBounds);
  return Math.max(
    Math.max(...reach.map((at) => at.maxX)) -
      Math.min(...reach.map((at) => at.minX)),
    Math.max(...reach.map((at) => at.maxY)) -
      Math.min(...reach.map((at) => at.minY)),
  );
}

/** Every step the compass tries from one shape, in a fixed order: along each
 *  axis, then drawn out and back, then turned where it is not round. */
function nudges(
  shape: SetsOutline,
  move: number,
  spin: number,
  draw: number,
): SetsOutline[] {
  const tries: SetsOutline[] = [
    { ...shape, cx: shape.cx + move },
    { ...shape, cx: shape.cx - move },
    { ...shape, cy: shape.cy + move },
    { ...shape, cy: shape.cy - move },
  ];
  const log = Math.log(shape.stretch);
  for (const by of [draw, -draw]) {
    const next = Math.min(Math.max(log + by, 0), Math.log(STRETCH_MOST));
    if (next !== log) tries.push({ ...shape, stretch: Math.exp(next) });
  }
  if (shape.stretch > 1 + 1e-9) {
    tries.push({ ...shape, turn: shape.turn + spin });
    tries.push({ ...shape, turn: shape.turn - spin });
  }
  return tries;
}
