// The drawn region as a graph, which is the one place node geometry, colour and
// adjacency are decided. The scene reads attributes off this and draws them; the
// layout reads the same attributes and moves them.

import type { Address, DidSyr, NodeView, OwnedRef } from "@sloppy/types";
import Graph from "graphology";
import type { DrawnNode, GraphLens } from "./contract.js";
import { clusterField, clusterSeed, seedField } from "./layout/geometry.js";
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

const SEED_ANCHOR = 0.035;
const CLUSTER_ANCHOR = 0.09;

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
  /** The active lens's value for this node, absent when it carries none. */
  facet: string | undefined;
  fill: number;
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  anchorStrength: number;
}

export interface GraphEdgeAttributes {
  kind: "genealogy" | "link";
  distance: number;
}

export type GraphModel = Graph<GraphNodeAttributes, GraphEdgeAttributes>;

export interface ModelOptions {
  lens: GraphLens | null;
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
  /** The lens's values in ramp order, empty without a lens. */
  facets: readonly string[];
}

export function buildModel(
  drawn: readonly DrawnNode[],
  options: ModelOptions,
): BuiltModel {
  const graph: GraphModel = new Graph({ type: "undirected" });
  const facets = options.lens ? facetOrder(drawn, options.lens) : [];
  const facetIndex = new Map(facets.map((value, at) => [value, at]));
  const seeds = seedField(drawn.map((entry) => entry.node.address));

  const population = new Map<string | undefined, number>();
  if (options.lens) {
    for (const { node } of drawn) {
      const value = node.labels[options.lens.dimension.name];
      population.set(value, (population.get(value) ?? 0) + 1);
    }
  }
  const clusters = clusterField(facets, population);

  drawn.forEach((entry, index) => {
    const { node } = entry;
    const facet = options.lens
      ? node.labels[options.lens.dimension.name]
      : undefined;
    const seed = seeds.get(node.address) ?? { x: 0, y: 0, outward: 0 };
    const start = options.lens
      ? clusterSeed(node.address, clusters, facet)
      : seed;
    const anchor = options.lens ? clusters.centre(facet) : seed;
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
      facet,
      fill: fillFor(entry, facet, facetIndex, facets.length, options),
      x: kept?.x ?? start.x,
      y: kept?.y ?? start.y,
      anchorX: anchor.x,
      anchorY: anchor.y,
      anchorStrength: options.lens ? CLUSTER_ANCHOR : SEED_ANCHOR,
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
    for (const target of node.links) {
      if (target !== node.ref && graph.hasNode(target)) {
        graph.mergeUndirectedEdge(node.ref, target, {
          kind: "link",
          distance: LINK_DISTANCE,
        });
      }
    }
  }

  return { graph, order: drawn.map((entry) => entry.node.ref), facets };
}

/**
 * The lens's values in the order the hue ramp walks: declared order first,
 * because that is the order the reader wrote them in, then whatever the region
 * turned out to carry, sorted so two peers reading the same region agree.
 */
export function facetOrder(
  drawn: readonly DrawnNode[],
  lens: GraphLens,
): string[] {
  const declared = lens.dimension.values;
  const known = new Set(declared);
  const extra = new Set<string>();
  for (const { node } of drawn) {
    const value = node.labels[lens.dimension.name];
    if (value !== undefined && !known.has(value)) extra.add(value);
  }
  return [...declared, ...[...extra].sort()];
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

function fillFor(
  entry: DrawnNode,
  facet: string | undefined,
  facetIndex: ReadonlyMap<string, number>,
  facetCount: number,
  options: ModelOptions,
): number {
  if (options.lens === null) return options.palette.depth(entry.node.depth);
  if (facet === undefined) return options.palette.unlabelled;
  const at = facetIndex.get(facet) ?? 0;
  return options.palette.facet(options.lens.slot, at, facetCount);
}
