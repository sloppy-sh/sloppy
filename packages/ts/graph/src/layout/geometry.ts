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
