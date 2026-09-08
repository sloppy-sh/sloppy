import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import {
  type Address,
  addressDepth,
  childAddress,
  orderSiblings,
  siblingAddress,
} from "./address.js";
import {
  CreateNodeRequestSchema,
  NodeSchema,
  noteLabel,
  parseNode,
  SetAddressRequestSchema,
  UpdateNodeRequestSchema,
} from "./node.js";

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

// `depth` is a stored derivation, which docs/ARCHITECTURE.md § "Data model"
// ratifies as the one exception. What it is derived from is the parent chain,
// so a person writing their own address cannot put a row out of step with it.
describe("depth, and the address it no longer duplicates", () => {
  it("reaches a row unchanged, whatever the address on it says", () => {
    expect(parseNode(row("1")).depth).toBe(1);
    for (const address of spread(200)) {
      expect(parseNode(row(address, 4)).depth).toBe(4);
    }
  });

  it("refuses a number no depth could be", () => {
    // 0 is what a depth counted from the wrong end gives a root, and it is the
    // one wrong value the database's own `ASSERT $value > 0` also catches.
    for (const depth of [0, -1, 1.5, Number.NaN]) {
      expect(() => NodeSchema.parse(row("1a", depth))).toThrow();
    }
  });
});

describe("a note with no address", () => {
  const bare = () => {
    const { address: _none, ...rest } = row("1");
    return rest;
  };

  it("is a row like any other", () => {
    expect(parseNode(bare()).address).toBeUndefined();
  });

  it("is read by its title, and by a word where it has none of those either", () => {
    expect(noteLabel({ ...parseNode(bare()), title: "Mushrooms" })).toBe(
      "Mushrooms",
    );
    expect(noteLabel({ ...parseNode(bare()), title: "   " })).toBe("Untitled");
  });

  it("is read by its address wherever it has one", () => {
    expect(noteLabel({ address: "1a", title: "Mushrooms" })).toBe("1a");
  });
});

describe("a run in the order it reads", () => {
  const note = (ref: string, created_at: string, address?: Address) => ({
    ref,
    created_at,
    ...(address === undefined ? {} : { address }),
  });

  it("puts the addressed notes first, in address order", () => {
    const run = orderSiblings([
      note("a/2", "2026-01-01T00:00:00.000Z"),
      note("a/1", "2026-01-02T00:00:00.000Z", "1b"),
      note("a/3", "2026-01-03T00:00:00.000Z", "1a"),
    ]);
    expect(run.map((one) => one.ref)).toEqual(["a/3", "a/1", "a/2"]);
  });

  it("puts the rest after them, in the order they were written", () => {
    const run = orderSiblings([
      note("a/3", "2026-01-03T00:00:00.000Z"),
      note("a/1", "2026-01-01T00:00:00.000Z"),
      note("a/2", "2026-01-02T00:00:00.000Z"),
    ]);
    expect(run.map((one) => one.ref)).toEqual(["a/1", "a/2", "a/3"]);
  });

  it("breaks a tie by ref, so two peers read one run the same way", () => {
    const same = "2026-01-01T00:00:00.000Z";
    const run = orderSiblings([note("a/2", same), note("a/1", same)]);
    expect(run.map((one) => one.ref)).toEqual(["a/1", "a/2"]);
  });
});

describe("what a person writes where an address is shown", () => {
  it("takes an address, and takes it back off", () => {
    expect(SetAddressRequestSchema.parse({ address: "1a1" })).toEqual({
      address: "1a1",
    });
    expect(SetAddressRequestSchema.parse({ address: null })).toEqual({
      address: null,
    });
  });

  it("refuses anything that is not an address", () => {
    for (const address of ["", "a1", "1A", "01", " 1a"]) {
      expect(() => SetAddressRequestSchema.parse({ address })).toThrow();
    }
  });
});

describe("the references a note's writing names", () => {
  it("stay absent on a row nothing derived them for, rather than becoming none", () => {
    expect(parseNode(row("1"))).not.toHaveProperty("references");
  });

  it("are the server's alone to write, so no request carries them", () => {
    const asked = { references: [`${DID}/${ULID}`] };
    expect(UpdateNodeRequestSchema.parse(asked)).toEqual({});
    expect(() => CreateNodeRequestSchema.parse(asked)).toThrow();
  });
});
