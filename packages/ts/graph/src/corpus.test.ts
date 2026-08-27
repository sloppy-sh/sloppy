import {
  addressDepth,
  isAddress,
  OwnedRefSchema,
  parseNodeView,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { DEFAULT_CORPUS, makeCorpus } from "./corpus.test-support.js";

describe("makeCorpus", () => {
  const corpus = makeCorpus();

  it("produces a graph the size the API's seed does", () => {
    expect(corpus.nodes).toHaveLength(DEFAULT_CORPUS.total);
    expect(corpus.nodes.filter((node) => node.depth === 1)).toHaveLength(
      DEFAULT_CORPUS.roots,
    );
    const deepest = corpus.nodes.reduce(
      (most, node) => Math.max(most, node.depth),
      0,
    );
    expect(deepest).toBeGreaterThanOrEqual(6);
    expect(deepest).toBeLessThanOrEqual(DEFAULT_CORPUS.maxDepth);
  });

  // Everything measured against this corpus is measured against nothing at all
  // if its rows are not the rows the API hands a client.
  it("emits rows that survive the wire parse", () => {
    for (const node of corpus.nodes) {
      expect(() => parseNodeView(node)).not.toThrow();
      expect(OwnedRefSchema.safeParse(node.ref).success).toBe(true);
      expect(isAddress(node.address)).toBe(true);
      expect(node.depth).toBe(addressDepth(node.address));
    }
  });

  it("is the same graph on every run", () => {
    const again = makeCorpus();
    expect(again.nodes.map((node) => node.address)).toEqual(
      corpus.nodes.map((node) => node.address),
    );
  });

  it("carries a pulled tree, so provenance has something to draw", () => {
    const owners = new Set(corpus.nodes.map((node) => node.created_by));
    expect(owners.size).toBe(2);
  });
});
