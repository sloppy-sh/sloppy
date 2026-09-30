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
  authorsOf,
  CreateNodeRequestSchema,
  liesInARun,
  MoveNoteRequestSchema,
  type Node,
  NodeSchema,
  noteLabel,
  parseNode,
  SetAddressRequestSchema,
  UpdateNodeRequestSchema,
  withAuthor,
  writeOutcome,
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

describe("the looks a note sets on its lines", () => {
  const OTHER = `${DID}/01J0000000000000000000000Z`;

  it("stay absent on a note nobody set one on", () => {
    expect(parseNode(row("1"))).not.toHaveProperty("edges");
  });

  it("are the whole list on a write, and absent leaves them alone", () => {
    expect(UpdateNodeRequestSchema.parse({}).edges).toBeUndefined();
    expect(UpdateNodeRequestSchema.parse({ edges: [] }).edges).toEqual([]);
    expect(
      UpdateNodeRequestSchema.parse({
        edges: [{ to: OTHER, stroke: "dotted" }],
      }).edges,
    ).toEqual([{ to: OTHER, stroke: "dotted" }]);
  });

  it("cost a note nothing where a row carries a second one", () => {
    const twice = [{ to: OTHER, label: "one" }, { to: OTHER }];
    expect(parseNode({ ...row("1"), edges: twice }).edges).toEqual([
      { to: OTHER, label: "one" },
    ]);
    expect(
      parseNode({ ...row("1"), edges: [{ to: OTHER, label: "one" }] }).edges,
    ).toEqual([{ to: OTHER, label: "one" }]);
  });
});

describe("the address a person names on a move", () => {
  const under = { relation: "under", note: `${DID}/${ULID}` } as const;

  it("is absent where they named none, leaving the landing to the rule", () => {
    expect(MoveNoteRequestSchema.parse({ to: under })).toEqual({ to: under });
  });

  it("is the label the moved note takes", () => {
    expect(MoveNoteRequestSchema.parse({ to: under, address: "3a1" })).toEqual({
      to: under,
      address: "3a1",
    });
  });

  it("is refused where it is not an address at all", () => {
    for (const address of ["", "a1", "1A", "01", " 1a", null]) {
      expect(() =>
        MoveNoteRequestSchema.parse({ to: under, address }),
      ).toThrow();
    }
  });
});

describe("the address a person names on a creation", () => {
  const under = { relation: "under", note: `${DID}/${ULID}` } as const;

  it("is absent where they named none, leaving it to the rule", () => {
    expect(CreateNodeRequestSchema.parse({ from: under })).toEqual({
      from: under,
      title: "",
      tags: [],
    });
  });

  it("is the label the new note takes", () => {
    expect(
      CreateNodeRequestSchema.parse({ from: under, address: "3a1" }),
    ).toEqual({ from: under, address: "3a1", title: "", tags: [] });
  });

  it("is refused where it is not an address at all", () => {
    for (const address of ["", "a1", "1A", "01", " 1a", null]) {
      expect(() =>
        CreateNodeRequestSchema.parse({ from: under, address }),
      ).toThrow();
    }
  });
});

// AI.md § "The Genealogy Is the Protocol": the ref's DID says whose graph a
// note is in, and whose writing it is, is a list on it.
describe("whose writing a note carries", () => {
  const BOB = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBob";
  const CAI = "did:syr:z6MkCaiCaiCaiCaiCaiCaiCaiCaiCaiCai";
  const open = (over: Partial<Node> = {}): Node =>
    parseNode({ ...row("1"), ...over });

  it("reads a note written before the list as its own author's", () => {
    expect(authorsOf(open())).toEqual([DID]);
    // Empty is the same answer: nobody's writing is nobody's note.
    expect(authorsOf(open({ authors: [] }))).toEqual([DID]);
  });

  it("appends a new writer to an open note, once", () => {
    const first = withAuthor(open(), BOB);
    expect(authorsOf(first)).toEqual([DID, BOB]);
    expect(withAuthor(first, BOB)).toBe(first);
    expect(withAuthor(open(), DID)).toEqual(open());
    expect(authorsOf(withAuthor(first, CAI))).toEqual([DID, BOB, CAI]);
  });

  it("lands a write on an open note, and on the owner's own", () => {
    expect(writeOutcome(open(), BOB)).toBe("lands");
    expect(writeOutcome(open({ owner: BOB }), BOB)).toBe("lands");
  });

  it("offers a write on a note somebody else gates, and keeps its authors", () => {
    const owned = open({ owner: BOB, authors: [BOB] });
    expect(writeOutcome(owned, CAI)).toBe("offered");
    expect(writeOutcome(owned, DID)).toBe("offered");
    // Ownership is not writing: taking an offer in adds a contributor, and
    // `withAuthor` is not what does it.
    expect(withAuthor(owned, CAI)).toBe(owned);
    expect(authorsOf(owned)).toEqual([BOB]);
  });
});

describe("when a note's reasoning was last read against the code", () => {
  it("leaves a note nobody has confirmed carrying nothing", () => {
    expect(parseNode(row("1")).checked).toBeUndefined();
    expect(UpdateNodeRequestSchema.parse({}).checked).toBeUndefined();
  });

  it("keeps the commit it was read against, as that history spells it", () => {
    const commit = "8e52d1a4c0b3f1e2d9a7c6b5a4938271605f4e3d";
    expect(parseNode({ ...row("1"), checked: commit }).checked).toBe(commit);
    expect(UpdateNodeRequestSchema.parse({ checked: commit }).checked).toBe(
      commit,
    );
  });

  it("refuses a commit that names nothing", () => {
    expect(NodeSchema.safeParse({ ...row("1"), checked: "" }).success).toBe(
      false,
    );
    expect(UpdateNodeRequestSchema.safeParse({ checked: 7 }).success).toBe(
      false,
    );
  });
});

describe("whether a note lies in a run", () => {
  const PARENT = `${DID}/01JSPREAD00000000000000001` as const;

  it("takes in a note that sprang from another, numbered or not", () => {
    expect(liesInARun({ parent: PARENT, address: "1a" as Address })).toBe(true);
    expect(liesInARun({ parent: PARENT, address: undefined })).toBe(true);
  });

  it("takes in a branch, which is a note with a number and nothing above it", () => {
    expect(liesInARun({ parent: undefined, address: "2" as Address })).toBe(
      true,
    );
  });

  // AI.md § "The Genealogy Is the Protocol": a note with no parent and no
  // address opens no branch, so no run carries on from it or into it.
  it("leaves out a note that sprang from nothing and carries no number", () => {
    expect(liesInARun({ parent: undefined, address: undefined })).toBe(false);
  });
});
