// Which region a note stands in, and where inside it its mark is drawn.
// DESIGN.md § "Sets — the tags as places" is the doc of record.
//
// Everything here is a function of the notes, the drawn tags and the zoom, so
// two devices reading the same selection stand the same marks in the same
// places. Nothing is persisted and nothing is written: a move between sets is
// reported ({@link retagInto}) and the host saves it.

import {
  type Address,
  type OwnedRef,
  orderSiblings,
  type Tag,
  type TagHueSlot,
} from "@sloppy/types";
import { drawnSetSlots, drawnSetsOf, type GraphRetag } from "../contract.js";
import type { Bounds, Point } from "../viewport.js";
import {
  boxGap,
  inBox,
  inShape,
  namePoint,
  nameRoom,
  regionAt,
  type SetsAsk,
  type SetsDiagram,
  SETS_FIGURE_WIDEST,
  type SetsRegion,
  SETS_STEP,
  type SetsShape,
  setsFigure,
} from "./geometry.js";

// The lattice step is a fact about the widest mark, and the unit of area the
// figure is sized in is chosen against it — `geometry.ts` holds both.
export { SETS_STEP } from "./geometry.js";

/** A note as the packing reads it. */
export interface SetsNote {
  ref: OwnedRef;
  /** The graph this note is in, which is the field its diagram is drawn in. */
  graph: OwnedRef;
  /** Every tag the MARK stands for, which on a fold is the region's. */
  tags: readonly Tag[];
  /** Absent is a note its author gave no address. */
  address?: Address;
  created_at: string;
}

/** One drawn set: the shape, the tag it stands for and the hue it borrows. */
export interface SetsSetDrawn {
  shape: SetsShape;
  tag: Tag;
  slot: TagHueSlot;
  /** Which of {@link SetsDrawn.tags} this set draws: bit `1 << bit` of every
   *  region mask. A field draws only the drawn tags its own notes carry, so
   *  these are a run of the canvas's list rather than all of it. */
  bit: number;
  /** Where the tag's name is written, in diagram coordinates. */
  nameAt: Point;
}

/**
 * One graph's diagram and where it stands on the canvas. The shapes and the
 * regions are in DIAGRAM coordinates — this field's own figure, drawn at the
 * size its count of notes asks for — and `dx`/`dy` is where it sits. Every
 * region mask is over {@link SetsDrawn.tags}, the canvas's own list, so two
 * fields drawing different sets still read their regions the same way.
 */
export interface SetsFieldDrawn {
  ref: OwnedRef;
  dx: number;
  dy: number;
  sets: readonly SetsSetDrawn[];
  regions: readonly SetsRegion[];
  box: Bounds;
}

/** Where one mark stands: which field's diagram, and which region of it. */
export interface SetsStanding {
  field: number;
  region: number;
}

export interface SetsDrawn {
  /** The drawn tags, in drawing order: index `i` is bit `1 << i`. Empty is a
   *  canvas whose notes carry no tag at all, where every note stands outside. */
  tags: readonly Tag[];
  fields: readonly SetsFieldDrawn[];
  /** Where every note stands, the ones behind a fold included: a fold stands
   *  its whole region, so each of them stands where the fold does. */
  standing: ReadonlyMap<OwnedRef, SetsStanding>;
  /** The marks standing for a whole region rather than for one note, each with
   *  everyone standing in that region — the note whose ref names the mark
   *  included, which is what choosing one chooses. */
  folds: ReadonlyMap<OwnedRef, readonly OwnedRef[]>;
}

/** One mark the packing placed, in world coordinates. */
export interface SetsMark {
  ref: OwnedRef;
  x: number;
  y: number;
  field: number;
  region: number;
  /** The other notes of the region this mark answers for: empty on one note's
   *  own mark, and every one of them on a fold. */
  holds: readonly OwnedRef[];
}

/** How far inside its region a mark's centre stands: the widest a leaf mark is
 *  drawn, so the whole disc is in the one set and no mark reads as standing in
 *  two. */
const SETS_MARK_REACH = SETS_STEP / 2;

/** The least two marks stand apart on SCREEN, in CSS pixels. */
const SETS_SCREEN_STEP = 14;

/**
 * The half-octave the spacing is quantised to at a zoom of `scale`. A pinch
 * crosses one now and then rather than repacking every frame — the way
 * `markSheetTier` tiers the mark sheet.
 */
export function setsSpacingTier(scale: number): number {
  const wanted = Math.max(SETS_STEP, SETS_SCREEN_STEP / Math.max(scale, 1e-6));
  return Math.max(0, Math.ceil(Math.log2(wanted / SETS_STEP) * 2));
}

/** How far apart the lattice stands its marks at a zoom of `scale`. */
export function setsSpacing(scale: number): number {
  return SETS_STEP * 2 ** (setsSpacingTier(scale) / 2);
}

/** What a zoom is multiplied by to cross exactly one {@link setsSpacingTier} —
 *  one step more room in every region. */
export const SETS_TIER_ZOOM = Math.SQRT2;

/** The region a note stands in, as a bitmask over `drawn`. */
export function membershipOf(
  tags: readonly Tag[],
  drawn: readonly Tag[],
): number {
  const carried = new Set(tags);
  let mask = 0;
  for (const [bit, tag] of drawn.entries()) {
    if (carried.has(tag)) mask |= 1 << bit;
  }
  return mask;
}

/**
 * Where a membership stands when the figure draws no place for that exact
 * combination of sets: inside its LEADING set — the first of the ones it
 * carries in drawing order, which is the first the reader selected — in
 * whichever place of that set holds the most of its others, ties to the lowest
 * mask. Eight circles cannot cross in every way eight tags do, so the figure
 * has no place for every combination; what it never does is stand a mark
 * outside a set it carries while a reader is asking about that set. 0 only for
 * a note carrying no drawn tag at all, or one whose sets the figure draws no
 * place in.
 */
export function regionFor(mask: number, drawn: ReadonlySet<number>): number {
  if (drawn.has(mask)) return mask;
  for (let bit = 1; bit <= mask; bit <<= 1) {
    if ((mask & bit) === 0) continue;
    let found = 0;
    let most = -1;
    for (const place of drawn) {
      if ((place & bit) === 0) continue;
      const mine = setsIn(place & mask);
      if (mine > most || (mine === most && place < found)) {
        most = mine;
        found = place;
      }
    }
    if (found !== 0) return found;
  }
  return 0;
}

function setsIn(mask: number): number {
  let held = 0;
  for (let bits = mask; bits > 0; bits >>= 1) held += bits & 1;
  return held;
}

/**
 * The order notes stand in inside a region: the ones carrying the same UNDRAWN
 * tags together, then the order a run reads in — `orderSiblings`, so the
 * addresses lead and the rest follow in the order they were written.
 */
export function standingOrder<T extends SetsNote>(
  notes: readonly T[],
  drawn: readonly Tag[],
): T[] {
  const drawing = new Set(drawn);
  const groups = new Map<string, T[]>();
  for (const note of notes) {
    const key = [...note.tags]
      .filter((tag) => !drawing.has(tag))
      .sort()
      .join("\u0000");
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [note]);
    else group.push(note);
  }
  return [...groups.keys()]
    .sort()
    .flatMap((key) => orderSiblings(groups.get(key) as T[]));
}

/** How many marks a region has room for at a spacing: its area over one
 *  lattice cell's. A region holding more notes than this folds. */
export function regionCapacity(region: SetsRegion, spacing: number): number {
  return Math.floor(roomIn(region, spacing));
}

/** The same room before it is rounded down to whole marks, which is what the
 *  growth below divides by: a region with less than one mark's room is short of
 *  it by a factor rather than by everything. */
function roomIn(region: SetsRegion, spacing: number): number {
  return region.area / (spacing * spacing * (Math.sqrt(3) / 2));
}

/**
 * How much of a region's area the lattice can stand marks in: the rim a whole
 * mark keeps inside every outline, and the room the names take, cost about half
 * of it over the fields `pack.test.ts` holds this reading to. The growth asks
 * for area, so it asks for twice what the notes themselves need.
 */
const SETS_ROOM_LATTICED = 0.5;

/**
 * How much wider a figure is drawn so that its most crowded place has room for
 * the notes standing there at the lattice's floor: the square root of the worst
 * ratio of notes to room, since a uniform widening takes every area up with its
 * square. Held to {@link SETS_FIGURE_WIDEST}, so a place the figure cannot be
 * given room for without growing past what a reader sees at once keeps its
 * fold; 1 is a figure already roomy enough, or already that wide.
 */
function growthFor(
  diagram: SetsDiagram,
  standing: ReadonlyMap<number, readonly SetsNote[]>,
): number {
  let worst = 1;
  for (const region of diagram.regions) {
    const notes = standing.get(region.id)?.length ?? 0;
    if (notes === 0) continue;
    const want = notes / (roomIn(region, SETS_STEP) * SETS_ROOM_LATTICED);
    if (want > worst) worst = want;
  }
  const across = Math.max(
    diagram.box.maxX - diagram.box.minX,
    diagram.box.maxY - diagram.box.minY,
  );
  return Math.max(
    1,
    Math.min(Math.sqrt(worst), SETS_FIGURE_WIDEST / Math.max(across, 1)),
  );
}

export interface SetsPackOptions {
  notes: readonly SetsNote[];
  /**
   * The graphs on the canvas, in the order the reader put them there. Fewer
   * than two is one field holding every note, the way the genealogy draws one.
   */
  fields: readonly OwnedRef[];
  /** The tags selected, in selection order. Which of them, and which of the
   *  tags the notes carry besides, are drawn as places is `drawnSetsOf`. */
  selection: readonly Tag[];
  spacing: number;
  /** The most marks the whole canvas may draw. */
  most: number;
  /** How far apart two fields' diagrams stand, in world units. */
  gutter: number;
}

export interface SetsPacking {
  marks: readonly SetsMark[];
  drawn: SetsDrawn;
}

/** Where every mark stands, and the figure each field draws. */
export function packSets(options: SetsPackOptions): SetsPacking {
  const tags = drawnSetsOf(options.selection, options.notes);
  const slots = drawnSetSlots(tags);

  const byField = fieldsOf(options.notes, options.fields);
  const marks: SetsMark[] = [];
  const standing = new Map<OwnedRef, SetsStanding>();
  const folds = new Map<OwnedRef, readonly OwnedRef[]>();
  const fields: SetsFieldDrawn[] = [];
  const most = Math.max(1, Math.floor(options.most / byField.length));
  /** The middle of the figure being laid out, and half the width of the one
   *  before it: the fields draw at the sizes their own counts ask for, so each
   *  one stands off the width the last came out at. */
  let middle = 0;
  let half = 0;

  for (const [at, field] of byField.entries()) {
    // A field draws a circle for a drawn tag its own notes carry and for no
    // other: a tag that lives in another graph on the canvas is in the rail's
    // legend, and there is nothing here for it to be a place among.
    const bits = tags
      .map((_tag, bit) => bit)
      .filter((bit) =>
        field.notes.some((note) => note.tags.includes(tags[bit])),
      );
    const own = bits.map((bit) => tags[bit]);
    // The figure the counts draw, and then the same figure widened until its
    // most crowded place has room for the notes standing there — the notes fall
    // in the same places either way, so one pass settles it.
    const ask = askOf(field.notes, own);
    const first = setsFigure(ask);
    const diagram = setsFigure(
      ask,
      growthFor(first, standingIn(field.notes, own, first.regions)),
    );
    const reach = (diagram.box.maxX - diagram.box.minX) / 2;
    if (at > 0) middle += half + options.gutter + reach;
    half = reach;
    const dx = middle - (diagram.box.minX + diagram.box.maxX) / 2;
    const dy = 0;
    const sets: SetsSetDrawn[] = own.map((tag, local) => ({
      shape: diagram.shapes[local],
      tag,
      slot: slots.get(tag) ?? 1,
      bit: bits[local],
      nameAt: namePoint(diagram.shapes[local]),
    }));
    const lift = (local: number) => liftMask(local, bits);
    fields.push({
      ref: field.ref,
      dx,
      dy,
      sets,
      regions: diagram.regions.map((region) => ({
        ...region,
        id: lift(region.id),
      })),
      box: diagram.box,
    });

    const byRegion = standingIn(field.notes, own, diagram.regions);

    const crowds = diagram.regions
      .filter((region) => (byRegion.get(region.id)?.length ?? 0) > 0)
      .map((region) => {
        const notes = standingOrder(
          byRegion.get(region.id) as SetsNote[],
          tags,
        );
        return {
          region,
          notes,
          // With no set drawn anywhere on the canvas there is no question to
          // stand the notes inside, so they fold into the one mark that says
          // how many there are. A field drawing no circle of its own is not
          // that: its notes stand outside, as every untagged note does.
          room:
            tags.length === 0
              ? 0
              : Math.min(notes.length, regionCapacity(region, options.spacing)),
        };
      });
    const allowed = shareOut(
      crowds.map((crowd) => crowd.room),
      most,
    );

    for (const [which, crowd] of crowds.entries()) {
      const { region, notes } = crowd;
      const stands = { field: at, region: lift(region.id) };
      const places =
        allowed[which] < notes.length
          ? []
          : latticeIn(region, diagram, options.spacing, notes.length);
      if (places.length < notes.length) {
        const [first, ...rest] = notes;
        // A sliver with room for no whole mark at all still answers for its
        // notes.
        const stood = foldStands(region, diagram, options.spacing);
        marks.push({
          ref: first.ref,
          x: stood.x + dx,
          y: stood.y + dy,
          field: at,
          region: stands.region,
          holds: rest.map((note) => note.ref),
        });
        for (const note of notes) standing.set(note.ref, stands);
        folds.set(
          first.ref,
          notes.map((note) => note.ref),
        );
        continue;
      }
      for (const [standsAt, note] of notes.entries()) {
        marks.push({
          ref: note.ref,
          x: places[standsAt].x + dx,
          y: places[standsAt].y + dy,
          field: at,
          region: stands.region,
          holds: [],
        });
        standing.set(note.ref, stands);
      }
    }
  }

  return { marks, drawn: { tags, fields, standing, folds } };
}

/** A mask over the sets one field draws, read as a mask over the canvas's own
 *  list: `bits[i]` is which drawn tag that field's i-th set draws. */
function liftMask(local: number, bits: readonly number[]): number {
  let mask = 0;
  for (const [at, bit] of bits.entries()) {
    if ((local & (1 << at)) !== 0) mask |= 1 << bit;
  }
  return mask;
}

/** Which notes stand in each region of a figure, by {@link regionFor}. */
function standingIn(
  notes: readonly SetsNote[],
  drawn: readonly Tag[],
  regions: readonly SetsRegion[],
): Map<number, SetsNote[]> {
  const places = new Set(regions.map((region) => region.id));
  const byRegion = new Map<number, SetsNote[]>();
  for (const note of notes) {
    const id = regionFor(membershipOf(note.tags, drawn), places);
    const held = byRegion.get(id);
    if (held === undefined) byRegion.set(id, [note]);
    else held.push(note);
  }
  return byRegion;
}

/**
 * What a field asks its figure for: how many of its notes carry each drawn tag,
 * how many carry each pair of them, and how many carry none. Counted in drawing
 * order over the notes as they were handed in, so the ask — and the figure
 * measured from it — is the same whatever order a host reads its notes out in.
 */
export function askOf(
  notes: readonly Pick<SetsNote, "tags">[],
  drawn: readonly Tag[],
): SetsAsk {
  const count = drawn.length;
  const counts = new Array<number>(count).fill(0);
  const shared = new Array<number>(count * count).fill(0);
  let outside = 0;
  for (const note of notes) {
    const mask = membershipOf(note.tags, drawn);
    if (mask === 0) {
      outside += 1;
      continue;
    }
    for (let a = 0; a < count; a++) {
      if ((mask & (1 << a)) === 0) continue;
      counts[a] += 1;
      for (let b = a + 1; b < count; b++) {
        if ((mask & (1 << b)) === 0) continue;
        shared[a * count + b] += 1;
        shared[b * count + a] += 1;
      }
    }
  }
  return { counts, shared, outside };
}

/** The notes of each field, in the order the fields stand. */
function fieldsOf(
  notes: readonly SetsNote[],
  asked: readonly OwnedRef[],
): { ref: OwnedRef; notes: SetsNote[] }[] {
  const nothing = "" as OwnedRef;
  if (asked.length < 2) {
    return [{ ref: notes[0]?.graph ?? nothing, notes: [...notes] }];
  }
  const held = new Map<OwnedRef, SetsNote[]>(
    asked.map((ref) => [ref, [] as SetsNote[]]),
  );
  for (const note of notes) {
    // A graph the host did not name still gets a field of its own rather than
    // being drawn over one it does not belong to.
    const group = held.get(note.graph);
    if (group === undefined) held.set(note.graph, [note]);
    else group.push(note);
  }
  return [...held].map(([ref, group]) => ({ ref, notes: group }));
}

/** Which region of which field a world point falls in. `null` is a canvas with
 *  no diagram on it at all. */
export function setsDropAt(drawn: SetsDrawn, at: Point): SetsStanding | null {
  if (drawn.fields.length === 0) return null;
  let found = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [which, field] of drawn.fields.entries()) {
    const middle = field.dx + (field.box.minX + field.box.maxX) / 2;
    const away = Math.abs(at.x - middle);
    if (away < nearest) {
      nearest = away;
      found = which;
    }
  }
  const field = drawn.fields[found];
  const where = { x: at.x - field.dx, y: at.y - field.dy };
  let region = 0;
  for (const set of field.sets) {
    if (inShape(set.shape, where)) region |= 1 << set.bit;
  }
  return { field: found, region };
}

/**
 * The move a drop reports, or `null` for one that would change nothing. `into`
 * and `outOf` name the DRAWN tags alone — a tag outside the diagram is untouched
 * by a move inside it — and a note dropped where its own mark already stands is
 * left out of `notes`, which is what makes that drop the way to call one off.
 */
export function retagInto(
  drawn: SetsDrawn,
  notes: readonly Pick<SetsNote, "ref" | "tags">[],
  region: number,
): GraphRetag | null {
  if (drawn.tags.length === 0) return null;
  const into: Tag[] = [];
  const outOf: Tag[] = [];
  for (const [bit, tag] of drawn.tags.entries()) {
    ((region & (1 << bit)) === 0 ? outOf : into).push(tag);
  }
  const moving = notes
    .filter((note) => standsIn(drawn, note) !== region)
    .map((note) => note.ref);
  if (moving.length === 0) return null;
  return { notes: moving, into, outOf };
}

/**
 * The region a note's mark stands in: the packing's own answer, which is not
 * always the one its tags name — the figure has no place for every combination
 * of eight sets. A note the canvas never stood anywhere is read off its tags.
 */
function standsIn(
  drawn: SetsDrawn,
  note: Pick<SetsNote, "ref" | "tags">,
): number {
  const stands = drawn.standing.get(note.ref);
  return stands?.region ?? membershipOf(note.tags, drawn.tags);
}

/** The six steps round a hexagonal ring, in axial coordinates. */
const AROUND: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/**
 * One disc with room for a whole mark taken off it, or given to it — which is
 * how a mark is held clear of an outline rather than only its centre: a mark
 * stands clear of a set when its centre is inside that set shrunk by its reach,
 * or outside the set grown by it.
 */
function roomFor(shape: SetsShape, reach: number): SetsShape {
  return { ...shape, r: Math.max(shape.r + reach, 1e-6) };
}

/**
 * Whether a point stands inside a region with room for the WHOLE of the widest
 * mark: inside every set the region is in, shrunk by the mark's reach, and
 * outside every one it is not, grown by it.
 */
function standsClear(
  shapes: readonly SetsShape[],
  region: number,
): (at: Point) => boolean {
  const inside = shapes.map((shape) => roomFor(shape, -SETS_MARK_REACH));
  const outside = shapes.map((shape) => roomFor(shape, SETS_MARK_REACH));
  return (at) =>
    shapes.every((_unused, bit) =>
      (region & (1 << bit)) === 0
        ? !inShape(outside[bit], at)
        : inShape(inside[bit], at),
    );
}

/** Whether a mark at this point is clear of every set's name. */
function clearOfNames(names: readonly Bounds[], at: Point): boolean {
  return names.every((room) => boxGap(room, at) >= SETS_MARK_REACH);
}

/**
 * Up to `want` points of a hexagonal lattice standing inside `region`, from its
 * centre outward, each with room for the WHOLE of the widest mark and clear of
 * the room every set's name is written in. Fewer than `want` is a region the
 * lattice has no more room in at this spacing.
 */
export function latticeIn(
  region: SetsRegion,
  diagram: { shapes: readonly SetsShape[]; box: Bounds },
  spacing: number,
  want: number,
): Point[] {
  const basis = { x: spacing, y: spacing * (Math.sqrt(3) / 2) };
  const at = (q: number, r: number): Point => ({
    x: region.centre.x + q * basis.x + r * (basis.x / 2),
    y: region.centre.y + r * basis.y,
  });
  const clear = standsClear(diagram.shapes, region.id);
  const names = diagram.shapes.map(nameRoom);
  const stands = (point: Point): boolean =>
    inBox(diagram.box, point) && clearOfNames(names, point) && clear(point);

  const found: Point[] = [];
  if (want <= 0) return found;
  const take = (point: Point): boolean => {
    if (stands(point)) found.push(point);
    return found.length >= want;
  };
  if (take(at(0, 0))) return found;

  const rings =
    Math.ceil(
      Math.hypot(
        region.bounds.maxX - region.bounds.minX,
        region.bounds.maxY - region.bounds.minY,
      ) / spacing,
    ) + 2;
  for (let ring = 1; ring <= rings; ring++) {
    let q = AROUND[4][0] * ring;
    let r = AROUND[4][1] * ring;
    for (const [dq, dr] of AROUND) {
      for (let step = 0; step < ring; step++) {
        if (take(at(q, r))) return found;
        q += dq;
        r += dr;
      }
    }
  }
  return found;
}

/**
 * Where a region's fold stands: the lattice's own first place where there is
 * one, and otherwise the point of the region nearest its deepest that keeps a
 * whole mark clear of every set's name — and of the outlines too, where the
 * region has room for that as well. A region narrower than a mark keeps its
 * deepest point, pushed clear of the name standing over it, because the word
 * that says which place a reader is looking at is never under a count.
 */
export function foldStands(
  region: SetsRegion,
  diagram: { shapes: readonly SetsShape[]; box: Bounds },
  spacing: number,
): Point {
  const stood = latticeIn(region, diagram, spacing, 1);
  if (stood.length > 0) return stood[0];

  const names = diagram.shapes.map(nameRoom);
  const clear = standsClear(diagram.shapes, region.id);
  const tries: Point[] = [];
  for (const run of region.cover) {
    const y = (run.minY + run.maxY) / 2;
    const xs = [Math.min(Math.max(region.centre.x, run.minX), run.maxX)];
    for (const room of names) {
      xs.push(room.minX - SETS_MARK_REACH, room.maxX + SETS_MARK_REACH);
    }
    for (const x of xs) {
      if (x >= run.minX && x <= run.maxX) tries.push({ x, y });
    }
  }
  const nearest = (ok: (at: Point) => boolean): Point | undefined => {
    let found: Point | undefined;
    let away = Number.POSITIVE_INFINITY;
    for (const at of tries) {
      if (regionAt(diagram.shapes, at) !== region.id || !ok(at)) continue;
      const gap = Math.hypot(at.x - region.centre.x, at.y - region.centre.y);
      if (gap < away) {
        away = gap;
        found = at;
      }
    }
    return found;
  };
  return (
    nearest((at) => clearOfNames(names, at) && clear(at)) ??
    nearest((at) => clearOfNames(names, at)) ??
    pushedOffNames(region.centre, diagram.shapes, names)
  );
}

/**
 * A point moved out of every name room it stands in, each time along the way
 * out of the name itself, far enough for a whole mark to be clear of it.
 */
function pushedOffNames(
  from: Point,
  shapes: readonly SetsShape[],
  names: readonly Bounds[],
): Point {
  let at = from;
  for (let pass = 0; pass < names.length; pass++) {
    const which = names.findIndex((room) => boxGap(room, at) < SETS_MARK_REACH);
    if (which < 0) return at;
    const word = namePoint(shapes[which]);
    const dx = at.x - word.x;
    const dy = at.y - word.y;
    const away = Math.hypot(dx, dy);
    at = pushedOut(
      names[which],
      at,
      away > 1e-9 ? { x: dx / away, y: dy / away } : { x: 1, y: 0 },
    );
  }
  return at;
}

/** A point carried along `way` until a whole mark on it is clear of `room`. */
function pushedOut(room: Bounds, at: Point, way: Point): Point {
  const edge = {
    minX: room.minX - SETS_MARK_REACH,
    maxX: room.maxX + SETS_MARK_REACH,
    minY: room.minY - SETS_MARK_REACH,
    maxY: room.maxY + SETS_MARK_REACH,
  };
  const tx =
    way.x > 1e-9
      ? (edge.maxX - at.x) / way.x
      : way.x < -1e-9
        ? (edge.minX - at.x) / way.x
        : Number.POSITIVE_INFINITY;
  const ty =
    way.y > 1e-9
      ? (edge.maxY - at.y) / way.y
      : way.y < -1e-9
        ? (edge.minY - at.y) / way.y
        : Number.POSITIVE_INFINITY;
  const out = Math.min(tx, ty);
  if (!Number.isFinite(out)) return at;
  return { x: at.x + way.x * (out + 1e-3), y: at.y + way.y * (out + 1e-3) };
}

/** A field's budget handed out among its regions, smallest ask first, so a
 *  crowded region takes whatever the quiet ones leave. */
function shareOut(room: readonly number[], budget: number): number[] {
  const order = room
    .map((_unused, at) => at)
    .sort((a, b) => room[a] - room[b] || a - b);
  const allowed = new Array<number>(room.length).fill(0);
  let left = Math.max(0, budget);
  let waiting = order.length;
  for (const at of order) {
    const take = Math.min(room[at], Math.floor(left / waiting));
    allowed[at] = take;
    left -= take;
    waiting -= 1;
  }
  return allowed;
}
