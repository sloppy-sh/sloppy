import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { drawnNodes } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { applyLod, DEFAULT_BUDGET, makeFold, spineFloor } from "./lod.js";

const corpus = makeCorpus();
const nodes = corpus.nodes;
const nothing = new Set<OwnedRef>();

const drawnUnder = (
  collapsed: ReadonlySet<OwnedRef>,
  from: readonly NodeView[] = nodes,
) => drawnNodes(from, collapsed);

describe("applyLod", () => {
  // The bound is the design, not an optimisation — DESIGN.md § "The canvas"
  // ties legibility and frame time together, so neither mode may exceed it.
  it("holds the drawn count under the bound on a whole graph", () => {
    const result = applyLod(nodes, nothing, undefined);
    expect(drawnUnder(result.collapsed).length).toBeLessThanOrEqual(
      DEFAULT_BUDGET.maxDrawn,
    );
  });

  it("holds it under a tighter bound too", () => {
    for (const maxDrawn of [40, 120, 300]) {
      const result = applyLod(nodes, nothing, undefined, {
        ...DEFAULT_BUDGET,
        maxDrawn,
      });
      expect(drawnUnder(result.collapsed).length).toBeLessThanOrEqual(maxDrawn);
    }
  });

  it("holds the bound with a focus deep in a tree", () => {
    const focus = nodes.find((node) => node.depth === 9)!;
    const floor = spineFloor(nodes, focus.ref);
    expect(floor).toBeLessThan(DEFAULT_BUDGET.maxDrawn);

    for (const maxDrawn of [20, 120, DEFAULT_BUDGET.maxDrawn]) {
      const result = applyLod(nodes, nothing, focus.ref, {
        ...DEFAULT_BUDGET,
        maxDrawn,
      });
      const drawn = drawnUnder(result.collapsed);
      expect(drawn.length).toBeLessThanOrEqual(Math.max(maxDrawn, floor));
      expect(drawn.some((entry) => entry.node.ref === focus.ref)).toBe(true);
    }
  });

  it("holds the bound exactly once the bound clears that floor", () => {
    for (const focus of nodes.filter((node) => node.depth === 7).slice(0, 25)) {
      const result = applyLod(nodes, nothing, focus.ref);
      expect(spineFloor(nodes, focus.ref)).toBeLessThan(
        DEFAULT_BUDGET.maxDrawn,
      );
      expect(drawnUnder(result.collapsed).length).toBeLessThanOrEqual(
        DEFAULT_BUDGET.maxDrawn,
      );
    }
  });

  it("never draws fewer marks than there are roots", () => {
    const result = applyLod(nodes, nothing, undefined, {
      depth: 1,
      maxDrawn: 1,
    });
    const drawn = drawnUnder(result.collapsed);
    expect(drawn.length).toBe(corpus.nodes.filter((n) => n.depth === 1).length);
    expect(drawn.every((entry) => entry.collapsed)).toBe(true);
  });

  it("keeps what the host asked to collapse collapsed", () => {
    const target = nodes.find((node) => node.depth === 2)!;
    const result = applyLod(nodes, new Set([target.ref]), target.ref);
    expect(result.collapsed.has(target.ref)).toBe(true);
    expect(result.folded.has(target.ref)).toBe(false);
    const drawn = drawnUnder(result.collapsed);
    expect(drawn.some((entry) => entry.node.parent === target.ref)).toBe(false);
  });

  it("reports only what the budget added, not what the host did", () => {
    const hostChoice = new Set(
      nodes.filter((node) => node.depth === 3).map((node) => node.ref),
    );
    const result = applyLod(nodes, hostChoice, undefined);
    for (const ref of result.folded) expect(hostChoice.has(ref)).toBe(false);
  });

  // Tapping a mega-node moves the focus to it, and that is the whole reason
  // expanding one shows anything: the budget is measured from where you looked.
  it("opens the neighbourhood of the focus in full", () => {
    const focus = nodes.find(
      (node) => node.depth === 6 && nodes.some((n) => n.parent === node.ref),
    )!;
    const children = nodes.filter((node) => node.parent === focus.ref);
    expect(children.length).toBeGreaterThan(0);

    const drawn = new Set(
      drawnUnder(applyLod(nodes, nothing, focus.ref).collapsed).map(
        (entry) => entry.node.ref,
      ),
    );
    for (const child of children) expect(drawn.has(child.ref)).toBe(true);

    const blind = new Set(
      drawnUnder(applyLod(nodes, nothing, undefined).collapsed).map(
        (entry) => entry.node.ref,
      ),
    );
    expect(children.some((child) => !blind.has(child.ref))).toBe(true);
  });

  it("folds another tree into one mega-node when the focus is elsewhere", () => {
    const focus = nodes.find((node) => node.address.startsWith("1a"))!;
    const result = applyLod(nodes, nothing, focus.ref);
    const others = nodes.filter(
      (node) => node.depth === 1 && !node.address.startsWith("1"),
    );
    for (const root of others)
      expect(result.collapsed.has(root.ref)).toBe(true);
  });

  it("counts a folded subtree once, on the mega-node that holds it", () => {
    const result = applyLod(nodes, nothing, undefined);
    const drawn = drawnUnder(result.collapsed);
    const total = drawn.reduce((sum, entry) => sum + entry.folded + 1, 0);
    expect(total).toBe(nodes.length);
  });

  it("is the same fold every time it is asked", () => {
    const once = applyLod(nodes, nothing, undefined);
    const twice = applyLod(nodes, nothing, undefined);
    expect([...twice.collapsed].sort()).toEqual([...once.collapsed].sort());
  });

  // The fold that answers a tag question walks the same tree the one before it
  // did, and that walk is the whole O(every note) cost of a rebuild.
  describe("re-using its walk of the tree", () => {
    /** The nodes, with every read of `parent` counted — which is what building
     *  the children index costs and what folding, given one, does not. */
    const counted = (
      from: readonly NodeView[],
    ): { nodes: NodeView[]; reads: () => number } => {
      let reads = 0;
      return {
        nodes: from.map((node) => {
          const { parent, ...rest } = node;
          return Object.defineProperty(rest as NodeView, "parent", {
            enumerable: true,
            get: () => {
              reads += 1;
              return parent;
            },
          });
        }),
        reads: () => reads,
      };
    };

    it("does not walk it again for the same nodes and focus", () => {
      const { nodes: watched, reads } = counted(nodes);
      const fold = makeFold();
      fold(watched, nothing, undefined);
      const walked = reads();
      expect(walked).toBeGreaterThanOrEqual(watched.length);

      fold(watched, new Set([watched[0].ref]), undefined);
      expect(reads() - walked).toBeLessThan(watched.length / 10);
    });

    it("walks it again when the focus moves", () => {
      const { nodes: watched, reads } = counted(nodes);
      const focus = watched.find((node) => node.depth === 6)!;
      const fold = makeFold();
      fold(watched, nothing, undefined);
      const walked = reads();
      fold(watched, nothing, focus.ref);
      expect(reads() - walked).toBeGreaterThanOrEqual(watched.length);
    });

    // One canvas is one fold, so a second one on the same tree is not somebody
    // else's walk being thrown away and read again.
    it("gives every canvas its own walk to re-use", () => {
      const { nodes: watched, reads } = counted(nodes);
      const one = makeFold();
      const two = makeFold();
      one(watched, nothing, undefined);
      two(watched, nothing, undefined);
      const walked = reads();

      one(watched, nothing, undefined);
      two(watched, nothing, undefined);
      expect(reads() - walked).toBeLessThan(watched.length / 10);
    });

    it("folds the same whether or not the walk is re-used", () => {
      const focus = nodes.find((node) => node.depth === 6)!;
      const asks: [ReadonlySet<OwnedRef>, OwnedRef | undefined][] = [
        [nothing, undefined],
        [new Set([nodes[0].ref]), undefined],
        [nothing, focus.ref],
        [nothing, undefined],
      ];
      const fold = makeFold();
      for (const [collapsed, focusRef] of asks) {
        const kept = fold(nodes, collapsed, focusRef);
        // The free fold walks the tree for every ask, so this is the answer with
        // nothing re-used.
        const fresh = applyLod(nodes, collapsed, focusRef);
        expect([...kept.collapsed].sort()).toEqual([...fresh.collapsed].sort());
        expect([...kept.folded].sort()).toEqual([...fresh.folded].sort());
      }
    });
  });

  it("leaves a region already under the bound alone", () => {
    const small = nodes.slice(0, 30);
    const result = applyLod(small, nothing, undefined, {
      depth: 20,
      maxDrawn: 500,
    });
    expect(result.folded.size).toBe(0);
    expect(drawnUnder(result.collapsed, small)).toHaveLength(small.length);
  });
});
