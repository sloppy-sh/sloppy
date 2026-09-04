import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import { childAddress, siblingAddress } from "./address.js";
import { splitOwnedRef, ulid } from "./codecs.js";
import {
  graphRef,
  HOME_GRAPH_ULID,
  homeGraphRef,
  InvalidGraphRefError,
  isHomeGraphRef,
  requireOwnGraph,
} from "./graph.js";
import { graphOf, parseNode, runKeyOf } from "./node.js";
import { UlidSchema } from "./common.js";

const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const BRAM = "did:syr:z6MkBramBramBramBramBramBramBramBram";
const SECOND = `${AVA}/01JGRAPH2ND000000000000000`;

function row(address: string, graph?: string, parent?: string) {
  const id = new RecordId("node", {
    created_by: AVA,
    id: "01JNTE00000000000000000000",
  });
  return parseNode({
    id,
    created_by: AVA,
    ...(graph ? { graph } : {}),
    address,
    depth: address.replace(/[0-9]+/g, "0").length,
    ...(parent ? { parent } : {}),
    origin: `${AVA}/01JNTE00000000000000000000`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

describe("the graph an address is read in", () => {
  it("is a ref its owner holds, and the home one is a function of the identity", () => {
    expect(homeGraphRef(AVA)).toBe(`${AVA}/${HOME_GRAPH_ULID}`);
    expect(splitOwnedRef(homeGraphRef(AVA)).did).toBe(AVA);
    expect(isHomeGraphRef(homeGraphRef(AVA))).toBe(true);
    expect(isHomeGraphRef(SECOND)).toBe(false);
  });

  it("is reserved, so nothing a fresh mint draws can be it", () => {
    // The reservation is the whole basis for deriving it rather than storing a
    // pointer to it, and a ULID carries the clock in its first ten characters.
    expect(UlidSchema.parse(HOME_GRAPH_ULID)).toBe(HOME_GRAPH_ULID);
    for (let drawn = 0; drawn < 5_000; drawn++) {
      expect(ulid()).not.toBe(HOME_GRAPH_ULID);
    }
  });

  it("reads an absent one as the owner's home graph, wherever it is absent", () => {
    expect(graphRef(AVA, undefined)).toBe(homeGraphRef(AVA));
    expect(graphRef(AVA, SECOND)).toBe(SECOND);
    expect(graphOf(row("1"))).toBe(homeGraphRef(AVA));
    expect(graphOf(row("1", SECOND))).toBe(SECOND);
  });

  it("refuses one belonging to somebody else, at the row boundary", () => {
    const theirs = `${BRAM}/01JGRAPH2ND000000000000000`;
    expect(() => requireOwnGraph(AVA, theirs)).toThrow(InvalidGraphRefError);
    expect(() => row("1", theirs)).toThrow(InvalidGraphRefError);
    expect(() => requireOwnGraph(AVA, undefined)).not.toThrow();
  });
});

describe("the run a branch lies in", () => {
  it("is the graph it opens in, never the author who opened it", () => {
    // Two graphs of one person each hold a `1`. Keyed by author they would be
    // one run, and the canvas would draw a line between two unrelated branches.
    expect(runKeyOf(row("1"))).not.toBe(runKeyOf(row("1", SECOND)));
    expect(runKeyOf(row("1"))).toBe(runKeyOf(row("2")));
    expect(runKeyOf(row("1", SECOND))).toBe(runKeyOf(row("2", SECOND)));
  });

  it("is the note it sprang from, wherever there is one", () => {
    const parent = `${AVA}/01JPARENT00000000000000000`;
    expect(runKeyOf(row("1a", undefined, parent))).toBe(parent);
    expect(runKeyOf(row("1a", SECOND, parent))).toBe(parent);
  });

  it("never reads a graph's ref as a note's", () => {
    // Both are `<did>/<ulid>`, and nothing stops one table minting the id
    // another already used.
    const asNote = `${AVA}/${HOME_GRAPH_ULID}`;
    expect(runKeyOf(row("1a", undefined, asNote))).not.toBe(runKeyOf(row("1")));
  });
});

describe("an address inside one graph", () => {
  it("keeps every rule it had, because the rules never mention a graph", () => {
    // The scope widened; assignment did not. Held here so a graph appearing in
    // the vocabulary cannot quietly change what an address means.
    expect(childAddress(null)).toBe("1");
    expect(childAddress("1")).toBe("1a");
    expect(siblingAddress("1a")).toBe("1b");
  });
});
