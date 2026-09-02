import { describe, expect, it } from "vitest";
import { emptyDocument } from "./document.js";
import {
  MAX_PUBLISHED_NODES_PER_PAGE,
  MAX_PUBLISHED_PAGES,
  parsePublishedIndex,
  type PublishedNode,
  type PublishedSubtreePage,
  publishedSubtreeReader,
  UnaskedAnswerError,
} from "./publication.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const STRANGER = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";

function ulid(n: number): string {
  return `01JPBSHEDX${String(n).padStart(16, "0")}`;
}

function node(
  index: number,
  address: string,
  over: Partial<PublishedNode> = {},
) {
  return {
    ref: `${AUTHOR}/${ulid(index)}`,
    address,
    origin: `${AUTHOR}/${ulid(0)}`,
    title: "A thought",
    tags: [],
    links: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** `1a` published whole: its root, and a child that points back at it. */
function subtree(over: Partial<PublishedSubtreePage> = {}) {
  const root = node(0, "1a");
  return {
    did: AUTHOR,
    root_address: "1a",
    nodes: [root, node(1, "1a1", { parent: root.ref })],
    blocks: [
      {
        ref: `${AUTHOR}/${ulid(2)}`,
        node: root.ref,
        ord: "a0",
        content: emptyDocument(),
      },
    ],
    ...over,
  };
}

const asked = { did: AUTHOR, root_address: "1a" };

/** The whole of a subtree that arrives in one answer. */
function takeWhole(body: unknown): PublishedSubtreePage {
  return publishedSubtreeReader(asked).take(body);
}

describe("a subtree a peer answered with", () => {
  it("is taken when it is the subtree that was asked for", () => {
    const page = takeWhole(subtree());
    expect(page.nodes.map((n) => n.address)).toEqual(["1a", "1a1"]);
  });

  it("is refused when it is about somebody else", () => {
    expect(() => takeWhole(subtree({ did: STRANGER }))).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when it is a different region than the one cited", () => {
    // The address is what a reader holds a region by, so an answer at another
    // one would be filed under a root it does not cover.
    expect(() => takeWhole(subtree({ root_address: "1b" }))).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when it is not a subtree at all", () => {
    // One error out of the boundary, whatever was wrong with the answer: a
    // validation message is not something to put in front of a person.
    for (const nonsense of [null, "1a", { did: AUTHOR }, { nodes: [] }]) {
      expect(() => takeWhole(nonsense)).toThrow(UnaskedAnswerError);
    }
  });

  it("is refused when a note in it is attributed to a third party", () => {
    const stolen = subtree();
    stolen.nodes[1] = node(1, "1a1", {
      ref: `${STRANGER}/${ulid(1)}`,
      parent: stolen.nodes[0].ref,
    });
    expect(() => takeWhole(stolen)).toThrow(UnaskedAnswerError);
  });

  it("is refused when a note in it is outside the subtree", () => {
    const strays = subtree();
    strays.nodes[1] = node(1, "2");
    expect(() => takeWhole(strays)).toThrow(UnaskedAnswerError);
  });

  it("is refused when the region's own root is missing", () => {
    const headless = subtree();
    headless.nodes = [headless.nodes[1]];
    expect(() => takeWhole(headless)).toThrow(UnaskedAnswerError);
  });

  it("is refused when the same note arrives twice", () => {
    const twice = subtree();
    twice.nodes = [...twice.nodes, twice.nodes[1]];
    expect(() => takeWhole(twice)).toThrow(UnaskedAnswerError);
  });

  it("is refused when two notes claim one address", () => {
    // `node_owner_address UNIQUE` is the address protocol on our own rows: a
    // second note at a taken address is a citation that resolves two ways. A
    // peer's answer is held to it too, and the region's own root included —
    // otherwise which of the two is the root is whichever arrived first.
    const twoBelow = subtree();
    twoBelow.nodes = [
      ...twoBelow.nodes,
      node(3, "1a1", { parent: twoBelow.nodes[0].ref }),
    ];
    expect(() => takeWhole(twoBelow)).toThrow(UnaskedAnswerError);

    const twoRoots = subtree();
    twoRoots.nodes = [twoRoots.nodes[0], node(4, "1a")];
    expect(() => takeWhole(twoRoots)).toThrow(UnaskedAnswerError);
  });

  it("names no note it did not send", () => {
    // A reference to something outside the publication is a note the author
    // never had to publish and the reader can never resolve.
    for (const outside of [
      { parent: `${AUTHOR}/${ulid(9)}` },
      { origin: `${AUTHOR}/${ulid(9)}` },
    ]) {
      const leaking = subtree();
      leaking.nodes[1] = node(1, "1a1", {
        parent: leaking.nodes[0].ref,
        ...outside,
      });
      expect(() => takeWhole(leaking)).toThrow(UnaskedAnswerError);
    }
  });

  it("is refused when a note below the root hangs off nothing", () => {
    const loose = subtree();
    loose.nodes[1] = node(1, "1a1");
    expect(() => takeWhole(loose)).toThrow(UnaskedAnswerError);
  });

  it("refuses a root that points at anything above itself", () => {
    for (const root of [
      node(0, "1a", { parent: `${AUTHOR}/${ulid(9)}` }),
      node(0, "1a", { origin: `${AUTHOR}/${ulid(9)}` }),
    ]) {
      const rooted = subtree();
      rooted.nodes = [root, node(1, "1a1", { parent: root.ref })];
      expect(() => takeWhole(rooted)).toThrow(UnaskedAnswerError);
    }
  });

  it("is refused when a section belongs to a note it did not send", () => {
    const orphan = subtree();
    orphan.blocks[0].node = `${AUTHOR}/${ulid(9)}`;
    expect(() => takeWhole(orphan)).toThrow(UnaskedAnswerError);
  });

  it("is refused when the same section arrives twice", () => {
    // It would otherwise get past here and collide at the write, after the
    // region and every note in it were already stored.
    const twice = subtree();
    twice.blocks = [...twice.blocks, twice.blocks[0]];
    expect(() => takeWhole(twice)).toThrow(UnaskedAnswerError);
  });
});

/** `count` children of the region root, the root itself first. */
function branch(from: number, count: number): PublishedNode[] {
  const root = node(0, "1a");
  return Array.from({ length: count }, (_, i) =>
    node(from + i, `1a${from + i}`, { parent: root.ref }),
  );
}

describe("a subtree longer than one answer", () => {
  it("takes a page at a time, each note hanging off what came before", () => {
    const reader = publishedSubtreeReader(asked);

    const first = reader.take({
      ...subtree(),
      nodes: [
        node(0, "1a"),
        node(1, "1a1", { parent: `${AUTHOR}/${ulid(0)}` }),
      ],
      next_cursor: "past-1a1",
    });
    expect(first.next_cursor).toBe("past-1a1");

    const second = reader.take({
      did: AUTHOR,
      root_address: "1a",
      nodes: [node(2, "1a1a", { parent: `${AUTHOR}/${ulid(1)}` })],
      blocks: [
        {
          ref: `${AUTHOR}/${ulid(3)}`,
          node: `${AUTHOR}/${ulid(1)}`,
          ord: "a0",
          content: emptyDocument(),
        },
      ],
    });
    expect(second.next_cursor).toBeUndefined();
    expect([...reader.served()]).toEqual([
      `${AUTHOR}/${ulid(0)}`,
      `${AUTHOR}/${ulid(1)}`,
      `${AUTHOR}/${ulid(2)}`,
    ]);
  });

  it("holds a later page to the pages before it", () => {
    for (const repeat of [
      { nodes: [node(0, "1a")] },
      { nodes: [node(5, "1a1", { parent: `${AUTHOR}/${ulid(0)}` })] },
      { blocks: [subtree().blocks[0]] },
    ]) {
      const reader = publishedSubtreeReader(asked);
      reader.take({ ...subtree(), next_cursor: "more" });
      expect(() =>
        reader.take({ ...subtree(), nodes: [], blocks: [], ...repeat }),
      ).toThrow(UnaskedAnswerError);
    }
  });

  it("wants the region's own root in the first answer", () => {
    const reader = publishedSubtreeReader(asked);
    expect(() =>
      reader.take({
        did: AUTHOR,
        root_address: "1a",
        nodes: [node(1, "1a1", { parent: `${AUTHOR}/${ulid(0)}` })],
        blocks: [],
        next_cursor: "more",
      }),
    ).toThrow(UnaskedAnswerError);
  });

  it("leaves a refused page out of what it holds", () => {
    // The claim the refusal makes: nothing of a page it would not take, so the
    // same page answered properly is still a page it can take.
    const reader = publishedSubtreeReader(asked);
    reader.take({ ...subtree(), next_cursor: "more" });

    const rest = {
      did: AUTHOR,
      root_address: "1a",
      nodes: [node(3, "1a2", { parent: `${AUTHOR}/${ulid(0)}` })],
      blocks: [
        {
          ref: `${AUTHOR}/${ulid(4)}`,
          node: `${AUTHOR}/${ulid(3)}`,
          ord: "a1",
          content: emptyDocument(),
        },
      ],
    };
    expect(() =>
      reader.take({ ...rest, nodes: [...rest.nodes, node(9, "2")] }),
    ).toThrow(UnaskedAnswerError);
    expect(reader.take(rest).nodes).toHaveLength(1);
  });

  it("refuses a page larger than a reader will take, and takes a full one", () => {
    const overflowing = subtree();
    overflowing.nodes = [
      overflowing.nodes[0],
      ...branch(1, MAX_PUBLISHED_NODES_PER_PAGE),
    ];
    expect(() => takeWhole(overflowing)).toThrow(UnaskedAnswerError);

    // The bound is on one answer and never on the region: a graph past it is
    // read page by page rather than refused for its size.
    const reader = publishedSubtreeReader(asked);
    const full = MAX_PUBLISHED_NODES_PER_PAGE;
    reader.take({
      did: AUTHOR,
      root_address: "1a",
      nodes: [node(0, "1a"), ...branch(1, full - 1)],
      blocks: [],
      next_cursor: "more",
    });
    reader.take({
      did: AUTHOR,
      root_address: "1a",
      nodes: branch(full, full),
      blocks: [],
    });
    expect(reader.served().size).toBe(full * 2);
  });

  it("stops asking a peer that answers forever", () => {
    const reader = publishedSubtreeReader(asked);
    reader.take({
      did: AUTHOR,
      root_address: "1a",
      nodes: [node(0, "1a")],
      blocks: [],
      next_cursor: "more",
    });
    for (let page = 1; page < MAX_PUBLISHED_PAGES; page++) {
      reader.take({
        did: AUTHOR,
        root_address: "1a",
        nodes: branch(page, 1),
        blocks: [],
        next_cursor: "more",
      });
    }
    expect(() =>
      reader.take({
        did: AUTHOR,
        root_address: "1a",
        nodes: branch(MAX_PUBLISHED_PAGES, 1),
        blocks: [],
      }),
    ).toThrow(UnaskedAnswerError);
  });
});

describe("a listing a peer answered with", () => {
  const roots = [
    {
      root_address: "1a",
      title: "A branch",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("is taken when it is about the identity that was asked about", () => {
    expect(parsePublishedIndex({ did: AUTHOR, roots }, AUTHOR).roots).toEqual(
      roots,
    );
  });

  it("says where it goes on, so a long one is read rather than refused", () => {
    const page = parsePublishedIndex(
      { did: AUTHOR, roots, next_cursor: "past-1a" },
      AUTHOR,
    );
    expect(page.next_cursor).toBe("past-1a");
  });

  it("is refused when it is about somebody else", () => {
    // Nothing in a DID says where a graph is served, so the instance came from
    // the caller — and an instance that answers about another identity is
    // answering a question nobody asked.
    expect(() => parsePublishedIndex({ did: STRANGER, roots }, AUTHOR)).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when it is not a listing at all", () => {
    expect(() => parsePublishedIndex({ roots: "everything" }, AUTHOR)).toThrow(
      UnaskedAnswerError,
    );
  });
});
