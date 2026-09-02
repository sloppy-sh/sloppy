import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import {
  type Address,
  addressDepth,
  childAddress,
  siblingAddress,
} from "./address.js";
import { parseNodeView, pulledBlockView, pulledNodeView } from "./api.js";
import { emptyDocument } from "./document.js";
import {
  type PulledNode,
  parsePulledNode,
  PulledBlockSchema,
} from "./federation.js";
import { NodeDepthMismatchError } from "./node.js";
import { nodeRefFromSyrPost, syrPostRefFor } from "./syr.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const READER = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const HELD = "01JSPREAD00000000000000000";
const ROOT = "01JSPREAD00000000000000001";

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
    pull: `${READER}/${ROOT}`,
    source: `${AUTHOR}/${HELD}`,
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
});

describe("a held block", () => {
  it("reads back as its author's block, timestamped when the copy arrived", () => {
    const row = PulledBlockSchema.parse({
      id: new RecordId("pulled_block", { created_by: READER, id: HELD }),
      created_by: READER,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      pull: `${READER}/${ROOT}`,
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
