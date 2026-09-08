import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import {
  PublicationSchema,
  parseSnapshotNode,
  publishRootsOf,
} from "./publication.js";
import { DEFAULT_COMMENT_ACCESS } from "./published.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const STRANGER = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const COPY = "01JSNAP0000000000000000000";
const NOTE = "01JSNAP0000000000000000001";
const VERSION = "01JSNAP0000000000000000002";

function snapshotNode(over: Record<string, unknown> = {}) {
  return {
    id: new RecordId("snapshot_node", { created_by: AUTHOR, id: COPY }),
    created_by: AUTHOR,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    version: `${AUTHOR}/${VERSION}`,
    source: `${AUTHOR}/${NOTE}`,
    ord: "00000003",
    address: "1a",
    node: {
      address: "1a",
      origin: `${AUTHOR}/${NOTE}`,
      title: "A published thought",
      tags: [],
      links: [],
      created_at: "2025-06-01T00:00:00.000Z",
      updated_at: "2025-06-02T00:00:00.000Z",
    },
    ...over,
  };
}

describe("a note a version froze", () => {
  it("is read where the row and the node it carries agree", () => {
    expect(parseSnapshotNode(snapshotNode()).address).toBe("1a");
  });

  it("is refused where it is filed at an address it is not addressed at", () => {
    // The column is immutable and a peer reads what it indexes, so a row that
    // got past here would serve one address's note under another's forever.
    expect(() => parseSnapshotNode(snapshotNode({ address: "1b" }))).toThrow();
  });

  // A note its author gave no number publishes like any other, and the place
  // the version gives it is what a reader is served it by.
  it("is read where neither the row nor the node it carries has an address", () => {
    const held = parseSnapshotNode(
      snapshotNode({
        address: undefined,
        node: { ...snapshotNode().node, address: undefined },
      }),
    );
    expect(held.address).toBeUndefined();
    expect(held.ord).toBe("00000003");
  });

  it("is refused where it is filed with no address and addressed with one", () => {
    expect(() =>
      parseSnapshotNode(snapshotNode({ address: undefined })),
    ).toThrow();
  });

  it("is refused where its version belongs to somebody else", () => {
    expect(() =>
      parseSnapshotNode(snapshotNode({ version: `${STRANGER}/${VERSION}` })),
    ).toThrow();
  });
});

describe("a publication", () => {
  it("invites anyone to answer it until its author says otherwise", () => {
    const row = PublicationSchema.parse({
      id: new RecordId("publication", { created_by: AUTHOR, id: VERSION }),
      created_by: AUTHOR,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      root: `${AUTHOR}/${NOTE}`,
      root_address: "1a",
    });
    expect(row.comments).toBe(DEFAULT_COMMENT_ACCESS);
    expect(row.comments).toBe("anyone");
  });

  it("is rooted at a branch its author gave no number", () => {
    const row = PublicationSchema.parse({
      id: new RecordId("publication", { created_by: AUTHOR, id: VERSION }),
      created_by: AUTHOR,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      root: `${AUTHOR}/${NOTE}`,
    });
    expect(row.root_address).toBeUndefined();
    expect(row.root).toBe(`${AUTHOR}/${NOTE}`);
  });
});

describe("the chosen notes a publish of a whole set sends out", () => {
  const chosen = (...addresses: string[]) =>
    addresses.map((address) => ({ origin: `${AUTHOR}/${NOTE}`, address }));

  it("leaves a note with no chain of its own to the chosen note carrying it", () => {
    const set = chosen("1", "1a", "1a1");

    expect(publishRootsOf(set, () => false)).toEqual([set[0]]);
  });

  // Its chain is its own, and a carrier's snapshot does not advance it.
  it("sends a chain of its own again even inside another chosen note", () => {
    const set = chosen("1", "1a", "1a1");

    expect(publishRootsOf(set, (note) => note.address === "1a")).toEqual([
      set[0],
      set[1],
    ]);
  });

  it("sends a chosen note beside another on its own", () => {
    const set = chosen("1a", "1b");

    expect(publishRootsOf(set, () => false)).toEqual(set);
  });

  // An address descends only within the tree it was assigned in.
  it("carries nothing across trees that share an address", () => {
    const set = [
      { origin: `${AUTHOR}/${NOTE}`, address: "1" },
      { origin: `${AUTHOR}/${VERSION}`, address: "1a" },
    ];

    expect(publishRootsOf(set, () => false)).toEqual(set);
  });
});
