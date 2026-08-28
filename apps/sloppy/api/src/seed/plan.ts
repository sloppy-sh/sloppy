// The shape of the seeded graph, worked out before anything is written.
//
// Deterministic: one integer seed decides every title, tag and branch, so two
// runs of `pnpm --filter @sloppy/api seed` produce the same graph and a bug in
// it can be reproduced. The interiors are drawn from a second stream off that
// same seed, so rewriting how a section is written cannot reshape the graph.

import type { BlockDocument, DocumentNode, ElementType } from "@sloppy/types";
import {
  FOLLOWING_TEMPLATES,
  LIST_TEMPLATES,
  OPENING_TEMPLATES,
  PARAGRAPH_TEMPLATES,
  QUESTION_TEMPLATES,
  TOPICS,
  type Topic,
} from "./corpus";

/** The element kinds the seed writes. It fills a graph with prose, not pictures. */
type SeededElement = Extract<
  ElementType,
  "paragraph" | "heading" | "list" | "todo" | "code"
>;

/** One line for a piece of prose, one per item for a list. */
interface PlannedElement {
  type: SeededElement;
  lines: string[];
}

export interface PlannedNode {
  title: string;
  /** Already the set the store will hold: lowercased, deduplicated, sorted. */
  tags: string[];
  /** One document per section, holding everything written inside it. */
  blocks: BlockDocument[];
  children: PlannedNode[];
}

export interface GraphPlan {
  roots: PlannedNode[];
  /** Every tag the plan used, so the command can report what it wrote. */
  tags: string[];
  nodes: number;
  blocks: number;
  deepest: number;
  widestRun: number;
}

/**
 * Tags that answer to nothing else in the graph — not the subject, not the
 * depth, not the kind of note. They are what makes an intersection worth
 * asking for: a handful of notes scattered across every tree.
 */
const MARGINALIA = [
  "revisit",
  "disputed",
  "source-needed",
  "favourite",
] as const;

/** Deep enough that a chain is worth collapsing, shallow enough to stay legible. */
const MAX_DEPTH = 9;

export function planGraph(nodeTarget: number, seed = 0x5104_9713): GraphPlan {
  const random = mulberry32(seed);
  const prose = mulberry32(seed ^ 0x9e37_79b9);
  const used = new Set<string>();
  const perTree = Math.ceil(nodeTarget / TOPICS.length);
  const roots = TOPICS.map((topic) =>
    growTree(random, prose, used, topic, perTree),
  );

  return {
    roots,
    tags: [...vocabulary(roots)].sort(),
    nodes: roots.reduce((total, root) => total + count(root), 0),
    blocks: roots.reduce((total, root) => total + blockCount(root), 0),
    deepest: Math.max(...roots.map((root) => deepest(root, 1))),
    widestRun: Math.max(...roots.map(widestRun)),
  };
}

function growTree(
  random: () => number,
  prose: () => number,
  used: Set<string>,
  topic: Topic,
  target: number,
): PlannedNode {
  const root: PlannedNode = {
    title: topic.thesis,
    tags: settle([...tagsFor(random, topic, 1, "claim"), topic.tag]),
    blocks: blocksFor(prose, topic, 1, true),
    children: [],
  };
  let planted = 1;

  // Depth-first, so a run of narrow choices becomes one long chain of thought
  // rather than a broad shallow fan.
  const unexpanded: { node: PlannedNode; depth: number }[] = [
    { node: root, depth: 1 },
  ];
  while (planted < target && unexpanded.length > 0) {
    const { node, depth } = unexpanded.pop() as {
      node: PlannedNode;
      depth: number;
    };
    if (depth >= MAX_DEPTH) continue;
    const width = Math.min(widthAt(random, depth), target - planted);
    for (let i = 0; i < width; i++) {
      node.children.push(plant(random, prose, used, topic, depth + 1));
      planted++;
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      unexpanded.push({ node: node.children[i], depth: depth + 1 });
    }
  }
  return root;
}

/** How many notes spring from one note at this depth: a chain, a small branch,
 *  or a wide run of siblings worth collapsing into a mega-node. */
function widthAt(random: () => number, depth: number): number {
  if (depth === 1) return 6 + Math.floor(random() * 4);
  const roll = random();
  if (depth <= 3) {
    if (roll < 0.34) return 1;
    if (roll < 0.62) return 2 + Math.floor(random() * 3);
    return 12 + Math.floor(random() * 15);
  }
  if (depth <= 6) {
    if (roll < 0.48) return 1;
    if (roll < 0.8) return 2 + Math.floor(random() * 2);
    return 8 + Math.floor(random() * 11);
  }
  if (roll < 0.3) return 0;
  if (roll < 0.75) return 1;
  return 2 + Math.floor(random() * 3);
}

function plant(
  random: () => number,
  prose: () => number,
  used: Set<string>,
  topic: Topic,
  depth: number,
): PlannedNode {
  const { title, kind } = titleFor(random, used, topic, depth);
  return {
    title,
    tags: tagsFor(random, topic, depth, kind),
    blocks: blocksFor(prose, topic, depth, false),
    children: [],
  };
}

type NoteKind =
  | "question"
  | "claim"
  | "observation"
  | "definition"
  | "objection";

function titleFor(
  random: () => number,
  used: Set<string>,
  topic: Topic,
  depth: number,
): { title: string; kind: NoteKind } {
  for (let attempt = 0; attempt < 24; attempt++) {
    const roll = random();
    const { template, kind } =
      roll < 0.12
        ? {
            template: pick(random, QUESTION_TEMPLATES),
            kind: "question" as const,
          }
        : depth <= 2
          ? { template: pick(random, OPENING_TEMPLATES), kind: kindFor(random) }
          : {
              template: pick(random, FOLLOWING_TEMPLATES),
              kind: kindFor(random),
            };
    const title = fill(random, template, topic);
    if (!used.has(title)) {
      used.add(title);
      return { title, kind };
    }
  }
  // Every pool is finite. Rather than repeat a title, take the plainest form
  // there is and let the address distinguish the note.
  const title = `${sentenceCase(pick(random, topic.subjects))}, again`;
  used.add(title);
  return { title, kind: "observation" };
}

function kindFor(random: () => number): NoteKind {
  const roll = random();
  if (roll < 0.42) return "claim";
  if (roll < 0.7) return "observation";
  if (roll < 0.85) return "objection";
  return "definition";
}

function tagsFor(
  random: () => number,
  topic: Topic,
  depth: number,
  kind: NoteKind,
): string[] {
  const tags: string[] = [];

  if (random() < 0.92) tags.push(topic.tag);
  // A fifth of a tree's notes also carry somebody else's subject, which is what
  // makes selecting two tags worth doing: the set has to cut ACROSS the
  // genealogy rather than redraw it.
  if (random() < 0.21) {
    tags.push(
      pick(
        random,
        TOPICS.map((other) => other.tag),
      ),
    );
  }

  tags.push(ripenessFor(random, depth));
  if (random() < 0.9) tags.push(kind);
  if (random() < 0.6) {
    const settled = random();
    tags.push(settled < 0.4 ? "hunch" : settled < 0.8 ? "working" : "settled");
  }
  for (const tag of MARGINALIA) if (random() < 0.06) tags.push(tag);
  return settle(tags);
}

/** What the store will hold, so a planned note and a written one are the same
 *  note — `TagsSchema` in @sloppy/types is the rule this obeys. */
function settle(tags: readonly string[]): string[] {
  return [...new Set(tags)].sort();
}

/** Older thinking sits nearer the trunk, but not so strictly that the ripeness
 *  tags just redraw the depth. */
function ripenessFor(random: () => number, depth: number): string {
  if (random() < 0.08) return "dormant";
  const ripe = random();
  if (depth <= 3)
    return ripe < 0.5 ? "developed" : ripe < 0.85 ? "growing" : "seed";
  if (depth <= 6)
    return ripe < 0.18 ? "developed" : ripe < 0.6 ? "growing" : "seed";
  return ripe < 0.06 ? "developed" : ripe < 0.38 ? "growing" : "seed";
}

function blocksFor(
  prose: () => number,
  topic: Topic,
  depth: number,
  isRoot: boolean,
): BlockDocument[] {
  if (!isRoot && prose() > 0.62) return [];
  const sections = isRoot || prose() < 0.4 ? 3 : 2;
  return Array.from({ length: sections }, (_, index) =>
    documentOf(sectionFor(prose, topic, depth, index === 0)),
  );
}

/** A section is one thought written out: a heading over a few paragraphs, and
 *  sometimes a list or a question to come back to. */
function sectionFor(
  prose: () => number,
  topic: Topic,
  depth: number,
  opening: boolean,
): PlannedElement[] {
  const elements: PlannedElement[] = [];
  if (opening || prose() < 0.45) {
    elements.push({
      type: "heading",
      lines: [sentenceCase(pick(prose, topic.subjects))],
    });
  }
  const paragraphs = 1 + Math.floor(prose() * 3);
  for (let i = 0; i < paragraphs; i++) {
    elements.push({
      type: "paragraph",
      lines: [fill(prose, pick(prose, PARAGRAPH_TEMPLATES), topic)],
    });
  }
  const extra = prose();
  if (extra < 0.2) {
    const items = 3 + Math.floor(prose() * 3);
    elements.push({
      type: "list",
      lines: Array.from({ length: items }, () =>
        fill(prose, pick(prose, LIST_TEMPLATES), topic),
      ),
    });
  } else if (extra < 0.28) {
    elements.push({
      type: "todo",
      lines: [fill(prose, pick(prose, QUESTION_TEMPLATES), topic)],
    });
  } else if (extra < 0.34 && depth > 2) {
    elements.push({
      type: "code",
      lines: [
        "SELECT address, title FROM node",
        "  WHERE created_by = $did AND origin = $origin AND depth <= 3;",
      ],
    });
  }
  return elements;
}

function documentOf(elements: readonly PlannedElement[]): BlockDocument {
  return { type: "doc", content: elements.map(elementNode) };
}

/** The seed writes what the editor would have written, because that is what a
 *  block stores. */
function elementNode(element: PlannedElement): DocumentNode {
  switch (element.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: 2 },
        content: text(element.lines[0]),
      };
    case "paragraph":
      return { type: "paragraph", content: text(element.lines[0]) };
    case "list":
      return { type: "bulletList", content: element.lines.map(listItem) };
    case "todo":
      return { type: "taskList", content: element.lines.map(taskItem) };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: "sql" },
        content: text(element.lines.join("\n")),
      };
  }
}

function text(line: string): DocumentNode[] {
  return [{ type: "text", text: line }];
}

function listItem(line: string): DocumentNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: text(line) }],
  };
}

function taskItem(line: string): DocumentNode {
  return {
    type: "taskItem",
    attrs: { checked: false },
    content: [{ type: "paragraph", content: text(line) }],
  };
}

function fill(random: () => number, template: string, topic: Topic): string {
  const subject = pick(random, topic.subjects);
  const action = pick(random, topic.actions);
  const object = pick(random, topic.objects);
  const condition = pick(random, topic.conditions);
  return template
    .replace("{Subject}", sentenceCase(subject))
    .replace(/\{subject\}/g, subject)
    .replace(/\{action\}/g, action)
    .replace(/\{object\}/g, object)
    .replace(/\{condition\}/g, condition);
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pick<T>(random: () => number, from: readonly T[]): T {
  return from[Math.floor(random() * from.length)];
}

function vocabulary(roots: readonly PlannedNode[]): Set<string> {
  const seen = new Set<string>();
  const walk = (node: PlannedNode) => {
    for (const tag of node.tags) seen.add(tag);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return seen;
}

function count(node: PlannedNode): number {
  return 1 + node.children.reduce((total, child) => total + count(child), 0);
}

function blockCount(node: PlannedNode): number {
  return (
    node.blocks.length +
    node.children.reduce((total, child) => total + blockCount(child), 0)
  );
}

function deepest(node: PlannedNode, depth: number): number {
  return node.children.reduce(
    (found, child) => Math.max(found, deepest(child, depth + 1)),
    depth,
  );
}

function widestRun(node: PlannedNode): number {
  return node.children.reduce(
    (found, child) => Math.max(found, widestRun(child)),
    node.children.length,
  );
}

/** Mulberry32: a small, well-known PRNG. Any deterministic source would do;
 *  what matters is that it is not the platform's, which offers no seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
