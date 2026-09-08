// The Folgezettel address. AI.md § "The Genealogy Is the Protocol" states the
// rules these functions keep; docs/ARCHITECTURE.md § "The genealogy and the address"
// states the grammar and why it is shaped this way.
//
// Every function here is pure and total over valid addresses. A peer somewhere
// is holding what they return, so none of them may consult a clock, a random
// source, or anything outside their arguments.

import { z } from "zod";

/** Alternating segments, numeric first: `1`, `1a`, `1a1`, `1ab12c`. */
const ADDRESS_PATTERN = /^[1-9][0-9]*(?:[a-z]+[1-9][0-9]*)*[a-z]*$/;

const ROOT_ADDRESS_PATTERN = /^[1-9][0-9]*$/;

export const AddressSchema = z
  .string()
  .regex(ADDRESS_PATTERN, "Expected a Folgezettel address, e.g. 1a1");
export type Address = z.infer<typeof AddressSchema>;

/**
 * A branch's own number, which is an address of one numeric segment. The only
 * address anybody may name: every other one is derived from its parent's.
 */
export const RootAddressSchema = z
  .string()
  .refine(isRootAddress, "Number a branch with a whole number, like 7");

export type SegmentKind = "number" | "letter";

/**
 * One segment, as a 1-based ordinal in its own alphabet: `1` and `a` are both
 * ordinal 1, `z` is 26, `aa` is 27.
 */
export interface AddressSegment {
  kind: SegmentKind;
  ordinal: number;
}

export class InvalidAddressError extends Error {
  constructor(address: string, reason: string) {
    super(`Invalid address ${JSON.stringify(address)}: ${reason}`);
    this.name = "InvalidAddressError";
  }
}

const LETTER_BASE = 26;
const CODE_A = 97;
const TAU = Math.PI * 2;

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

/**
 * Whether `value` addresses a root — a branch nobody's note sprang out of. The
 * bound is on the successor rather than on the number itself: the branch after
 * this one is `ordinal + 1`, so a number nothing can follow is a branch that
 * could never be continued.
 */
export function isRootAddress(value: unknown): value is Address {
  return (
    typeof value === "string" &&
    ROOT_ADDRESS_PATTERN.test(value) &&
    Number.isSafeInteger(Number(value) + 1)
  );
}

export function parseAddress(address: string): AddressSegment[] {
  if (!ADDRESS_PATTERN.test(address)) {
    throw new InvalidAddressError(address, "does not match the grammar");
  }
  const segments: AddressSegment[] = [];
  for (const run of address.match(/[0-9]+|[a-z]+/g) ?? []) {
    if (run.charCodeAt(0) < CODE_A) {
      const ordinal = Number(run);
      // A peer can hand us any string. Past 2^53 the arithmetic below stops
      // being exact and two different addresses would start comparing equal.
      if (!Number.isSafeInteger(ordinal)) {
        throw new InvalidAddressError(address, "numeric segment is too large");
      }
      segments.push({ kind: "number", ordinal });
    } else {
      segments.push({ kind: "letter", ordinal: letterOrdinal(address, run) });
    }
  }
  return segments;
}

export function formatAddress(segments: readonly AddressSegment[]): Address {
  let out = "";
  for (const segment of segments) {
    out +=
      segment.kind === "number"
        ? String(segment.ordinal)
        : letterLabel(segment.ordinal);
  }
  const fault = segmentFault(segments);
  if (fault !== null) throw new InvalidAddressError(out, fault);
  return out;
}

// Checked over the segments rather than over the string they spell, because the
// string cannot show the damage: two same-kind segments in a row concatenate
// into ONE segment, and `[{number,1},{number,2}]` spells "12" — a valid address
// with a different depth, parent and sector than the caller described.
function segmentFault(segments: readonly AddressSegment[]): string | null {
  if (segments.length === 0) return "an address has at least one segment";
  for (const [index, segment] of segments.entries()) {
    const expected: SegmentKind = index % 2 === 0 ? "number" : "letter";
    if (segment.kind !== expected) {
      return `segment ${index + 1} is a ${segment.kind} where the grammar alternates to a ${expected}`;
    }
    if (!Number.isSafeInteger(segment.ordinal) || segment.ordinal < 1) {
      return `segment ${index + 1} has ordinal ${segment.ordinal}, and ordinals start at 1`;
    }
  }
  return null;
}

/**
 * The address of a node's first child. `null` yields the first root address,
 * because opening a fresh graph and opening a fresh branch are the same act.
 */
export function childAddress(parent: Address | null): Address {
  if (parent === null) return "1";
  const segments = parseAddress(parent);
  return parent + (segments[segments.length - 1].kind === "number" ? "a" : "1");
}

/** The address of the next node alongside this one: `1a` → `1b`, `1` → `2`. */
export function siblingAddress(address: Address): Address {
  const segments = parseAddress(address);
  const last = segments[segments.length - 1];
  segments[segments.length - 1] = {
    kind: last.kind,
    ordinal: last.ordinal + 1,
  };
  return formatAddress(segments);
}

/**
 * The address a new child of `parent` takes, given every address its siblings
 * already hold. `null` names a new root.
 *
 * The next sibling follows the GREATEST address in the run rather than the
 * first gap in it, so a note taken out of the middle does not hand its address
 * to a later one.
 *
 * `siblings` is the run as a caller holds it, so a sibling its author left
 * unaddressed is passed in as absent and never moves the answer.
 *
 * `siblings` may also carry addresses from another run — a move gives a parent
 * a different address, and the rows an address was spent on are read by the
 * parent they hung under. Those are dropped rather than followed: they are
 * spent under an address no note is at, and nothing will be written there
 * again.
 */
export function nextChildAddress(
  parent: Address | null,
  siblings: readonly (Address | undefined)[],
): Address {
  const run = siblings.filter(
    (address): address is Address =>
      address !== undefined && parentAddress(address) === parent,
  );
  if (run.length === 0) return childAddress(parent);
  const greatest = run.reduce((a, b) => (compareAddresses(a, b) >= 0 ? a : b));
  return siblingAddress(greatest);
}

/** The address this one sprang from, or `null` for a root. */
export function parentAddress(address: Address): Address | null {
  const segments = parseAddress(address);
  if (segments.length === 1) return null;
  return formatAddress(segments.slice(0, -1));
}

/** Segment count, so a root is 1: how deep the address itself runs. */
export function addressDepth(address: Address): number {
  return parseAddress(address).length;
}

/**
 * Whether `descendant` lies under `ancestor`. Not a string prefix test: `1ab`
 * starts with `1a` and is a sibling of it, not a child.
 */
export function isAncestorAddress(
  ancestor: Address,
  descendant: Address,
): boolean {
  const a = parseAddress(ancestor);
  const d = parseAddress(descendant);
  if (a.length >= d.length) return false;
  return a.every(
    (segment, i) =>
      segment.kind === d[i].kind && segment.ordinal === d[i].ordinal,
  );
}

/**
 * Whether `address` lies in the subtree rooted at `root`, the root ITSELF
 * included — which `isAncestorAddress` deliberately excludes. This is the
 * membership a publication covers and a pulled region holds, so the two read it
 * from the same function rather than each remembering the root.
 */
export function isInSubtree(root: Address, address: Address): boolean {
  return root === address || isAncestorAddress(root, address);
}

/**
 * Where a note of the subtree rooted at `was` lands once that root has been
 * re-addressed to `now`: the segments past the root's are kept by ordinal and
 * take the kind the alternation puts them at from `now`'s depth. `1a1` under
 * `1a` is `2c1` under `2c`, and `3a` under `3`.
 *
 * `address` must be `was` or lie under it; anything else is a caller that has
 * mistaken which subtree is moving, and throws rather than returning a place.
 */
export function rebaseAddress(
  was: Address,
  now: Address,
  address: Address,
): Address {
  if (address !== was && !isAncestorAddress(was, address)) {
    throw new InvalidAddressError(address, `does not lie under ${was}`);
  }
  const root = parseAddress(now);
  const beneath = parseAddress(address).slice(parseAddress(was).length);
  return formatAddress([
    ...root,
    ...beneath.map(({ ordinal }, at) => ({
      kind: ((root.length + at) % 2 === 0 ? "number" : "letter") as SegmentKind,
      ordinal,
    })),
  ]);
}

/**
 * Total order over addresses: depth-first tree order. A node sorts before its
 * descendants, and `1a` before `1b` before `2`. Returns -1, 0 or 1.
 */
export function compareAddresses(a: Address, b: Address): number {
  const left = parseAddress(a);
  const right = parseAddress(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    if (left[i].ordinal !== right[i].ordinal) {
      return left[i].ordinal < right[i].ordinal ? -1 : 1;
    }
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

/**
 * A note as a run reads it: the ref that names it, the address it carries where
 * its author has written one, and when it was written.
 */
export interface RunMember {
  ref: string;
  address?: Address;
  created_at: string;
}

/**
 * Notes in the order a person reads them: the ones carrying addresses first, by
 * address, then the rest in the order they were written — ties broken by ref, so
 * two notes written in one millisecond still read the same way on every peer. A
 * run is what this is named for and what {@link runPairs} needs it for; a listing
 * that is not one is ordered by the same rule so no two surfaces disagree.
 */
export function orderSiblings<T extends RunMember>(
  alongside: readonly T[],
): T[] {
  return [...alongside].sort((a, b) => {
    if (a.address !== undefined && b.address !== undefined) {
      return compareAddresses(a.address, b.address);
    }
    if (a.address !== undefined) return -1;
    if (b.address !== undefined) return 1;
    return (
      a.created_at.localeCompare(b.created_at) || a.ref.localeCompare(b.ref)
    );
  });
}

/**
 * The run of thought over notes that lie alongside each other, in pairs: each
 * one and the one that follows it. {@link orderSiblings} is the whole rule, so
 * a note taken out of the middle leaves the two either side of it consecutive.
 */
export function runPairs<T extends RunMember>(
  alongside: readonly T[],
): [T, T][] {
  const order = orderSiblings(alongside);
  const pairs: [T, T][] = [];
  for (let at = 1; at < order.length; at++) {
    pairs.push([order[at - 1], order[at]]);
  }
  return pairs;
}

/**
 * Where the note at `ref` sits along the run it is `alongside`, which is
 * expected to include it: the one before it and the one after, `null` at either
 * end of the run.
 */
export function alongRun<T extends RunMember>(
  ref: string,
  alongside: readonly T[],
): { before: T | null; after: T | null } {
  let before: T | null = null;
  let after: T | null = null;
  for (const [left, right] of runPairs(alongside)) {
    if (right.ref === ref) before = left;
    if (left.ref === ref) after = right;
  }
  return { before, after };
}

/**
 * The direction a note's branch leaves from, in radians on `[0, 2π)`,
 * counter-clockwise from the positive x-axis. Over the ref, which every peer
 * holding the note has and no label can change, so a subtree radiates the same
 * way on every peer's screen without anybody shipping coordinates.
 */
export function refSector(ref: string): number {
  return (fnv1a32(ref) / 0x1_0000_0000) * TAU;
}

function letterOrdinal(address: string, run: string): number {
  let ordinal = 0;
  for (let i = 0; i < run.length; i++) {
    ordinal = ordinal * LETTER_BASE + (run.charCodeAt(i) - CODE_A + 1);
    if (!Number.isSafeInteger(ordinal)) {
      throw new InvalidAddressError(address, "letter segment is too large");
    }
  }
  return ordinal;
}

function letterLabel(ordinal: number): string {
  let remaining = ordinal;
  let label = "";
  while (remaining > 0) {
    const index = (remaining - 1) % LETTER_BASE;
    label = String.fromCharCode(CODE_A + index) + label;
    remaining = Math.floor((remaining - 1) / LETTER_BASE);
  }
  return label;
}

// FNV-1a, 32-bit. Chosen over any hash the platform offers because it is a
// handful of integer operations with no engine-defined behaviour: the sector a
// peer computes must equal the one we compute, on every runtime, forever.
function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
