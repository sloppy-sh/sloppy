// Where a node starts before the simulation touches it.
//
// A seed is a pure function of the genealogy — what a note sprang out of, and
// where it falls among the notes written alongside it. AI.md § "The Genealogy
// Is the Protocol" is why: a subtree radiates the same way on every peer, and it
// can only do that if no coordinate is ever shipped and no label ever moves a
// mark. The force pass resolves the crowding around the shape that fixes.
//
// A peer that pulled a subtree without the notes above it draws it in the same
// shape rather than in the same place — where those sat is not something the
// subtree carries.

import { orderSiblings, type OwnedRef, refSector } from "@sloppy/types";

/** The widest the root ring gets; past it the force pass is what holds a
 *  crowded ring apart. */
const ROOT_RADIUS = 1400;
/** How far apart two notes stand on the root ring while it has room for them. */
const ROOT_SPACING = 300;
const STEP_FIRST = 300;
const STEP_DECAY = 0.8;
/** The widest a child may lean off its parent's outward direction. */
const SPREAD_FIRST = 1.15;
const SPREAD_DECAY = 0.66;
/**
 * How much of a child's lean comes from its place in the run rather than from
 * its ref. The run alone fans siblings in the order they were written; the ref
 * alone gives each subtree a direction of its own. Both travel with the note, so
 * both are kept.
 */
const FAN_WEIGHT = 0.7;
/** Saturates the ordinal fan, so 23 siblings still fit inside one spread. */
const FAN_SOFT = 3;

export interface SeedPoint {
  x: number;
  y: number;
  /** The direction this node's own children leave it in, in radians. */
  outward: number;
}

/**
 * A note as the seeding reads it. There is no address on it, and that is the
 * contract: a label a person writes, edits or takes off must not move a mark.
 */
export interface SeededNote {
  ref: OwnedRef;
  /** Absent, or naming a note the field does not hold, seeds on the root ring. */
  parent?: OwnedRef;
  created_at: string;
  /** Its generation, for a note whose parent is not here to count from. */
  depth: number;
}

/** Seed every note, by ref. */
export function seedField(
  notes: Iterable<SeededNote>,
): ReadonlyMap<OwnedRef, SeedPoint> {
  const held = [...notes];
  const byRef = new Map(held.map((note) => [note.ref, note]));
  const ordinals = runOrdinals(held, byRef);
  const radius = ringRadius(
    held.filter((note) => onTheRing(note, byRef)).length,
  );
  const placed = new Map<OwnedRef, Placed>();

  for (const note of held) place(note, byRef, ordinals, radius, placed);

  return new Map(
    [...placed].map(([ref, under]) => [ref, under.point] as const),
  );
}

/** A seed and the generation it was reached at, which is what the next one
 *  steps and leans off. */
interface Placed {
  point: SeedPoint;
  depth: number;
}

/** Nothing above it here: a branch, an independent note, or one whose parent
 *  this reader does not hold. */
function onTheRing(
  note: SeededNote,
  byRef: ReadonlyMap<OwnedRef, SeededNote>,
): boolean {
  return note.parent === undefined || !byRef.has(note.parent);
}

function place(
  note: SeededNote,
  byRef: ReadonlyMap<OwnedRef, SeededNote>,
  ordinals: ReadonlyMap<OwnedRef, number>,
  radius: number,
  placed: Map<OwnedRef, Placed>,
): Placed {
  // Walked rather than recursed: a chain as deep as the field is long would
  // otherwise be a stack the corpus size decides.
  const chain: SeededNote[] = [];
  const walking = new Set<OwnedRef>();
  for (
    let at: SeededNote | undefined = note;
    at !== undefined && !placed.has(at.ref) && !walking.has(at.ref);
    at = at.parent === undefined ? undefined : byRef.get(at.parent)
  ) {
    walking.add(at.ref);
    chain.push(at);
  }

  for (let at = chain.length - 1; at >= 0; at--) {
    const under = chain[at];
    const from =
      under.parent === undefined ? undefined : placed.get(under.parent);
    placed.set(
      under.ref,
      from === undefined
        ? { point: seedRing(refSector(under.ref), radius), depth: under.depth }
        : leanOff(from, under, ordinals.get(under.ref) ?? 1),
    );
  }

  return placed.get(note.ref) as Placed;
}

function leanOff(from: Placed, note: SeededNote, ordinal: number): Placed {
  const depth = from.depth + 1;
  const lean =
    spreadAt(depth) *
    (FAN_WEIGHT * fanOffset(ordinal) +
      (1 - FAN_WEIGHT) * signedUnit(refSector(note.ref)));
  const outward = from.point.outward + lean;
  const step = STEP_FIRST * STEP_DECAY ** (depth - 2);
  return {
    point: {
      x: from.point.x + Math.cos(outward) * step,
      y: from.point.y + Math.sin(outward) * step,
      outward,
    },
    depth,
  };
}

/**
 * Each note's place in the run it lies in, from 1. `orderSiblings` is handed the
 * notes without their labels, so what fans a run is the order it was written —
 * the half of that rule two peers cannot disagree about.
 */
function runOrdinals(
  held: readonly SeededNote[],
  byRef: ReadonlyMap<OwnedRef, SeededNote>,
): ReadonlyMap<OwnedRef, number> {
  const runs = new Map<OwnedRef, { ref: OwnedRef; created_at: string }[]>();
  for (const note of held) {
    if (note.parent === undefined || !byRef.has(note.parent)) continue;
    const member = { ref: note.ref, created_at: note.created_at };
    const run = runs.get(note.parent);
    if (run === undefined) runs.set(note.parent, [member]);
    else run.push(member);
  }

  const ordinals = new Map<OwnedRef, number>();
  for (const run of runs.values()) {
    orderSiblings(run).forEach((member, at) =>
      ordinals.set(member.ref, at + 1),
    );
  }
  return ordinals;
}

/** A ring only as wide as the number standing on it, so a field of a few
 *  branches opens whole on a phone. */
function ringRadius(standing: number): number {
  return Math.min(ROOT_RADIUS, (ROOT_SPACING * standing) / (2 * Math.PI));
}

function seedRing(outward: number, radius: number): SeedPoint {
  return {
    x: Math.cos(outward) * radius,
    y: Math.sin(outward) * radius,
    outward,
  };
}

function spreadAt(depth: number): number {
  return SPREAD_FIRST * SPREAD_DECAY ** (depth - 2);
}

/**
 * A sibling's place in its parent's fan, in `(-1, 1)`: the first on the centre
 * line, then alternating outward. Saturating rather than proportional, so a run
 * of 23 stays inside one spread.
 */
function fanOffset(ordinal: number): number {
  const k = ordinal - 1;
  const rank = Math.ceil(k / 2);
  const sign = k % 2 === 1 ? 1 : -1;
  return sign * (rank / (rank + FAN_SOFT));
}

/** A sector angle as a signed fraction of a half-turn, in `[-1, 1)`. */
function signedUnit(sector: number): number {
  return sector / Math.PI - 1;
}

/**
 * The box a field's seeds span — the two edges that decide where the next field
 * starts, and the top its name is written off.
 */
export interface SeedBox {
  minX: number;
  maxX: number;
  minY: number;
}

/** Where one graph's field sits on a canvas holding several. */
export interface FieldPlacement {
  /** Every seed in the field moves by this much along x. */
  dx: number;
  /** How far the placed field reaches, in world coordinates. */
  minX: number;
  maxX: number;
  /** Where the field's name is written, in world coordinates. */
  nameX: number;
  nameY: number;
}

/** How far one field stands off the next, in world units. Wide enough that the
 *  crowding the force pass resolves never carries a mark out of its own field. */
const FIELD_GUTTER = 900;
/** How far above its seeds a field's name is written. */
const FIELD_NAME_RISE = 320;

/** An empty box, for a graph on the canvas that has nothing in it yet. */
export function seedBox(seeds: Iterable<SeedPoint>): SeedBox {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const seed of seeds) {
    minX = Math.min(minX, seed.x);
    maxX = Math.max(maxX, seed.x);
    minY = Math.min(minY, seed.y);
  }
  return Number.isFinite(minX)
    ? { minX, maxX, minY }
    : { minX: 0, maxX: 0, minY: 0 };
}

/**
 * Several graphs on one canvas, each field beside the last in the order given.
 * The first does not move, so putting another graph up never shifts the one
 * being read. DESIGN.md § "Several graphs on one canvas".
 */
export function placeFields(boxes: readonly SeedBox[]): FieldPlacement[] {
  const placed: FieldPlacement[] = [];
  let cursor: number | null = null;
  for (const box of boxes) {
    const dx: number = cursor === null ? 0 : cursor + FIELD_GUTTER - box.minX;
    placed.push({
      dx,
      minX: box.minX + dx,
      maxX: box.maxX + dx,
      nameX: (box.minX + box.maxX) / 2 + dx,
      nameY: box.minY - FIELD_NAME_RISE,
    });
    cursor = box.maxX + dx;
  }
  return placed;
}
