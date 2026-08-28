import type { NodeView, OwnedRef, Tag } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { drawnNodes } from "./contract.js";

const DID = "did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc";

const ref = (seq: number): OwnedRef =>
  `${DID}/01JYQ0000000000000000${String(seq).padStart(5, "0")}`;

function node(
  seq: number,
  address: string,
  parent?: NodeView,
  tags: string[] = [],
): NodeView {
  return {
    ref: ref(seq),
    created_by: DID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address,
    depth: (address.match(/[0-9]+|[a-z]+/g) ?? []).length,
    parent: parent?.ref,
    origin: parent?.origin ?? ref(seq),
    title: address,
    tags: tags as Tag[],
    links: [],
    published: false,
  };
}

const root = node(1, "1");
const child = node(2, "1a", root, ["seed"]);
const grandchild = node(3, "1a1", child, ["evergreen", "seed"]);
const sibling = node(4, "1b", root);

describe("drawnNodes", () => {
  it("draws everything when nothing is collapsed", () => {
    const drawn = drawnNodes([root, child, grandchild], new Set());
    expect(drawn.map((d) => d.node.address)).toEqual(["1", "1a", "1a1"]);
    expect(drawn.every((d) => !d.collapsed && d.folded === 0)).toBe(true);
  });

  it("folds a whole subtree into its collapsed root", () => {
    const drawn = drawnNodes(
      [root, child, grandchild, sibling],
      new Set([root.ref]),
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0].node.ref).toBe(root.ref);
    expect(drawn[0].collapsed).toBe(true);
    expect(drawn[0].folded).toBe(3);
  });

  it("counts a nested collapse once, into the outermost root", () => {
    const drawn = drawnNodes(
      [root, child, grandchild],
      new Set([root.ref, child.ref]),
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0].folded).toBe(2);
  });

  it("leaves a collapsed node's siblings alone", () => {
    const drawn = drawnNodes(
      [root, child, grandchild, sibling],
      new Set([child.ref]),
    );
    expect(drawn.map((d) => d.node.address)).toEqual(["1", "1a", "1b"]);
    expect(drawn[1].folded).toBe(1);
    expect(drawn[2].folded).toBe(0);
  });

  it("draws a node whose ancestors the host has not loaded", () => {
    const drawn = drawnNodes([grandchild], new Set([root.ref, child.ref]));
    expect(drawn.map((d) => d.node.address)).toEqual(["1a1"]);
  });

  it("carries what it folded, so a fold never hides a match", () => {
    const drawn = drawnNodes(
      [root, child, grandchild, sibling],
      new Set([root.ref]),
    );
    expect(new Set(drawn[0].tags)).toEqual(new Set(["seed", "evergreen"]));
  });

  it("carries a nested collapse's tags out to the outermost mega-node", () => {
    const drawn = drawnNodes(
      [root, child, grandchild],
      new Set([root.ref, child.ref]),
    );
    expect(new Set(drawn[0].tags)).toEqual(new Set(["seed", "evergreen"]));
  });

  it("gives a mark that folded nothing its own tags and no others", () => {
    const drawn = drawnNodes([root, child, grandchild, sibling], new Set());
    expect(drawn.map((entry) => entry.tags)).toEqual([
      [],
      ["seed"],
      ["evergreen", "seed"],
      [],
    ]);
  });

  it("never folds across origins", () => {
    const theirs = node(9, "1a");
    const drawn = drawnNodes([root, theirs], new Set([root.ref]));
    expect(drawn.map((d) => d.node.ref)).toEqual([root.ref, theirs.ref]);
    expect(drawn[0].folded).toBe(0);
  });
});
