// The drawn region as a graph, which is the one place node geometry, colour and
// adjacency are decided. The scene reads attributes off this and draws them; the
// layout reads the same attributes and moves them.

import {
  assignTagHueSlots,
  type Address,
  type DidSyr,
  type EdgeKind,
  graphOf,
  type MarkRadius,
  type NodeView,
  type OwnedRef,
  type PictureSeries,
  type PreviewSize,
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
import { MAX_SCALE } from "./viewport.js";

/** DESIGN.md § Form: provenance survives greyscale, so it is never a hue. */
export type Provenance = "own" | "published" | "pulled";

/** The two ends of what a mark is drawn at: a leaf with nothing set, and the
 *  cap a mega-node grows to. */
export const LEAF_RADIUS = 9;
const MEGA_GROWTH = 0.42;
export const MAX_RADIUS = 46;

/** What a look multiplies a mark's radius by. DESIGN.md § "The mark" carries the
 *  ladder, and the ruling that the fold's cap is scaled by it rather than
 *  capping it again. */
export const LOOK_SCALE: Record<MarkRadius, number> = {
  small: 0.78,
  regular: 1,
  large: 1.34,
  huge: 1.8,
  giant: 2.4,
};

/** The largest mark any canvas draws: the fold's cap at the top of the ladder.
 *  Everything sized for the worst case a mark can be is sized off this. */
export const LADDER_TOP = Math.max(...Object.values(LOOK_SCALE));
export const WIDEST_RADIUS = MAX_RADIUS * LADDER_TOP;

/** A look's ring, as fractions of the mark's radius — its centre line, and what
 *  each weight strokes. Inside the mark, since the edge is provenance's. */
export const LOOK_RING_AT = 0.6;
export const LOOK_RING_WIDTH: Record<Exclude<RingWeight, "none">, number> = {
  hairline: 0.075,
  regular: 0.14,
  heavy: 0.22,
};
/** Dashes around a broken one, and how much of each one's turn is drawn — the
 *  rest is the gap, which `scene.test.ts` keeps wider than the heaviest stroke. */
export const LOOK_RING_DASHES = 7;
export const LOOK_RING_DUTY = 0.4;

/** What a picture covers where its author has not chosen a size. */
export const PREVIEW_AT = 0.42;

/**
 * How much of the mark's radius the picture covers, at each size an author may
 * ask for. What is left is the fill the reader's selected tags answer in, and
 * the look's ring is the ceiling — DESIGN.md § "The mark" carries both bounds,
 * and `scene.test.ts` measures them against the radii `scene.ts` draws at.
 */
export const PREVIEW_SPAN: Record<PreviewSize, number> = {
  small: PREVIEW_AT,
  medium: LOOK_RING_AT - LOOK_RING_WIDTH.heavy / 2,
  large: LOOK_RING_AT,
};

/** Assumed of the densest screen Sloppy runs on. */
const DENSE_SCREEN = 2;

/**
 * The side of the square a picture is STORED at: the most any mark could ever
 * show of it — the biggest mega-node at the top of the ladder, wearing the
 * largest picture, at full zoom, on a dense display. A picture is stored with
 * its SHORT side at this, because the crop spends the long one.
 *
 * The cut is taken once, when somebody chooses the file, and the look it is
 * chosen for goes on being edited afterwards — so it is cut for the size the
 * look could reach rather than the size it happens to be. What a MARK decodes is
 * the other budget, and {@link markPictureSide} is that one.
 */
export const MARK_PICTURE_PX = Math.ceil(
  WIDEST_RADIUS * PREVIEW_SPAN.large * 2 * MAX_SCALE * DENSE_SCREEN,
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
export function markPictureSide(radius: number, size: PreviewSize): number {
  const wanted = radius * PREVIEW_SPAN[size] * 2 * MAX_SCALE * DENSE_SCREEN;
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
  address: Address;
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
  /** The share of the mark it covers — {@link PREVIEW_SPAN}. */
  previewSize: PreviewSize;
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

  drawn.forEach((entry, index) => {
    const { node } = entry;
    const tag = earliestSelected(entry.tags, rank);
    const slot = tag === undefined ? undefined : slots.get(tag);
    const seed = seedOf(node);
    const kept = options.keep?.get(node.ref);
    // A mega-node wears the look of the note it IS, never an average of the
    // looks it folded — DESIGN.md § "The mark".
    const look =
      node.appearance == null ? UNSTYLED : resolveAppearance(node.appearance);

    graph.addNode(node.ref, {
      index,
      ref: node.ref,
      address: node.address,
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
      previewSize: look.previewSize,
      fill:
        slot === undefined
          ? options.palette.depth(node.depth)
          : options.palette.tag(slot),
      alpha:
        slot === undefined && options.selection.length > 0
          ? options.palette.unselectedAlpha
          : 1,
      x: kept?.x ?? seed.x,
      y: kept?.y ?? seed.y,
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
    const seeds = seedField(drawn.map((entry) => entry.node.address));
    return { seedOf: (node) => seeds.get(node.address) ?? ORIGIN, fields: [] };
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
    order.map((of) => [
      of,
      seedField((byField.get(of) ?? []).map((node) => node.address)),
    ]),
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
      const seed = seeds.get(of)?.get(node.address);
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
  const scale = LOOK_SCALE[look.markRadius];
  if (entry.folded === 0) return LEAF_RADIUS * scale;
  const grown = LEAF_RADIUS * (1 + Math.log2(1 + entry.folded) * MEGA_GROWTH);
  // The cap is the fold's, so the author's step scales it too: a bigger step
  // draws bigger at every fold, which a flat cap took away from exactly the
  // mega-nodes a step is asked for — DESIGN.md § "The mark".
  return Math.min(grown * scale, MAX_RADIUS * scale);
}

function provenanceOf(node: NodeView, viewer: DidSyr | undefined): Provenance {
  if (viewer !== undefined && node.created_by !== viewer) return "pulled";
  return node.published ? "published" : "own";
}
