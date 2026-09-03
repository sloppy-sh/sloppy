import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import {
  type Address,
  addressDepth,
  childAddress,
  isInSubtree,
  siblingAddress,
} from "./address.js";
import { parseNodeView, pulledBlockView, pulledNodeView } from "./api.js";
import { emptyDocument } from "./document.js";
import {
  CreatePullRequestSchema,
  isPeerOrigin,
  peerOrigin,
  PeerOriginSchema,
  PeerPublicationsQuerySchema,
  type PulledNode,
  parsePulledNode,
  PulledBlockSchema,
  PullMemberSchema,
} from "./federation.js";
import { NodeDepthMismatchError } from "./node.js";
import { nodeRefFromSyrPost, syrPostRefFor } from "./syr.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const READER = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const HELD = "01JSPREAD00000000000000000";
const ROOT = "01JSPREAD00000000000000001";
const PUBLICATION = `${AUTHOR}/01JSPREAD00000000000000002`;

/** Addresses the protocol can assign, breadth-first from the root. */
function spread(count: number): Address[] {
  const addresses: Address[] = ["1"];
  for (let i = 0; addresses.length < count; i++) {
    addresses.push(childAddress(addresses[i]), siblingAddress(addresses[i]));
  }
  return addresses.slice(0, count);
}

function heldNode(address: Address, depth = addressDepth(address)): PulledNode {
  return {
    id: new RecordId("pulled_node", { created_by: READER, id: HELD }),
    created_by: READER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    source: `${AUTHOR}/${HELD}`,
    source_did: AUTHOR,
    address,
    depth,
    node: {
      address,
      origin: `${AUTHOR}/${ROOT}`,
      title: "A held thought",
      tags: [],
      links: [],
      created_at: "2025-06-01T00:00:00.000Z",
      updated_at: "2025-06-02T00:00:00.000Z",
    },
  };
}

describe("a held node", () => {
  it("reads back as its author's node, at every depth", () => {
    for (const address of spread(24)) {
      const view = parseNodeView(pulledNodeView(heldNode(address)));
      expect(view.ref).toBe(`${AUTHOR}/${HELD}`);
      expect(view.created_by).toBe(AUTHOR);
      expect(view.address).toBe(address);
      expect(view.published).toBe(true);
      expect(view.appearance).toBeUndefined();
    }
  });

  it("keeps the author's own timestamps rather than the copy's", () => {
    const view = pulledNodeView(heldNode("1a"));
    expect(view.created_at).toBe("2025-06-01T00:00:00.000Z");
    expect(view.updated_at).toBe("2025-06-02T00:00:00.000Z");
  });

  it("is refused when its depth and its address disagree", () => {
    for (const address of spread(24)) {
      const actual = addressDepth(address);
      for (const wrong of [actual + 1, actual + 2]) {
        expect(() => parsePulledNode(heldNode(address, wrong))).toThrow(
          NodeDepthMismatchError,
        );
      }
      expect(parsePulledNode(heldNode(address)).depth).toBe(actual);
    }
  });

  it("is refused when it names an author its source does not", () => {
    // The column an index seeks on, held to the reference it was copied from:
    // a row that got past here would answer somebody else's region for good.
    expect(() =>
      parsePulledNode({ ...heldNode("1a"), source_did: READER }),
    ).toThrow(/was written by/);
  });

  it("is refused when it is filed at an address it is not at", () => {
    // The other column an index seeks on, and the one a UNIQUE stands over: a
    // row that got past here would answer a citation with somebody else's note.
    expect(() => parsePulledNode({ ...heldNode("1a"), address: "1b" })).toThrow(
      /filed at/,
    );
  });

  it("is held once, and the regions that served it are rows of their own", () => {
    // Two regions of one author's graph, the second an ancestor of the first.
    // Both COVER the note; which of them handed it over is what the rows say,
    // because an answer that did not carry it is not something an address knows.
    const held = heldNode("1a1");
    for (const root of ["1", "1a", "1a1"] as const) {
      expect(isInSubtree(root, held.address)).toBe(true);
    }
    for (const root of ["1b", "2"] as const) {
      expect(isInSubtree(root, held.address)).toBe(false);
    }

    const served = PullMemberSchema.parse({
      id: new RecordId("pull_member", { created_by: READER, id: ROOT }),
      created_by: READER,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pull: `${READER}/${ROOT}`,
      source: held.source,
    });
    expect(served.source).toBe(held.source);
  });
});

describe("a held block", () => {
  it("reads back as its author's block, timestamped when the copy arrived", () => {
    const row = PulledBlockSchema.parse({
      id: new RecordId("pulled_block", { created_by: READER, id: HELD }),
      created_by: READER,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      source: `${AUTHOR}/${HELD}`,
      node: `${AUTHOR}/${ROOT}`,
      ord: "a0",
      content: emptyDocument(),
    });
    const view = pulledBlockView(row);
    expect(view.ref).toBe(`${AUTHOR}/${HELD}`);
    expect(view.created_by).toBe(AUTHOR);
    expect(view.node).toBe(`${AUTHOR}/${ROOT}`);
    expect(view.created_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("a note addressed in an identity store", () => {
  it("survives the round trip, and carries only the two halves", () => {
    for (const [did, localId] of [
      [AUTHOR, HELD],
      [READER, ROOT],
    ] as const) {
      const ref = `${did}/${localId}` as const;
      const post = syrPostRefFor(ref);
      expect(post).toEqual({ post_did: did, post_id: localId });
      expect(nodeRefFromSyrPost(post)).toBe(ref);
    }
  });
});

describe("where a peer's graph is served", () => {
  it("is an origin, whatever a person typed at it", () => {
    for (const [typed, origin] of [
      ["peer.example", "https://peer.example"],
      ["  https://peer.example/  ", "https://peer.example"],
      ["https://peer.example/1a?from=here#top", "https://peer.example"],
      ["http://192.168.1.9:8040", "http://192.168.1.9:8040"],
      ["peer.example:8040", "https://peer.example:8040"],
      ["PEER.example", "https://peer.example"],
      ["https://reader:secret@peer.example", "https://peer.example"],
      ["http://[::1]:8040", "http://[::1]:8040"],
      ["http://peer.example:80", "http://peer.example"],
      ["https://peer.example:443", "https://peer.example"],
    ] as const) {
      expect(peerOrigin(typed)).toBe(origin);
      expect(isPeerOrigin(origin)).toBe(true);
      expect(PeerOriginSchema.parse(origin)).toBe(origin);
    }
  });

  it("is refused where it is not an instance at all", () => {
    for (const typed of [
      "",
      "   ",
      "file:///etc/passwd",
      "gopher://peer.example",
      "https://",
      "https://peer.example:0",
      "https://peer.example:99999",
      "https://-peer.example",
    ]) {
      expect(peerOrigin(typed)).toBeNull();
    }
  });

  it("carries nothing but the instance across the wire", () => {
    // Anything else is a caller choosing the address this instance fetches and
    // reading the answer back, so the shape refuses it rather than a server.
    for (const value of [
      "https://peer.example/",
      "https://peer.example/latest",
      "https://peer.example?ref=1",
      "https://reader:secret@peer.example",
      "file:///etc/passwd",
      "gopher://peer.example",
      "HTTPS://PEER.EXAMPLE",
      "https://peer.example:443",
    ]) {
      expect(isPeerOrigin(value)).toBe(false);
      expect(() => PeerOriginSchema.parse(value)).toThrow();
      expect(() =>
        CreatePullRequestSchema.parse({
          publication: PUBLICATION,
          source_url: value,
        }),
      ).toThrow();
      expect(() =>
        PeerPublicationsQuerySchema.parse({ did: AUTHOR, source_url: value }),
      ).toThrow();
    }
  });

  it("is optional, and absent means this instance", () => {
    expect(CreatePullRequestSchema.parse({ publication: PUBLICATION })).toEqual(
      { publication: PUBLICATION },
    );
    expect(PeerPublicationsQuerySchema.parse({ did: AUTHOR })).toEqual({
      did: AUTHOR,
    });
  });
});
