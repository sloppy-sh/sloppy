// Level of detail. DESIGN.md § "The canvas" states it as design rather than as
// optimisation: a subtree past a depth threshold from the focus draws as one
// mega-node, and neither mode ever draws more than a bounded node count —
// legibility and frame time being the same constraint.
//
// This only ever ADDS to what the host asked for. A host that collapses a
// subtree keeps it collapsed; a host that opens one gets it opened as far as the
// budget reaches, and the rest folds into mega-nodes it can tap through.

import type { NodeView, OwnedRef } from "@sloppy/types";

export interface LodBudget {
  /** Generations from the focus that draw in full before folding starts. */
  depth: number;
  /**
   * The bound on drawn marks. Held exactly, except against a focus whose own
   * spine already exceeds it: folding hides a node's CHILDREN, so the path from
   * the focus to its root and one generation off it cannot be folded away
   * without folding away the focus. {@link spineFloor} is that lower bound.
   */
  maxDrawn: number;
}

export const DEFAULT_BUDGET: LodBudget = { depth: 5, maxDrawn: 800 };

export interface LodResult {
  /** What to hand `drawnNodes`: the host's set plus what the budget folded. */
  collapsed: ReadonlySet<OwnedRef>;
  /** Only what the budget added, so a host can show that it happened. */
  folded: ReadonlySet<OwnedRef>;
}

/**
 * Fold `nodes` down to the budget, measured in tree hops from `focus` — or from
 * each node's own root when there is no focus, which is the whole-graph view.
 */
export function applyLod(
  nodes: readonly NodeView[],
  hostCollapsed: ReadonlySet<OwnedRef>,
  focus: OwnedRef | undefined,
  budget: LodBudget = DEFAULT_BUDGET,
): LodResult {
  const { children, byRef, distance } = walkFrom(nodes, focus);
  const collapsed = new Set(hostCollapsed);
  const folded = new Set<OwnedRef>();
  const hidden = new Set<OwnedRef>();
  let drawn = nodes.length;

  const fold = (ref: OwnedRef, byBudget: boolean): void => {
    if (hidden.has(ref)) return;
    if (!collapsed.has(ref)) {
      collapsed.add(ref);
      if (byBudget) folded.add(ref);
    }
    const stack = [...(children.get(ref) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (hidden.has(next)) continue;
      hidden.add(next);
      drawn -= 1;
      const under = children.get(next);
      if (under) stack.push(...under);
    }
  };

  for (const ref of hostCollapsed) if (byRef.has(ref)) fold(ref, false);

  // Hops count the same up the tree as down it, so the focus's own root is as
  // far away as a great-great-grandchild — and folding it would fold the focus
  // out of the view it is the focus of. The spine is off limits to the budget.
  const spine = new Set<OwnedRef>();
  for (
    let ref = focus;
    ref !== undefined && byRef.has(ref) && !spine.has(ref);
    ref = byRef.get(ref)?.parent
  ) {
    spine.add(ref);
  }

  // Nearest first, so the depth pass folds the node ON the boundary rather than
  // one of its descendants and leaves the mega-node where the reader expects it.
  const nearestFirst = nodes
    .filter(
      (node) =>
        (children.get(node.ref)?.length ?? 0) > 0 && !spine.has(node.ref),
    )
    .sort(
      (a, b) =>
        (distance.get(a.ref) ?? 0) - (distance.get(b.ref) ?? 0) ||
        a.depth - b.depth,
    );

  for (const node of nearestFirst) {
    if ((distance.get(node.ref) ?? 0) >= budget.depth) fold(node.ref, true);
  }

  for (let at = nearestFirst.length - 1; at >= 0; at--) {
    if (drawn <= budget.maxDrawn) break;
    fold(nearestFirst[at].ref, true);
  }

  return { collapsed, folded };
}

/**
 * The fewest marks a focus can be shown with: its own path to the root, every
 * child of that path, and every other tree folded to its root.
 */
export function spineFloor(
  nodes: readonly NodeView[],
  focus: OwnedRef | undefined,
): number {
  const byRef = new Map(nodes.map((node) => [node.ref, node]));
  if (focus === undefined || !byRef.has(focus)) {
    return nodes.filter((node) => node.parent === undefined).length;
  }

  const spine = new Set<OwnedRef>();
  for (
    let ref: OwnedRef | undefined = focus;
    ref !== undefined && byRef.has(ref) && !spine.has(ref);
    ref = byRef.get(ref)?.parent
  ) {
    spine.add(ref);
  }

  let kept = spine.size;
  for (const node of nodes) {
    if (spine.has(node.ref)) continue;
    const parent = node.parent;
    if (parent === undefined || spine.has(parent)) kept += 1;
  }
  return kept;
}

/** What a fold reads off the tree before it folds anything. */
interface LodWalk {
  children: ReadonlyMap<OwnedRef, OwnedRef[]>;
  byRef: ReadonlyMap<OwnedRef, NodeView>;
  distance: ReadonlyMap<OwnedRef, number>;
}

/**
 * The last walk, kept because the walk is a function of the nodes and the focus
 * alone: a tag question, a choice and a note opened all rebuild against the
 * same tree, and those are the rebuilds a reader spends the day making.
 */
let lastWalk:
  | { nodes: readonly NodeView[]; focus: OwnedRef | undefined; walk: LodWalk }
  | undefined;

function walkFrom(
  nodes: readonly NodeView[],
  focus: OwnedRef | undefined,
): LodWalk {
  if (lastWalk?.nodes === nodes && lastWalk.focus === focus)
    return lastWalk.walk;

  const children = new Map<OwnedRef, OwnedRef[]>();
  const byRef = new Map<OwnedRef, NodeView>();
  for (const node of nodes) {
    byRef.set(node.ref, node);
    if (node.parent !== undefined) {
      const list = children.get(node.parent);
      if (list) list.push(node.ref);
      else children.set(node.parent, [node.ref]);
    }
  }

  const walk: LodWalk = {
    children,
    byRef,
    distance: hopsFrom(nodes, children, byRef, focus),
  };
  lastWalk = { nodes, focus, walk };
  return walk;
}

/**
 * Hops from `focus` through the genealogical tree, in both directions — a
 * sibling of the focus is two hops away, not a whole branch away. Without a
 * focus, a node's own depth stands in, so the whole-graph view folds by
 * generation.
 */
function hopsFrom(
  nodes: readonly NodeView[],
  children: ReadonlyMap<OwnedRef, OwnedRef[]>,
  byRef: ReadonlyMap<OwnedRef, NodeView>,
  focus: OwnedRef | undefined,
): ReadonlyMap<OwnedRef, number> {
  const distance = new Map<OwnedRef, number>();
  if (focus === undefined || !byRef.has(focus)) {
    for (const node of nodes) distance.set(node.ref, node.depth - 1);
    return distance;
  }

  distance.set(focus, 0);
  let frontier: OwnedRef[] = [focus];
  while (frontier.length > 0) {
    const next: OwnedRef[] = [];
    for (const ref of frontier) {
      const hop = (distance.get(ref) ?? 0) + 1;
      const parent = byRef.get(ref)?.parent;
      const neighbours = [
        ...(parent !== undefined && byRef.has(parent) ? [parent] : []),
        ...(children.get(ref) ?? []),
      ];
      for (const neighbour of neighbours) {
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, hop);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  // A region the focus's tree does not reach — another root, or a pulled
  // subtree — is far away by definition, so it folds first.
  const unreached = Number.MAX_SAFE_INTEGER;
  for (const node of nodes) {
    if (!distance.has(node.ref)) distance.set(node.ref, unreached);
  }
  return distance;
}
