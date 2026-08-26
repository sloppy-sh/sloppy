import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import {
  type Address,
  addressDepth,
  childAddress,
  parseAddress,
  siblingAddress,
} from "./address.js";
import { NodeSchema } from "./node.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const ULID = "01JSPREAD00000000000000000";

/**
 * Addresses the protocol can actually assign, breadth-first from the root: a
 * child and a sibling of every address so far. Breadth-first because depth is
 * the axis under test, and this reaches every depth up to the count.
 */
function spread(count: number): Address[] {
  const addresses: Address[] = ["1"];
  for (let i = 0; addresses.length < count; i++) {
    addresses.push(childAddress(addresses[i]), siblingAddress(addresses[i]));
  }
  return addresses.slice(0, count);
}

function row(address: Address, depth = addressDepth(address)) {
  return {
    id: new RecordId("node", { created_by: DID, id: ULID }),
    created_by: DID,
    address,
    depth,
    origin: `${DID}/${ULID}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

// `depth` is a second copy of something the address already says, which is what
// AI.md § "The Address Is the Protocol" forbids and what the ruling in
// docs/ARCHITECTURE.md § "Data model" overrode. These are the tests that ruling
// is conditioned on: the copy is safe only for as long as it cannot drift.
describe("depth against the address it duplicates", () => {
  it("is the address's segment count, for every address the protocol assigns", () => {
    for (const address of spread(500)) {
      expect(addressDepth(address)).toBe(parseAddress(address).length);
    }
  });

  it("reaches a row unchanged, and starts at 1 on a root", () => {
    expect(NodeSchema.parse(row("1")).depth).toBe(1);
    for (const address of spread(500)) {
      const node = NodeSchema.parse(row(address));
      expect(node.depth).toBe(parseAddress(node.address).length);
    }
  });

  it("spans more than one generation, so the test above is not vacuous", () => {
    const depths = new Set(spread(500).map(addressDepth));
    expect(Math.min(...depths)).toBe(1);
    expect(Math.max(...depths)).toBeGreaterThan(5);
  });

  it("refuses a number no address could produce", () => {
    // 0 is what a depth counted from the wrong end gives a root, and it is the
    // one wrong value the database's own `ASSERT $value > 0` also catches.
    for (const depth of [0, -1, 1.5, Number.NaN]) {
      expect(() => NodeSchema.parse(row("1a", depth))).toThrow();
    }
  });
});
