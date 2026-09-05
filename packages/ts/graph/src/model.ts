// The drawn region as a graph, which is the one place node geometry, colour and
// adjacency are decided. The scene reads attributes off this and draws them; the
// layout reads the same attributes and moves them.

import {
  assignTagHueSlots,
  type Address,
  type DidSyr,
  graphOf,
  type MarkRadius,
  type NodeView,
  type OwnedRef,
  type PreviewSize,
  type ResolvedAppearance,
  resolveAppearance,
  type RingStyle,
  type RingWeight,
  runKeyOf,
  runPairs,
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
 *  ladder and what a step of it may reach. */
export const LOOK_SCALE: Record<MarkRadius, number> = {
  small: 0.78,
  regular: 1,
  large: 1.34,
  huge: 1.8,
  giant: 2.4,
};

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

/** Assumed of the densest screen Sloppy runs on, for {@link MARK_PICTURE_PX}. */
const DENSE_SCREEN = 2;

/** The side of the square a mark's picture is cropped to, at the most of one a
 *  screen ever shows: the biggest mega-node wearing the largest picture, at full
 *  zoom, on a dense display. A picture is stored with its SHORT side at this,
 *  because the crop spends the long one. */
export const MARK_PICTURE_PX = Math.ceil(
  MAX_RADIUS * PREVIEW_SPAN.large * 2 * MAX_SCALE * DENSE_SCREEN,
);

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
  /** The picture the mark draws, as an upload only their own instance can answer
   *  for: the one its author's series starts at. */
  preview: string | undefined;
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
  kind: "genealogy" | "run" | "connection";
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
      preview: look.preview.pictures[0],
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

  for (const { node } of drawn) {
    if (node.parent !== undefined && graph.hasNode(node.parent)) {
      graph.updateNodeAttribute(
        node.parent,
        "children",
        (count) => (count ?? 0) + 1,
      );
      graph.mergeUndirectedEdge(node.parent, node.ref, {
        kind: "genealogy",
        distance: Math.max(
          EDGE_MIN,
          EDGE_FIRST * EDGE_DECAY ** Math.max(node.depth - 2, 0),
        ),
      });
    }
  }

  // Distance is the gap the pair's own seeds already sit at, so the run
  // reinforces the shape the addresses fixed rather than pulling siblings
  // together — with the shared floor still holding the most crowded
  // generations apart.
  for (const [before, after] of runs(drawn)) {
    const from = graph.getNodeAttributes(before.ref);
    const to = graph.getNodeAttributes(after.ref);
    graph.mergeUndirectedEdge(before.ref, after.ref, {
      kind: "run",
      distance: Math.max(
        EDGE_MIN,
        Math.hypot(to.anchorX - from.anchorX, to.anchorY - from.anchorY),
      ),
    });
  }

  // Last, so a connection somebody made stays drawn as one even where the run
  // or the tree already joins those two. Merged rather than added, so a pair
  // connected both ways is the one line DESIGN.md § Edges calls for.
  for (const { node } of drawn) {
    for (const target of connectedTo(node)) {
      if (target === node.ref || !graph.hasNode(target)) continue;
      const already = graph.undirectedEdge(node.ref, target);
      graph.mergeUndirectedEdge(node.ref, target, {
        kind: "connection",
        // A connection changes how the line is drawn, never how far apart the
        // two notes sit: that is the addresses' to set — DESIGN.md § Edges.
        distance:
          already === undefined
            ? CONNECTION_DISTANCE
            : graph.getEdgeAttribute(already, "distance"),
      });
    }
  }

  return { graph, order: drawn.map((entry) => entry.node.ref), fields };
}

/** The notes a note is connected to, drawn by hand and derived from its own
 *  writing alike. Absent `references` is a note nothing derived them for.
 *  DESIGN.md § Edges. */
function connectedTo(node: NodeView): readonly OwnedRef[] {
  return node.references === undefined
    ? node.links
    : [...node.links, ...node.references];
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
  return Math.min(grown * scale, MAX_RADIUS);
}

function provenanceOf(node: NodeView, viewer: DidSyr | undefined): Provenance {
  if (viewer !== undefined && node.created_by !== viewer) return "pulled";
  return node.published ? "published" : "own";
}
