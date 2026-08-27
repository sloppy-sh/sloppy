import type { NodeView, OwnedRef } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { drawnNodes } from "./contract.js";
import { makeCorpus } from "./corpus.test-support.js";
import { applyLod, DEFAULT_BUDGET, spineFloor } from "./lod.js";

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
