// The protocol claim, held over a graph on this device: a sequence of acts must
// assign the addresses a peer holding nothing but addresses assigns, and never
// assign one twice. `packages/ts/types/src/address.test.ts` makes the same claim
// between two peers; the oracle below is that file's address-order peer, so what
// is compared here is a vault against state this package shares none of.

import {
  type Address,
  type OwnedRef,
  compareAddresses,
  isInSubtree,
  nextChildAddress,
  parentAddress,
  rebaseAddress,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import type { LocalGraph } from "./graph.js";
import { graphOnly } from "./local.test-support.js";
import type { NoteWriter } from "./notes.js";

type Op =
  | { kind: "root" }
  | { kind: "child" | "sibling" | "delete" | "purge"; target: number }
  | { kind: "move"; target: number; relation: "under" | "after"; to: number };

/** Nothing but addresses, in the four states a graph holds them in: at a note,
 *  at a deleted one, retired, and left behind by a move. */
class AddressOrderPeer {
  readonly assigned: Address[] = [];
  private readonly at: (Address | undefined)[] = [];
  private readonly live = new Set<Address>();
  private readonly deleted = new Set<Address>();
  private readonly retired = new Set<Address>();
  private readonly left = new Map<Address, Address>();

  get current(): Address[] {
    return [...this.live, ...this.deleted].sort(compareAddresses);
  }

  apply(op: Op): void {
    if (op.kind === "delete") {
      const going = this.at[op.target];
      if (going === undefined) return;
      for (const address of [...this.live]) {
        if (!isInSubtree(going, address)) continue;
        this.live.delete(address);
        this.deleted.add(address);
      }
      return;
    }
    if (op.kind === "purge") {
      const address = this.at[op.target];
      if (address === undefined) return;
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
      const was = this.at[op.target];
      const to = this.at[op.to];
      if (was === undefined || to === undefined) {
        throw new Error(`no run to carry ${op.target} into`);
      }
      this.move(was, op.relation === "under" ? to : parentAddress(to));
      return;
    }
    if (op.kind === "root") {
      this.at.push(this.spend(null));
      return;
    }
    const of = this.at[op.target];
    if (of === undefined) throw new Error(`no run beside ${op.target}`);
    this.at.push(this.spend(op.kind === "sibling" ? parentAddress(of) : of));
  }

  private spend(parent: Address | null): Address {
    const address = this.nextUnder(parent);
    this.live.add(address);
    this.assigned.push(address);
    return address;
  }

  private move(was: Address, parent: Address | null): void {
    const now = this.nextUnder(parent);
    for (const [alias, resolves] of [...this.left]) {
      if (isInSubtree(was, resolves)) {
        this.left.set(alias, rebaseAddress(was, now, resolves));
      }
    }
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
      if (address === undefined) continue;
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

/** The same operations applied to a vault, and every address it assigned. */
async function replayOnVault(ops: readonly Op[]): Promise<{
  assigned: Address[];
  current: Address[];
}> {
  const { graph, writer } = await graphOnly(new MemoryFiles());
  const refs: OwnedRef[] = [];
  const assigned: Address[] = [];
  for (const op of ops) await apply(graph, writer, refs, assigned, op);
  return {
    assigned,
    current: graph
      .all()
      .flatMap((note) => (note.address ? [note.address] : []))
      .sort(compareAddresses),
  };
}

async function apply(
  graph: LocalGraph,
  writer: NoteWriter,
  refs: OwnedRef[],
  assigned: Address[],
  op: Op,
): Promise<void> {
  if (op.kind === "delete") {
    await writer.remove(refs[op.target]);
    return;
  }
  if (op.kind === "purge") {
    const gone = graph.findDeleted(refs[op.target]);
    if (gone) await graph.purge([gone]);
    return;
  }
  if (op.kind === "move") {
    const landed = await writer.move(refs[op.target], {
      relation: op.relation,
      note: refs[op.to],
    });
    const moved = landed.find((view) => view.ref === refs[op.target]);
    if (moved?.address) assigned.push(moved.address);
    return;
  }
  const written = await writer.create(
    op.kind === "root"
      ? {}
      : {
          from: {
            relation: op.kind === "child" ? "under" : "after",
            note: refs[op.target],
          },
        },
  );
  refs.push(written.ref);
  if (written.address) assigned.push(written.address);
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
 * somewhere else. A note that has gone is never written under, alongside or
 * into again, and a note is never carried under itself or under anything it
 * holds — the sequences the product will not let anybody ask for either.
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
      // Only one with nothing of its own left in the bin. The window closes on
      // what was deleted longest ago, and a note goes with everything that
      // sprang from it, so a parent never leaves the bin ahead of its children.
      const loose = [...deleted].filter(
        (node) =>
          ![...deleted].some((held) => held !== node && under(node, held)),
      );
      if (loose.length > 0) {
        const target = loose[Math.floor(random() * loose.length)];
        deleted.delete(target);
        ops.push({ kind: "purge", target });
        continue;
      }
    }
    if (roll < 0.34) {
      const target = pick(live);
      const relation = random() < 0.5 ? "under" : "after";
      const allowed = [...live].filter((to) =>
        to === target
          ? false
          : relation === "under"
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

describe("a graph on this device against a peer holding only addresses", () => {
  const SEEDS = 120;
  const OPS_PER_SEED = 90;

  it("assigns byte-identical addresses over generated sequences", async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ops = generateOps(seed, OPS_PER_SEED);
      const peer = new AddressOrderPeer();
      for (const op of ops) peer.apply(op);
      const vault = await replayOnVault(ops);
      expect(vault.assigned.join("\n")).toBe(peer.assigned.join("\n"));
      expect(vault.current.join("\n")).toBe(peer.current.join("\n"));
    }
  });

  it("never assigns one address twice", async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { assigned } = await replayOnVault(generateOps(seed, OPS_PER_SEED));
      expect(new Set(assigned).size).toBe(assigned.length);
    }
  });

  it("offers what the rule offers on a fresh graph", async () => {
    const ops: Op[] = [{ kind: "root" }, { kind: "child", target: 0 }];
    const peer = new AddressOrderPeer();
    for (const op of ops) peer.apply(op);
    expect(peer.assigned).toEqual(["1", "1a"]);
    expect((await replayOnVault(ops)).assigned).toEqual(["1", "1a"]);
  });
});
