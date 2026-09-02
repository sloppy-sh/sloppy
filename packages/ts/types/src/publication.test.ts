import { describe, expect, it } from "vitest";
import { emptyDocument } from "./document.js";
import {
  MAX_PUBLISHED_NODES,
  parsePublishedIndex,
  parsePublishedSubtree,
  type PublishedNode,
  type PublishedSubtree,
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
function subtree(over: Partial<PublishedSubtree> = {}) {
  const root = node(0, "1a");
  return {
    did: AUTHOR,
    root_address: "1a",
    nodes: [root, node(1, "1a1", { parent: root.ref, origin: root.ref })],
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

describe("a subtree a peer answered with", () => {
  it("is taken when it is the subtree that was asked for", () => {
    const region = parsePublishedSubtree(subtree(), asked);
    expect(region.nodes.map((n) => n.address)).toEqual(["1a", "1a1"]);
  });

  it("is refused when it is about somebody else", () => {
    expect(() =>
      parsePublishedSubtree(subtree({ did: STRANGER }), asked),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when it is a different region than the one cited", () => {
    // The address is what a reader holds a region by, so an answer at another
    // one would be filed under a root it does not cover.
    expect(() =>
      parsePublishedSubtree(subtree({ root_address: "1b" }), asked),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when a note in it is attributed to a third party", () => {
    const stolen = subtree();
    stolen.nodes[1] = node(1, "1a1", {
      ref: `${STRANGER}/${ulid(1)}`,
      parent: stolen.nodes[0].ref,
      origin: stolen.nodes[0].ref,
    });
    expect(() => parsePublishedSubtree(stolen, asked)).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when a note in it is outside the subtree", () => {
    const strays = subtree();
    strays.nodes[1] = node(1, "2", { origin: strays.nodes[1].ref });
    expect(() => parsePublishedSubtree(strays, asked)).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when the region's own root is missing", () => {
    const headless = subtree();
    headless.nodes = [headless.nodes[1]];
    expect(() => parsePublishedSubtree(headless, asked)).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when the same note arrives twice", () => {
    const twice = subtree();
    twice.nodes = [...twice.nodes, twice.nodes[1]];
    expect(() => parsePublishedSubtree(twice, asked)).toThrow(
      UnaskedAnswerError,
    );
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
        origin: leaking.nodes[0].ref,
        ...outside,
      });
      expect(() => parsePublishedSubtree(leaking, asked)).toThrow(
        UnaskedAnswerError,
      );
    }
  });

  it("refuses a root that points at anything above itself", () => {
    for (const root of [
      node(0, "1a", { parent: `${AUTHOR}/${ulid(9)}` }),
      node(0, "1a", { origin: `${AUTHOR}/${ulid(9)}` }),
    ]) {
      const rooted = subtree();
      rooted.nodes = [
        root,
        node(1, "1a1", { parent: root.ref, origin: root.ref }),
      ];
      expect(() => parsePublishedSubtree(rooted, asked)).toThrow(
        UnaskedAnswerError,
      );
    }
  });

  it("is refused when a section belongs to a note it did not send", () => {
    const orphan = subtree();
    orphan.blocks[0].node = `${AUTHOR}/${ulid(9)}`;
    expect(() => parsePublishedSubtree(orphan, asked)).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused whole when it is larger than a reader will hold", () => {
    const flood = subtree();
    flood.nodes = [
      flood.nodes[0],
      ...Array.from({ length: MAX_PUBLISHED_NODES }, (_, i) =>
        node(i + 1, "1a1", { parent: flood.nodes[0].ref }),
      ),
    ];
    expect(() => parsePublishedSubtree(flood, asked)).toThrow();
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

  it("is refused when it is about somebody else", () => {
    // Nothing in a DID says where a graph is served, so the instance came from
    // the caller — and an instance that answers about another identity is
    // answering a question nobody asked.
    expect(() => parsePublishedIndex({ did: STRANGER, roots }, AUTHOR)).toThrow(
      UnaskedAnswerError,
    );
  });
});
