// What a graph surface is handed and what it raises. DESIGN.md § "The canvas"
// draws the ownership line this expresses: the host owns which nodes exist, the
// surface owns pan, zoom and drag.

import type { DidSyr, NodeView, OwnedRef, Tag } from "@sloppy/types";

/** The notes a picking canvas outlines, so a tap is answered before it lands. */
export interface GraphPickMarks {
  /** The note the choice is being made for. */
  from: OwnedRef;
  /** What `from` already points at. */
  taken: ReadonlySet<OwnedRef>;
}

/**
 * A choice being asked for on the canvas rather than a note to open. Pan, pinch
 * and mega-node expansion are unchanged while one is on, because the note has to
 * be found before it can be picked.
 */
export interface GraphPicking extends GraphPickMarks {
  /** The note tapped: any drawn note but {@link GraphPickMarks.from}, a `taken`
   *  one included — that tap is the reader saying the link they want is the one
   *  already there. */
  onPick: (ref: OwnedRef) => void;
}

/** Where a menu was asked for, and what it was asked on. */
export interface GraphMenuAt {
  /** Viewport coordinates, so the menu can be placed against the screen. */
  clientX: number;
  clientY: number;
  /** The note under the point; null on bare canvas, where the acts differ. */
  ref: OwnedRef | null;
  /** This note has drawn children, so there is something for a fold to gather. */
  foldable: boolean;
}

export interface GraphSurfaceProps {
  /** The region to draw, in address order. */
  nodes: readonly NodeView[];
  /** Subtree roots to draw as one mega-node — {@link drawnNodes}. */
  collapsed: ReadonlySet<OwnedRef>;
  /**
   * The tags the reader selected, in the order they selected them — the order
   * `assignTagHueSlots` hands out the hues in. Empty is the monochrome
   * genealogical view DESIGN.md § Hue calls for when nothing has been asked.
   *
   * Notes carrying none of these dim; they are never dropped, so the shape the
   * answer is read against stays on the canvas.
   */
  selection: readonly Tag[];
  /**
   * Re-initialises the scene when it changes, and only then: a pan, a zoom or a
   * drag must never remount, or the viewport is lost on every gesture.
   */
  remountKey?: string;
  /**
   * Who is reading. DESIGN.md § Form draws provenance, and without this every
   * node reads as the reader's own — so a surface that leaves it out is saying
   * nothing about provenance rather than saying something wrong.
   */
  viewer?: DidSyr;
  /**
   * Where the reader is looking. Level of detail is measured in hops from here
   * (`lod.ts`); absent means the whole graph, folded by generation.
   */
  focus?: OwnedRef;
  /** Absent means a tap opens the note under it. */
  picking?: GraphPicking;
  /**
   * The notes somebody has picked out to act on — DESIGN.md § "The mark" calls
   * this the chosen set, and never a selection, because `selection` above is
   * already the reader's tags.
   *
   * PRESENT is a canvas somebody is choosing on, an empty set included: a tap
   * then adds or removes rather than opening. Absent is the ordinary canvas.
   */
  chosen?: ReadonlySet<OwnedRef>;
  /** Add or remove one note. Absent is a surface nothing can be chosen on. */
  onChoose?: (ref: OwnedRef) => void;
  /** Add every note a sweep enclosed — a mouse with shift, control or command
   *  held, dragged over bare canvas. Absent leaves that drag panning. */
  onChooseWithin?: (refs: readonly OwnedRef[]) => void;
  /**
   * A menu asked for on the canvas: a right-click, or a press and hold.
   * Absent leaves a press and hold folding the note under it.
   */
  onMenu?: (at: GraphMenuAt) => void;
  onOpenNode: (ref: OwnedRef) => void;
  /** Draw this mega-node's subtree instead of folding it. */
  onExpand: (ref: OwnedRef) => void;
  /** Fold this node's subtree into a mega-node. */
  onCollapse: (ref: OwnedRef) => void;
  /**
   * Every pen event over the canvas, with the point it lands on in graph
   * coordinates so a stroke stays where it was drawn through a pan or a zoom.
   * Absent means this surface has nothing to ink into, and a stylus pans.
   */
  onInkPointer?: (event: PointerEvent, world: { x: number; y: number }) => void;
}

export interface DrawnNode {
  node: NodeView;
  /** This is a mega-node: the subtree under it is drawn as one. */
  collapsed: boolean;
  /** Descendants folded into it, which DESIGN.md § "The canvas" sizes it by. */
  folded: number;
  /**
   * Every tag this mark stands for: its own and those of everything folded into
   * it, because a mega-node answers for the subtree it replaced.
   */
  tags: readonly Tag[];
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
  const carried = new Map<OwnedRef, Set<Tag>>();
  const visible: NodeView[] = [];

  for (const node of nodes) {
    const under = outermostCollapsed(node, byRef, collapsed);
    if (under === undefined) {
      visible.push(node);
      continue;
    }
    folded.set(under, (folded.get(under) ?? 0) + 1);
    let tags = carried.get(under);
    if (tags === undefined) carried.set(under, (tags = new Set()));
    for (const tag of node.tags) tags.add(tag);
  }

  return visible.map((node) => ({
    node,
    collapsed: collapsed.has(node.ref),
    folded: folded.get(node.ref) ?? 0,
    tags: withFolded(node.tags, carried.get(node.ref)),
  }));
}

function withFolded(
  own: readonly Tag[],
  folded: ReadonlySet<Tag> | undefined,
): readonly Tag[] {
  if (folded === undefined) return own;
  const all = new Set(own);
  for (const tag of folded) all.add(tag);
  return [...all];
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
