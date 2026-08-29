// The drawn region as a graph, which is the one place node geometry, colour and
// adjacency are decided. The scene reads attributes off this and draws them; the
// layout reads the same attributes and moves them.

import {
  assignTagHueSlots,
  type Address,
  compareAddresses,
  type DidSyr,
  type NodeView,
  type OwnedRef,
  type Tag,
} from "@sloppy/types";
import Graph from "graphology";
import type { DrawnNode } from "./contract.js";
import { seedField } from "./layout/geometry.js";
import type { GraphPalette } from "./palette.js";

/** DESIGN.md § Form: provenance survives greyscale, so it is never a hue. */
export type Provenance = "own" | "published" | "pulled";

const LEAF_RADIUS = 9;
const MEGA_GROWTH = 0.42;
const MAX_RADIUS = 46;

const EDGE_FIRST = 300;
const EDGE_DECAY = 0.8;
const EDGE_MIN = 34;
const LINK_DISTANCE = 520;

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
  /**
   * The selected tag this mark draws the hue of: the earliest-selected of the
   * ones it stands for ({@link DrawnNode.tags}), absent when it stands for
   * none. DESIGN.md § Hue — one mark, one hue.
   */
  tag: Tag | undefined;
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
  kind: "genealogy" | "run" | "link";
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
}

export interface BuiltModel {
  graph: GraphModel;
  /** Drawn order, which is address order — the layout indexes by position. */
  order: readonly OwnedRef[];
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
  const seeds = seedField(drawn.map((entry) => entry.node.address));

  drawn.forEach((entry, index) => {
    const { node } = entry;
    const tag = earliestSelected(entry.tags, rank);
    const slot = tag === undefined ? undefined : slots.get(tag);
    const seed = seeds.get(node.address) ?? { x: 0, y: 0, outward: 0 };
    const kept = options.keep?.get(node.ref);

    graph.addNode(node.ref, {
      index,
      ref: node.ref,
      address: node.address,
      depth: node.depth,
      title: node.title,
      collapsed: entry.collapsed,
      folded: entry.folded,
      radius: radiusFor(entry),
      provenance: provenanceOf(node, options.viewer),
      children: 0,
      tag,
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

  // Held at the gap between the two seeds, so the run reinforces the shape the
  // addresses already fixed rather than pulling against it.
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

  // Last, so a link somebody drew stays drawn as one even where the run or the
  // genealogy already joins those two.
  for (const { node } of drawn) {
    for (const target of node.links) {
      if (target !== node.ref && graph.hasNode(target)) {
        graph.mergeUndirectedEdge(node.ref, target, {
          kind: "link",
          distance: LINK_DISTANCE,
        });
      }
    }
  }

  return { graph, order: drawn.map((entry) => entry.node.ref) };
}

/**
 * The run of thought, in pairs: at every level, each drawn note and the one
 * that comes next along it. A note deleted out of the middle of a run leaves
 * the two either side of it consecutive, and they draw as consecutive.
 */
function runs(drawn: readonly DrawnNode[]): [NodeView, NodeView][] {
  const levels = new Map<string, NodeView[]>();
  for (const { node } of drawn) {
    const level = node.parent ?? node.created_by;
    const alongside = levels.get(level);
    if (alongside === undefined) levels.set(level, [node]);
    else alongside.push(node);
  }

  const pairs: [NodeView, NodeView][] = [];
  for (const alongside of levels.values()) {
    alongside.sort((a, b) => compareAddresses(a.address, b.address));
    for (let at = 1; at < alongside.length; at++) {
      pairs.push([alongside[at - 1], alongside[at]]);
    }
  }
  return pairs;
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

function radiusFor(entry: DrawnNode): number {
  if (entry.folded === 0) return LEAF_RADIUS;
  const grown = LEAF_RADIUS * (1 + Math.log2(1 + entry.folded) * MEGA_GROWTH);
  return Math.min(grown, MAX_RADIUS);
}

function provenanceOf(node: NodeView, viewer: DidSyr | undefined): Provenance {
  if (viewer !== undefined && node.created_by !== viewer) return "pulled";
  return node.published ? "published" : "own";
}
