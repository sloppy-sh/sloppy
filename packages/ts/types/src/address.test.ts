import { describe, expect, it } from "vitest";
import {
  type Address,
  type AddressSegment,
  addressDepth,
  addressSector,
  alongRun,
  childAddress,
  compareAddresses,
  formatAddress,
  InvalidAddressError,
  isAddress,
  isAncestorAddress,
  isInSubtree,
  isRootAddress,
  parentAddress,
  parseAddress,
  runPairs,
  siblingAddress,
} from "./address.js";

describe("the number a branch is named with", () => {
  it("is the only address whose parent is nothing", () => {
    for (const value of ["1", "7", "12", "4096"]) {
      expect(isRootAddress(value)).toBe(true);
      expect(parentAddress(value)).toBeNull();
    }
  });

  it("refuses anything that names a place under another note", () => {
    for (const value of ["1a", "1a1", "9z9z"]) {
      expect(isRootAddress(value)).toBe(false);
      expect(isAddress(value)).toBe(true);
    }
  });

  it("refuses what is not an address at all", () => {
    for (const value of ["", "0", "-3", "1.5", "01", " 7", "seven", 7, null]) {
      expect(isRootAddress(value)).toBe(false);
    }
  });

  it("refuses a number too large to compare exactly", () => {
    expect(isRootAddress("9".repeat(30))).toBe(false);
  });

  it("accepts only a number the next branch can follow", () => {
    const last = String(Number.MAX_SAFE_INTEGER);
    expect(isRootAddress(last)).toBe(false);
    expect(() => siblingAddress(last)).toThrow(InvalidAddressError);

    for (const value of [
      "1",
      "7",
      "4096",
      String(Number.MAX_SAFE_INTEGER - 1),
    ]) {
      expect(isRootAddress(value)).toBe(true);
      expect(() => siblingAddress(value)).not.toThrow();
    }
  });
});

describe("the grammar", () => {
  it("accepts alternating segments starting with a number", () => {
    for (const value of ["1", "12", "1a", "1a1", "1ab12c", "9z9z"]) {
      expect(isAddress(value)).toBe(true);
    }
  });

  it("rejects anything a peer could send that is not one", () => {
    for (const value of [
      "",
      "0",
      "01",
      "a",
      "a1",
      "1A",
      "1-a",
      "1a0",
      "1 a",
      "1.1",
      "１",
    ]) {
      expect(isAddress(value)).toBe(false);
      expect(() => parseAddress(value)).toThrow(InvalidAddressError);
    }
  });

  it("refuses a numeric segment past exact integer arithmetic", () => {
    expect(() => parseAddress("9007199254740993")).toThrow(InvalidAddressError);
  });

  it("round-trips through segments", () => {
    for (const value of ["1", "27", "1a", "1z1", "1aa1", "3zz9aa"]) {
      expect(formatAddress(parseAddress(value))).toBe(value);
    }
  });

  it("refuses segments that spell a different address than they describe", () => {
    // Every list here concatenates into a perfectly valid address of the wrong
    // depth, so the failure a caller needs is loud, not a returned string.
    for (const segments of [
      [
        { kind: "number", ordinal: 1 },
        { kind: "number", ordinal: 2 },
      ],
      [
        { kind: "number", ordinal: 1 },
        { kind: "letter", ordinal: 1 },
        { kind: "letter", ordinal: 2 },
      ],
      [...parseAddress("2"), ...parseAddress("1")],
      // A zero or fractional ordinal renders to nothing, or to its floor.
      [
        { kind: "number", ordinal: 1 },
        { kind: "letter", ordinal: 0 },
        { kind: "number", ordinal: 2 },
      ],
      [
        { kind: "number", ordinal: 1 },
        { kind: "letter", ordinal: 1.5 },
      ],
    ] satisfies AddressSegment[][]) {
      expect(() => formatAddress(segments)).toThrow(InvalidAddressError);
    }
  });

  it("refuses an empty segment list and a letter-led one", () => {
    expect(() => formatAddress([])).toThrow(InvalidAddressError);
    expect(() => formatAddress([{ kind: "letter", ordinal: 1 }])).toThrow(
      InvalidAddressError,
    );
  });

  it("reads letters as bijective base-26", () => {
    expect(parseAddress("1a")[1].ordinal).toBe(1);
    expect(parseAddress("1z")[1].ordinal).toBe(26);
    expect(parseAddress("1aa")[1].ordinal).toBe(27);
    expect(parseAddress("1az")[1].ordinal).toBe(52);
    expect(parseAddress("1ba")[1].ordinal).toBe(53);
  });
});

describe("assignment", () => {
  it("starts a graph at 1", () => {
    expect(childAddress(null)).toBe("1");
  });

  it("alternates segment type down a branch", () => {
    expect(childAddress("1")).toBe("1a");
    expect(childAddress("1a")).toBe("1a1");
    expect(childAddress("1a1")).toBe("1a1a");
  });

  it("increments the last segment sideways", () => {
    expect(siblingAddress("1")).toBe("2");
    expect(siblingAddress("1a")).toBe("1b");
    expect(siblingAddress("1a1")).toBe("1a2");
  });

  it("carries a letter segment past z", () => {
    let address: Address = childAddress("1");
    for (let i = 1; i < 26; i++) address = siblingAddress(address);
    expect(address).toBe("1z");
    expect(siblingAddress(address)).toBe("1aa");
    expect(siblingAddress("1az")).toBe("1ba");
    expect(siblingAddress("1zz")).toBe("1aaa");
  });

  it("carries a numeric segment past 9", () => {
    expect(siblingAddress("9")).toBe("10");
    expect(siblingAddress("1a9")).toBe("1a10");
  });

  it("walks back up", () => {
    expect(parentAddress("1")).toBeNull();
    expect(parentAddress("1a")).toBe("1");
    expect(parentAddress("1a1")).toBe("1a");
    expect(parentAddress("1aa")).toBe("1");
  });

  it("counts segments, from 1 at a root", () => {
    expect(addressDepth("1")).toBe(1);
    expect(addressDepth("1a")).toBe(2);
    expect(addressDepth("1a1a")).toBe(4);
  });
});

describe("ancestry", () => {
  it("is not a string prefix test", () => {
    expect(isAncestorAddress("1a", "1a1")).toBe(true);
    expect(isAncestorAddress("1", "1a1")).toBe(true);
    // `1ab` starts with `1a` and is its sibling, not its child.
    expect(isAncestorAddress("1a", "1ab")).toBe(false);
    expect("1ab".startsWith("1a")).toBe(true);
  });

  it("excludes a node from its own ancestry", () => {
    expect(isAncestorAddress("1a", "1a")).toBe(false);
  });

  it("excludes a cousin", () => {
    expect(isAncestorAddress("1a", "1b1")).toBe(false);
    expect(isAncestorAddress("1a", "2a")).toBe(false);
  });
});

describe("a subtree, as a publication covers one and a region holds one", () => {
  it("holds its own root, which ancestry does not", () => {
    expect(isInSubtree("1a", "1a")).toBe(true);
    expect(isAncestorAddress("1a", "1a")).toBe(false);
  });

  it("holds everything under the root and nothing beside it", () => {
    for (const address of ["1a", "1a1", "1a1b", "1a2"]) {
      expect(isInSubtree("1a", address)).toBe(true);
      expect(isInSubtree("1", address)).toBe(true);
    }
    for (const address of ["1", "1b", "1ab", "2a"]) {
      expect(isInSubtree("1a", address)).toBe(false);
    }
  });

  it("is where two overlapping regions meet: what one drops, the other keeps", () => {
    const held = ["1", "1a", "1a1", "1b"] as const;
    const kept = held.filter((address) => isInSubtree("1", address));
    const dropped = held.filter((address) => isInSubtree("1a", address));
    expect(dropped).toEqual(["1a", "1a1"]);
    expect(dropped.every((address) => kept.includes(address))).toBe(true);
  });
});

describe("ordering", () => {
  it("puts a node before its descendants and before its next sibling", () => {
    const sorted = [
      "1",
      "1a",
      "1a1",
      "1a2",
      "1b",
      "1z",
      "1aa",
      "2",
      "10",
    ] as const;
    for (let i = 0; i + 1 < sorted.length; i++) {
      expect(compareAddresses(sorted[i], sorted[i + 1])).toBe(-1);
      expect(compareAddresses(sorted[i + 1], sorted[i])).toBe(1);
    }
    expect(compareAddresses("1a1", "1a1")).toBe(0);
  });

  it("sorts numerically, not lexicographically", () => {
    expect([...["10", "2", "1"]].sort(compareAddresses)).toEqual([
      "1",
      "2",
      "10",
    ]);
  });
});

describe("the run of thought", () => {
  const alongside = (...addresses: string[]) =>
    addresses.map((address) => ({ address }));

  it("pairs each note with the one that follows it, however they arrive", () => {
    expect(runPairs(alongside("1c", "1a", "1b"))).toEqual([
      [{ address: "1a" }, { address: "1b" }],
      [{ address: "1b" }, { address: "1c" }],
    ]);
  });

  it("closes over a note taken out of the middle", () => {
    expect(runPairs(alongside("1", "3"))).toEqual([
      [{ address: "1" }, { address: "3" }],
    ]);
    expect(alongRun("1", alongside("1", "3")).after).toEqual({ address: "3" });
  });

  it("pairs nothing where there is nothing to follow", () => {
    expect(runPairs(alongside())).toEqual([]);
    expect(runPairs(alongside("1a"))).toEqual([]);
  });

  it("says what a note sits between", () => {
    expect(alongRun("1b", alongside("1a", "1b", "1d"))).toEqual({
      before: { address: "1a" },
      after: { address: "1d" },
    });
  });

  it("says nothing past either end of the run", () => {
    const run = alongside("1a", "1b");
    expect(alongRun("1a", run).before).toBeNull();
    expect(alongRun("1b", run).after).toBeNull();
  });

  it("says nothing for a note that is not one of these", () => {
    expect(alongRun("2", alongside("1a", "1b"))).toEqual({
      before: null,
      after: null,
    });
  });

  /** A run with notes taken out of it and the rest shuffled — what a cache and
   *  a canvas each hand this, neither of them in order. */
  function scattered(seed: number): { address: Address }[] {
    const random = seededRandom(seed);
    const run = [{ address: "1a" as Address }];
    let address: Address = "1a";
    for (let step = 0; step < 24; step++) {
      address = siblingAddress(address);
      if (random() < 0.7) run.push({ address });
    }
    for (let at = run.length - 1; at > 0; at--) {
      const swap = Math.floor(random() * (at + 1));
      [run[at], run[swap]] = [run[swap], run[at]];
    }
    return run;
  }

  // The canvas draws an edge per pair and the note surface walks by neighbour,
  // so both are held to address order here rather than to each other.
  it("pairs and walks by address order, whatever a run is missing", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = scattered(seed);
      const order = [...run].sort((a, b) =>
        compareAddresses(a.address, b.address),
      );

      expect(runPairs(run)).toEqual(
        order.slice(1).map((note, at) => [order[at], note]),
      );
      order.forEach((note, at) => {
        expect(alongRun(note.address, run)).toEqual({
          before: order[at - 1] ?? null,
          after: order[at + 1] ?? null,
        });
      });
    }
  });
});

describe("the angular sector", () => {
  it("lands in [0, 2π)", () => {
    for (const address of ["1", "1a", "1a1", "27", "3zz9aa"]) {
      const sector = addressSector(address);
      expect(sector).toBeGreaterThanOrEqual(0);
      expect(sector).toBeLessThan(Math.PI * 2);
    }
  });

  it("is fixed for a given address", () => {
    // The literals are the point: a change to the hash moves every subtree on
    // every peer's screen, so it must fail here rather than pass quietly.
    expect(addressSector("1")).toBe(1.2774850847471988);
    expect(addressSector("1a")).toBe(2.6733127270969375);
    expect(addressSector("1a1")).toBe(2.6749322754261975);
  });

  it("separates siblings", () => {
    const sectors = ["1a", "1b", "1c", "1d"].map(addressSector);
    expect(new Set(sectors).size).toBe(4);
  });

  it("refuses an address it cannot parse", () => {
    expect(() => addressSector("nope")).toThrow(InvalidAddressError);
  });
});

// ---------------------------------------------------------------------------
// The protocol claim.
//
// Two peers applying the same operations must produce byte-identical addresses,
// and neither may ever assign one twice — deleting and purging a note included,
// which is why the sequences below hold both. Proving that against one
// implementation replayed twice would prove only that the code is a function,
// so the two replicas assign addresses from DIFFERENT state:
//
//   - `AppendOrderPeer` keeps no row for a note that has gone, the way a store
//     that deletes outright does. What it takes the next address from is the
//     mark it made when it wrote, and a note going never moves that mark.
//   - `AddressOrderPeer` remembers nothing but addresses, in the three states a
//     graph holds them in: at a note, at a deleted one, and retired. It recovers
//     the tree from the addresses themselves and takes the greatest by
//     `compareAddresses`.
//
// So the test also pins the property the graph rests on: an address says where
// it sits, and a peer holding only addresses reconstructs the same tree.
// ---------------------------------------------------------------------------

type Op =
  | { kind: "root" }
  | { kind: "child" | "sibling" | "delete" | "purge"; target: number };

interface Peer {
  /** The address assigned to each node, in creation order. */
  readonly assigned: readonly Address[];
  apply(op: Op): void;
}

class AppendOrderPeer implements Peer {
  readonly assigned: Address[] = [];
  private readonly parentOf: (number | null)[] = [];
  /** The notes it still holds. A delete takes them, address and all. */
  private readonly rows = new Map<number, Address>();
  /** The last address written under a parent, which no delete takes back. */
  private readonly lastUnder = new Map<number | null, Address>();

  apply(op: Op): void {
    if (op.kind === "purge") return;
    if (op.kind === "delete") {
      for (const node of [...this.rows.keys()]) {
        if (this.isUnder(op.target, node)) this.rows.delete(node);
      }
      return;
    }
    const parent =
      op.kind === "root"
        ? null
        : op.kind === "child"
          ? op.target
          : this.parentOf[op.target];
    const spent = this.lastUnder.get(parent);
    const address =
      spent === undefined
        ? childAddress(parent === null ? null : this.rowAt(parent))
        : siblingAddress(spent);
    this.lastUnder.set(parent, address);
    this.rows.set(this.assigned.length, address);
    this.parentOf.push(parent);
    this.assigned.push(address);
  }

  private rowAt(node: number): Address {
    const address = this.rows.get(node);
    if (address === undefined) {
      throw new Error(`wrote under a note that has gone: ${node}`);
    }
    return address;
  }

  private isUnder(root: number, node: number): boolean {
    for (
      let walk: number | null = node;
      walk !== null;
      walk = this.parentOf[walk]
    ) {
      if (walk === root) return true;
    }
    return false;
  }
}

class AddressOrderPeer implements Peer {
  readonly assigned: Address[] = [];
  private readonly live = new Set<Address>();
  private readonly deleted = new Set<Address>();
  private readonly retired = new Set<Address>();

  apply(op: Op): void {
    if (op.kind === "delete") {
      const going = this.assigned[op.target];
      for (const address of [...this.live]) {
        if (!isInSubtree(going, address)) continue;
        this.live.delete(address);
        this.deleted.add(address);
      }
      return;
    }
    if (op.kind === "purge") {
      const address = this.assigned[op.target];
      this.deleted.delete(address);
      this.retired.add(address);
      return;
    }
    const parent =
      op.kind === "root"
        ? null
        : op.kind === "child"
          ? this.assigned[op.target]
          : parentAddress(this.assigned[op.target]);
    // Reversed, so a bug that depended on scan order would show up here.
    const spent = [...this.live, ...this.deleted, ...this.retired];
    const siblings = spent
      .reverse()
      .filter((address) => parentAddress(address) === parent);
    const address =
      siblings.length === 0
        ? childAddress(parent)
        : siblingAddress(
            siblings.reduce((best, sibling) =>
              compareAddresses(sibling, best) > 0 ? sibling : best,
            ),
          );
    this.live.add(address);
    this.assigned.push(address);
  }
}

/** mulberry32 — deterministic, and short enough to read. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` operations, of which some write a note, some delete one with
 * everything under it, and some purge a note already deleted. A note that has
 * gone is never written under or alongside again, which is the one thing the
 * product will not let anybody ask for either.
 */
function generateOps(seed: number, count: number): Op[] {
  const random = seededRandom(seed);
  const ops: Op[] = [{ kind: "root" }];
  const parentOf: (number | null)[] = [null];
  const live = new Set<number>([0]);
  const deleted = new Set<number>();
  const pick = (from: ReadonlySet<number>): number =>
    [...from][Math.floor(random() * from.size)];
  const under = (root: number, node: number): boolean => {
    for (let walk: number | null = node; walk != null; walk = parentOf[walk]) {
      if (walk === root) return true;
    }
    return false;
  };

  while (ops.length < count) {
    const roll = random();
    if (roll < 0.08) {
      parentOf.push(null);
      live.add(parentOf.length - 1);
      ops.push({ kind: "root" });
      continue;
    }
    if (roll < 0.14 && live.size > 1) {
      const target = pick(live);
      const going = [...live].filter((node) => under(target, node));
      // Never the last note: an op after it would have nothing to be written
      // against, which is a sequence the product cannot produce either.
      if (going.length < live.size) {
        for (const node of going) {
          live.delete(node);
          deleted.add(node);
        }
        ops.push({ kind: "delete", target });
        continue;
      }
    }
    if (roll < 0.18 && deleted.size > 0) {
      const target = pick(deleted);
      deleted.delete(target);
      ops.push({ kind: "purge", target });
      continue;
    }
    const target = pick(live);
    const kind = roll < 0.62 ? "child" : "sibling";
    parentOf.push(kind === "child" ? target : parentOf[target]);
    live.add(parentOf.length - 1);
    ops.push({ kind, target });
  }
  return ops;
}

function replay(peer: Peer, ops: readonly Op[]): readonly Address[] {
  for (const op of ops) peer.apply(op);
  return peer.assigned;
}

describe("determinism across peers", () => {
  const SEEDS = 200;
  const OPS_PER_SEED = 120;

  it("assigns byte-identical addresses from unrelated internal state", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      const a = replay(new AppendOrderPeer(), ops);
      const b = replay(new AddressOrderPeer(), ops);
      expect(b.join("\n")).toBe(a.join("\n"));
    }
  });

  it("never assigns one address twice, however many notes have gone", () => {
    let gone = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      gone += ops.filter(
        (op) => op.kind === "delete" || op.kind === "purge",
      ).length;
      for (const peer of [new AppendOrderPeer(), new AddressOrderPeer()]) {
        const assigned = replay(peer, ops);
        expect(new Set(assigned).size).toBe(assigned.length);
      }
    }
    // The claim above is empty over sequences that never delete anything.
    expect(gone).toBeGreaterThan(SEEDS);
  });

  it("never rewrites an address it has already assigned", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      let previous: readonly Address[] = [];
      for (let step = 1; step <= ops.length; step++) {
        const assigned = replay(new AppendOrderPeer(), ops.slice(0, step));
        expect(assigned.slice(0, previous.length)).toEqual([...previous]);
        previous = assigned;
      }
    }
  });

  it("keeps every assignment inside the grammar and under its parent", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const address of replay(
        new AppendOrderPeer(),
        generateOps(seed, OPS_PER_SEED),
      )) {
        expect(isAddress(address)).toBe(true);
        const parent = parentAddress(address);
        if (parent !== null) {
          expect(isAncestorAddress(parent, address)).toBe(true);
          expect(addressDepth(address)).toBe(addressDepth(parent) + 1);
        }
      }
    }
  });

  it("orders addresses the same way on both peers", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      const a = [...replay(new AppendOrderPeer(), ops)].sort(compareAddresses);
      const b = [...replay(new AddressOrderPeer(), ops)].sort(compareAddresses);
      expect(b.join("\n")).toBe(a.join("\n"));
    }
  });
});
