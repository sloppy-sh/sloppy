// Which region a note stands in, and where inside it its mark is drawn.
// DESIGN.md § "Sets — the tags as places" is the doc of record.
//
// Everything here is a function of the notes, the drawn tags and the zoom, so
// two devices reading the same selection stand the same marks in the same
// places. Nothing is persisted and nothing is written: a move between sets is
// reported ({@link retagInto}) and the host saves it.

import {
  type Address,
  assignTagHueSlots,
  MARK_SCALE_MAX,
  type OwnedRef,
  orderSiblings,
  type Tag,
  type TagHueSlot,
} from "@sloppy/types";
import { DRAWN_SETS_MOST, type GraphRetag } from "../contract.js";
import { LEAF_RADIUS } from "../model.js";
import type { Bounds, Point } from "../viewport.js";
import {
  inBox,
  inShape,
  namePoint,
  regionAt,
  type SetsRegion,
  type SetsShape,
  setsDiagram,
} from "./geometry.js";

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
  /** Where the tag's name is written, in diagram coordinates. */
  nameAt: Point;
}

/**
 * One graph's diagram and where it stands on the canvas. The shapes and the
 * regions are in DIAGRAM coordinates — this field's own figure, drawn at the
 * size its count of notes asks for — and `dx`/`dy` is where it sits.
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
  /** The drawn tags, in selection order: index `i` is bit `1 << i`. Empty is a
   *  reading with nothing chosen, where every note stands outside. */
  tags: readonly Tag[];
  fields: readonly SetsFieldDrawn[];
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

/**
 * How far apart the lattice stands two marks at full zoom, in world units: the
 * widest a leaf mark can be drawn at either side of the gap and a hair over, so
 * no two marks touch however large their authors sized them.
 */
export const SETS_STEP = Math.ceil(LEAF_RADIUS * MARK_SCALE_MAX * 2 + 6);

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

/** The tags a selection draws as regions: the first {@link DRAWN_SETS_MOST},
 *  deduped the way `assignTagHueSlots` hands out the hues. */
export function drawnSetsOf(selection: readonly Tag[]): Tag[] {
  return [...new Set(selection)].slice(0, DRAWN_SETS_MOST);
}

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
 * combination of sets: the most of them it does draw a place for, and outside
 * every one of them where it draws none. Every note stands somewhere.
 */
export function regionFor(mask: number, drawn: ReadonlySet<number>): number {
  if (drawn.has(mask)) return mask;
  let found = 0;
  let most = -1;
  for (let part = mask - 1; part > 0; part--) {
    if ((part & mask) !== part || !drawn.has(part)) continue;
    const held = setsIn(part);
    if (held > most) {
      most = held;
      found = part;
    }
  }
  return found;
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
  return Math.floor(region.area / (spacing * spacing * (Math.sqrt(3) / 2)));
}

export interface SetsPackOptions {
  notes: readonly SetsNote[];
  /**
   * The graphs on the canvas, in the order the reader put them there. Fewer
   * than two is one field holding every note, the way the genealogy draws one.
   */
  fields: readonly OwnedRef[];
  /** The tags selected, in selection order — the drawn ones are the first
   *  {@link DRAWN_SETS_MOST} of them. */
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

/** Where every mark stands, and the diagram each field draws. */
export function packSets(options: SetsPackOptions): SetsPacking {
  const tags = drawnSetsOf(options.selection);
  const slots = assignTagHueSlots(options.selection);

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
    const diagram = setsDiagram(tags.length, field.notes.length);
    const reach = (diagram.box.maxX - diagram.box.minX) / 2;
    if (at > 0) middle += half + options.gutter + reach;
    half = reach;
    const dx = middle - (diagram.box.minX + diagram.box.maxX) / 2;
    const dy = 0;
    const sets: SetsSetDrawn[] = tags.map((tag, bit) => ({
      shape: diagram.shapes[bit],
      tag,
      slot: slots.get(tag) ?? 1,
      nameAt: namePoint(diagram.shapes[bit]),
    }));
    fields.push({
      ref: field.ref,
      dx,
      dy,
      sets,
      regions: diagram.regions,
      box: diagram.box,
    });

    const drawnRegions = new Set(diagram.regions.map((region) => region.id));
    const byRegion = new Map<number, SetsNote[]>();
    for (const note of field.notes) {
      const id = regionFor(membershipOf(note.tags, tags), drawnRegions);
      const held = byRegion.get(id);
      if (held === undefined) byRegion.set(id, [note]);
      else held.push(note);
    }

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
          // With nothing drawn there is no question to stand the notes inside,
          // so they fold into the one mark that says how many there are.
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
      const places =
        allowed[which] < notes.length
          ? []
          : latticeIn(region, diagram, options.spacing, notes.length);
      if (places.length < notes.length) {
        const [first, ...rest] = notes;
        marks.push({
          ref: first.ref,
          x: region.centre.x + dx,
          y: region.centre.y + dy,
          field: at,
          region: region.id,
          holds: rest.map((note) => note.ref),
        });
        standing.set(first.ref, { field: at, region: region.id });
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
          region: region.id,
          holds: [],
        });
        standing.set(note.ref, { field: at, region: region.id });
      }
    }
  }

  return { marks, drawn: { tags, fields, standing, folds } };
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
  return {
    field: found,
    region: regionAt(
      field.sets.map((set) => set.shape),
      { x: at.x - field.dx, y: at.y - field.dy },
    ),
  };
}

/**
 * The move a drop reports, or `null` for one that would change nothing. `into`
 * and `outOf` name the DRAWN tags alone — a tag outside the diagram is untouched
 * by a move inside it — and a note already standing where it was dropped is left
 * out of `notes`.
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
    .filter((note) => membershipOf(note.tags, drawn.tags) !== region)
    .map((note) => note.ref);
  if (moving.length === 0) return null;
  return { notes: moving, into, outOf };
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
 * One shape with room for a whole mark taken off it, or given to it — which is
 * how a disc is held clear of an outline rather than only its centre: a mark
 * stands clear of a set when its centre is inside that set shrunk by its reach,
 * or outside the set grown by it.
 *
 * Both axes move by the same SHARE, the reach over the shorter one, because an
 * ellipse's own inward offset is nearer than the reach wherever it leans.
 */
function roomFor(shape: SetsShape, reach: number): SetsShape {
  const share = 1 + reach / Math.min(shape.rx, shape.ry);
  return {
    ...shape,
    rx: Math.max(shape.rx * share, 1e-6),
    ry: Math.max(shape.ry * share, 1e-6),
  };
}

/**
 * Up to `want` points of a hexagonal lattice standing inside `region`, from its
 * centre outward, each with room for the WHOLE of the widest mark. Fewer than
 * `want` is a region the lattice has no more room in at this spacing.
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
  const inside = diagram.shapes.map((shape) =>
    roomFor(shape, -SETS_MARK_REACH),
  );
  const outside = diagram.shapes.map((shape) =>
    roomFor(shape, SETS_MARK_REACH),
  );
  // Inside every set the region is in and outside every one it is not, with
  // room for the whole of the widest mark on the near side of each outline.
  const stands = (point: Point): boolean =>
    inBox(diagram.box, point) &&
    diagram.shapes.every((_unused, bit) =>
      (region.id & (1 << bit)) === 0
        ? !inShape(outside[bit], point)
        : inShape(inside[bit], point),
    );

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
