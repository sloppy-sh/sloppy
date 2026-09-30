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
  liesInARun,
  runKeyOf,
  runPairs,
  strongestEdge,
  type Tag,
} from "@sloppy/types";
import Graph from "graphology";
import {
  type DifferenceMark,
  differenceMarks,
  type DrawnNode,
  type GraphDifference,
  type GraphEdgeLook,
  edgeLookKey,
  edgeLooksByPair,
  type GraphField,
} from "./contract.js";
import { MAX_DENSITY } from "./density.js";
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

/**
 * The side of the square a picture is STORED at: the most any mark could ever
 * show of it — the biggest mega-node at the largest a look may size one, covered
 * whole, at full zoom, on the densest screen. A picture is stored with its SHORT
 * side at this, because the crop spends the long one.
 *
 * The cut is taken once, when somebody chooses the file, and the look it is
 * chosen for goes on being edited afterwards — so it is cut for the size the
 * look could reach rather than the size it happens to be. What a MARK decodes is
 * the other budget, and {@link markPictureSide} is that one.
 */
export const MARK_PICTURE_PX = Math.ceil(
  WIDEST_RADIUS * PREVIEW_COVER_MAX * 2 * MAX_SCALE * MAX_DENSITY,
);

/**
 * The side of the square a mark drawn at `radius` world units decodes its
 * picture to on a screen of `density` device pixels per CSS pixel, held under
 * {@link MARK_PICTURE_PX}. A leaf never carries a mega-node's pixels however
 * large the stored picture is, and a plain screen never carries a dense one's,
 * which is what makes a phone holding hundreds of pictured marks affordable —
 * `model.test.ts` holds the two budgets apart.
 *
 * Rounded UP to a power of two, so the same picture worn by marks a hair apart
 * in size is one texture rather than a dozen cuts of one file.
 */
export function markPictureSide(
  radius: number,
  cover: number,
  density = MAX_DENSITY,
): number {
  const wanted = radius * cover * 2 * MAX_SCALE * density;
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
  /** Whether the code this note points at has moved since its author read the
   *  note against it — {@link ModelOptions.codeMoved}. False on a note nobody
   *  has read, and on every mark where the code cannot be reached. */
  codeMoved: boolean;
  /** The pictures the mark wears, as uploads only their author's own instance
   *  can answer for. No pictures is a mark with none; whose turn it is among
   *  several is the scene's to read off the clock. */
  preview: PictureSeries;
  /** The share of the mark's radius they cover. */
  previewCover: number;
  /** What the difference being compared says of this note, absent on a canvas
   *  comparing nothing and on a note neither state moved or wrote in. */
  difference?: DifferenceMark;
  fill: number;
  /** Below 1 for a node no question in front of the reader has anything to say
   *  about — and at one strength however many are being asked. */
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
  /** The look a person set on this pair, oriented as they set it. Absent is a
   *  line drawn as DESIGN.md § Edges alone says. It is read where the line is
   *  drawn and nowhere else: a look changes no {@link distance}. */
  look?: GraphEdgeLook;
}

export type GraphModel = Graph<GraphNodeAttributes, GraphEdgeAttributes>;

export interface ModelOptions {
  /** In selection order, which is the order the hue slots are handed out in. */
  selection: readonly Tag[];
  /** {@link GraphSurfaceProps.codeMoved} — the notes the code has moved under
   *  since their author read them against it. Absent and empty both say
   *  nothing, which is what a canvas beside no code draws. */
  codeMoved?: ReadonlySet<OwnedRef>;
  palette: GraphPalette;
  /** Whose graph this is. Absent means nothing here is claimed as own. */
  viewer?: DidSyr;
  /** Positions to carry over, so an update does not restart the settle. */
  keep?: ReadonlyMap<OwnedRef, { x: number; y: number }>;
  /** {@link GraphSurfaceProps.fields} — the graphs on the canvas, in order. */
  fields?: readonly GraphField[];
  /** {@link GraphSurfaceProps.edgeLooks} — one resolved look per pair. A look
   *  naming a pair this canvas draws no line between is left where it is. */
  edgeLooks?: readonly GraphEdgeLook[];
  /** Two states being compared, the notes that went already standing in
   *  `drawn` — `nodesWithGone` in `contract.ts` is what puts them there. */
  difference?: GraphDifference;
}

/** A graph's name, where the canvas writes it, and how far its field reaches —
 *  world coordinates, so a name stays over the field it belongs to. */
export interface NamedField extends GraphField {
  x: number;
  y: number;
  minX: number;
  maxX: number;
}

/**
 * The lines a difference draws, as index pairs into {@link BuiltModel.order}:
 * the ones that arrived with a note and the ones that went with it. Not edges —
 * a line to the parent a note LEFT would otherwise pull it back there.
 */
export interface DifferenceLines {
  arrived: readonly number[];
  gone: readonly number[];
}

export interface BuiltModel {
  graph: GraphModel;
  /** The order the region was handed in — the layout indexes by position. */
  order: readonly OwnedRef[];
  /** Empty on a canvas drawing one graph, which needs no name to tell apart. */
  fields: readonly NamedField[];
  difference: DifferenceLines;
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
  const marks = differenceMarks(options.difference);
  // Two states that turn out to be the same ask nothing, so nothing recedes to
  // answer it — DESIGN.md § "A difference between two states".
  const comparing = marks.size > 0;
  const went = new Set(
    (options.difference?.removed ?? []).map((node) => node.ref),
  );

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
    const difference = marks.get(node.ref);
    // A note that went is a band around nothing: there is no mark inside it to
    // carry a look or a picture — DESIGN.md § "A difference between two states".
    const gone = difference === "gone";
    const answering =
      (options.selection.length === 0 || slot !== undefined) &&
      (!comparing || difference !== undefined);

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
      ringWeight: gone ? "none" : look.ringWeight,
      ringStyle: look.ringStyle,
      // A note that went is a band around nothing, so there is no rim to mark.
      codeMoved: !gone && (options.codeMoved?.has(node.ref) ?? false),
      preview: gone ? { ...look.preview, pictures: [] } : look.preview,
      previewCover: look.previewCover,
      ...(difference === undefined ? {} : { difference }),
      fill,
      alpha: answering ? 1 : options.palette.unselectedAlpha(fill),
      x: start.x,
      y: start.y,
      anchorX: seed.x,
      anchorY: seed.y,
      anchorStrength: SEED_ANCHOR,
    });
  });

  // One line per pair, and it is the strongest kind true of it — DESIGN.md
  // § Edges. Distance belongs to whichever line got there first, which is why
  // the two kinds the tree makes are laid before the two a person made: a
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
      // The edge is what holds a note that went beside the parent it hung from
      // while the field settles; the count is what a fold answers off, and a
      // note this state does not hold is nothing to fold.
      if (!went.has(node.ref)) {
        graph.updateNodeAttribute(
          node.parent,
          "children",
          (count) => (count ?? 0) + 1,
        );
      }
      join(node.parent, node.ref, "genealogy", () =>
        Math.max(
          EDGE_MIN,
          EDGE_FIRST * EDGE_DECAY ** Math.max(node.depth - 2, 0),
        ),
      );
    }
  }

  // Distance is the gap the pair's own seeds already sit at, so the run
  // reinforces the shape the genealogy fixed rather than pulling siblings
  // together — with the shared floor still holding the most crowded
  // generations apart.
  for (const [before, after] of runs(drawn, went)) {
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

  lookLines(graph, options.edgeLooks);

  return {
    graph,
    order: drawn.map((entry) => entry.node.ref),
    fields,
    difference: differenceLines(drawn, graph, marks, options.difference),
  };
}

/**
 * The looks onto the lines they are set on. A look draws on the line that is
 * already there and makes none: one naming a pair with no line between them —
 * two notes nothing joins, or an end this canvas is not drawing — is left where
 * it is. DESIGN.md § Edges, "A look a person set".
 */
function lookLines(
  graph: GraphModel,
  looks: readonly GraphEdgeLook[] | undefined,
): void {
  if (looks === undefined || looks.length === 0) return;
  const byPair = edgeLooksByPair(looks);
  graph.forEachEdge((edge, _attributes, source, target) => {
    const look = byPair.get(
      edgeLookKey(source as OwnedRef, target as OwnedRef),
    );
    if (look !== undefined) graph.setEdgeAttribute(edge, "look", look);
  });
}

/**
 * A move is a fact about a line and is drawn on the lines — DESIGN.md § "A
 * difference between two states". A note that arrived brought the line to its
 * parent with it and one that went took its own, so all three answer here.
 *
 * A pair with an end the canvas is not drawing — a parent outside the region,
 * or one a fold swallowed — draws no line: a line has to reach two marks.
 */
function differenceLines(
  drawn: readonly DrawnNode[],
  graph: GraphModel,
  marks: ReadonlyMap<OwnedRef, DifferenceMark>,
  difference: GraphDifference | undefined,
): DifferenceLines {
  const arrived: number[] = [];
  const gone: number[] = [];
  if (marks.size === 0) return { arrived, gone };

  const byRef = new Map(drawn.map((entry) => [entry.node.ref, entry.node]));
  const indexOf = (ref: OwnedRef | undefined): number | undefined =>
    ref !== undefined && graph.hasNode(ref)
      ? graph.getNodeAttributes(ref).index
      : undefined;
  const line = (
    into: number[],
    ref: OwnedRef,
    parent: OwnedRef | undefined,
  ): void => {
    const from = indexOf(ref);
    const to = indexOf(parent);
    if (from !== undefined && to !== undefined) into.push(from, to);
  };

  for (const { node } of drawn) {
    const mark = marks.get(node.ref);
    if (mark === "arrived") line(arrived, node.ref, node.parent);
    if (mark === "gone") line(gone, node.ref, node.parent);
  }
  for (const moved of difference?.moved ?? []) {
    line(arrived, moved.ref, byRef.get(moved.ref)?.parent);
    line(gone, moved.ref, moved.from);
  }
  return { arrived, gone };
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
 * Where each drawn note starts, and where each field's name is written. Every
 * graph is seeded onto the same ring, so on a canvas holding several the field a
 * note is in is what moves it, and the note's place inside its own field is
 * untouched.
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
 * graph. A note with no parent and no address lies in neither, so nothing runs
 * into it or out of it (`liesInARun`).
 *
 * `went` is the notes this state does not hold. They stand on the canvas to be
 * compared and take no place in the run — the two either side of one read as
 * consecutive, because they are (DESIGN.md § Edges).
 */
function runs(
  drawn: readonly DrawnNode[],
  went: ReadonlySet<OwnedRef>,
): [NodeView, NodeView][] {
  const levels = new Map<string, NodeView[]>();
  for (const { node } of drawn) {
    if (went.has(node.ref) || !liesInARun(node)) continue;
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
