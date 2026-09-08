import { describe, expect, it } from "vitest";
import { MARK_RADIUS_SCALE, resolveAppearance } from "./appearance.js";
import { emptyDocument } from "./document.js";
import { homeGraphRef } from "./graph.js";
import {
  MAX_PUBLISHED_NODES_PER_PAGE,
  MAX_PUBLISHED_PAGES,
  parsePublishedIndex,
  type PublishedNode,
  type PublishedPublication,
  publishedChangesReader,
  publishedIndexReader,
  type PublishedSubtreePage,
  publishedSubtreeReader,
  publishedVersionsReader,
  UnaskedAnswerError,
} from "./published.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const STRANGER = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";

function ulid(n: number): string {
  return `01JPBSHEDX${String(n).padStart(16, "0")}`;
}

const PUBLICATION = `${AUTHOR}/${ulid(100)}`;

function version(n: number) {
  return {
    ref: `${AUTHOR}/${ulid(200 + n)}`,
    sequence: n,
    published_at: `2026-0${n}-01T00:00:00.000Z`,
  };
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

function section(index: number, node: string, ord = "a0") {
  return {
    ref: `${AUTHOR}/${ulid(index)}`,
    node,
    ord,
    content: emptyDocument(),
  };
}

/** `1a` published whole: its root, and a child that points back at it. */
function subtree(over: Partial<PublishedSubtreePage> = {}) {
  const root = node(0, "1a");
  return {
    publication: PUBLICATION,
    version: version(1),
    root_address: "1a",
    comments: "anyone",
    nodes: [root, node(1, "1a1", { parent: root.ref })],
    blocks: [section(2, root.ref)],
    ...over,
  };
}

/** The same, with only what a later page has to carry. */
function nextPage(over: Partial<PublishedSubtreePage>) {
  return {
    publication: PUBLICATION,
    version: version(1),
    root_address: "1a",
    comments: "anyone",
    nodes: [],
    blocks: [],
    ...over,
  };
}

const asked = { publication: PUBLICATION };

/** The whole of a region that arrives in one answer. */
function takeWhole(body: unknown): PublishedSubtreePage {
  return publishedSubtreeReader(asked).take(body);
}

describe("a region a peer answered with", () => {
  it("is taken when it is the publication that was asked for", () => {
    const page = takeWhole(subtree());
    expect(page.nodes.map((n) => n.address)).toEqual(["1a", "1a1"]);
    expect(page.version.sequence).toBe(1);
  });

  it("is refused when it is another publication", () => {
    expect(() =>
      takeWhole(subtree({ publication: `${AUTHOR}/${ulid(101)}` })),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when the version it answers with is somebody else's", () => {
    // A publication is one identity's, so a version of it that belongs to
    // another is an answer stitched out of two people's writing.
    expect(() =>
      takeWhole(
        subtree({
          version: { ...version(1), ref: `${STRANGER}/${ulid(201)}` },
        }),
      ),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when it is not the version that was asked for", () => {
    const reader = publishedSubtreeReader({
      publication: PUBLICATION,
      version: version(2).ref,
    });
    expect(() => reader.take(subtree())).toThrow(UnaskedAnswerError);
    expect(reader.take(subtree({ version: version(2) })).nodes).toHaveLength(2);
  });

  it("is refused when a later page is of another version", () => {
    // Two snapshots spliced into one region would hand the reader a tree that
    // neither version ever had.
    const reader = publishedSubtreeReader(asked);
    reader.take(subtree({ next_cursor: "more" }));
    expect(() =>
      reader.take(
        nextPage({
          version: version(2),
          nodes: [node(3, "1a2", { parent: `${AUTHOR}/${ulid(0)}` })],
        }),
      ),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when a later page roots the region somewhere else", () => {
    const reader = publishedSubtreeReader(asked);
    reader.take(subtree({ next_cursor: "more" }));
    expect(() => reader.take(nextPage({ root_address: "1b" }))).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused when a later page is in another of the author's graphs", () => {
    // An address is a label read inside one graph, so a region spliced out of
    // two would hand the reader a tree whose addresses mean two things.
    const reader = publishedSubtreeReader(asked);
    reader.take(subtree({ graph: `${AUTHOR}/${ulid(50)}`, next_cursor: "m" }));
    expect(() =>
      reader.take(nextPage({ graph: `${AUTHOR}/${ulid(51)}` })),
    ).toThrow(UnaskedAnswerError);
  });

  it("reads an absent graph and the home graph's own ref as one graph", () => {
    // A peer that names the graph a region is in has not changed its answer
    // half way through by naming the one an earlier page left unsaid.
    const reader = publishedSubtreeReader(asked);
    reader.take(subtree({ next_cursor: "more" }));
    expect(() =>
      reader.take(nextPage({ graph: homeGraphRef(AUTHOR) })),
    ).not.toThrow();
  });

  it("is refused when the graph it names is somebody else's", () => {
    expect(() =>
      takeWhole(subtree({ graph: `${STRANGER}/${ulid(50)}` })),
    ).toThrow(UnaskedAnswerError);
  });

  it("is taken when the invitation on it is one this build has never heard of", () => {
    // A narrower invitation is a value somebody else's build may already have.
    // Refusing the page would cost the reader every note in the region over a
    // word about who may reply, so the reader reads it as the narrowest one it
    // knows and goes on holding the writing.
    for (const unknown of ["the-people-i-follow", 7, undefined]) {
      const page = takeWhole(subtree({ comments: unknown as never }));
      expect(page.comments).toBe("nobody");
      expect(page.nodes).toHaveLength(2);
    }
    expect(takeWhole(subtree({ comments: "nobody" })).comments).toBe("nobody");
    expect(takeWhole(subtree()).comments).toBe("anyone");
  });

  it("is refused when it is not a region at all", () => {
    // One error out of the boundary, whatever was wrong with the answer: a
    // validation message is not something to put in front of a person.
    for (const nonsense of [null, "1a", { publication: PUBLICATION }]) {
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

  it("is refused when a note in it is outside the region", () => {
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
    // A second note at a taken address is a citation that resolves two ways,
    // which our own rows cannot hold. A peer's answer is held to the same rule,
    // and the region's own root included — otherwise which of the two is the
    // root is whichever arrived first.
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

  it("holds no address out of a page it refused", () => {
    // A page is taken whole or not at all, so an address that arrived on a
    // refused one was never held, and the note that really carries it is still
    // taken afterwards.
    const reader = publishedSubtreeReader(asked);
    const opened = subtree({ next_cursor: "more" });
    reader.take(opened);

    const stray = nextPage({
      next_cursor: "more",
      nodes: [
        node(3, "1a2", { parent: opened.nodes[0].ref }),
        node(4, "1a3", { parent: `${AUTHOR}/${ulid(9)}` }),
      ],
    });
    expect(() => reader.take(stray)).toThrow(UnaskedAnswerError);

    const carried = nextPage({
      nodes: [node(5, "1a2", { parent: opened.nodes[0].ref })],
    });
    expect(reader.take(carried).nodes).toHaveLength(1);
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

  it("is refused when a note does not reach the region's root", () => {
    // Every note in a region springs from the root, however far down. A pair
    // pointing at each other is that rule at its worst: our own rows cannot
    // hold a cycle, so the walk up a note's ancestors does not guard itself
    // against one.
    const cycle = subtree();
    cycle.nodes = [
      cycle.nodes[0],
      node(1, "1a1", { parent: `${AUTHOR}/${ulid(2)}` }),
      node(2, "1a2", { parent: `${AUTHOR}/${ulid(1)}` }),
    ];
    expect(() => takeWhole(cycle)).toThrow(UnaskedAnswerError);
  });

  it("takes a note whose address says nothing about where it hangs", () => {
    // A person writes their own addresses, so an address that reads like a
    // grandchild on a note that springs from the root is not a disagreement —
    // it is a label, and the parent is the shape.
    const relabelled = subtree();
    relabelled.nodes = [
      relabelled.nodes[0],
      node(1, "1a1", { parent: relabelled.nodes[0].ref }),
      node(2, "1a1a", { parent: relabelled.nodes[0].ref }),
    ];
    expect(takeWhole(relabelled).nodes).toHaveLength(3);

    // And a note with no address at all is one this reader holds like any
    // other: what places it is the parent it names.
    const unlabelled = subtree();
    const { address: _none, ...bare } = node(3, "1b", {
      parent: unlabelled.nodes[0].ref,
    });
    unlabelled.nodes = [...unlabelled.nodes, bare];
    expect(takeWhole(unlabelled).nodes).toHaveLength(3);
  });

  it("is refused when a note links to one its author did not write", () => {
    // Every reference on a published node names a note the same author
    // published; a link naming one of the READER's own would draw a stranger's
    // note into their graph as a link they had drawn themselves.
    const reaching = subtree();
    reaching.nodes[1] = node(1, "1a1", {
      parent: reaching.nodes[0].ref,
      links: [`${STRANGER}/${ulid(7)}`],
    });
    expect(() => takeWhole(reaching)).toThrow(UnaskedAnswerError);

    // The author is the whole of the rule: a link may leave this region, the
    // author's other publications being no business of this answer.
    const elsewhere = subtree();
    elsewhere.nodes[1] = node(1, "1a1", {
      parent: elsewhere.nodes[0].ref,
      links: [`${AUTHOR}/${ulid(8)}`],
    });
    expect(takeWhole(elsewhere).nodes[1].links).toHaveLength(1);
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

  it("is refused when a section has no place in its note", () => {
    // A page is taken whole or refused whole, so what a peer sends is held to
    // what the reader's own rows accept — an unordered section would otherwise
    // fail at the write with the region already stored.
    const placeless = subtree();
    placeless.blocks[0].ord = "";
    expect(() => takeWhole(placeless)).toThrow(UnaskedAnswerError);
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
describe("what a look does on the way to a peer", () => {
  it("carries the shape channels its author set", () => {
    const root = node(0, "1a", {
      look: {
        ring_weight: "heavy",
        ring_style: "dashed",
        mark_radius: "large",
      },
    });

    const page = takeWhole(subtree({ nodes: [root] }));

    expect(resolveAppearance(page.nodes[0].look)).toMatchObject({
      ringWeight: "heavy",
      ringStyle: "dashed",
      markScale: MARK_RADIUS_SCALE.large,
    });
  });

  // The pictures stay behind: each is an upload in the author's own store, and
  // a peer has no way to read one.
  it("leaves a picture behind rather than naming one a peer cannot read", () => {
    const root = node(0, "1a", {
      look: {
        ring_weight: "hairline",
        preview: "upload-1",
        preview_more: ["upload-2"],
      } as PublishedNode["look"],
    });

    const page = takeWhole(subtree({ nodes: [root] }));

    expect(page.nodes[0].look).toEqual({ ring_weight: "hairline" });
    expect(resolveAppearance(page.nodes[0].look).preview.pictures).toEqual([]);
  });

  // Everything published before a look could travel, and everything published
  // by a peer that sends none.
  it("draws a note that carries none exactly as an unstyled one", () => {
    const page = takeWhole(subtree());

    expect(page.nodes[0].look).toBeUndefined();
    expect(resolveAppearance(page.nodes[0].look)).toEqual(
      resolveAppearance(undefined),
    );
  });
});

describe("the notebook a region's addresses are read in", () => {
  it("carries the name its author gave it", () => {
    const page = takeWhole(subtree({ graph_title: "The thesis" }));

    expect(page.graph_title).toBe("The thesis");
  });

  it("reads a peer that names none as naming none", () => {
    expect(takeWhole(subtree()).graph_title).toBeUndefined();
  });

  it("is refused a second spelling of no name at all", () => {
    // Absence is what a reader falls back to an unnamed notebook on, and an
    // empty name would draw a blank label instead.
    expect(() => takeWhole(subtree({ graph_title: "" }))).toThrow();
  });
});

function branch(from: number, count: number): PublishedNode[] {
  const root = node(0, "1a");
  return Array.from({ length: count }, (_, i) =>
    node(from + i, `1a${from + i}`, { parent: root.ref }),
  );
}

describe("a region longer than one answer", () => {
  it("takes a page at a time, each note hanging off what came before", () => {
    const reader = publishedSubtreeReader(asked);

    const first = reader.take(
      subtree({
        nodes: [
          node(0, "1a"),
          node(1, "1a1", { parent: `${AUTHOR}/${ulid(0)}` }),
        ],
        blocks: [],
        next_cursor: "past-1a1",
      }),
    );
    expect(first.next_cursor).toBe("past-1a1");

    const second = reader.take(
      nextPage({
        nodes: [node(2, "1a1a", { parent: `${AUTHOR}/${ulid(1)}` })],
        blocks: [section(3, `${AUTHOR}/${ulid(1)}`)],
      }),
    );
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
      reader.take(subtree({ next_cursor: "more" }));
      expect(() => reader.take(nextPage(repeat))).toThrow(UnaskedAnswerError);
    }
  });

  it("wants the region's own root in the first answer", () => {
    const reader = publishedSubtreeReader(asked);
    expect(() =>
      reader.take(
        nextPage({
          nodes: [node(1, "1a1", { parent: `${AUTHOR}/${ulid(0)}` })],
          next_cursor: "more",
        }),
      ),
    ).toThrow(UnaskedAnswerError);
  });

  it("leaves a refused page out of what it holds", () => {
    // The claim the refusal makes: nothing of a page it would not take, so the
    // same page answered properly is still a page it can take.
    const reader = publishedSubtreeReader(asked);
    reader.take(subtree({ next_cursor: "more" }));

    const rest = nextPage({
      nodes: [node(3, "1a2", { parent: `${AUTHOR}/${ulid(0)}` })],
      blocks: [section(4, `${AUTHOR}/${ulid(3)}`, "a1")],
    });
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
    reader.take(
      nextPage({
        nodes: [node(0, "1a"), ...branch(1, full - 1)],
        next_cursor: "more",
      }),
    );
    reader.take(nextPage({ nodes: branch(full, full) }));
    expect(reader.served().size).toBe(full * 2);
  });

  it("stops asking a peer that answers forever", () => {
    const reader = publishedSubtreeReader(asked);
    reader.take(nextPage({ nodes: [node(0, "1a")], next_cursor: "more" }));
    for (let page = 1; page < MAX_PUBLISHED_PAGES; page++) {
      reader.take(nextPage({ nodes: branch(page, 1), next_cursor: "more" }));
    }
    expect(() =>
      reader.take(nextPage({ nodes: branch(MAX_PUBLISHED_PAGES, 1) })),
    ).toThrow(UnaskedAnswerError);
  });
});

describe("a listing a peer answered with", () => {
  const publications: PublishedPublication[] = [
    {
      ref: PUBLICATION,
      root_address: "1a",
      title: "A branch",
      latest: version(1),
    },
  ];

  it("is taken when it is about the identity that was asked about", () => {
    expect(
      parsePublishedIndex({ did: AUTHOR, publications }, AUTHOR).publications,
    ).toEqual(publications);
  });

  it("says where it goes on, so a long one is read rather than refused", () => {
    const page = parsePublishedIndex(
      { did: AUTHOR, publications, next_cursor: "past-1a" },
      AUTHOR,
    );
    expect(page.next_cursor).toBe("past-1a");
  });

  it("is refused when it is about somebody else", () => {
    // Nothing in a DID says where a graph is served, so the instance came from
    // the caller — and an instance that answers about another identity is
    // answering a question nobody asked.
    expect(() =>
      parsePublishedIndex({ did: STRANGER, publications }, AUTHOR),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when it lists somebody else's publication", () => {
    const borrowed = [{ ...publications[0], ref: `${STRANGER}/${ulid(100)}` }];
    expect(() =>
      parsePublishedIndex({ did: AUTHOR, publications: borrowed }, AUTHOR),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when it is not a listing at all", () => {
    expect(() =>
      parsePublishedIndex({ publications: "everything" }, AUTHOR),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when one publication is listed twice over a run of pages", () => {
    const reader = publishedIndexReader({ did: AUTHOR });
    reader.take({ did: AUTHOR, publications, next_cursor: "past-1a" });
    expect(() => reader.take({ did: AUTHOR, publications })).toThrow(
      UnaskedAnswerError,
    );
  });

  it("stops following a listing that never ends", () => {
    const reader = publishedIndexReader({ did: AUTHOR });
    for (let page = 0; page < MAX_PUBLISHED_PAGES; page++) {
      reader.take({
        did: AUTHOR,
        publications: [
          { ...publications[0], ref: `${AUTHOR}/${ulid(300 + page)}` },
        ],
        next_cursor: "more",
      });
    }
    expect(() =>
      reader.take({ did: AUTHOR, publications: [], next_cursor: "more" }),
    ).toThrow(UnaskedAnswerError);
  });
});

describe("a publication's history", () => {
  const chain = {
    publication: PUBLICATION,
    versions: [version(3), version(2)],
  };

  it("is taken newest first, which is the order it is read in", () => {
    const page = publishedVersionsReader(asked).take(chain);
    expect(page.versions.map((v) => v.sequence)).toEqual([3, 2]);
  });

  it("is refused when it is another publication's", () => {
    expect(() =>
      publishedVersionsReader(asked).take({
        ...chain,
        publication: `${AUTHOR}/${ulid(101)}`,
      }),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when a version in it belongs to somebody else", () => {
    expect(() =>
      publishedVersionsReader(asked).take({
        ...chain,
        versions: [{ ...version(3), ref: `${STRANGER}/${ulid(203)}` }],
      }),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when the history stops falling, on one page or over a run", () => {
    // A number is assigned once and versions are only appended, so a repeat or
    // a reorder is an instance rewriting its own history.
    expect(() =>
      publishedVersionsReader(asked).take({
        ...chain,
        versions: [version(2), version(3)],
      }),
    ).toThrow(UnaskedAnswerError);

    const reader = publishedVersionsReader(asked);
    reader.take({ ...chain, next_cursor: "more" });
    expect(() =>
      reader.take({ publication: PUBLICATION, versions: [version(2)] }),
    ).toThrow(UnaskedAnswerError);
  });
});

describe("what a peer says changed between two versions", () => {
  const from = version(1).ref;
  const to = version(2).ref;
  const askedChanges = { publication: PUBLICATION, from, to };
  const root = node(0, "1a");

  function difference(changes: unknown[]) {
    return {
      publication: PUBLICATION,
      root_address: "1a",
      from,
      to,
      changes,
    };
  }

  const rewritten = {
    change: "changed",
    note: { ...root, title: "As it stands now" },
    before: root,
    sections: [
      {
        change: "changed",
        section: section(2, root.ref),
        before: section(2, root.ref),
      },
    ],
  };

  it("is taken when it is the pair that was asked about", () => {
    const page = publishedChangesReader(askedChanges).take(
      difference([rewritten]),
    );
    expect(page.changes).toHaveLength(1);
  });

  it("is refused when it compares other versions", () => {
    for (const pair of [{ from: to }, { to: from }]) {
      expect(() =>
        publishedChangesReader(askedChanges).take({
          ...difference([rewritten]),
          ...pair,
        }),
      ).toThrow(UnaskedAnswerError);
    }
  });

  it("is refused when a note in it is outside the region or somebody else's", () => {
    for (const wrong of [
      { ...rewritten, note: node(1, "2"), before: node(1, "2") },
      {
        change: "removed",
        note: node(1, "1a1", { ref: `${STRANGER}/${ulid(1)}` }),
      },
    ]) {
      expect(() =>
        publishedChangesReader(askedChanges).take(difference([wrong])),
      ).toThrow(UnaskedAnswerError);
    }
  });

  it("is refused when one note changed twice, on a page or over a run", () => {
    expect(() =>
      publishedChangesReader(askedChanges).take(
        difference([rewritten, { change: "removed", note: root }]),
      ),
    ).toThrow(UnaskedAnswerError);

    const reader = publishedChangesReader(askedChanges);
    reader.take({ ...difference([rewritten]), next_cursor: "more" });
    expect(() =>
      reader.take(difference([{ change: "removed", note: root }])),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when the two sides are different notes or different sections", () => {
    expect(() =>
      publishedChangesReader(askedChanges).take(
        difference([
          { ...rewritten, before: node(1, "1a1", { parent: root.ref }) },
        ]),
      ),
    ).toThrow(UnaskedAnswerError);

    expect(() =>
      publishedChangesReader(askedChanges).take(
        difference([
          {
            ...rewritten,
            sections: [
              {
                change: "changed",
                section: section(2, root.ref),
                before: section(3, root.ref),
              },
            ],
          },
        ]),
      ),
    ).toThrow(UnaskedAnswerError);
  });

  it("is refused when a section in it belongs to another note", () => {
    expect(() =>
      publishedChangesReader(askedChanges).take(
        difference([
          {
            ...rewritten,
            sections: [
              { change: "added", section: section(3, `${AUTHOR}/${ulid(9)}`) },
            ],
          },
        ]),
      ),
    ).toThrow(UnaskedAnswerError);
  });
});
