// Where a node starts before the simulation touches it.
//
// Seeds are a pure function of the address and nothing else, which is the point:
// AI.md § "The Address Is the Protocol" says a subtree radiates the same way on
// every peer, and it can only do that if no coordinate is ever shipped. The
// force pass then resolves overlap around a shape the protocol already fixed.

import {
  type Address,
  addressSector,
  formatAddress,
  parseAddress,
} from "@sloppy/types";

const TAU = Math.PI * 2;

/** Roots sit on this ring; their subtrees radiate outward from it. */
const ROOT_RADIUS = 1400;
const STEP_FIRST = 300;
const STEP_DECAY = 0.8;
/** The widest a child may lean off its parent's outward direction. */
const SPREAD_FIRST = 1.15;
const SPREAD_DECAY = 0.66;
/**
 * How much of a child's lean comes from its ordinal rather than its sector.
 * Ordinal alone fans siblings in reading order; sector alone gives the subtree
 * the direction every peer agrees on. Both are address-pure, so both are kept.
 */
const FAN_WEIGHT = 0.7;
/** Saturates the ordinal fan, so 23 siblings still fit inside one spread. */
const FAN_SOFT = 3;

export interface SeedPoint {
  x: number;
  y: number;
  /** The direction this node's own children leave it in, in radians. */
  outward: number;
}

/**
 * Seed every address, memoised over shared prefixes — a tree shares almost all
 * of its prefixes, so this stays close to linear in the node count.
 */
export function seedField(
  addresses: Iterable<Address>,
): ReadonlyMap<Address, SeedPoint> {
  const seeds = new Map<Address, SeedPoint>();
  for (const address of addresses) seedAt(address, seeds);
  return seeds;
}

/** One address's seed. Total over valid addresses, and free of any clock. */
export function seedAddress(address: Address): SeedPoint {
  return seedAt(address, new Map());
}

function seedAt(address: Address, memo: Map<Address, SeedPoint>): SeedPoint {
  const hit = memo.get(address);
  if (hit) return hit;

  const segments = parseAddress(address);
  let point: SeedPoint;

  if (segments.length === 1) {
    const outward = addressSector(address);
    point = {
      x: Math.cos(outward) * ROOT_RADIUS,
      y: Math.sin(outward) * ROOT_RADIUS,
      outward,
    };
  } else {
    const parent = seedAt(formatAddress(segments.slice(0, -1)), memo);
    const depth = segments.length;
    const lean =
      spreadAt(depth) *
      (FAN_WEIGHT * fanOffset(segments[depth - 1].ordinal) +
        (1 - FAN_WEIGHT) * signedUnit(addressSector(address)));
    const outward = parent.outward + lean;
    const step = STEP_FIRST * STEP_DECAY ** (depth - 2);
    point = {
      x: parent.x + Math.cos(outward) * step,
      y: parent.y + Math.sin(outward) * step,
      outward,
    };
  }

  memo.set(address, point);
  return point;
}

function spreadAt(depth: number): number {
  return SPREAD_FIRST * SPREAD_DECAY ** (depth - 2);
}

/**
 * A sibling's place in its parent's fan, in `(-1, 1)`: `a` on the centre line,
 * then alternating outward. Saturating rather than proportional, because the
 * sibling count is not knowable from an address and a peer holding half a
 * branch must still place it where we do.
 */
function fanOffset(ordinal: number): number {
  const k = ordinal - 1;
  const rank = Math.ceil(k / 2);
  const sign = k % 2 === 1 ? 1 : -1;
  return sign * (rank / (rank + FAN_SOFT));
}

/** A sector angle as a signed fraction of a half-turn, in `[-1, 1)`. */
function signedUnit(sector: number): number {
  return sector / Math.PI - 1;
}

export interface ClusterField {
  /** Where a node carrying this facet value belongs. `undefined` is unset. */
  centre(value: string | undefined): { x: number; y: number };
  /** How far a node scatters around its cluster's centre. */
  spread(value: string | undefined): number;
  /** Every value's position on the ring, unset last. */
  readonly order: readonly string[];
}

const CLUSTER_BASE_RADIUS = 420;
const CLUSTER_SCATTER = 0.62;

/**
 * Cluster centres for the active lens: one ring position per facet value, with
 * the unset cluster last so it never sits at the centre and becomes a well
 * every unlabelled node falls into.
 *
 * `population` sizes each cluster's scatter, so a dimension whose values split
 * unevenly does not draw one dense blot beside several sparse ones.
 */
export function clusterField(
  order: readonly string[],
  population: ReadonlyMap<string | undefined, number>,
): ClusterField {
  const slots = order.length + 1;
  const radius = CLUSTER_BASE_RADIUS * Math.sqrt(Math.max(slots, 2));
  const index = new Map(order.map((value, at) => [value, at]));

  const centre = (value: string | undefined) => {
    const at =
      value === undefined ? order.length : (index.get(value) ?? order.length);
    const angle = (TAU * at) / slots;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  };

  return {
    centre,
    spread: (value) =>
      CLUSTER_SCATTER *
      radius *
      Math.sqrt((population.get(value) ?? 1) / slots),
    order,
  };
}

/**
 * A node's seed under a lens: its cluster's centre, scattered by its address so
 * the sim starts spread out rather than stacked on one point.
 */
export function clusterSeed(
  address: Address,
  field: ClusterField,
  value: string | undefined,
): { x: number; y: number } {
  const home = field.centre(value);
  const sector = addressSector(address);
  const distance = field.spread(value) * Math.sqrt(fract(sector * 3.7));
  return {
    x: home.x + Math.cos(sector) * distance,
    y: home.y + Math.sin(sector) * distance,
  };
}

function fract(value: number): number {
  return value - Math.floor(value);
}
