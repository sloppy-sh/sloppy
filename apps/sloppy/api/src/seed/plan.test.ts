import { BlockDocumentSchema, TagsSchema } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { TOPICS } from "./corpus";
import { type PlannedNode, planGraph } from "./plan";

const plan = planGraph(2400);

function every(node: PlannedNode, visit: (node: PlannedNode) => void): void {
  visit(node);
  for (const child of node.children) every(child, visit);
}

const all: PlannedNode[] = [];
const treeOf = new Map<PlannedNode, PlannedNode>();
for (const root of plan.roots) {
  every(root, (node) => {
    all.push(node);
    treeOf.set(node, root);
  });
}

const SUBJECTS = new Set(TOPICS.map((topic) => topic.tag));

function carrying(...tags: string[]): PlannedNode[] {
  return all.filter((node) => tags.every((tag) => node.tags.includes(tag)));
}

function treesSpanned(nodes: readonly PlannedNode[]): number {
  return new Set(nodes.map((node) => treeOf.get(node))).size;
}

const PAIRS = plan.tags.flatMap((one, i) =>
  plan.tags.slice(i + 1).map((other) => [one, other] as const),
);

describe("the seeded graph", () => {
  it("is big enough to be worth drawing", () => {
    expect(all.length).toBe(plan.nodes);
    expect(plan.nodes).toBeGreaterThanOrEqual(2000);
    expect(plan.blocks).toBeGreaterThan(1000);
  });

  it("gives a note with an interior more than one section to drag", () => {
    const written = all.filter((node) => node.blocks.length > 0);
    expect(written.length / all.length).toBeGreaterThan(0.5);
    for (const node of written) {
      expect(node.blocks.length, node.title).toBeGreaterThanOrEqual(2);
      expect(node.blocks.length, node.title).toBeLessThanOrEqual(3);
    }
  });

  it("writes each section as a document the store will accept", () => {
    for (const node of all) {
      for (const section of node.blocks) {
        expect(BlockDocumentSchema.parse(section), node.title).toEqual(section);
        expect(section.content.length, node.title).toBeGreaterThan(0);
      }
    }
  });

  it("puts a heading over several paragraphs in a good many sections", () => {
    const sections = all.flatMap((node) => node.blocks);
    const written = sections.filter(
      (section) =>
        section.content.some((element) => element.type === "heading") &&
        section.content.filter((element) => element.type === "paragraph")
          .length > 1,
    );
    expect(written.length / sections.length).toBeGreaterThan(0.2);
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

  it("plans the tags a note will actually be stored with", () => {
    for (const node of all) {
      expect(TagsSchema.parse(node.tags), node.title).toEqual(node.tags);
    }
    expect(new Set(plan.tags)).toEqual(new Set(all.flatMap((n) => n.tags)));
  });

  it("puts more than one subject inside every tree", () => {
    for (const root of plan.roots) {
      const subjects = new Set<string>();
      every(root, (node) => {
        for (const tag of node.tags) if (SUBJECTS.has(tag)) subjects.add(tag);
      });
      expect(subjects.size).toBeGreaterThan(1);
    }
  });

  it("carries every tag on a share of the graph worth highlighting", () => {
    for (const tag of plan.tags) {
      const share = carrying(tag).length / all.length;
      // Under the floor a selection lights nothing; over the ceiling it lights
      // the whole canvas. Either way the highlight has said nothing.
      expect(share, tag).toBeGreaterThan(0.01);
      expect(share, tag).toBeLessThan(0.65);
    }
  });

  it("has most pairs of tags meet, and never inside one tree", () => {
    // Selecting two tags is the gesture the graph exists to answer. The pairs
    // that never meet are the ones a note only ever has one of — how ripe it
    // is, what kind of note it is — and those are the plan's own doing.
    const meeting = PAIRS.filter(([one, other]) => carrying(one, other).length);
    expect(meeting.length / PAIRS.length).toBeGreaterThan(0.7);
    for (const [one, other] of meeting) {
      expect(
        treesSpanned(carrying(one, other)),
        `${one} + ${other}`,
      ).toBeGreaterThan(1);
    }
  });

  it("puts a look on some of the lines and leaves most of them plain", () => {
    const looked = all.filter((node) => node.look !== undefined);

    expect(looked.length).toBe(plan.looks);
    expect(looked.length).toBeGreaterThan(50);
    // Over this the canvas reads as a wall of words rather than as a graph.
    expect(looked.length / all.length).toBeLessThan(0.2);
    for (const node of looked) {
      expect(node.look?.label?.length, node.title).toBeGreaterThan(0);
    }
    // A branch has no line above it for a look to draw on.
    for (const root of plan.roots) expect(root.look).toBeUndefined();
  });

  it("is the same graph on every run", () => {
    const again = planGraph(2400);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });
});
