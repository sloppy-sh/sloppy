// The seed is the part of the layout the protocol claims, so it is proved here
// rather than asserted: AI.md § "The Genealogy Is the Protocol" says two peers
// applying the same creations must agree, and a seed that disagreed would put
// the same subtree in a different place on every screen. The other half of the
// rule is proved the same way — the address is a label, so writing one, editing
// one or taking one off moves nothing.

import type { Address, NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  type CorpusNote,
  makeCorpus,
  mulberry32,
} from "../corpus.test-support.js";
import {
  placeFields,
  seedBox,
  type SeedBox,
  seedField,
  type SeedPoint,
} from "./geometry.js";

const corpus = makeCorpus();
const notes = corpus.nodes;
const ROOT_RADIUS = 1400;

describe("seedField", () => {
  it("does not depend on the order it is handed", () => {
    const straight = seedField(notes);
    const scrambled = seedField(shuffle(notes, 7));
    for (const node of notes) {
      expect(scrambled.get(node.ref)).toEqual(straight.get(node.ref));
    }
  });

  // The claim that matters, and the whole of what a peer agrees with: two
  // people holding the same tree draw the same field, whatever either of them
  // has called the notes in it.
  it("puts the same tree in the same place on two peers whose labels differ", () => {
    for (const seed of [3, 11, 29, 97]) {
      const tree = makeCorpus({
        total: 400,
        roots: 3,
        maxDepth: 6,
        maxSiblings: 7,
        seed,
        pulledRoots: [],
      });
      const here = seedField(shuffle(unnumbered(tree.nodes), seed));
      const there = seedField(shuffle(renumbered(tree.nodes), seed + 1));
      for (const node of tree.nodes) {
        expect(there.get(node.ref), `${seed} ${node.ref}`).toEqual(
          here.get(node.ref),
        );
      }
    }
  });

  // The other way round, and the one a person feels: numbering a note they had
  // left unnumbered rearranges the run they read it in and nothing on the
  // canvas.
  it("leaves every mark where it was when a note is given a number", () => {
    const bare = unnumbered(notes);
    const before = seedField(bare);
    const after = seedField(
      bare.map((node, at) =>
        at === 12 ? { ...node, address: "1a" as Address } : node,
      ),
    );
    for (const node of bare) {
      expect(after.get(node.ref)).toEqual(before.get(node.ref));
    }
  });

  // A subtree a peer pulled arrives without the notes above it, so where those
  // sat is not something it can know — what travels is the shape.
  it("draws a subtree pulled without its ancestors in the same shape", () => {
    const whole = seedField(notes);
    const root = notes.find(
      (node) => node.depth === 3 && descendantsOf(node.ref, notes).length > 20,
    );
    if (root === undefined) throw new Error("the corpus grew no such subtree");
    const branch = [root, ...descendantsOf(root.ref, notes)];
    const { parent: _above, ...pulled } = root;
    const alone = seedField([pulled, ...descendantsOf(root.ref, notes)]);

    for (const node of branch) {
      for (const other of branch) {
        expect(apart(alone, node.ref, other.ref)).toBeCloseTo(
          apart(whole, node.ref, other.ref),
          6,
        );
      }
    }
  });

  it("never seeds two notes to the same point", () => {
    const seen = new Set<string>();
    for (const seed of seedField(notes).values()) {
      const key = `${seed.x}:${seed.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  // A note with nothing above it in the field — a branch, an independent note,
  // or one whose parent this reader does not hold — starts on the ring, from
  // the ref every peer holding it has.
  it("starts a note with nothing above it on the root ring", () => {
    const field = seedField(loose(40));
    const seen = new Set<string>();
    for (const seed of field.values()) {
      expect(Math.hypot(seed.x, seed.y)).toBeCloseTo(ROOT_RADIUS, 6);
      const key = `${seed.x}:${seed.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  // A ring sized for forty branches is one a graph of six opens too far out to
  // read: DESIGN.md § "The mark" measures the look against the view a graph
  // opens on, and for a small field the ring is most of that view.
  it("stands a few branches on a tighter ring than a crowd", () => {
    const few = ringOf(seedField(loose(6)));
    expect(few).toBeLessThan(ringOf(seedField(loose(40))));
    expect(few).toBeGreaterThan(0);
  });

  it("fans a run by which of its notes was written first", () => {
    const [parent, ...run] = family(3);
    const field = seedField([parent, ...run]);
    const swapped = seedField([
      parent,
      { ...run[0], created_at: run[2].created_at },
      run[1],
      { ...run[2], created_at: run[0].created_at },
    ]);
    expect(swapped.get(run[0].ref)).not.toEqual(field.get(run[0].ref));
    expect(swapped.get(run[2].ref)).not.toEqual(field.get(run[2].ref));
    expect(swapped.get(run[1].ref)).toEqual(field.get(run[1].ref));
  });

  it("lays a run out in the order it was written, sweeping one way", () => {
    const [parent, ...run] = family(11);
    const field = seedField([parent, ...run]);
    const from = field.get(parent.ref) as SeedPoint;
    const leans = run.map(
      (child) => (field.get(child.ref) as SeedPoint).outward - from.outward,
    );
    for (let at = 1; at < leans.length; at++) {
      expect(leans[at], `${at}`).toBeGreaterThan(leans[at - 1]);
    }
  });

  // The widest run the seeder is asked for still leaves its parent's fan: a run
  // that overran it would lay its far end over the branch alongside.
  it("keeps the widest run inside its parent's own spread", () => {
    const [parent, ...run] = family(23);
    const field = seedField([parent, ...run]);
    const from = field.get(parent.ref) as SeedPoint;
    const spread = 1.15 * 0.66 ** (parent.depth + 1 - 2);
    for (const child of run) {
      const lean = (field.get(child.ref) as SeedPoint).outward - from.outward;
      expect(Math.abs(lean), child.ref).toBeLessThan(spread);
    }
  });

  // A subtree that started scattered would be a subtree the force pass has to
  // gather, and gathering is what makes a settle look like a hairball resolving.
  it("starts a subtree inside a disc its own generation bounds", () => {
    const field = seedField(notes);
    const roots = notes.filter((node) => node.depth === 3);
    for (const root of roots.slice(0, 40)) {
      const from = field.get(root.ref) as SeedPoint;
      for (const node of descendantsOf(root.ref, notes)) {
        const to = field.get(node.ref) as SeedPoint;
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThan(
          reachFrom(root.depth),
        );
      }
    }
  });
});

describe("placeFields", () => {
  const boxes: SeedBox[] = [
    { minX: -1400, maxX: 1400, minY: -1400 },
    { minX: -900, maxX: 2100, minY: -600 },
    { minX: -1400, maxX: 1400, minY: -1400 },
  ];

  it("leaves the field being read exactly where it was", () => {
    for (const many of [1, 2, 3]) {
      const placed = placeFields(boxes.slice(0, many));
      expect(placed[0].dx, `${many}`).toBe(0);
    }
  });

  it("never lets one field reach into the next", () => {
    const placed = placeFields(boxes);
    for (const [at, where] of placed.entries()) {
      if (at === 0) continue;
      expect(where.minX).toBeGreaterThan(placed[at - 1].maxX);
    }
  });

  it("names each field over the field it belongs to", () => {
    for (const where of placeFields(boxes)) {
      expect(where.nameX).toBeGreaterThanOrEqual(where.minX);
      expect(where.nameX).toBeLessThanOrEqual(where.maxX);
    }
  });

  // Every graph is seeded onto the one ring, so a field is what moves — never
  // the place a note has inside it.
  it("moves a whole field together, and nothing within it", () => {
    const [, second] = placeFields(boxes.slice(0, 2));
    const seeds = seedField(family(4));
    const spans = [...seeds.values()].map((seed) => seed.x);
    const moved = spans.map((x) => x + second.dx);
    for (const [at, x] of moved.entries()) {
      expect(x - moved[0]).toBeCloseTo(spans[at] - spans[0], 10);
    }
  });

  it("gives a graph with nothing in it a field of its own", () => {
    const placed = placeFields([boxes[0], seedBox([])]);
    expect(placed[1].minX).toBeGreaterThan(placed[0].maxX);
  });
});

/** `many` notes with nothing above any of them. */
function loose(many: number): NodeView[] {
  return unnumbered(notes.slice(0, many)).map(
    ({ parent: _above, ...rest }) => rest,
  );
}

/** The one radius a field of loose notes stands at. */
function ringOf(field: ReadonlyMap<OwnedRef, SeedPoint>): number {
  const radii = [...field.values()].map((seed) => Math.hypot(seed.x, seed.y));
  for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 6);
  return radii[0];
}

/** The same notes with nobody's label on them. */
function unnumbered(of: readonly CorpusNote[]): NodeView[] {
  return of.map(({ address: _none, ...node }) => node);
}

/** The same notes labelled the way a peer who numbered them differently holds
 *  them — including runs numbered against the order they were written. */
function renumbered(of: readonly CorpusNote[]): NodeView[] {
  return of.map((node, at) => ({
    ...node,
    address: `${(of.length - at) % 97 || 1}z` as Address,
  }));
}

/** A parent and `many` notes written under it, a second apart. */
function family(many: number): NodeView[] {
  const { parent: _none, ...parent } = notes[0];
  return [
    { ...parent, depth: 1 },
    ...Array.from({ length: many }, (_unused, at) => ({
      ...notes[at + 1],
      parent: parent.ref,
      depth: 2,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
    })),
  ];
}

function descendantsOf(
  root: OwnedRef,
  among: readonly CorpusNote[],
): CorpusNote[] {
  const under = new Set([root]);
  const found: CorpusNote[] = [];
  for (const node of among) {
    if (node.parent === undefined || !under.has(node.parent)) continue;
    under.add(node.ref);
    found.push(node);
  }
  return found;
}

function apart(
  field: ReadonlyMap<OwnedRef, SeedPoint>,
  from: OwnedRef,
  to: OwnedRef,
): number {
  const a = field.get(from) as SeedPoint;
  const b = field.get(to) as SeedPoint;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The furthest a descendant can be seeded from a node `depth` generations in. */
function reachFrom(depth: number): number {
  let reach = 0;
  for (let at = depth + 1; at <= 24; at++) reach += 300 * 0.8 ** (at - 2);
  return reach + 1;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let at = out.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1));
    [out[at], out[swap]] = [out[swap], out[at]];
  }
  return out;
}
