import { describe, expect, it } from "vitest";
import { DIMENSIONS, type PlannedNode, planGraph } from "./plan";

const plan = planGraph(2400);

function every(node: PlannedNode, visit: (node: PlannedNode) => void): void {
  visit(node);
  for (const child of node.children) every(child, visit);
}

const all: PlannedNode[] = [];
for (const root of plan.roots) every(root, (node) => all.push(node));

describe("the seeded graph", () => {
  it("is big enough to be worth drawing", () => {
    expect(all.length).toBe(plan.nodes);
    expect(plan.nodes).toBeGreaterThanOrEqual(2000);
    expect(plan.blocks).toBeGreaterThan(1000);
  });

  it("has chains deep enough and runs wide enough to be worth collapsing", () => {
    expect(plan.deepest).toBeGreaterThanOrEqual(7);
    expect(plan.widestRun).toBeGreaterThanOrEqual(12);
  });

  it("gives every note a title somebody could have written, and only once", () => {
    const titles = all.map((node) => node.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) {
      expect(title.length).toBeGreaterThan(12);
      expect(title).not.toMatch(/\{|\}|\d{3}/);
    }
  });

  it("labels only with values its dimensions declare", () => {
    const declared = new Map(
      DIMENSIONS.map((d) => [d.name, new Set(d.values)]),
    );
    for (const node of all) {
      for (const [name, value] of Object.entries(node.labels)) {
        expect(declared.get(name)?.has(value), `${name}:${value}`).toBe(true);
      }
    }
  });

  it("spreads a domain across the trees rather than along them", () => {
    for (const root of plan.roots) {
      const domains = new Set<string>();
      every(root, (node) => {
        if (node.labels.domain) domains.add(node.labels.domain);
      });
      expect(domains.size).toBeGreaterThan(1);
    }
  });

  it("spreads every dimension's values, so switching lens re-clusters", () => {
    for (const dimension of DIMENSIONS) {
      const counts = new Map<string, number>();
      for (const node of all) {
        const value = node.labels[dimension.name];
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const labelled = [...counts.values()].reduce((a, b) => a + b, 0);
      expect(counts.size, dimension.name).toBe(dimension.values.length);
      // One value on most of the graph is one cluster and a rounding error.
      expect(
        Math.max(...counts.values()) / labelled,
        dimension.name,
      ).toBeLessThan(0.65);
    }
  });

  it("is the same graph on every run", () => {
    const again = planGraph(2400);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });
});
