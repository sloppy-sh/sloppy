import { describe, expect, it } from "vitest";
import {
  type Address,
  type AddressSegment,
  addressDepth,
  addressSector,
  childAddress,
  compareAddresses,
  formatAddress,
  InvalidAddressError,
  isAddress,
  isAncestorAddress,
  parentAddress,
  parseAddress,
  siblingAddress,
} from "./address.js";

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
// Two peers applying the same creation operations must produce byte-identical
// addresses. Proving that against one implementation replayed twice would prove
// only that the code is a function, so the two replicas below assign addresses
// from DIFFERENT state:
//
//   - `AppendOrderPeer` remembers which node it wrote under which parent, and
//     takes the last one it wrote.
//   - `AddressOrderPeer` remembers nothing but a set of addresses. It recovers
//     the tree from the addresses themselves and takes the greatest by
//     `compareAddresses`.
//
// So the test also pins the property the graph rests on: an address says where
// it sits, and a peer holding only addresses reconstructs the same tree.
// ---------------------------------------------------------------------------

type Op = { kind: "root" } | { kind: "child" | "sibling"; target: number };

interface Peer {
  /** The address assigned to each node, in creation order. */
  readonly assigned: readonly Address[];
  apply(op: Op): void;
}

class AppendOrderPeer implements Peer {
  readonly assigned: Address[] = [];
  private readonly parentOf: (number | null)[] = [];
  private readonly childrenOf = new Map<number | null, number[]>();

  apply(op: Op): void {
    const parent =
      op.kind === "root"
        ? null
        : op.kind === "child"
          ? op.target
          : this.parentOf[op.target];
    const siblings = this.childrenOf.get(parent) ?? [];
    const address =
      siblings.length === 0
        ? childAddress(parent === null ? null : this.assigned[parent])
        : siblingAddress(this.assigned[siblings[siblings.length - 1]]);
    this.childrenOf.set(parent, [...siblings, this.assigned.length]);
    this.parentOf.push(parent);
    this.assigned.push(address);
  }
}

class AddressOrderPeer implements Peer {
  readonly assigned: Address[] = [];

  apply(op: Op): void {
    const parent =
      op.kind === "root"
        ? null
        : op.kind === "child"
          ? this.assigned[op.target]
          : parentAddress(this.assigned[op.target]);
    // Reversed, so a bug that depended on scan order would show up here.
    const siblings = [...this.assigned]
      .reverse()
      .filter((address) => parentAddress(address) === parent);
    if (siblings.length === 0) {
      this.assigned.push(childAddress(parent));
      return;
    }
    const greatest = siblings.reduce((best, address) =>
      compareAddresses(address, best) > 0 ? address : best,
    );
    this.assigned.push(siblingAddress(greatest));
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

function generateOps(seed: number, count: number): Op[] {
  const random = seededRandom(seed);
  const ops: Op[] = [{ kind: "root" }];
  for (let created = 1; created < count; created++) {
    const roll = random();
    if (roll < 0.08) {
      ops.push({ kind: "root" });
      continue;
    }
    const target = Math.floor(random() * created);
    ops.push({ kind: roll < 0.62 ? "child" : "sibling", target });
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

  it("never assigns one address twice", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const assigned = replay(
        new AppendOrderPeer(),
        generateOps(seed, OPS_PER_SEED),
      );
      expect(new Set(assigned).size).toBe(assigned.length);
    }
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
