// The shape of the seeded graph, worked out before anything is written.
//
// Deterministic: one integer seed decides every title, label and branch, so two
// runs of `pnpm --filter @sloppy/api seed` produce the same graph and a bug in
// it can be reproduced.

import type { BlockType, LabelSet } from "@sloppy/types";
import {
  FOLLOWING_TEMPLATES,
  LIST_TEMPLATES,
  OPENING_TEMPLATES,
  PARAGRAPH_TEMPLATES,
  QUESTION_TEMPLATES,
  TOPICS,
  type Topic,
} from "./corpus";

export interface PlannedBlock {
  type: BlockType;
  content: string;
}

export interface PlannedNode {
  title: string;
  labels: LabelSet;
  blocks: PlannedBlock[];
  children: PlannedNode[];
}

export interface PlannedDimension {
  name: string;
  values: string[];
  color_slot: number;
}

export interface GraphPlan {
  dimensions: PlannedDimension[];
  roots: PlannedNode[];
  nodes: number;
  blocks: number;
  deepest: number;
  widestRun: number;
}

export const DIMENSIONS: readonly PlannedDimension[] = [
  {
    name: "domain",
    values: TOPICS.map((topic) => topic.domain),
    color_slot: 1,
  },
  {
    name: "status",
    values: ["seed", "growing", "developed", "dormant"],
    color_slot: 3,
  },
  {
    name: "type",
    values: ["question", "claim", "observation", "definition", "objection"],
    color_slot: 5,
  },
  {
    name: "confidence",
    values: ["hunch", "working", "settled"],
    color_slot: 7,
  },
];

/** Deep enough that a chain is worth collapsing, shallow enough to stay legible. */
const MAX_DEPTH = 9;

export function planGraph(nodeTarget: number, seed = 0x5104_9713): GraphPlan {
  const random = mulberry32(seed);
  const used = new Set<string>();
  const perTree = Math.ceil(nodeTarget / TOPICS.length);
  const roots = TOPICS.map((topic) => growTree(random, used, topic, perTree));

  return {
    dimensions: [...DIMENSIONS],
    roots,
    nodes: roots.reduce((total, root) => total + count(root), 0),
    blocks: roots.reduce((total, root) => total + blockCount(root), 0),
    deepest: Math.max(...roots.map((root) => deepest(root, 1))),
    widestRun: Math.max(...roots.map(widestRun)),
  };
}

function growTree(
  random: () => number,
  used: Set<string>,
  topic: Topic,
  target: number,
): PlannedNode {
  const root: PlannedNode = {
    title: topic.thesis,
    labels: { ...labelsFor(random, topic, 1, "claim"), domain: topic.domain },
    blocks: blocksFor(random, topic, 1, true),
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
      node.children.push(plant(random, used, topic, depth + 1));
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
  used: Set<string>,
  topic: Topic,
  depth: number,
): PlannedNode {
  const { title, kind } = titleFor(random, used, topic, depth);
  return {
    title,
    labels: labelsFor(random, topic, depth, kind),
    blocks: blocksFor(random, topic, depth, false),
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

function labelsFor(
  random: () => number,
  topic: Topic,
  depth: number,
  kind: NoteKind,
): LabelSet {
  const labels: LabelSet = {};

  // A fifth of a tree's notes belong to somebody else's domain, which is the
  // whole point of the facet axis: the domain lens must re-cluster ACROSS the
  // genealogy, not redraw it.
  labels.domain =
    random() < 0.79
      ? topic.domain
      : pick(
          random,
          TOPICS.map((other) => other.domain),
        );

  labels.status = statusFor(random, depth);
  if (random() < 0.9) labels.type = kind;
  if (random() < 0.6) {
    const settled = random();
    labels.confidence =
      settled < 0.4 ? "hunch" : settled < 0.8 ? "working" : "settled";
  }
  return labels;
}

/** Older thinking sits nearer the trunk, but not so strictly that the status
 *  lens just redraws the depth. */
function statusFor(random: () => number, depth: number): string {
  if (random() < 0.08) return "dormant";
  const ripe = random();
  if (depth <= 3)
    return ripe < 0.5 ? "developed" : ripe < 0.85 ? "growing" : "seed";
  if (depth <= 6)
    return ripe < 0.18 ? "developed" : ripe < 0.6 ? "growing" : "seed";
  return ripe < 0.06 ? "developed" : ripe < 0.38 ? "growing" : "seed";
}

function blocksFor(
  random: () => number,
  topic: Topic,
  depth: number,
  isRoot: boolean,
): PlannedBlock[] {
  if (!isRoot && random() > 0.62) return [];
  const blocks: PlannedBlock[] = [];
  if (isRoot || random() < 0.22) {
    blocks.push({
      type: "heading",
      content: `## ${sentenceCase(pick(random, topic.subjects))}`,
    });
  }
  const paragraphs = isRoot ? 2 : 1 + Math.floor(random() * 2);
  for (let i = 0; i < paragraphs; i++) {
    blocks.push({
      type: "paragraph",
      content: fill(random, pick(random, PARAGRAPH_TEMPLATES), topic),
    });
  }
  const extra = random();
  if (extra < 0.18) {
    const items = 3 + Math.floor(random() * 3);
    blocks.push({
      type: "list",
      content: Array.from(
        { length: items },
        () => `- ${fill(random, pick(random, LIST_TEMPLATES), topic)}`,
      ).join("\n"),
    });
  } else if (extra < 0.26) {
    blocks.push({
      type: "todo",
      content: `- [ ] ${fill(random, pick(random, QUESTION_TEMPLATES), topic)}`,
    });
  } else if (extra < 0.3 && depth > 2) {
    blocks.push({
      type: "code",
      content: [
        "```sql",
        "SELECT address, title FROM node",
        "  WHERE created_by = $did AND origin = $origin AND depth <= 3;",
        "```",
      ].join("\n"),
    });
  }
  return blocks;
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
