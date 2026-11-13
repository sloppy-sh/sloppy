// What crosses the layout worker boundary. Structured-cloneable only: no class
// instances, no functions, and positions as a Float32Array so a settle frame is
// one transfer rather than several thousand property reads.

export interface LayoutNodeInput {
  x: number;
  y: number;
  radius: number;
  anchorX: number;
  anchorY: number;
  /** 0 lets the force pass decide alone; higher holds the seeded shape. */
  anchorStrength: number;
}

export interface LayoutEdgeInput {
  source: number;
  target: number;
  distance: number;
  strength: number;
}

export interface LayoutStart {
  kind: "start";
  /**
   * Which model these positions belong to. A reply carrying a stale epoch is
   * dropped rather than drawn: the alternative is the previous region's
   * coordinates landing on this one's nodes.
   */
  epoch: number;
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
  /**
   * How many times larger than the genealogy lays it out this field is drawn.
   * Every position and distance above is already times it, and a mark's radius
   * is not. 1 is the field as laid out; anything not above 0 is read as 1.
   */
  spread: number;
  /** The energy the settle starts at, in (0, 1]. Absent is 1: a field laid out
   *  afresh rather than one carried on from where it stands. */
  alpha?: number;
  /**
   * Run to convergence and answer once. DESIGN.md § Motion: reduced motion
   * jumps to the converged positions, and must never mean an unsettled graph.
   */
  settleAtOnce: boolean;
}

export interface LayoutPin {
  kind: "pin";
  epoch: number;
  index: number;
  x: number;
  y: number;
  /** `false` releases the node back to the simulation. */
  held: boolean;
}

export interface LayoutStop {
  kind: "stop";
}

export type LayoutCommand = LayoutStart | LayoutPin | LayoutStop;

export interface LayoutPositions {
  kind: "positions";
  epoch: number;
  /** `[x0, y0, x1, y1, …]`, indexed as `LayoutStart.nodes` was. */
  positions: Float32Array;
  /** The simulation's remaining energy; 0 once it has settled. */
  alpha: number;
  settled: boolean;
}

export type LayoutEvent = LayoutPositions;
