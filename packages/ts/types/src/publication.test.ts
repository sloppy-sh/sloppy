import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import { PublicationSchema, parseSnapshotNode } from "./publication.js";
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
});
