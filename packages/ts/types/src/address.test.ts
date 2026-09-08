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
  nextChildAddress,
  parentAddress,
  parseAddress,
  rebaseAddress,
  orderSiblings,
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

describe("the next address under a parent", () => {
  it("opens a graph at 1 and a branch at its first child", () => {
    expect(nextChildAddress(null, [])).toBe("1");
    expect(nextChildAddress("1", [])).toBe("1a");
    expect(nextChildAddress("1a", [])).toBe("1a1");
  });

  it("follows the run of siblings already there", () => {
    expect(nextChildAddress(null, ["1", "2", "3"])).toBe("4");
    expect(nextChildAddress("1", ["1a", "1b"])).toBe("1c");
    expect(nextChildAddress("1a", ["1a1", "1a2"])).toBe("1a3");
  });

  it("reads the run by ordinal, not by spelling", () => {
    const past26: Address[] = Array.from({ length: 26 }, (_, i) =>
      `1${String.fromCharCode(97 + i)}`.toString(),
    );
    expect(nextChildAddress("1", past26)).toBe("1aa");
    expect(nextChildAddress("1", ["1a", "1z", "1aa"])).toBe("1ab");
    expect(nextChildAddress(null, ["1", "9", "10"])).toBe("11");
  });

  it("does not reuse the address of a note taken out of the middle", () => {
    expect(nextChildAddress("1", ["1a", "1c"])).toBe("1d");
  });

  it("passes over an address spent under a parent that has since moved", () => {
    // The rows an address is spent on are read by the parent it hung under, so
    // a move hands this run addresses from the run that parent used to be in.
    // Following one would put the new note beside a note in another run.
    expect(nextChildAddress("2c", ["2c1", "1a1"])).toBe("2c2");
    expect(nextChildAddress("2c", ["1a1", "1a2"])).toBe("2c1");
    expect(nextChildAddress(null, ["1", "1a"])).toBe("2");
    expect(nextChildAddress("1", ["1a", "2"])).toBe("1b");
  });

  it("gives the same answer whatever order the siblings arrive in", () => {
    const siblings = ["1c", "1a", "1b", "1e", "1d"];
    expect(nextChildAddress("1", siblings)).toBe("1f");
    expect(nextChildAddress("1", [...siblings].reverse())).toBe("1f");
  });
});

/** The run under one parent as a graph hands it over: the addresses notes are
 *  at, and the ones notes have left behind. */
function run(live: readonly Address[], gone: readonly Address[]): Address[] {
  return [...live, ...gone];
}

describe("an address a note has left behind", () => {
  it("does not go to the note written after the greatest sibling", () => {
    expect(nextChildAddress("1", run(["1a", "1b"], ["1c"]))).toBe("1d");
  });

  it("does not come back when the only child goes", () => {
    expect(nextChildAddress("1", run([], ["1a"]))).toBe("1b");
  });

  it("stays spent for every note a deleted branch took with it", () => {
    // Deleting 1b takes 1b1 and 1b1a with it, and all three numbers go with
    // them: a citation of any one must never resolve to a later thought.
    expect(nextChildAddress("1", run(["1a"], ["1b"]))).toBe("1c");
    expect(nextChildAddress("1b", run([], ["1b1"]))).toBe("1b2");
    expect(nextChildAddress("1b1", run([], ["1b1a"]))).toBe("1b1b");
  });

  it("leaves a branch number spent too", () => {
    expect(nextChildAddress(null, run(["1", "2"], ["3"]))).toBe("4");
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
  const WRITTEN = "2026-01-01T00:00:00.000Z";
  const one = (address?: string, ref = address ?? "bare") => ({
    ref: `did:syr:zAva/${ref}`,
    ...(address === undefined ? {} : { address }),
    created_at: WRITTEN,
  });
  const alongside = (...addresses: string[]) => addresses.map((a) => one(a));

  it("pairs each note with the one that follows it, however they arrive", () => {
    expect(runPairs(alongside("1c", "1a", "1b"))).toEqual([
      [one("1a"), one("1b")],
      [one("1b"), one("1c")],
    ]);
  });

  it("closes over a note taken out of the middle", () => {
    expect(runPairs(alongside("1", "3"))).toEqual([[one("1"), one("3")]]);
    expect(alongRun(one("1").ref, alongside("1", "3")).after).toEqual(one("3"));
  });

  it("pairs nothing where there is nothing to follow", () => {
    expect(runPairs(alongside())).toEqual([]);
    expect(runPairs(alongside("1a"))).toEqual([]);
  });

  it("says what a note sits between", () => {
    expect(alongRun(one("1b").ref, alongside("1a", "1b", "1d"))).toEqual({
      before: one("1a"),
      after: one("1d"),
    });
  });

  it("says nothing past either end of the run", () => {
    const run = alongside("1a", "1b");
    expect(alongRun(one("1a").ref, run).before).toBeNull();
    expect(alongRun(one("1b").ref, run).after).toBeNull();
  });

  it("says nothing for a note that is not one of these", () => {
    expect(alongRun(one("2").ref, alongside("1a", "1b"))).toEqual({
      before: null,
      after: null,
    });
  });

  it("puts the notes carrying no address after the ones that do", () => {
    const run = [one("1b"), one(undefined, "second"), one("1a")];
    expect(orderSiblings(run).map((note) => note.ref)).toEqual([
      one("1a").ref,
      one("1b").ref,
      one(undefined, "second").ref,
    ]);
  });

  /** A run with notes taken out of it and the rest shuffled — what a cache and
   *  a canvas each hand this, neither of them in order. */
  function scattered(seed: number): ReturnType<typeof one>[] {
    const random = seededRandom(seed);
    const run = [one("1a")];
    let address: Address = "1a";
    for (let step = 0; step < 24; step++) {
      address = siblingAddress(address);
      if (random() < 0.7) run.push(one(address));
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
        compareAddresses(a.address as Address, b.address as Address),
      );

      expect(runPairs(run)).toEqual(
        order.slice(1).map((note, at) => [order[at], note]),
      );
      order.forEach((note, at) => {
        expect(alongRun(note.ref, run)).toEqual({
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

describe("where a moved subtree lands", () => {
  it("re-addresses the note that moved and nothing else about it", () => {
    expect(rebaseAddress("1a", "2c", "1a")).toBe("2c");
    expect(rebaseAddress("1", "4", "1")).toBe("4");
  });

  it("keeps every note under it where it was, relative to it", () => {
    expect(rebaseAddress("1a", "2c", "1a1")).toBe("2c1");
    expect(rebaseAddress("1a", "2c", "1a2b")).toBe("2c2b");
    expect(rebaseAddress("1a", "2c", "1a26")).toBe("2c26");
  });

  it("takes each segment's kind from the depth it now sits at", () => {
    // Going up a level turns what was a number into a letter and back, so the
    // grammar holds and the run each note is in keeps its order.
    expect(rebaseAddress("1a", "3", "1a1")).toBe("3a");
    expect(rebaseAddress("1a", "3", "1a1a")).toBe("3a1");
    expect(rebaseAddress("1", "2a", "1b")).toBe("2a2");
    expect(rebaseAddress("1a", "3", "1a27")).toBe("3aa");
    expect(rebaseAddress("1", "2a", "1aa")).toBe("2a27");
  });

  it("keeps the order a run was in", () => {
    const run = ["1a1", "1a2", "1a10"] as const;
    const landed = run.map((address) => rebaseAddress("1a", "3", address));
    expect(landed).toEqual(["3a", "3b", "3j"]);
    for (let at = 1; at < landed.length; at++) {
      expect(compareAddresses(landed[at - 1], landed[at])).toBe(-1);
    }
  });

  it("refuses an address that is not in the subtree that moved", () => {
    // `1ab` starts with `1a` and is its sibling, so a prefix test would carry
    // a note that never moved.
    for (const address of ["1b", "1ab", "2", "1"]) {
      expect(() => rebaseAddress("1a", "2c", address)).toThrow(
        InvalidAddressError,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The protocol claim.
//
// Two peers applying the same operations must produce byte-identical addresses
// and byte-identical aliases, and neither may ever assign one twice — deleting,
// purging and moving a note included, which is why the sequences below hold all
// three. Proving that against one implementation replayed twice would prove only
// that the code is a function, so the two replicas assign addresses from
// DIFFERENT state:
//
//   - `AppendOrderPeer` keeps no row for a note that has gone, the way a store
//     that deletes outright does. What it takes the next address from is the
//     mark it made when it wrote, and a note going never moves that mark. A move
//     is the one act that makes it read: a note carried somewhere else takes its
//     run with it, and the mark under it is what its children are at now.
//   - `AddressOrderPeer` remembers nothing but addresses, in the four states a
//     graph holds them in: at a note, at a deleted one, retired, and left behind
//     by a move. It recovers the tree from the addresses themselves and takes
//     the greatest by `compareAddresses`.
//
// So the test also pins the property the graph rests on: an address says where
// it sits, and a peer holding only addresses reconstructs the same tree.
// ---------------------------------------------------------------------------

type Op =
  | { kind: "root" }
  | { kind: "child" | "sibling" | "delete" | "purge"; target: number }
  | { kind: "move"; target: number; relation: "under" | "after"; to: number };

interface Peer {
  /** Every address it assigned, in the order it assigned them: one per note
   *  written, and one more each time a note is moved. */
  readonly assigned: readonly Address[];
  /** Where the notes are now, deleted ones among them, in address order. */
  readonly current: readonly Address[];
  /** Each address a move left behind and where it resolves to now, as
   *  `<alias> -> <address>`, in one order whatever the peer holds. */
  readonly aliases: readonly string[];
  apply(op: Op): void;
}

const greatestOf = (addresses: readonly Address[]): Address =>
  addresses.reduce((best, address) =>
    compareAddresses(address, best) > 0 ? address : best,
  );

class AppendOrderPeer implements Peer {
  readonly assigned: Address[] = [];
  private readonly parentOf: (number | null)[] = [];
  /** Where each note it has written is now, the deleted ones among them. */
  private readonly addressOf = new Map<number, Address>();
  /** The notes still there. Nothing is written against one that has gone. */
  private readonly there = new Set<number>();
  /** The notes whose rows a purge took; their addresses stay where they were. */
  private readonly purged = new Set<number>();
  /** The last address written under a parent, which no delete takes back. */
  private readonly lastUnder = new Map<number | null, Address>();
  /** Each address a move left behind, and the note it still names. */
  private readonly left = new Map<Address, number>();

  get current(): Address[] {
    return [...this.addressOf]
      .filter(([node]) => !this.purged.has(node))
      .map(([, address]) => address)
      .sort(compareAddresses);
  }

  get aliases(): string[] {
    return [...this.left]
      .map(([alias, node]) => `${alias} -> ${this.addressOf.get(node)}`)
      .sort();
  }

  apply(op: Op): void {
    if (op.kind === "purge") {
      this.purged.add(op.target);
      // The aliases go with the row: there is nothing left for one to resolve
      // to. The addresses stay spent — no note is at the one they hung under.
      for (const [alias, node] of [...this.left]) {
        if (node === op.target) this.left.delete(alias);
      }
      return;
    }
    if (op.kind === "delete") {
      for (const node of this.carried(op.target)) this.there.delete(node);
      return;
    }
    if (op.kind === "move") {
      this.move(
        op.target,
        op.relation === "under" ? op.to : this.parentOf[op.to],
      );
      return;
    }
    const parent =
      op.kind === "root"
        ? null
        : op.kind === "child"
          ? op.target
          : this.parentOf[op.target];
    const node = this.parentOf.length;
    const address = this.next(parent);
    this.parentOf.push(parent);
    this.addressOf.set(node, address);
    this.there.add(node);
    this.assigned.push(address);
  }

  private move(moved: number, parent: number | null): void {
    const was = this.rowAt(moved);
    const now = this.next(parent);
    const carried = this.carried(moved);
    for (const node of carried) {
      const old = this.addressOf.get(node) as Address;
      this.left.set(old, node);
      this.addressOf.set(node, rebaseAddress(was, now, old));
    }
    this.parentOf[moved] = parent;
    // The run under a note it has just carried elsewhere starts from what its
    // children are at now: the marks it made where they were belong to a run
    // nothing will be written into again.
    for (const node of carried) this.remark(node);
    this.assigned.push(now);
  }

  private next(parent: number | null): Address {
    const spent = this.lastUnder.get(parent);
    const address =
      spent === undefined
        ? childAddress(parent === null ? null : this.rowAt(parent))
        : siblingAddress(spent);
    this.lastUnder.set(parent, address);
    return address;
  }

  private remark(node: number): void {
    const children = this.parentOf.flatMap((parent, child) =>
      parent === node && !this.purged.has(child)
        ? [this.addressOf.get(child) as Address]
        : [],
    );
    if (children.length === 0) this.lastUnder.delete(node);
    else this.lastUnder.set(node, greatestOf(children));
  }

  private rowAt(node: number): Address {
    const address = this.addressOf.get(node);
    if (address === undefined || !this.there.has(node)) {
      throw new Error(`wrote against a note that has gone: ${node}`);
    }
    return address;
  }

  /** The notes a move takes with this one. A purged note is not one of them:
   *  its row has gone, and the address it spent stays where it was. */
  private carried(root: number): number[] {
    return this.parentOf.flatMap((_, node) =>
      this.isUnder(root, node) && !this.purged.has(node) ? [node] : [],
    );
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
  /** Where each note it has been told about is, in creation order. */
  private readonly at: Address[] = [];
  private readonly live = new Set<Address>();
  private readonly deleted = new Set<Address>();
  private readonly retired = new Set<Address>();
  /** Each address a move left behind, and where it resolves to now. */
  private readonly left = new Map<Address, Address>();

  get current(): Address[] {
    return [...this.live, ...this.deleted].sort(compareAddresses);
  }

  get aliases(): string[] {
    return [...this.left].map(([alias, now]) => `${alias} -> ${now}`).sort();
  }

  apply(op: Op): void {
    if (op.kind === "delete") {
      const going = this.at[op.target];
      for (const address of [...this.live]) {
        if (!isInSubtree(going, address)) continue;
        this.live.delete(address);
        this.deleted.add(address);
      }
      return;
    }
    if (op.kind === "purge") {
      const address = this.at[op.target];
      this.deleted.delete(address);
      this.retired.add(address);
      for (const [alias, resolves] of [...this.left]) {
        if (resolves !== address) continue;
        this.left.delete(alias);
        this.retired.add(alias);
      }
      return;
    }
    if (op.kind === "move") {
      this.move(
        this.at[op.target],
        op.relation === "under"
          ? this.at[op.to]
          : parentAddress(this.at[op.to]),
      );
      return;
    }
    const parent =
      op.kind === "root"
        ? null
        : op.kind === "child"
          ? this.at[op.target]
          : parentAddress(this.at[op.target]);
    const address = this.nextUnder(parent);
    this.live.add(address);
    this.at.push(address);
    this.assigned.push(address);
  }

  private move(was: Address, parent: Address | null): void {
    const now = this.nextUnder(parent);
    for (const [alias, resolves] of [...this.left]) {
      if (isInSubtree(was, resolves)) {
        this.left.set(alias, rebaseAddress(was, now, resolves));
      }
    }
    // A retired address stays where it was spent: there is no row left to carry.
    for (const held of [this.live, this.deleted]) {
      for (const address of [...held]) {
        if (!isInSubtree(was, address)) continue;
        const landed = rebaseAddress(was, now, address);
        held.delete(address);
        held.add(landed);
        this.left.set(address, landed);
      }
    }
    for (const [node, address] of this.at.entries()) {
      if (this.retired.has(address) || !isInSubtree(was, address)) continue;
      this.at[node] = rebaseAddress(was, now, address);
    }
    this.assigned.push(now);
  }

  private nextUnder(parent: Address | null): Address {
    // Reversed, so a bug that depended on scan order would show up here.
    const spent = [
      ...this.live,
      ...this.deleted,
      ...this.retired,
      ...this.left.keys(),
    ];
    return nextChildAddress(parent, spent.reverse());
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
 * everything under it, some purge a note already deleted, and some carry one
 * somewhere else — under another note or after one, into a run it is already in
 * as readily as into another. A note that has gone is never written under,
 * alongside or into again, and a note is never carried under itself or under
 * anything it holds, which are the sequences the product will not let anybody
 * ask for either.
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
    if (roll < 0.34) {
      const target = pick(live);
      const relation = random() < 0.5 ? "under" : "after";
      const allowed = [...live].filter((to) =>
        relation === "under"
          ? !under(target, to)
          : parentOf[to] === null || !under(target, parentOf[to]),
      );
      if (allowed.length > 0) {
        const to = allowed[Math.floor(random() * allowed.length)];
        parentOf[target] = relation === "under" ? to : parentOf[to];
        ops.push({ kind: "move", target, relation, to });
        continue;
      }
    }
    const target = pick(live);
    const kind = roll < 0.66 ? "child" : "sibling";
    parentOf.push(kind === "child" ? target : parentOf[target]);
    live.add(parentOf.length - 1);
    ops.push({ kind, target });
  }
  return ops;
}

function replay(peer: Peer, ops: readonly Op[]): Peer {
  for (const op of ops) peer.apply(op);
  return peer;
}

describe("determinism across peers", () => {
  const SEEDS = 200;
  const OPS_PER_SEED = 120;

  it("assigns byte-identical addresses from unrelated internal state", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      const a = replay(new AppendOrderPeer(), ops);
      const b = replay(new AddressOrderPeer(), ops);
      expect(b.assigned.join("\n")).toBe(a.assigned.join("\n"));
      expect(b.current.join("\n")).toBe(a.current.join("\n"));
    }
  });

  it("leaves byte-identical aliases behind, each one resolving to a note", () => {
    let moves = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      moves += ops.filter((op) => op.kind === "move").length;
      const a = replay(new AppendOrderPeer(), ops);
      const b = replay(new AddressOrderPeer(), ops);
      expect(b.aliases.join("\n")).toBe(a.aliases.join("\n"));

      const notes = new Set(a.current);
      for (const alias of a.aliases) {
        const [address, resolves] = alias.split(" -> ");
        expect(notes.has(resolves as Address)).toBe(true);
        // An address a note left is never a note's address again, or the two
        // would resolve two ways inside one graph.
        expect(notes.has(address as Address)).toBe(false);
      }
    }
    // The claim above is empty over sequences that never move anything.
    expect(moves).toBeGreaterThan(SEEDS);
  });

  it("never assigns one address twice, however many notes have gone or moved", () => {
    let gone = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      gone += ops.filter(
        (op) => op.kind === "delete" || op.kind === "purge",
      ).length;
      for (const peer of [new AppendOrderPeer(), new AddressOrderPeer()]) {
        const { assigned } = replay(peer, ops);
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
        const { assigned } = replay(new AppendOrderPeer(), ops.slice(0, step));
        expect(assigned.slice(0, previous.length)).toEqual([...previous]);
        previous = assigned;
      }
    }
  });

  it("keeps every assignment inside the grammar and under its parent", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const peer = replay(
        new AppendOrderPeer(),
        generateOps(seed, OPS_PER_SEED),
      );
      for (const address of [...peer.assigned, ...peer.current]) {
        expect(isAddress(address)).toBe(true);
        const parent = parentAddress(address);
        if (parent !== null) {
          expect(isAncestorAddress(parent, address)).toBe(true);
          expect(addressDepth(address)).toBe(addressDepth(parent) + 1);
        }
      }
    }
  });

  it("offers the same address however many siblings carry none", () => {
    // A caller hands the rule the run as it holds it, absent addresses and all
    // — which is what a store answers with once a note has been left
    // unnumbered. The rule follows the GREATEST address, and a note with none
    // holds nothing to be greater than.
    const WRITTEN = "2026-01-01T00:00:00.000Z";
    let runs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const graph = replay(new AddressOrderPeer(), generateOps(seed, 60));
      for (const parent of [null, ...graph.current]) {
        const run = graph.current.filter(
          (address) => parentAddress(address) === parent,
        );
        if (run.length === 0) continue;
        runs += 1;
        const alongside = orderSiblings<{
          ref: string;
          address?: Address;
          created_at: string;
        }>([
          ...run.map((address, at) => ({
            ref: `did:syr:zAva/${at}`,
            address,
            created_at: WRITTEN,
          })),
          ...[1, 2, 3].map((at) => ({
            ref: `did:syr:zAva/bare${at}`,
            created_at: WRITTEN,
          })),
        ]);
        expect(
          nextChildAddress(
            parent,
            alongside.map((one) => one.address),
          ),
        ).toBe(nextChildAddress(parent, run));
      }
    }
    expect(runs).toBeGreaterThan(200);
  });

  it("orders addresses the same way on both peers", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      const a = [...replay(new AppendOrderPeer(), ops).assigned].sort(
        compareAddresses,
      );
      const b = [...replay(new AddressOrderPeer(), ops).assigned].sort(
        compareAddresses,
      );
      expect(b.join("\n")).toBe(a.join("\n"));
    }
  });
});
