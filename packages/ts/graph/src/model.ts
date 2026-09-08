// The drawn region as a graph, which is the one place node geometry, colour and
// adjacency are decided. The scene reads attributes off this and draws them; the
// layout reads the same attributes and moves them.

import {
  assignTagHueSlots,
  type Address,
  type DidSyr,
  type EdgeKind,
  graphOf,
  MARK_SCALE_MAX,
  type NodeView,
  type OwnedRef,
  type PictureSeries,
  PREVIEW_COVER_MAX,
  type ResolvedAppearance,
  resolveAppearance,
  type RingStyle,
  type RingWeight,
  runKeyOf,
  runPairs,
  strongestEdge,
  type Tag,
} from "@sloppy/types";
import Graph from "graphology";
import type { DrawnNode, GraphField } from "./contract.js";
import {
  placeFields,
  type SeedPoint,
  seedBox,
  seedField,
} from "./layout/geometry.js";
import type { GraphPalette } from "./palette.js";
import { MAX_SCALE, type Point } from "./viewport.js";

/** DESIGN.md § Form: provenance survives greyscale, so it is never a hue. */
export type Provenance = "own" | "published" | "pulled";

/** The two ends of what a mark is drawn at: a leaf with nothing set, and the
 *  cap a mega-node grows to. */
export const LEAF_RADIUS = 9;
const MEGA_GROWTH = 0.42;
export const MAX_RADIUS = 46;

/** The largest mark any canvas draws: the fold's cap at the top of the size
 *  channel. Everything sized for the worst case a mark can be is sized off this. */
export const WIDEST_RADIUS = MAX_RADIUS * MARK_SCALE_MAX;

/** A look's ring, as fractions of the mark's radius — its centre line, and what
 *  each weight strokes. Inside the mark, since the edge is provenance's. */
export const LOOK_RING_AT = 0.6;
export const LOOK_RING_WIDTH: Record<Exclude<RingWeight, "none">, number> = {
  hairline: 0.075,
  regular: 0.14,
  heavy: 0.22,
};

/**
 * How each style breaks the ring: the marks it is stepped round in, and the
 * share of each mark's turn that is drawn — the rest is the gap, which
 * `scene.test.ts` keeps wider than the heaviest stroke. No marks strokes it
 * whole. DESIGN.md § "The mark" carries what a style has to be worth.
 */
export const LOOK_RING_BREAK: Record<
  RingStyle,
  { dashes: number; duty: number }
> = {
  solid: { dashes: 0, duty: 1 },
  open: { dashes: 1, duty: 0.86 },
  notched: { dashes: 3, duty: 0.72 },
  dashed: { dashes: 7, duty: 0.4 },
};

/** Assumed of the densest screen Sloppy runs on. */
const DENSE_SCREEN = 2;

/**
 * The side of the square a picture is STORED at: the most any mark could ever
 * show of it — the biggest mega-node at the largest a look may size one, covered
 * whole, at full zoom, on a dense display. A picture is stored with its SHORT
 * side at this, because the crop spends the long one.
 *
 * The cut is taken once, when somebody chooses the file, and the look it is
 * chosen for goes on being edited afterwards — so it is cut for the size the
 * look could reach rather than the size it happens to be. What a MARK decodes is
 * the other budget, and {@link markPictureSide} is that one.
 */
export const MARK_PICTURE_PX = Math.ceil(
  WIDEST_RADIUS * PREVIEW_COVER_MAX * 2 * MAX_SCALE * DENSE_SCREEN,
);

/**
 * The side of the square a mark drawn at `radius` world units decodes its
 * picture to, held under {@link MARK_PICTURE_PX}. A leaf never carries a
 * mega-node's pixels however large the stored picture is, which is what makes a
 * phone holding hundreds of pictured marks affordable — `model.test.ts` holds
 * the two budgets apart.
 *
 * Rounded UP to a power of two, so the same picture worn by marks a hair apart
 * in size is one texture rather than a dozen cuts of one file.
 */
export function markPictureSide(radius: number, cover: number): number {
  const wanted = radius * cover * 2 * MAX_SCALE * DENSE_SCREEN;
  const stepped = 2 ** Math.ceil(Math.log2(Math.max(1, wanted)));
  return Math.min(MARK_PICTURE_PX, stepped);
}

/** What a note nobody styled draws as, held once rather than resolved per node. */
const UNSTYLED: ResolvedAppearance = resolveAppearance(null);

const EDGE_FIRST = 300;
const EDGE_DECAY = 0.8;
const EDGE_MIN = 34;
const CONNECTION_DISTANCE = 520;

/**
 * How hard a node is held to its seed — a nudge, because the seed fixes the
 * shape and the force pass only resolves the crowding around it.
 */
const SEED_ANCHOR = 0.035;

export interface GraphNodeAttributes {
  index: number;
  ref: OwnedRef;
  /** Absent is a note its author gave no address; the title is what names it. */
  address?: Address;
  depth: number;
  title: string;
  collapsed: boolean;
  folded: number;
  radius: number;
  provenance: Provenance;
  /** Children of this node that are themselves drawn — what a collapse folds. */
  children: number;
  /** Every tag this mark stands for — {@link DrawnNode.tags}, which a mega-node
   *  answers for the whole subtree with. */
  tags: readonly Tag[];
  /**
   * The selected tag this mark draws the hue of: the earliest-selected of the
   * ones it stands for ({@link tags}), absent when it stands for none.
   * DESIGN.md § Hue — one mark, one hue.
   */
  tag: Tag | undefined;
  /** The author's ring, drawn INSIDE the mark since the edge is provenance's —
   *  DESIGN.md § "The mark". `none` is a mark with no ring of its own. */
  ringWeight: RingWeight;
  /** Says nothing while {@link ringWeight} is `none`. */
  ringStyle: RingStyle;
  /** The pictures the mark wears, as uploads only their author's own instance
   *  can answer for. No pictures is a mark with none; whose turn it is among
   *  several is the scene's to read off the clock. */
  preview: PictureSeries;
  /** The share of the mark's radius they cover. */
  previewCover: number;
  fill: number;
  /** Below 1 for a node the selection has nothing to say about. */
  alpha: number;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  anchorStrength: number;
}

export interface GraphEdgeAttributes {
  /** A pair several of these are true of draws one line, and it is the
   *  strongest of them — `EDGE_KINDS` in `@sloppy/types` is the order. */
  kind: EdgeKind;
  distance: number;
}

export type GraphModel = Graph<GraphNodeAttributes, GraphEdgeAttributes>;

export interface ModelOptions {
  /** In selection order, which is the order the hue slots are handed out in. */
  selection: readonly Tag[];
  palette: GraphPalette;
  /** Whose graph this is. Absent means nothing here is claimed as own. */
  viewer?: DidSyr;
  /** Positions to carry over, so an update does not restart the settle. */
  keep?: ReadonlyMap<OwnedRef, { x: number; y: number }>;
  /** {@link GraphSurfaceProps.fields} — the graphs on the canvas, in order. */
  fields?: readonly GraphField[];
}

/** A graph's name, where the canvas writes it, and how far its field reaches —
 *  world coordinates, so a name stays over the field it belongs to. */
export interface NamedField extends GraphField {
  x: number;
  y: number;
  minX: number;
  maxX: number;
}

export interface BuiltModel {
  graph: GraphModel;
  /** Drawn order, which is address order — the layout indexes by position. */
  order: readonly OwnedRef[];
  /** Empty on a canvas drawing one graph, which needs no name to tell apart. */
  fields: readonly NamedField[];
}

export function buildModel(
  drawn: readonly DrawnNode[],
  options: ModelOptions,
): BuiltModel {
  const graph: GraphModel = new Graph({ type: "undirected" });
  const slots = assignTagHueSlots(options.selection);
  // Ranked off the slot map's keys rather than off the selection, so the dedupe
  // rule that hands out the hues is the same one that picks between them.
  const rank = new Map([...slots.keys()].map((tag, at) => [tag, at] as const));
  const { seedOf, fields } = seedFields(drawn, options.fields ?? []);
  const starts = startPoints(drawn, seedOf, options.keep);

  drawn.forEach((entry, index) => {
    const { node } = entry;
    const tag = earliestSelected(entry.tags, rank);
    const slot = tag === undefined ? undefined : slots.get(tag);
    const seed = seedOf(node);
    const start = starts.get(node.ref) ?? seed;
    // A mega-node wears the look of the note it IS, never an average of the
    // looks it folded — DESIGN.md § "The mark".
    const look =
      node.appearance == null ? UNSTYLED : resolveAppearance(node.appearance);
    const fill =
      slot === undefined
        ? options.palette.depth(node.depth)
        : options.palette.tag(slot);

    graph.addNode(node.ref, {
      index,
      ref: node.ref,
      ...(node.address === undefined ? {} : { address: node.address }),
      depth: node.depth,
      title: node.title,
      collapsed: entry.collapsed,
      folded: entry.folded,
      radius: radiusFor(entry, look),
      provenance: provenanceOf(node, options.viewer),
      children: 0,
      tags: entry.tags,
      tag,
      ringWeight: look.ringWeight,
      ringStyle: look.ringStyle,
      preview: look.preview,
      previewCover: look.previewCover,
      fill,
      alpha:
        slot === undefined && options.selection.length > 0
          ? options.palette.unselectedAlpha(fill)
          : 1,
      x: start.x,
      y: start.y,
      anchorX: seed.x,
      anchorY: seed.y,
      anchorStrength: SEED_ANCHOR,
    });
  });

  // One line per pair, and it is the strongest kind true of it — DESIGN.md
  // § Edges. Distance belongs to whichever line got there first, which is why
  // the addresses' two kinds are laid before the two a person made: a
  // connection changes how a line is drawn and never how far apart the two
  // notes sit.
  const join = (
    a: OwnedRef,
    b: OwnedRef,
    kind: EdgeKind,
    apart: () => number,
  ): void => {
    const already = graph.undirectedEdge(a, b);
    if (already === undefined) {
      graph.addUndirectedEdge(a, b, { kind, distance: apart() });
      return;
    }
    graph.setEdgeAttribute(
      already,
      "kind",
      strongestEdge(graph.getEdgeAttribute(already, "kind"), kind),
    );
  };

  for (const { node } of drawn) {
    if (node.parent !== undefined && graph.hasNode(node.parent)) {
      graph.updateNodeAttribute(
        node.parent,
        "children",
        (count) => (count ?? 0) + 1,
      );
      join(node.parent, node.ref, "genealogy", () =>
        Math.max(
          EDGE_MIN,
          EDGE_FIRST * EDGE_DECAY ** Math.max(node.depth - 2, 0),
        ),
      );
    }
  }

  // Distance is the gap the pair's own seeds already sit at, so the run
  // reinforces the shape the addresses fixed rather than pulling siblings
  // together — with the shared floor still holding the most crowded
  // generations apart.
  for (const [before, after] of runs(drawn)) {
    join(before.ref, after.ref, "run", () => {
      const from = graph.getNodeAttributes(before.ref);
      const to = graph.getNodeAttributes(after.ref);
      return Math.max(
        EDGE_MIN,
        Math.hypot(to.anchorX - from.anchorX, to.anchorY - from.anchorY),
      );
    });
  }

  for (const { node } of drawn) {
    for (const [kind, targets] of connectionsOf(node)) {
      for (const target of targets) {
        if (target === node.ref || !graph.hasNode(target)) continue;
        join(node.ref, target, kind, () => CONNECTION_DISTANCE);
      }
    }
  }

  return { graph, order: drawn.map((entry) => entry.node.ref), fields };
}

/**
 * The notes a note is connected to, by each of the two ways of making a line:
 * `links` a hand drew, and `references` the note's own writing named. Absent
 * `references` is a note nothing derived them for. DESIGN.md § Edges draws the
 * two apart, so nothing here unions them.
 */
function connectionsOf(node: NodeView): [EdgeKind, readonly OwnedRef[]][] {
  return [
    ["link", node.links],
    ["reference", node.references ?? []],
  ];
}

const ORIGIN: SeedPoint = { x: 0, y: 0, outward: 0 };

/** Where each mark starts this rebuild, which is one reader's session rather
 *  than the protocol: the seeds a peer agrees with (`layout/geometry.ts`) are
 *  untouched. DESIGN.md § "The canvas". */
function startPoints(
  drawn: readonly DrawnNode[],
  seedOf: (node: NodeView) => SeedPoint,
  keep: ReadonlyMap<OwnedRef, Point> | undefined,
): ReadonlyMap<OwnedRef, Point> {
  const byRef = new Map(drawn.map((entry) => [entry.node.ref, entry.node]));
  const at = new Map<OwnedRef, Point>();

  const place = (node: NodeView, seen: Set<OwnedRef>): Point => {
    const held = at.get(node.ref);
    if (held !== undefined) return held;
    const kept = keep?.get(node.ref);
    const seed = seedOf(node);
    const parent =
      node.parent === undefined ? undefined : byRef.get(node.parent);
    let point: Point = kept ?? seed;
    if (kept === undefined && parent !== undefined && !seen.has(node.ref)) {
      seen.add(node.ref);
      const from = place(parent, seen);
      const parentSeed = seedOf(parent);
      point = {
        x: from.x + seed.x - parentSeed.x,
        y: from.y + seed.y - parentSeed.y,
      };
    }
    at.set(node.ref, point);
    return point;
  };

  for (const entry of drawn) place(entry.node, new Set());
  return at;
}

/**
 * Where each drawn note starts, and where each field's name is written. An
 * address seeds the same point in every graph — that is the protocol — so on a
 * canvas holding several the field a note is in is what moves it, and the note's
 * place inside its own field is untouched.
 */
function seedFields(
  drawn: readonly DrawnNode[],
  asked: readonly GraphField[],
): { seedOf: (node: NodeView) => SeedPoint; fields: NamedField[] } {
  if (asked.length < 2) {
    const seeds = seedField(drawn.map((entry) => entry.node));
    return { seedOf: (node) => seeds.get(node.ref) ?? ORIGIN, fields: [] };
  }

  const byField = new Map<OwnedRef, NodeView[]>();
  for (const { node } of drawn) {
    const of = graphOf(node);
    const held = byField.get(of);
    if (held === undefined) byField.set(of, [node]);
    else held.push(node);
  }

  // A graph the host did not name still gets a field of its own rather than
  // being drawn over one it does not belong to.
  const order = [
    ...new Set([...asked.map((field) => field.ref), ...byField.keys()]),
  ];
  const seeds = new Map(
    order.map((of) => [of, seedField(byField.get(of) ?? [])]),
  );

  const placed = new Map(
    placeFields(
      order.map((of) => seedBox((seeds.get(of) ?? new Map()).values())),
    ).map((where, at) => [order[at], where] as const),
  );
  const named = new Map(asked.map((field) => [field.ref, field.title]));
  return {
    seedOf: (node) => {
      const of = graphOf(node);
      const seed = seeds.get(of)?.get(node.ref);
      if (seed === undefined) return ORIGIN;
      return { ...seed, x: seed.x + (placed.get(of)?.dx ?? 0) };
    },
    fields: order.map((ref) => {
      const where = placed.get(ref);
      return {
        ref,
        title: named.get(ref) ?? "",
        x: where?.nameX ?? 0,
        y: where?.nameY ?? 0,
        minX: where?.minX ?? 0,
        maxX: where?.maxX ?? 0,
      };
    }),
  };
}

/**
 * The run of thought, in pairs. Only which notes are alongside each other is
 * decided here: those that sprang from the same note, or the branches of one
 * graph.
 */
function runs(drawn: readonly DrawnNode[]): [NodeView, NodeView][] {
  const levels = new Map<string, NodeView[]>();
  for (const { node } of drawn) {
    const level = runKeyOf(node);
    const alongside = levels.get(level);
    if (alongside === undefined) levels.set(level, [node]);
    else alongside.push(node);
  }
  return [...levels.values()].flatMap(runPairs);
}

/**
 * Of the tags a mark stands for, the one selected first — so a mark in several
 * selected sets draws in one hue and always the same one.
 */
function earliestSelected(
  tags: readonly Tag[],
  rank: ReadonlyMap<Tag, number>,
): Tag | undefined {
  let found: Tag | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const tag of tags) {
    const at = rank.get(tag);
    if (at !== undefined && at < best) {
      best = at;
      found = tag;
    }
  }
  return found;
}

function radiusFor(entry: DrawnNode, look: ResolvedAppearance): number {
  const scale = look.markScale;
  if (entry.folded === 0) return LEAF_RADIUS * scale;
  const grown = LEAF_RADIUS * (1 + Math.log2(1 + entry.folded) * MEGA_GROWTH);
  // The cap is the fold's, so the author's own size scales it too: bigger draws
  // bigger at every fold, which a flat cap took away from exactly the
  // mega-nodes the control is asked for — DESIGN.md § "The mark".
  return Math.min(grown * scale, MAX_RADIUS * scale);
}

function provenanceOf(node: NodeView, viewer: DidSyr | undefined): Provenance {
  if (viewer !== undefined && node.created_by !== viewer) return "pulled";
  return node.published ? "published" : "own";
}
