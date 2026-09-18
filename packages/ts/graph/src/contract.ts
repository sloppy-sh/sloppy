// What a graph surface is handed and what it raises. DESIGN.md § "The canvas"
// draws the ownership line this expresses: the host owns which nodes exist, the
// surface owns pan, zoom and drag.

import type {
  DidSyr,
  EdgeDirection,
  EdgeStroke,
  NodeView,
  OwnedRef,
  PictureTransition,
  Tag,
} from "@sloppy/types";
import type { GraphGround } from "./ground.js";

/**
 * A graph on the canvas: the ref its notes carry, and what its owner calls it.
 * Several of them draw as fields side by side, each named at its own field —
 * DESIGN.md § "Several graphs on one canvas".
 */
export interface GraphField {
  ref: OwnedRef;
  title: string;
}

/**
 * A look a person set on the line between two notes, oriented: `from` is the
 * note the look is stored on and `to` the note at the other end, which is what
 * `direction` is read against. The host hands one per pair, resolved through
 * `lookBetween` in `@sloppy/types`. An absent channel is DESIGN.md § Edges' own
 * value for that channel.
 */
export interface GraphEdgeLook {
  from: OwnedRef;
  to: OwnedRef;
  label?: string;
  direction?: EdgeDirection;
  stroke?: EdgeStroke;
}

/** The look on each pair, under a key that reads the same from either end —
 *  {@link edgeLookKey}. */
export type GraphEdgeLooks = ReadonlyMap<string, GraphEdgeLook>;

/** One pair's key, whichever order the pair is named in: a line is one line. */
export function edgeLookKey(a: OwnedRef, b: OwnedRef): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The looks a canvas was handed, keyed for lookup. A pair draws one line, so
 *  the first look on a pair is the one it draws — `looksRead` and `lookOn` in
 *  `@sloppy/types` keep the first too. */
export function edgeLooksByPair(
  looks: readonly GraphEdgeLook[] | undefined,
): GraphEdgeLooks {
  const byPair = new Map<string, GraphEdgeLook>();
  for (const look of looks ?? []) {
    const key = edgeLookKey(look.from, look.to);
    if (!byPair.has(key)) byPair.set(key, look);
  }
  return byPair;
}

/** The notes a picking canvas outlines, so a tap is answered before it lands. */
export interface GraphPickMarks {
  /** The note the choice is being made for. */
  from: OwnedRef;
  /** What `from` is already linked to BY HAND. A note its writing names is not
   *  one of these: drawing a link there is a second, independent connection,
   *  and it is the one that stays when the words go. DESIGN.md § Edges. */
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

/**
 * The notes open on the reading surface, and the one in front of the reader.
 *
 * A per-reader, per-device fact: nothing here is stored on a note and nothing
 * here reaches a peer.
 */
export interface GraphReadingMarks {
  /** Every note open, the active one included. */
  open: ReadonlySet<OwnedRef>;
  /** The one being read, of {@link open}; `null` while none of them is. */
  active: OwnedRef | null;
}

/**
 * How a picture reaches the canvas — a mark's preview, and the ground's own:
 * the host resolves one, because this package reaches no server and a raw
 * remote URL in a texture is the privacy bug it is in an `<img>`.
 *
 * `null` is nothing to draw — a picture the store no longer holds included — and
 * what asked for it then draws exactly as it does with no picture. `release`
 * frees whatever `src` held; the canvas calls it once it is done with the bytes.
 */
export interface GraphPictures {
  read(picture: string): Promise<{ src: string; release: () => void } | null>;
}

/**
 * A picture under the field — a ground, like the paper it is laid behind, and
 * nothing about any note. DESIGN.md § "The wallpaper".
 */
export interface GraphWallpaper {
  /** The picture showing, named as {@link GraphSurfaceProps.pictures} resolves
   *  one. `null` draws no wallpaper. Whose turn it is among several is the
   *  host's to read, off `pictureTurn` in `@sloppy/types`. */
  picture: string | null;
  /**
   * How much of it the reader asked for, 0–1 of what this ground can carry.
   * What that is comes from the theme — `paperCeiling` in `palette.ts` — so a
   * host asking for 1 gets the most the floors allow rather than a raw picture.
   */
  strength: number;
  /** How one picture gives way to the next. Absent crossfades, which is what a
   *  reader who has chosen nothing gets. */
  transition?: PictureTransition;
}

/**
 * The room the host's chrome takes, as CSS lengths. The ground covers the
 * surface whole either way — DESIGN.md § "The wallpaper" — so this holds the
 * marks off the chrome without cutting the picture out from behind it. A bottom
 * length owes DESIGN.md § "The four inset vars", never a bare `env()`.
 */
export interface GraphFieldInset {
  /** Absent is the surface's own edge. */
  top?: string;
  bottom?: string;
}

/**
 * Where the field is looking, in the coordinates of the ink layer the mount
 * hands back: a world point `(wx, wy)` is drawn there at
 * `(wx * scale + x, wy * scale + y)`.
 */
export interface GraphTransform {
  x: number;
  y: number;
  scale: number;
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

/**
 * A mark a pointer has come to rest on, and where it is drawn — so a preview can
 * be placed clear of the mark rather than under the pointer.
 */
export interface GraphHoverAt {
  ref: OwnedRef;
  /** The mark's centre, in viewport coordinates. */
  clientX: number;
  clientY: number;
  /** What it is drawn at now, in CSS pixels. */
  radius: number;
  /** Descendants folded into it: 0 unless this is a mega-node. */
  folded: number;
  /** Every tag the MARK stands for, which on a mega-node is the subtree's and
   *  not the one note's — the hue it is drawn in answers off these. */
  tags: readonly Tag[];
}

/**
 * What a note is between the two states being compared — DESIGN.md § "A
 * difference between two states". A mark carries exactly one, and a note
 * several of these are true of takes the first: one that both moved and was
 * written into is `changed`, with the move on its lines.
 */
export type DifferenceMark = "gone" | "arrived" | "changed" | "moved";

/** A note both states hold, hanging from another parent in the earlier one. */
export interface GraphNoteMoved {
  ref: OwnedRef;
  /** The parent it left. Absent is one that hung from nothing then — a branch,
   *  or an independent note. */
  from?: OwnedRef;
}

/**
 * Two states of a graph, as what a person did between them and keyed by ref the
 * way `vaultDifference` answers. Present with nothing in it is two states that
 * are the same, and draws the graph exactly as no difference does.
 */
export interface GraphDifference {
  /** In the later state, and not in the earlier one. */
  added: ReadonlySet<OwnedRef>;
  /**
   * The notes the earlier state held and the later one does not, each carrying
   * the parent it hung from then: {@link GraphSurfaceProps.nodes} is the later
   * state, so a note that went can only be drawn where it was if the region is
   * handed it.
   */
  removed: readonly NodeView[];
  /** In both states, under another parent. An address a person edited is not
   *  one of these — a label moves no mark. */
  moved: readonly GraphNoteMoved[];
  /** In both states and not as it was — retitled, renumbered and written into
   *  alike, since one mark cannot carry a set. */
  changed: ReadonlySet<OwnedRef>;
}

/** The one value each note the difference names draws, by {@link
 *  DifferenceMark}'s order. */
export function differenceMarks(
  difference: GraphDifference | undefined,
): ReadonlyMap<OwnedRef, DifferenceMark> {
  const marks = new Map<OwnedRef, DifferenceMark>();
  if (difference === undefined) return marks;
  for (const { ref } of difference.moved) marks.set(ref, "moved");
  for (const ref of difference.changed) marks.set(ref, "changed");
  for (const ref of difference.added) marks.set(ref, "arrived");
  for (const node of difference.removed) marks.set(node.ref, "gone");
  return marks;
}

/** Whether two states are actually being compared. A difference that names
 *  nothing is two states that are the same. */
export function comparingStates(
  difference: GraphDifference | undefined,
): boolean {
  if (difference === undefined) return false;
  return (
    difference.added.size > 0 ||
    difference.removed.length > 0 ||
    difference.moved.length > 0 ||
    difference.changed.size > 0
  );
}

/**
 * The region with the notes that went standing back in it, so the seeding puts
 * each one where the earlier state drew it. Answers `nodes` itself where
 * nothing went, so a canvas with no difference on it rebuilds off the array it
 * was handed.
 */
export function nodesWithGone(
  nodes: readonly NodeView[],
  difference: GraphDifference | undefined,
): readonly NodeView[] {
  const gone = difference?.removed ?? [];
  if (gone.length === 0) return nodes;
  const held = new Set(nodes.map((node) => node.ref));
  return [...nodes, ...gone.filter((node) => !held.has(node.ref))];
}

export interface GraphSurfaceProps {
  /** The region to draw. */
  nodes: readonly NodeView[];
  /**
   * The graphs on the canvas, in the order the reader put them there. Fewer
   * than two is one field, drawn where the genealogy alone puts it and named
   * only in the chrome: with nothing to tell apart there is no question for a
   * name on the canvas to answer.
   */
  fields?: readonly GraphField[];
  /** Subtree roots to draw as one mega-node — {@link drawnNodes}. */
  collapsed: ReadonlySet<OwnedRef>;
  /**
   * The looks the reader's own notes set on the lines between them, one per
   * pair. Absent, and empty, are a canvas where every line draws as DESIGN.md
   * § Edges alone says it should.
   *
   * A look naming a pair this canvas draws no line between draws nothing: a
   * look makes no line, moves no mark and changes no distance.
   */
  edgeLooks?: readonly GraphEdgeLook[];
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
   * The notes another question about this graph names — the review's chosen
   * signal, DESIGN.md § "What the code left behind". They stay in ink and every
   * other note dims, exactly as a tag question dims what carries none of its
   * tags; a note has to answer both to stay lit while both are being asked.
   *
   * Absent is a canvas nobody has asked this of, which is not the same as an
   * empty set — that is a question nothing answered, and dims the field.
   */
  lit?: ReadonlySet<OwnedRef>;
  /**
   * Re-initialises the scene when it changes, and only then: a pan, a zoom or a
   * drag must never remount, or the viewport is lost on every gesture.
   */
  remountKey?: string;
  inset?: GraphFieldInset;
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
  /**
   * Two states of this graph being compared. The notes it names are left as
   * they are and everything else dims, and nothing is picked or chosen while
   * one is up — DESIGN.md § "A difference between two states". The canvas holds
   * that last part itself: while this names anything, {@link picking} and
   * {@link chosen} alongside it are refused rather than drawn, and a tap opens
   * the note under it.
   *
   * The notes it says went are drawn alongside `nodes`, which the region itself
   * no longer holds; a canvas is otherwise handed the later state.
   */
  difference?: GraphDifference;
  /** Absent means a tap opens the note under it. */
  picking?: GraphPicking;
  /**
   * The notes open on the reading surface — DESIGN.md § "The mark" lifts these
   * off the paper, and lifts the active one further. Absent is a canvas with
   * nothing open on it.
   *
   * Separate from {@link focus}, which measures level of detail in hops and
   * says nothing about how a mark is drawn.
   */
  reading?: GraphReadingMarks;
  /** Read once, as the canvas starts: absent draws every mark without the
   *  picture its author gave it. */
  pictures?: GraphPictures;
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
  /**
   * A mark a POINTER has come to rest on, and `null` for one it has left. Never
   * raised for a finger — hover does not exist on touch, so nothing may be put
   * behind this that a tap cannot also reach. It stays quiet through a pan, a
   * drag, and a canvas somebody is picking or choosing on.
   */
  onHover?: (at: GraphHoverAt | null) => void;
  /**
   * The paper the field is drawn on: a reader's own view choice, and nothing the
   * notes say. Absent draws no ground at all.
   */
  ground?: GraphGround;
  /** A picture behind that paper. Absent is the plain theme, and the two are
   *  independent: a reader may have either, both or neither. */
  wallpaper?: GraphWallpaper;
  onOpenNode: (ref: OwnedRef) => void;
  /**
   * A tap that landed on a LINE rather than on a mark, naming the two notes it
   * joins in the order the canvas drew it. The pair is unordered as far as the
   * answer goes — a look on either note is the line's — so a host opening a
   * sheet reads both ends.
   *
   * Absent leaves a tap on a line doing nothing, which is every canvas today.
   * It stays quiet while {@link GraphSurfaceProps.picking}, a chosen set or a
   * {@link GraphSurfaceProps.difference} is up: those already say what a tap
   * means.
   */
  onEdge?: (from: OwnedRef, to: OwnedRef) => void;
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
  /**
   * Where the field is looking, raised once the canvas is up and again whenever
   * it moves — a pan, a zoom, a frame, a mark the canvas came to. What is drawn
   * into the ink layer reads this to stay on the marks under it.
   */
  onTransform?: (transform: GraphTransform) => void;
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

/**
 * {@link drawnNodes}'s resolution applied to {@link GraphReadingMarks}: an open
 * note a fold swallowed is carried by the mega-node that swallowed it, so the
 * canvas and the surface listing it never disagree — DESIGN.md § "The mark".
 *
 * A ref outside `nodes` is left as it is, and lifts nothing.
 */
export function drawnReading(
  nodes: readonly NodeView[],
  collapsed: ReadonlySet<OwnedRef>,
  reading: GraphReadingMarks,
): GraphReadingMarks {
  const onto = drawnAs(nodes, collapsed);
  return {
    open: new Set([...reading.open].map(onto)),
    active: reading.active === null ? null : onto(reading.active),
  };
}

/**
 * {@link drawnNodes}'s resolution applied to {@link GraphSurfaceProps.lit}: a
 * named note a fold swallowed is answered for by the mega-node that swallowed
 * it, the way that mega-node carries the tags of everything under it.
 */
export function drawnLit(
  nodes: readonly NodeView[],
  collapsed: ReadonlySet<OwnedRef>,
  lit: ReadonlySet<OwnedRef>,
): ReadonlySet<OwnedRef> {
  return new Set([...lit].map(drawnAs(nodes, collapsed)));
}

/** Where a ref is drawn: itself, or the mega-node it folded into. A ref outside
 *  `nodes` is left as it is. */
function drawnAs(
  nodes: readonly NodeView[],
  collapsed: ReadonlySet<OwnedRef>,
): (ref: OwnedRef) => OwnedRef {
  const byRef = new Map(nodes.map((node) => [node.ref, node]));
  return (ref) => {
    const node = byRef.get(ref);
    return node ? (outermostCollapsed(node, byRef, collapsed) ?? ref) : ref;
  };
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
