// A graph the size of a real one, generated rather than fetched, so the tests
// and the benchmark measure the same field. The defaults match what
// `pnpm --filter @sloppy/api seed` produces: 2,400 notes over 6 roots, nine
// generations deep, 23 siblings at the widest.

import {
  type Address,
  childAddress,
  compareAddresses,
  type NodeView,
  type OwnedRef,
  siblingAddress,
  type Tag,
  TagsSchema,
} from "@sloppy/types";

const OWNER = "did:syr:z6MkwSiAvviKsS8dvXsScr4ipdeZwusLQY92cWWBisnvpJLc";
const OTHER = "did:syr:z6MkfPeerPeerPeerPeerPeerPeerPeerPeerPeerPeerP";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface CorpusOptions {
  total: number;
  roots: number;
  maxDepth: number;
  maxSiblings: number;
  seed: number;
  /** Roots (by 1-based ordinal) whose whole tree belongs to somebody else. */
  pulledRoots: readonly number[];
}

export const DEFAULT_CORPUS: CorpusOptions = {
  total: 2400,
  roots: 6,
  maxDepth: 9,
  maxSiblings: 23,
  seed: 20260827,
  pulledRoots: [6],
};

export interface Corpus {
  nodes: NodeView[];
  /** Every tag the corpus carries, most-used first — what the tag read answers. */
  tags: Tag[];
  owner: string;
}

/** Drawn from independently, so a note lands in several sets at once. */
const TAG_POOLS: string[][] = [
  ["biology", "chemistry", "physics", "history", "method"],
  ["seed", "growing", "evergreen"],
  ["question", "claim", "note", "source"],
  ["hunch", "working", "settled"],
];

export function makeCorpus(overrides: Partial<CorpusOptions> = {}): Corpus {
  const options = { ...DEFAULT_CORPUS, ...overrides };
  const random = mulberry32(options.seed);
  const nodes: NodeView[] = [];

  interface Pending {
    address: Address;
    parent: OwnedRef | undefined;
    origin: OwnedRef;
    depth: number;
  }

  let serial = 0;
  const emit = (pending: Pending, owner: string): NodeView => {
    const ref = refAt(owner, serial++);
    const node: NodeView = {
      ref,
      created_by: owner,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      address: pending.address,
      depth: pending.depth,
      parent: pending.parent,
      origin: pending.depth === 1 ? ref : pending.origin,
      title: titleFor(pending.address, random),
      tags: tagsFor(random),
      links: [],
      published: random() < 0.12,
    };
    nodes.push(node);
    return node;
  };

  let frontier: { node: NodeView; owner: string }[] = [];
  for (let root = 1; root <= options.roots; root++) {
    const owner = options.pulledRoots.includes(root) ? OTHER : OWNER;
    const node = emit(
      {
        address: String(root) as Address,
        parent: undefined,
        origin: "" as OwnedRef,
        depth: 1,
      },
      owner,
    );
    frontier.push({ node, owner });
  }

  const profile = levelProfile(options);
  for (let depth = 1; depth < options.maxDepth; depth++) {
    const next: { node: NodeView; owner: string }[] = [];
    // Which parents branch is shuffled, so the wide nodes are not always the
    // first ones a walk in address order reaches.
    const order = shuffled(frontier, random);
    for (const [at, width] of shareOut(
      profile[depth],
      order.length,
      options.maxSiblings,
      random,
    ).entries()) {
      const { node, owner } = order[at];
      let address = childAddress(node.address);
      for (let sibling = 0; sibling < width; sibling++) {
        const child = emit(
          { address, parent: node.ref, origin: node.origin, depth: depth + 1 },
          owner,
        );
        next.push({ node: child, owner });
        address = siblingAddress(address);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  nodes.sort((a, b) => compareAddresses(a.address, b.address));

  // The connections genealogy does not carry, both ways of making one: a handful
  // drawn by hand and rather more the writing named, so each pass has something
  // to draw and the layout has a cross-tree spring.
  const joining = (
    count: number,
    join: (from: NodeView, to: OwnedRef) => void,
  ): void => {
    for (let at = 0; at < count; at++) {
      const from = nodes[Math.floor(random() * nodes.length)];
      const to = nodes[Math.floor(random() * nodes.length)];
      if (from !== to) join(from, to.ref);
    }
  };
  joining(Math.floor(nodes.length / 60), (from, to) => from.links.push(to));
  joining(Math.floor(nodes.length / 30), (from, to) => {
    from.references = [...(from.references ?? []), to];
  });

  const carriers = new Map<Tag, number>();
  for (const node of nodes) {
    for (const tag of node.tags)
      carriers.set(tag, (carriers.get(tag) ?? 0) + 1);
  }

  return {
    nodes,
    tags: [...carriers]
      .sort(([a, byA], [b, byB]) => byB - byA || a.localeCompare(b))
      .map(([tag]) => tag),
    owner: OWNER,
  };
}

/**
 * How many notes sit at each generation: a hump that rises and tapers, sized so
 * the tree reaches `maxDepth` instead of spending its whole budget three levels
 * in. Each level is capped at what its parents can hold.
 */
function levelProfile(options: CorpusOptions): number[] {
  const weights = Array.from({ length: options.maxDepth }, (_, level) =>
    level === 0 ? 0 : Math.sin((Math.PI * level) / options.maxDepth) ** 2,
  );
  const mass = weights.reduce((sum, weight) => sum + weight, 0);
  const budget = options.total - options.roots;
  const counts = [options.roots];
  let spent = 0;
  let carried = 0;
  for (let level = 1; level < options.maxDepth; level++) {
    const room = counts[level - 1] * options.maxSiblings;
    const want = Math.round((weights[level] / mass) * budget) + carried;
    const take = Math.max(0, Math.min(want, room, budget - spent));
    carried = want - take;
    counts.push(take);
    spent += take;
  }
  counts[counts.length - 1] += budget - spent;
  return counts;
}

/**
 * A generation's places handed out among its parents: mostly a few each,
 * occasionally the widest sibling set, and nothing at all once the generation
 * is full — which is where the leaves come from.
 */
function shareOut(
  places: number,
  parents: number,
  maxSiblings: number,
  random: () => number,
): number[] {
  const widths = new Array<number>(parents).fill(0);
  let remaining = places;
  let moved = true;
  while (remaining > 0 && moved) {
    moved = false;
    for (let at = 0; at < parents && remaining > 0; at++) {
      const room = maxSiblings - widths[at];
      if (room <= 0) continue;
      const wanted =
        random() < 0.05 ? maxSiblings : 1 + Math.floor(random() * 5);
      const take = Math.min(wanted, room, remaining);
      widths[at] += take;
      remaining -= take;
      moved = true;
    }
  }
  return widths;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let at = out.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1));
    [out[at], out[swap]] = [out[swap], out[at]];
  }
  return out;
}

/** Through `TagsSchema`, so a corpus row carries the set a stored one would. */
function tagsFor(random: () => number): Tag[] {
  const picked: string[] = [];
  for (const pool of TAG_POOLS) {
    if (random() < 0.18) continue;
    picked.push(pool[Math.floor(random() * pool.length)]);
  }
  return TagsSchema.parse(picked);
}

const WORDS = [
  "membrane",
  "gradient",
  "ledger",
  "sequence",
  "boundary",
  "signal",
  "index",
  "residue",
  "lattice",
  "drift",
  "closure",
  "witness",
];

function titleFor(address: Address, random: () => number): string {
  const count = 2 + Math.floor(random() * 3);
  const words: string[] = [];
  for (let at = 0; at < count; at++) {
    words.push(WORDS[Math.floor(random() * WORDS.length)]);
  }
  return `${words.join(" ")} ${address}`;
}

function refAt(owner: string, serial: number): OwnedRef {
  let digits = "";
  let remaining = serial;
  for (let at = 0; at < 26; at++) {
    digits = CROCKFORD[remaining % 32] + digits;
    remaining = Math.floor(remaining / 32);
  }
  return `${owner}/${digits}` as OwnedRef;
}

/** mulberry32 — small, and the same sequence in every runtime. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
