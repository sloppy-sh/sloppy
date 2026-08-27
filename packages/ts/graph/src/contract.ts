// What a graph surface is handed and what it raises. DESIGN.md § "The canvas"
// draws the ownership line this expresses: the host owns which nodes exist, the
// surface owns pan, zoom and drag.

import type {
  FacetSlot,
  LabelDimensionView,
  NodeView,
  OwnedRef,
} from "@sloppy/types";

/**
 * The lens the graph is coloured by. The host resolves the slot because only
 * the reader's whole dimension list decides it — DESIGN.md § Hue.
 */
export interface GraphLens {
  dimension: LabelDimensionView;
  slot: FacetSlot;
}

export interface GraphSurfaceProps {
  /** The region to draw, in address order. */
  nodes: readonly NodeView[];
  /** Subtree roots to draw as one mega-node — {@link drawnNodes}. */
  collapsed: ReadonlySet<OwnedRef>;
  /** `null` is the genealogical view, which DESIGN.md § Hue draws monochrome. */
  lens: GraphLens | null;
  /**
   * Re-initialises the scene when it changes, and only then: a pan, a zoom or a
   * drag must never remount, or the viewport is lost on every gesture.
   */
  remountKey?: string;
  onOpenNode: (ref: OwnedRef) => void;
  /** Draw this mega-node's subtree instead of folding it. */
  onExpand: (ref: OwnedRef) => void;
  /** Fold this node's subtree into a mega-node. */
  onCollapse: (ref: OwnedRef) => void;
}

export interface DrawnNode {
  node: NodeView;
  /** This is a mega-node: the subtree under it is drawn as one. */
  collapsed: boolean;
  /** Descendants folded into it, which DESIGN.md § "The canvas" sizes it by. */
  folded: number;
}

/**
 * What `collapsed` means, executably: the nodes a surface draws, in the order it
 * was handed them, with everything under a collapsed ref folded into it.
 *
 * Ancestry is read from `parent` and only within `nodes`, so a node whose
 * ancestors the host has not loaded draws rather than disappearing. A node under
 * two collapsed ancestors folds into the outer one alone, so `folded` never
 * double-counts.
 */
export function drawnNodes(
  nodes: readonly NodeView[],
  collapsed: ReadonlySet<OwnedRef>,
): DrawnNode[] {
  const byRef = new Map(nodes.map((node) => [node.ref, node]));
  const folded = new Map<OwnedRef, number>();
  const visible: NodeView[] = [];

  for (const node of nodes) {
    const under = outermostCollapsed(node, byRef, collapsed);
    if (under) folded.set(under, (folded.get(under) ?? 0) + 1);
    else visible.push(node);
  }

  return visible.map((node) => ({
    node,
    collapsed: collapsed.has(node.ref),
    folded: folded.get(node.ref) ?? 0,
  }));
}

function outermostCollapsed(
  node: NodeView,
  byRef: ReadonlyMap<OwnedRef, NodeView>,
  collapsed: ReadonlySet<OwnedRef>,
): OwnedRef | undefined {
  let found: OwnedRef | undefined;
  let parent = node.parent;
  while (parent !== undefined) {
    const ancestor = byRef.get(parent);
    if (!ancestor) break;
    if (collapsed.has(ancestor.ref)) found = ancestor.ref;
    parent = ancestor.parent;
  }
  return found;
}
