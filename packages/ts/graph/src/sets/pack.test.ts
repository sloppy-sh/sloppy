// Where a note stands is a function of the notes, the drawn tags and the zoom
// and of nothing else, so two devices reading the same selection stand the same
// marks in the same places. That is what is held here, over generated runs of
// notes rather than over a handful of hand-placed ones.

import type { Address, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { DRAWN_SETS_MOST, drawnSetsOf } from "../contract.js";
import { makeCorpus, mulberry32 } from "../corpus.test-support.js";
import type { Bounds } from "../viewport.js";
import {
  boxGap,
  lensArea,
  nameRoom,
  regionAt,
  SETS_FIGURE_WIDEST,
  setsFigure,
} from "./geometry.js";
import {
  askOf,
  foldStands,
  latticeIn,
  latticeRoom,
  membershipOf,
  packSets,
  regionCapacity,
  regionFor,
  retagInto,
  SETS_STEP,
  type SetsDrawn,
  setsDropAt,
  type SetsMark,
  type SetsNote,
  setsSpacing,
  setsSpacingTier,
  standingOrder,
} from "./pack.js";

const HOME = "did:syr:zHome" as OwnedRef;
const AWAY = "did:syr:zAway" as OwnedRef;
const TAGS = ["biology", "seed", "question", "working", "spare"] as Tag[];
/** As many tags as a figure draws places for, which is more than a field needs
 *  to carry for the rest of this suite. */
const EVERY_TAG = [...TAGS, "ink", "paper", "pencil"] as Tag[];

function note(
  serial: number,
  tags: readonly Tag[],
  graph = HOME,
  address?: string,
): SetsNote {
  return {
    ref: `${graph}/${serial.toString(36).padStart(26, "0")}` as OwnedRef,
    graph,
    tags,
    ...(address === undefined ? {} : { address: address as Address }),
    created_at: `2026-01-01T00:00:${String(serial % 60).padStart(2, "0")}.000Z`,
  };
}

/** A field of notes drawn from a tag pool, the same every run. */
function field(
  count: number,
  seed: number,
  pool: readonly Tag[] = TAGS,
): SetsNote[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_unused, at) =>
    note(
      at,
      pool.filter(() => random() < 0.45),
      HOME,
      `1a${at + 1}`,
    ),
  );
}

const setsIn = (mask: number) => mask.toString(2).replace(/0/g, "").length;

/** The edge of the widest mark a lattice point stands the centre of: a disc
 *  crossing a hairline reads as standing in two sets at once. */
const RIM = Array.from({ length: 64 }, (_unused, step) => {
  const turn = (step / 64) * Math.PI * 2;
  return {
    x: (Math.cos(turn) * SETS_STEP) / 2,
    y: (Math.sin(turn) * SETS_STEP) / 2,
  };
});

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let at = out.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1));
    [out[at], out[swap]] = [out[swap], out[at]];
  }
  return out;
}

/** The figure a field was drawn with: the shapes its marks were stood in, at
 *  the size that field's own count of notes asked for. */
const figure = (drawn: SetsDrawn, at = 0) => ({
  ...drawn.fields[at],
  shapes: drawn.fields[at].sets.map((set) => set.shape),
});

const packed = (notes: readonly SetsNote[], selection: readonly Tag[]) =>
  packSets({
    notes,
    fields: [],
    selection,
    spacing: SETS_STEP,
    most: 4000,
    gutter: 900,
  });

describe("the tags a selection draws", () => {
  it("reads a note's region off the drawn tags alone", () => {
    const drawn = TAGS.slice(0, 3);
    expect(membershipOf([TAGS[0], TAGS[2], TAGS[4]], drawn)).toBe(0b101);
    expect(membershipOf([TAGS[4]], drawn)).toBe(0);
    expect(membershipOf(drawn, drawn)).toBe(0b111);
  });
});

// Nothing is lost to a combination the figure draws no place for: the note
// stands inside the first of its own sets, which is the one a reader asked
// about first, among the most of its others it can be in there.
describe("a membership the figure has no place for", () => {
  it("stands inside its leading set, with the most of its others", () => {
    const drawn = new Set([0, 0b01, 0b10, 0b100, 0b110, 0b101]);
    expect(regionFor(0b110, drawn)).toBe(0b110);
    expect(regionFor(0b111, drawn)).toBe(0b101);
    expect(regionFor(0b011, drawn)).toBe(0b01);
    expect(regionFor(0b1000, drawn)).toBe(0);
    expect(regionFor(0, drawn)).toBe(0);
  });

  it("breaks a tie between two places of its leading set by the lowest", () => {
    const drawn = new Set([0, 0b011, 0b101]);
    expect(regionFor(0b111, drawn)).toBe(0b011);
  });

  // Enough sets at once and a small one is drawn wholly under the others, so no
  // place at all is in it alone. Its notes stand in a place of it all the same,
  // which is inside a set they do not carry as well — and nowhere is what that
  // is instead of.
  it("stands inside a leading set the figure draws no corner of", () => {
    const drawn = new Set([0, 0b10, 0b11]);
    expect(regionFor(0b01, drawn)).toBe(0b11);
    expect(regionFor(0b101, drawn)).toBe(0b11);
    expect(regionFor(0b100, drawn)).toBe(0);
  });

  // Its leading set has nowhere at all, so the next of its own sets answers
  // rather than the note standing out on the paper carrying a drawn tag.
  it("falls to the next of its own sets where its leading set has none", () => {
    const drawn = new Set([0, 0b10]);
    expect(regionFor(0b11, drawn)).toBe(0b10);
  });

  it("stands outside every one of them where the figure draws none", () => {
    expect(regionFor(0b11, new Set([0]))).toBe(0);
  });
});

describe("the order notes stand in inside a region", () => {
  const drawn = [TAGS[0]];

  it("stands the ones carrying the same undrawn tags together", () => {
    const seeded = note(1, [TAGS[0], TAGS[1]], HOME, "1a");
    const plain = note(2, [TAGS[0]], HOME, "1b");
    const alsoSeeded = note(3, [TAGS[0], TAGS[1]], HOME, "1c");

    const order = standingOrder([plain, alsoSeeded, seeded], drawn);

    expect(order.map((entry) => entry.address)).toEqual(["1b", "1a", "1c"]);
  });

  it("reads each group as a run: addresses first, then as written", () => {
    const unnumbered = note(9, [TAGS[0]]);
    const later = note(2, [TAGS[0]], HOME, "1b");
    const earlier = note(3, [TAGS[0]], HOME, "1a");

    const order = standingOrder([unnumbered, later, earlier], drawn);

    expect(order.map((entry) => entry.address)).toEqual([
      "1a",
      "1b",
      undefined,
    ]);
  });
});

describe("the lattice a region is packed on", () => {
  for (const count of [1, 2, 3, 4, DRAWN_SETS_MOST]) {
    const drawn = EVERY_TAG.slice(0, count);
    // One note per combination of the drawn tags, which asks the figure for
    // every region that many sets can have.
    const diagram = setsFigure(
      askOf(
        Array.from({ length: 1 << count }, (_unused, mask) =>
          note(
            mask,
            drawn.filter((_tag, bit) => (mask & (1 << bit)) !== 0),
          ),
        ),
        drawn,
      ),
    );

    it(`stands every mark inside its own region of ${count}`, () => {
      for (const region of diagram.regions) {
        for (const at of latticeIn(region, diagram, SETS_STEP, 24)) {
          expect(regionAt(diagram.shapes, at)).toBe(region.id);
        }
      }
    });

    // A disc crossing a hairline reads as standing in two sets at once, so the
    // WHOLE mark is inside its region and not only its centre.
    it(`keeps every whole mark of ${count} inside its own region`, () => {
      for (const region of diagram.regions) {
        for (const at of latticeIn(region, diagram, SETS_STEP, 24)) {
          for (const edge of RIM) {
            expect(
              regionAt(diagram.shapes, {
                x: at.x + edge.x,
                y: at.y + edge.y,
              }),
              `region ${region.id.toString(2)}`,
            ).toBe(region.id);
          }
        }
      }
    });

    // A name is written inside its own outline, where the lattice would
    // otherwise pack: a mark standing under one hides the word that says which
    // place this is.
    it(`keeps every mark of ${count} clear of every name`, () => {
      for (const region of diagram.regions) {
        for (const at of latticeIn(region, diagram, SETS_STEP, 24)) {
          for (const shape of diagram.shapes) {
            expect(
              boxGap(nameRoom(shape), at),
              `region ${region.id.toString(2)}`,
            ).toBeGreaterThanOrEqual(SETS_STEP / 2);
          }
        }
      }
    });

    it(`never stands two marks of ${count} within one step`, () => {
      for (const region of diagram.regions) {
        const points = latticeIn(region, diagram, SETS_STEP, 60);
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            expect(
              Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
              `region ${region.id.toString(2)}`,
            ).toBeGreaterThanOrEqual(SETS_STEP - 1e-6);
          }
        }
      }
    });
  }

  it("grows the spacing as the field is zoomed out, and never shrinks it", () => {
    expect(setsSpacing(1)).toBe(SETS_STEP);
    expect(setsSpacingTier(1)).toBe(0);
    let previous = SETS_STEP;
    for (const scale of [0.5, 0.25, 0.12, 0.06]) {
      const spacing = setsSpacing(scale);
      expect(spacing).toBeGreaterThanOrEqual(previous);
      previous = spacing;
    }
    expect(setsSpacing(0.06)).toBeGreaterThan(SETS_STEP);
  });
});

describe("packing a field", () => {
  const notes = field(300, 20261011);
  const selection = TAGS.slice(0, 3);

  it("stands each mark in the region of the drawn tags it carries", () => {
    const { marks, drawn } = packed(notes, selection);
    const drew = figure(drawn);
    const places = new Set(drew.regions.map((region) => region.id));
    for (const mark of marks) {
      if (mark.holds.length > 0) continue;
      const held = notes.find((entry) => entry.ref === mark.ref) as SetsNote;
      const carries = membershipOf(held.tags, drawn.tags);
      // The exact place is the note's wherever the figure draws one; where it
      // draws none, the note is somewhere inside its leading set.
      const leading = carries & -carries;
      if (places.has(carries)) expect(mark.region).toBe(carries);
      else expect(mark.region & leading).toBe(leading);
      expect(
        regionAt(drew.shapes, {
          x: mark.x - drew.dx,
          y: mark.y - drew.dy,
        }),
      ).toBe(mark.region);
    }
  });

  // A note the figure has no place for would be a note nobody can reach in this
  // reading, so there is no such note: every one of them is placed or counted.
  it("answers for every note exactly once, whatever is drawn", () => {
    for (let count = 0; count <= DRAWN_SETS_MOST; count++) {
      const { marks } = packed(notes, TAGS.slice(0, count));
      const answered = marks.flatMap((mark) => [mark.ref, ...mark.holds]);
      expect(new Set(answered).size, `${count} drawn`).toBe(notes.length);
      expect(answered, `${count} drawn`).toHaveLength(notes.length);
    }
  });

  // Each set is as wide as the notes carrying its tag, so a field four times
  // the size draws every one of them wider and the figure with them.
  it("draws a bigger field a bigger figure", () => {
    const few = field(100, 11);
    const many = field(400, 11);
    const drew = (notes: readonly SetsNote[]) => {
      const tags = drawnSetsOf(selection, notes);
      return setsFigure(askOf(notes, tags));
    };
    const across = (at: { box: Bounds }) => at.box.maxX - at.box.minX;

    expect(across(drew(many))).toBeGreaterThan(across(drew(few)));
    for (const [bit, shape] of drew(many).shapes.entries()) {
      expect(shape.r, `set ${bit}`).toBeGreaterThan(drew(few).shapes[bit].r);
    }
    // What is drawn is that figure, or a wider one where the room its most
    // crowded place needs is more than its own counts drew.
    for (const notes of [few, many]) {
      expect(
        across(packed(notes, selection).drawn.fields[0]),
      ).toBeGreaterThanOrEqual(across(drew(notes)));
    }
  });

  // What a note's share of the paper buys: a region the fit can size by its
  // own count has room for the notes standing in it at full zoom, so folding is
  // left to the slivers where four sets or more cross and no 2D figure can give
  // a combination the area its count asks for.
  for (const size of [600, 1200]) {
    it(`leaves every region a figure can size room for ${size} notes`, () => {
      const held = field(size, 606);
      const { drawn } = packed(held, selection);
      const field0 = drawn.fields[0];
      const places = new Set(field0.regions.map((region) => region.id));
      const standing = new Map<number, number>();
      for (const note of held) {
        const id = regionFor(membershipOf(note.tags, drawn.tags), places);
        standing.set(id, (standing.get(id) ?? 0) + 1);
      }
      for (const region of field0.regions) {
        const want = standing.get(region.id) ?? 0;
        if (want === 0 || setsIn(region.id) > 3) continue;
        expect(
          regionCapacity(region, SETS_STEP),
          `region ${region.id.toString(2)}`,
        ).toBeGreaterThanOrEqual(want);
      }
    });
  }

  // What the figure is FOR: the picture says what the counts say, so a reader
  // reads the answer off it rather than off a legend.
  it("sizes each set by the notes carrying its tag", () => {
    const { drawn } = packed(notes, selection);
    const carried = (tag: Tag) =>
      notes.filter((note) => note.tags.includes(tag)).length;
    const sets = [...drawn.fields[0].sets].sort(
      (a, b) => a.shape.r - b.shape.r,
    );
    for (const [at, set] of sets.entries()) {
      if (at === 0) continue;
      expect(
        carried(set.tag),
        `${set.tag} against ${sets[at - 1].tag}`,
      ).toBeGreaterThanOrEqual(carried(sets[at - 1].tag));
    }
  });

  it("stands the same marks in the same places whatever order it is handed", () => {
    const first = packed(notes, selection);
    for (const seed of [1, 7, 4201, 99991]) {
      const again = packed(shuffled(notes, seed), selection);
      expect(again.marks).toEqual(first.marks);
      expect(again.drawn.tags).toEqual(first.drawn.tags);
      expect([...again.drawn.standing]).toEqual([...first.drawn.standing]);
    }
  });

  it("stands the same marks for every count of drawn sets", () => {
    for (let count = 0; count <= DRAWN_SETS_MOST; count++) {
      const tags = TAGS.slice(0, count);
      const first = packed(notes, tags);
      const again = packed(shuffled(notes, 31 + count), tags);
      expect(again.marks, `${count} drawn`).toEqual(first.marks);
    }
  });

  it("never stands two marks of a region within one step", () => {
    const { marks } = packed(notes, selection);
    const byRegion = new Map<number, typeof marks>();
    for (const mark of marks) {
      byRegion.set(mark.region, [...(byRegion.get(mark.region) ?? []), mark]);
    }
    for (const held of byRegion.values()) {
      for (let i = 0; i < held.length; i++) {
        for (let j = i + 1; j < held.length; j++) {
          expect(
            Math.hypot(held[i].x - held[j].x, held[i].y - held[j].y),
          ).toBeGreaterThanOrEqual(SETS_STEP - 1e-6);
        }
      }
    }
  });

  // The count is bounded everywhere else on this canvas and it is bounded here.
  it("folds a region there is no room in into one mark that counts it", () => {
    const { marks, drawn } = packSets({
      notes,
      fields: [],
      selection,
      spacing: SETS_STEP * 8,
      most: 4000,
      gutter: 900,
    });
    const drew = figure(drawn);
    expect(drawn.folds.size).toBeGreaterThan(0);
    for (const mark of marks) {
      const region = drew.regions.find(
        (at) => at.id === mark.region,
      ) as (typeof drew.regions)[number];
      if (mark.holds.length === 0) continue;
      expect(drawn.folds.has(mark.ref)).toBe(true);
      // Either the region has no lattice room for everyone standing there, or
      // the canvas's own bound on how many marks it draws has none.
      const held = mark.holds.length + 1;
      expect(
        Math.min(
          regionCapacity(region, SETS_STEP * 8),
          latticeIn(region, drew, SETS_STEP * 8, held).length,
        ),
      ).toBeLessThan(held);
    }
  });

  // A fold answers for a whole region, so it stands where a mark stands: the
  // nearest place in the region with room for a whole one. A crescent's deepest
  // point is on the far side of its own set, which is where that set's name is
  // written, so a fold placed there is a fold under the name.
  it("stands a fold where a whole mark has room", () => {
    const pair = TAGS.slice(0, 2);
    const crowd = [
      ...Array.from({ length: 10 }, (_unused, at) =>
        note(at, [pair[0]], HOME, `1a${at + 1}`),
      ),
      ...Array.from({ length: 10 }, (_unused, at) =>
        note(100 + at, [pair[1]], HOME, `1b${at + 1}`),
      ),
      ...Array.from({ length: 10 }, (_unused, at) =>
        note(200 + at, pair, HOME, `1c${at + 1}`),
      ),
    ];
    const { marks, drawn } = packSets({
      notes: crowd,
      fields: [],
      selection: pair,
      spacing: SETS_STEP,
      most: 4,
      gutter: 900,
    });
    const diagram = figure(drawn);
    const { dx, dy } = drawn.fields[0];
    const crescent = diagram.regions.find(
      (at) => at.id === 0b01,
    ) as (typeof diagram.regions)[number];
    expect(boxGap(nameRoom(diagram.shapes[0]), crescent.centre)).toBeLessThan(
      SETS_STEP / 2,
    );

    let held = 0;
    for (const mark of marks) {
      if (mark.holds.length === 0) continue;
      const region = diagram.regions.find(
        (at) => at.id === mark.region,
      ) as (typeof diagram.regions)[number];
      held += 1;
      const at = { x: mark.x - dx, y: mark.y - dy };
      for (const edge of RIM) {
        expect(
          regionAt(diagram.shapes, { x: at.x + edge.x, y: at.y + edge.y }),
          `region ${region.id.toString(2)}`,
        ).toBe(region.id);
      }
      for (const shape of diagram.shapes) {
        expect(
          boxGap(nameRoom(shape), at),
          `region ${region.id.toString(2)}`,
        ).toBeGreaterThanOrEqual(SETS_STEP / 2);
      }
    }
    expect(held).toBe(3);
  });

  it("holds the whole canvas under the count it was given", () => {
    const { marks, drawn } = packSets({
      notes,
      fields: [],
      selection,
      spacing: SETS_STEP,
      most: 40,
      gutter: 900,
    });
    expect(marks.length).toBeLessThanOrEqual(40 + 2 ** drawn.tags.length);
  });

  // A reader who has asked nothing is still shown the shape of the field: the
  // tags its own notes carry draw, most-carried first.
  it("draws the field's own tags where nothing is selected", () => {
    const { drawn } = packed(notes, []);
    expect(drawn.tags).toEqual(drawnSetsOf([], notes));
    expect(drawn.tags.length).toBeGreaterThan(1);
    expect(drawn.fields[0].sets.map((set) => set.slot)).toEqual(
      drawn.tags.map((_tag, at) => at + 1),
    );
  });

  // With nothing drawn there is no question to stand the notes inside, so the
  // one mark that says how many there are is the whole of the reading.
  it("folds everything into one mark where no tag is carried at all", () => {
    const plain = Array.from({ length: 40 }, (_unused, at) =>
      note(at, [], HOME, `1b${at + 1}`),
    );
    const { marks, drawn } = packed(plain, []);
    expect(marks).toHaveLength(1);
    expect(marks[0].region).toBe(0);
    expect(marks[0].holds).toHaveLength(plain.length - 1);
    expect(drawn.tags).toEqual([]);
  });

  it("draws each graph its own diagram, side by side", () => {
    const both = [
      ...field(60, 5),
      ...field(60, 6).map((entry) => ({
        ...entry,
        graph: AWAY,
        ref: `${AWAY}/${entry.ref.split("/")[1]}` as OwnedRef,
      })),
    ];
    const { marks, drawn } = packSets({
      notes: both,
      fields: [HOME, AWAY],
      selection,
      spacing: SETS_STEP,
      most: 4000,
      gutter: 900,
    });
    expect(drawn.fields.map((one) => one.ref)).toEqual([HOME, AWAY]);
    expect(drawn.fields[1].dx).toBeGreaterThan(drawn.fields[0].dx);
    const home = marks.filter((mark) => mark.field === 0);
    const away = marks.filter((mark) => mark.field === 1);
    expect(home.length).toBeGreaterThan(0);
    expect(away.length).toBeGreaterThan(0);
    expect(Math.max(...home.map((mark) => mark.x))).toBeLessThan(
      Math.min(...away.map((mark) => mark.x)),
    );
  });
});

// A handful of notes, some of them carrying a second tag as well, is the shape
// a new graph is read in. The figure has to say as much there as it does of
// three hundred: every note in the sets it carries, and none of them drawn
// outside every set while it carries one.
describe("a field of a few notes", () => {
  const twoTags = TAGS.slice(0, 2);
  const flat = (count: number, both: number) =>
    Array.from({ length: count }, (_unused, at) =>
      note(at, at < both ? twoTags : [twoTags[0]], HOME, `1a${at + 1}`),
    );

  it("stands the two notes outside a nested set in the set they do carry", () => {
    const { marks, drawn } = packed(flat(5, 3), twoTags);
    expect(drawn.tags).toEqual(twoTags);
    const [carrying, both] = drawn.fields[0].sets;
    expect(carrying.shape.r).toBeGreaterThan(both.shape.r);
    // Outside both, the crescent of the first alone, and the three in both.
    expect(drawn.fields[0].regions.map((one) => one.id)).toEqual([
      0, 0b01, 0b11,
    ]);
    const standing = (address: string) =>
      marks.find(
        (mark) =>
          mark.ref ===
          (flat(5, 3).find((one) => one.address === address) as SetsNote).ref,
      )?.region;
    expect(standing("1a4")).toBe(0b01);
    expect(standing("1a5")).toBe(0b01);
    expect(standing("1a1")).toBe(0b11);
    expect(marks.every((mark) => mark.region !== 0)).toBe(true);
  });

  it("stands every note in the sets it carries, however few there are", () => {
    for (let count = 1; count <= 12; count++) {
      for (let both = 0; both <= count; both++) {
        const notes = flat(count, both);
        const { marks, drawn } = packed(notes, twoTags);
        const where = `${both} of ${count} in both`;
        expect(drawn.tags, where).toEqual(twoTags);
        const answered = new Set<OwnedRef>();
        for (const mark of marks) {
          for (const ref of [mark.ref, ...mark.holds]) {
            answered.add(ref);
            const held = notes.find((one) => one.ref === ref) as SetsNote;
            expect(mark.region, `${held.address} of ${where}`).toBe(
              membershipOf(held.tags, drawn.tags),
            );
          }
        }
        expect(answered.size, where).toBe(count);
      }
    }
  });

  it("draws two one-note sets sharing nothing as two clear discs", () => {
    const { marks, drawn } = packed(
      [note(0, [twoTags[0]], HOME, "1a"), note(1, [twoTags[1]], HOME, "1b")],
      twoTags,
    );
    const [a, b] = drawn.fields[0].sets.map((set) => set.shape);
    expect(a.r).toBeGreaterThan(0);
    expect(a.r).toBeCloseTo(b.r, 9);
    expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThanOrEqual(
      a.r + b.r - 1e-6,
    );
    expect(drawn.fields[0].regions.map((one) => one.id)).toEqual([
      0, 0b01, 0b10,
    ]);
    expect(marks.map((mark) => mark.region).sort()).toEqual([0b01, 0b10]);
  });
});

// Twelve tags on six hundred notes: more tags than the figure draws places for,
// which is the field the reading was opened on. At six sets and more the fit
// draws a small one wholly under the others, so there is no point of it that is
// in it alone — and a note carrying that tag has to be drawn inside it all the
// same, because a reader who selected the tag looks for its notes in its circle
// and not out on the paper among the notes carrying nothing.
describe("a field carrying more tags than the figure draws", () => {
  const POOL = [
    "seed",
    "question",
    "biology",
    "evergreen",
    "method",
    "claim",
    "working",
    "growing",
    "spare",
    "ink",
    "paper",
    "pencil",
  ] as Tag[];
  const spread = (pool: readonly Tag[]) => {
    const random = mulberry32(606);
    return Array.from({ length: 600 }, (_unused, at) =>
      note(
        at,
        pool.filter(() => random() < 0.25),
        HOME,
        `1a${at + 1}`,
      ),
    );
  };
  /** Which of the drawn sets the figure gave a place of their own, which is
   *  what a note carrying that tag alone would otherwise have nowhere to be. */
  const alone = (drawn: SetsDrawn) => {
    const places = new Set(drawn.fields[0].regions.map((one) => one.id));
    return drawn.tags.filter((_tag, bit) => places.has(1 << bit)).length;
  };

  for (const selection of [[], ["claim"] as Tag[]]) {
    const asked =
      selection.length === 0 ? "nothing selected" : "claim selected";
    it(`stands every mark in a set it carries, ${asked}`, () => {
      let buried = 0;
      for (let tags = 1; tags <= POOL.length; tags++) {
        const held = spread(POOL.slice(0, tags));
        const { marks, drawn } = packed(
          held,
          selection.filter((tag) => POOL.slice(0, tags).includes(tag)),
        );
        if (alone(drawn) < drawn.tags.length) buried += 1;
        const answered = new Set<OwnedRef>();
        for (const mark of marks) {
          for (const ref of [mark.ref, ...mark.holds]) {
            answered.add(ref);
            const one = held.find((entry) => entry.ref === ref) as SetsNote;
            const carries = membershipOf(one.tags, drawn.tags);
            const where = `${one.address} of ${tags} tags`;
            if (carries === 0) {
              expect(mark.region, where).toBe(0);
              continue;
            }
            expect(mark.region & carries, where).toBeGreaterThan(0);
          }
        }
        expect(answered.size, `${tags} tags`).toBe(held.length);
      }
      // Without a buried set the sweep never reaches the last resort, and the
      // rest of this test would hold whether or not it worked.
      expect(buried).toBeGreaterThan(0);
    });
  }

  // Standing a mark where its own set is drawn under another is standing it in
  // that other set too; there is nowhere else for it to be, and nowhere is what
  // this is instead of.
  it("stands a mark whose own set is drawn under another inside both", () => {
    const held = spread(POOL);
    const { marks, drawn } = packed(held, []);
    const places = new Set(drawn.fields[0].regions.map((one) => one.id));
    const buried = drawn.tags
      .map((_tag, bit) => 1 << bit)
      .filter((bit) => !places.has(bit));
    expect(buried.length).toBeGreaterThan(0);
    const only = held.filter(
      (one) => membershipOf(one.tags, drawn.tags) === buried[0],
    );
    expect(only.length).toBeGreaterThan(0);
    for (const one of only) {
      const mark = marks.find(
        (at) => at.ref === one.ref || at.holds.includes(one.ref),
      ) as SetsMark;
      expect(mark.region & buried[0], `${one.address}`).toBe(buried[0]);
      expect(mark.region & ~buried[0], `${one.address}`).toBeGreaterThan(0);
    }
  });
});

describe("where a drop lands", () => {
  const selection = TAGS.slice(0, 2);
  // A field carrying nothing but the two selected tags, so those two are the
  // whole of what is drawn and `TAGS[4]` is a tag no place names.
  const notes = field(120, 7, selection);

  it("reads the region a world point falls in", () => {
    const { drawn } = packed(notes, selection);
    const field0 = drawn.fields[0];
    for (const region of field0.regions) {
      expect(
        setsDropAt(drawn, {
          x: region.centre.x + field0.dx,
          y: region.centre.y + field0.dy,
        }),
      ).toEqual({ field: 0, region: region.id });
    }
  });

  /** One of the field's own notes standing in `region`, which is what a drag
   *  takes hold of. */
  const standingIn = (drawn: SetsDrawn, region: number) =>
    notes.find(
      (one) => drawn.standing.get(one.ref)?.region === region,
    ) as SetsNote;

  it("names the drawn tags of the region and leaves the rest alone", () => {
    const { drawn } = packed(notes, selection);
    const outside = standingIn(drawn, 0);

    expect(retagInto(drawn, [outside], 0b11)).toEqual({
      notes: [outside.ref],
      into: selection,
      outOf: [],
    });
    expect(retagInto(drawn, [outside], 0b01)).toEqual({
      notes: [outside.ref],
      into: [selection[0]],
      outOf: [selection[1]],
    });
  });

  it("says nothing about a note already standing where it was dropped", () => {
    const { drawn } = packed(notes, selection);
    const already = standingIn(drawn, 0b01);
    expect(retagInto(drawn, [already], 0b01)).toBeNull();
    expect(retagInto(drawn, [already], 0b11)).toEqual({
      notes: [already.ref],
      into: selection,
      outOf: [],
    });
  });

  it("reports only the notes a drop would actually move", () => {
    const { drawn } = packed(notes, selection);
    const already = standingIn(drawn, 0b01);
    const moving = standingIn(drawn, 0);
    expect(retagInto(drawn, [already, moving], 0b01)).toEqual({
      notes: [moving.ref],
      into: [selection[0]],
      outOf: [selection[1]],
    });
  });

  // A note the canvas never stood anywhere — one the host is holding that this
  // packing does not answer for — is read off the tags it carries.
  it("reads a note the packing never placed off its own tags", () => {
    const { drawn } = packed(notes, selection);
    const elsewhere = note(900, [selection[0]], AWAY);
    expect(drawn.standing.has(elsewhere.ref)).toBe(false);
    expect(retagInto(drawn, [elsewhere], 0b01)).toBeNull();
    expect(retagInto(drawn, [elsewhere], 0b10)?.notes).toEqual([elsewhere.ref]);
  });

  it("reports nothing at all where no set is drawn", () => {
    const plain = Array.from({ length: 20 }, (_unused, at) => note(at, []));
    const { drawn } = packed(plain, []);
    expect(drawn.tags).toEqual([]);
    expect(retagInto(drawn, [note(1, [TAGS[0]])], 0)).toBeNull();
  });
});

// The figure's two claims about a reader's question, held over the corpus the
// reading is measured on: a lens says two sets share notes, and a mark inside a
// circle says the note carries that tag. Eight circles cannot cross in every
// way eight tags do, so what is held is not that every combination has a place
// — it is that no mark stands outside a set the reader is asking about.
describe("the corpus the reading is measured on", () => {
  const corpus = makeCorpus();
  const notes: SetsNote[] = corpus.nodes.map((node) => ({
    ref: node.ref,
    graph: HOME,
    tags: node.tags,
    address: node.address,
    created_at: node.created_at,
  }));
  const asked: Tag[][] = [[], ["claim"], ["settled"], ["seed", "claim"]].map(
    (one) => one as Tag[],
  );

  it("draws a lens for every pair of sets that shares a note", () => {
    for (const selection of asked) {
      const { drawn } = packed(notes, selection);
      const field0 = drawn.fields[0];
      expect(field0.sets).toHaveLength(DRAWN_SETS_MOST);
      const ask = askOf(notes, drawn.tags);
      const count = drawn.tags.length;
      let sharing = 0;
      for (const a of field0.sets) {
        for (const b of field0.sets) {
          if (a.bit >= b.bit) continue;
          if ((ask.shared[a.bit * count + b.bit] ?? 0) === 0) continue;
          sharing += 1;
          expect(
            lensArea(
              a.shape.r,
              b.shape.r,
              Math.hypot(a.shape.cx - b.shape.cx, a.shape.cy - b.shape.cy),
            ),
            `${a.tag} and ${b.tag} of ${selection.join(",") || "nothing"}`,
          ).toBeGreaterThan(0);
        }
      }
      expect(sharing).toBeGreaterThan(DRAWN_SETS_MOST);
    }
  });

  it("stands no mark of it under a set's name", () => {
    for (const selection of asked) {
      const { marks, drawn } = packed(notes, selection);
      const diagram = figure(drawn);
      const { dx, dy } = drawn.fields[0];
      for (const mark of marks) {
        const region = diagram.regions.find(
          (at) => at.id === mark.region,
        ) as (typeof diagram.regions)[number];
        if (latticeIn(region, diagram, SETS_STEP, 1).length === 0) continue;
        const at = { x: mark.x - dx, y: mark.y - dy };
        for (const shape of diagram.shapes) {
          expect(
            boxGap(nameRoom(shape), at),
            `${mark.ref} in ${region.id.toString(2)}`,
          ).toBeGreaterThanOrEqual(SETS_STEP / 2);
        }
      }
    }
  });

  it("stands every note inside the first of its own drawn sets", () => {
    for (const selection of asked) {
      const { marks, drawn } = packed(notes, selection);
      for (const mark of marks) {
        for (const ref of [mark.ref, ...mark.holds]) {
          const note = notes.find((one) => one.ref === ref) as SetsNote;
          const carries = membershipOf(note.tags, drawn.tags);
          const leading = carries & -carries;
          expect(
            mark.region & leading,
            `${note.address} of ${selection.join(",") || "nothing"}`,
          ).toBe(leading);
        }
      }
    }
  });

  // What selecting a tag is FOR: its notes light up, and they light up inside
  // its own circle rather than somewhere in the figure that says they carry
  // something else.
  it("lights the notes of a selected tag inside that tag's own circle", () => {
    for (const tag of ["claim", "settled", "seed"] as Tag[]) {
      const { marks, drawn } = packed(notes, [tag]);
      const bit = 1 << drawn.tags.indexOf(tag);
      let lit = 0;
      for (const mark of marks) {
        for (const ref of [mark.ref, ...mark.holds]) {
          const note = notes.find((one) => one.ref === ref) as SetsNote;
          if (!note.tags.includes(tag)) continue;
          lit += 1;
          expect(mark.region & bit, `${note.address} of ${tag}`).toBe(bit);
        }
      }
      expect(lit, tag).toBeGreaterThan(100);
    }
  });

  // A drop where the mark already stands is how a drag is called off, so it is
  // read off where the mark IS and not off the tags it carries: the figure has
  // no place for every combination, and the two are often not the same region.
  it("says nothing about a mark dropped where it already stands", () => {
    const { drawn } = packed(notes, ["claim"] as Tag[]);
    const moved = notes.filter((one) => {
      const stands = drawn.standing.get(one.ref);
      return (
        stands !== undefined &&
        stands.region !== membershipOf(one.tags, drawn.tags)
      );
    });
    expect(moved.length).toBeGreaterThan(100);
    for (const one of moved.slice(0, 40)) {
      const stands = drawn.standing.get(one.ref) as { region: number };
      expect(
        retagInto(drawn, [one], stands.region),
        `${one.address}`,
      ).toBeNull();
      const report = retagInto(
        drawn,
        [one],
        membershipOf(one.tags, drawn.tags),
      );
      expect(report?.notes, `${one.address}`).toEqual([one.ref]);
    }
  });

  // A fold answers for everyone standing in its region, so each of them stands
  // where it does — a note behind one is not a note the canvas lost.
  it("stands every note behind a fold where the fold stands", () => {
    const { marks, drawn } = packSets({
      notes,
      fields: [],
      selection: [],
      spacing: SETS_STEP * 8,
      most: 4000,
      gutter: 900,
    });
    const folded = marks.filter((mark) => mark.holds.length > 0);
    expect(folded.length).toBeGreaterThan(0);
    for (const mark of folded) {
      for (const ref of mark.holds) {
        expect(drawn.standing.get(ref)).toEqual({
          field: mark.field,
          region: mark.region,
        });
      }
    }
  });
});

// Each field draws the drawn tags its OWN notes carry: the rail's legend is the
// canvas's, and a circle with nothing in it would say this graph holds a tag it
// does not.
// The drawn tags are the canvas's, so a graph whose own tags are not among them
// draws no circle. Its notes are still its notes: each one stands outside, as
// every note carrying none of the drawn tags does.
describe("a graph the canvas draws no set of", () => {
  const pool = Array.from(
    { length: DRAWN_SETS_MOST },
    (_unused, at) => `tag${at}` as Tag,
  );
  const here = Array.from({ length: 80 }, (_unused, at) =>
    note(at, [pool[at % pool.length]], HOME, `1a${at + 1}`),
  );
  const elsewhere = "elsewhere" as Tag;
  const there = Array.from({ length: 6 }, (_unused, at) => ({
    ...note(at, [elsewhere], AWAY, `1b${at + 1}`),
    ref: `${AWAY}/${at.toString(36).padStart(26, "0")}` as OwnedRef,
  }));
  const both = () =>
    packSets({
      notes: [...here, ...there],
      fields: [HOME, AWAY],
      selection: [],
      spacing: SETS_STEP,
      most: 4000,
      gutter: 900,
    });

  it("draws the canvas's tags, and no circle in the graph carrying none", () => {
    const { drawn } = both();
    expect(drawn.tags).toEqual(pool);
    expect(drawn.fields[1].sets).toEqual([]);
  });

  it("stands each of its notes outside, rather than folding them into one", () => {
    const { marks, drawn } = both();
    const its = marks.filter((mark) => mark.field === 1);
    expect(its).toHaveLength(there.length);
    for (const mark of its) {
      expect(mark.region).toBe(0);
      expect(mark.holds).toEqual([]);
    }
    expect(drawn.folds.size).toBe(0);
  });
});

describe("two graphs carrying different tags", () => {
  const here = TAGS[0];
  const there = TAGS[1];
  const notes = [
    ...Array.from({ length: 20 }, (_unused, at) =>
      note(at, [here], HOME, `1a${at + 1}`),
    ),
    ...Array.from({ length: 20 }, (_unused, at) => ({
      ...note(at, [there], AWAY, `1b${at + 1}`),
      ref: `${AWAY}/${at.toString(36).padStart(26, "0")}` as OwnedRef,
    })),
  ];
  const both = () =>
    packSets({
      notes,
      fields: [HOME, AWAY],
      selection: [here, there],
      spacing: SETS_STEP,
      most: 4000,
      gutter: 900,
    });

  it("draws each field a circle for its own tag alone", () => {
    const { drawn } = both();
    expect(drawn.tags).toEqual([here, there]);
    expect(drawn.fields[0].sets.map((set) => set.tag)).toEqual([here]);
    expect(drawn.fields[1].sets.map((set) => set.tag)).toEqual([there]);
    expect(drawn.fields[0].sets[0].bit).toBe(0);
    expect(drawn.fields[1].sets[0].bit).toBe(1);
    expect(drawn.fields[0].sets[0].slot).not.toBe(drawn.fields[1].sets[0].slot);
  });

  // Each circle is as wide as the notes its OWN field holds of that tag, so a
  // tag the other graph carries nothing of does not shrink it.
  it("sizes each circle by the notes of its own field", () => {
    const { drawn } = both();
    const [here0, there0] = drawn.fields.map((field) => field.sets[0].shape.r);
    expect(here0).toBeCloseTo(there0, 9);
  });

  it("stands every mark of a field inside its own field's set", () => {
    const { marks, drawn } = both();
    for (const mark of marks) {
      expect(mark.region).toBe(mark.field === 0 ? 0b01 : 0b10);
    }
    expect(new Set(marks.map((mark) => mark.field)).size).toBe(2);
    expect(drawn.fields[1].dx).toBeGreaterThan(drawn.fields[0].dx);
  });
});

const TWELVE = [
  ...EVERY_TAG,
  "method",
  "claim",
  "growing",
  "chemistry",
] as Tag[];

/** Six hundred notes over twelve tags, each note carrying the ones a coin at
 *  `share` gave it — four more tags than the figure draws places for. */
const crowded = (share: number): SetsNote[] => {
  const random = mulberry32(606);
  return Array.from({ length: 600 }, (_unused, at) =>
    note(
      at,
      TWELVE.filter(() => random() < share),
      HOME,
      `1a${at + 1}`,
    ),
  );
};

const corpusNotes = (total: number): SetsNote[] =>
  makeCorpus({ total }).nodes.map((node) => ({
    ref: node.ref,
    graph: HOME,
    tags: node.tags,
    address: node.address,
    created_at: node.created_at,
  }));

/** The fields this reading is measured on, each with the most of its notes that
 *  may stand behind a fold at the lattice's floor — what the width bound and
 *  the room the places are shared out by leave between them, measured. */
const BENCH: [string, () => SetsNote[], number][] = [
  ["six hundred notes", () => corpusNotes(600), 60],
  ["two thousand four hundred notes", () => corpusNotes(2400), 260],
  ["six hundred notes over twelve tags", () => crowded(0.25), 10],
];

const SELECTIONS: Tag[][] = [[], ["seed", "claim"] as Tag[]];

// What the figure's growth is for: the room a crowded place is short of is room
// the whole figure takes, so a fold is something a reader opens by zooming in
// rather than one no zoom ever reaches — up to the width the figure is held to,
// where a place still short of room keeps its fold. Held over the fields this
// reading is measured on, at the lattice's floor.
describe("the room a figure takes for its most crowded place", () => {
  for (const [what, held, most] of BENCH) {
    for (const selection of SELECTIONS) {
      const asked = selection.length === 0 ? "nothing" : "two tags";
      it(`gives ${what} the room its crowd asks for, ${asked} selected`, () => {
        const notes = held();
        const { marks, drawn } = packed(notes, selection);
        const figure0 = drawn.fields[0];
        const across = Math.max(
          figure0.box.maxX - figure0.box.minX,
          figure0.box.maxY - figure0.box.minY,
        );
        const behind = marks.reduce(
          (sum, mark) =>
            sum + (mark.holds.length > 0 ? mark.holds.length + 1 : 0),
          0,
        );

        // Every note is answered for, the figure is still one picture, and the
        // notes left behind a fold are fewer than the figure's own counts drew.
        expect(
          marks.reduce((sum, mark) => sum + 1 + mark.holds.length, 0),
        ).toBe(notes.length);
        expect(across).toBeLessThanOrEqual(SETS_FIGURE_WIDEST);
        expect(behind).toBeLessThanOrEqual(most);
      });
    }
  }

  // A fold stands where a mark stands, and never under the word that says which
  // place a reader is looking at — not even in a sliver the lattice has no room
  // in at all, where the fold is the only thing there is to draw.
  it("stands a fold clear of every set's name in every place of a field", () => {
    const notes = crowded(0.25);
    const tags = drawnSetsOf([], notes);
    const diagram = setsFigure(askOf(notes, tags));
    let slivers = 0;
    for (const region of diagram.regions) {
      const stood = foldStands(region, diagram, SETS_STEP);
      if (latticeIn(region, diagram, SETS_STEP, 1).length === 0) slivers += 1;
      for (const shape of diagram.shapes) {
        expect(
          boxGap(nameRoom(shape), stood),
          `region ${region.id.toString(2)}`,
        ).toBeGreaterThanOrEqual(SETS_STEP / 2);
      }
    }
    // Without a sliver the lattice refuses, the last resort is never reached
    // and the rest of this would hold whether or not it worked.
    expect(slivers).toBeGreaterThan(0);
  });

  it("stands every fold a zoomed-out field draws clear of the names", () => {
    const notes = crowded(0.25);
    const { marks, drawn } = packSets({
      notes,
      fields: [],
      selection: [],
      spacing: SETS_STEP * 8,
      most: 4000,
      gutter: 900,
    });
    const diagram = figure(drawn);
    const { dx, dy } = drawn.fields[0];
    const folded = marks.filter((mark) => mark.holds.length > 0);

    expect(folded.length).toBeGreaterThan(0);
    for (const mark of folded) {
      const at = { x: mark.x - dx, y: mark.y - dy };
      for (const shape of diagram.shapes) {
        expect(
          boxGap(nameRoom(shape), at),
          `fold in ${mark.region.toString(2)}`,
        ).toBeGreaterThanOrEqual(SETS_STEP / 2);
      }
    }
  });
});

// Where a note the figure draws no exact place for stands: inside its leading
// set still, but in a place of that set with room for a mark at the floor, so a
// whole combination is no longer stood in a sliver no zoom opens. The notes the
// figure has an exact place for take theirs first, and no place is filled past
// its room by the rest.
describe("the room a standing is shared out against", () => {
  const roomOf = (drawn: SetsDrawn) => {
    const diagram = figure(drawn);
    return new Map(
      diagram.regions.map((region) => [
        region.id,
        latticeRoom(region, diagram, SETS_STEP),
      ]),
    );
  };

  for (const [what, held] of BENCH) {
    for (const selection of SELECTIONS) {
      const asked = selection.length === 0 ? "nothing" : "two tags";
      it(`fills no place of ${what} past its room, ${asked} selected`, () => {
        const notes = held();
        const { drawn } = packed(notes, selection);
        const room = roomOf(drawn);
        const stood = new Map<number, number>();
        const exactly = new Map<number, number>();
        for (const note of notes) {
          const stands = drawn.standing.get(note.ref) as { region: number };
          stood.set(stands.region, (stood.get(stands.region) ?? 0) + 1);
          const carries = membershipOf(note.tags, drawn.tags);
          if (room.has(carries)) {
            exactly.set(carries, (exactly.get(carries) ?? 0) + 1);
          }
          const leading = carries & -carries;
          expect(stands.region & leading, `${note.address}`).toBe(leading);
        }
        expect([...stood.values()].reduce((sum, at) => sum + at, 0)).toBe(
          notes.length,
        );
        for (const [region, many] of stood) {
          // A place holds what it has room for, or the notes it is the exact
          // place of — a count the fit can leave short of room at any width.
          expect(many, `region ${region.toString(2)}`).toBeLessThanOrEqual(
            Math.max(room.get(region) ?? 0, exactly.get(region) ?? 0),
          );
        }
      });
    }
  }

  it("shares the same room out the same way whatever order it is handed", () => {
    for (const [what, held] of BENCH) {
      const notes = held();
      const first = packed(notes, SELECTIONS[1]);
      const again = packed(shuffled(notes, 2026), SELECTIONS[1]);
      expect(again.marks, what).toEqual(first.marks);
      expect([...again.drawn.standing], what).toEqual([
        ...first.drawn.standing,
      ]);
    }
  });
});
