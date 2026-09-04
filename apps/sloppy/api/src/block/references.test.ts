import {
  type Block,
  BlockSchema,
  createOwnedRecordId,
  type OwnedRef,
  REFERENCE_NOTE_ATTR,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { alreadyDerived, citationsMoved, referencesOf } from "./references";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const ulid = (n: number) => `01JPBSHEDX${String(n).padStart(16, "0")}`;
const FROM = `${DID}/${ulid(1)}` as OwnedRef;
const SEED = `${DID}/${ulid(2)}` as OwnedRef;
const TIDE = `${DID}/${ulid(3)}` as OwnedRef;

const section = (ord: string, ...cited: OwnedRef[]): Block =>
  BlockSchema.parse({
    id: createOwnedRecordId("block", DID),
    created_by: DID,
    node: FROM,
    ord,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: cited.map((note) => ({
            type: "reference",
            attrs: { [REFERENCE_NOTE_ATTR]: note, label: "a note" },
          })),
        },
      ],
    },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

describe("what a note's writing names", () => {
  it("is nothing for a note with no sections at all", () => {
    expect(referencesOf(FROM, [])).toEqual([]);
  });

  it("reads the whole stack, in the order it was handed it", () => {
    expect(
      referencesOf(FROM, [section("a", SEED), section("b", TIDE)]),
    ).toEqual([SEED, TIDE]);
  });

  // Writing kept before a block held the editor's own document is a bare
  // string. One of those must not cost the note the rest of its stack.
  it("steps over writing it cannot read as a document", () => {
    expect(
      referencesOf(FROM, [
        { content: "## The tram line nobody rebuilt" },
        section("b", SEED),
        { content: null },
      ]),
    ).toEqual([SEED]);
  });

  it("names one note once however many sections cite it", () => {
    expect(
      referencesOf(FROM, [
        section("a", SEED, TIDE),
        section("b", SEED),
        section("c", TIDE),
      ]),
    ).toEqual([SEED, TIDE]);
  });

  // A line from a mark back to itself says nothing a reader can use.
  it("never names the note the writing is in", () => {
    expect(referencesOf(FROM, [section("a", FROM, SEED)])).toEqual([SEED]);
  });
});

// The whole stack is read to derive a note, and a note may hold a drawing in
// every section of it — so a save that cannot have moved a line does not.
describe("whether a write could have moved a line", () => {
  const says = (...cited: OwnedRef[]) => section("a", ...cited).content;

  it("says no for a section written with the same notes in it", () => {
    expect(citationsMoved(says(SEED, TIDE), says(SEED, TIDE))).toBe(false);
  });

  it("says no for a section that names nothing, added or taken away", () => {
    expect(citationsMoved(null, says())).toBe(false);
    expect(citationsMoved(says(), null)).toBe(false);
  });

  it("says yes for a name added, taken away, or put in another order", () => {
    expect(citationsMoved(null, says(SEED))).toBe(true);
    expect(citationsMoved(says(SEED), null)).toBe(true);
    expect(citationsMoved(says(SEED), says(SEED, TIDE))).toBe(true);
    expect(citationsMoved(says(SEED, TIDE), says(TIDE, SEED))).toBe(true);
  });
});

describe("whether a row already holds a derivation", () => {
  it("says no for a note nothing has derived them for", () => {
    expect(alreadyDerived(undefined, [])).toBe(false);
    expect(alreadyDerived(undefined, [SEED])).toBe(false);
  });

  it("says yes only for the same notes in the same order", () => {
    expect(alreadyDerived([SEED, TIDE], [SEED, TIDE])).toBe(true);
    expect(alreadyDerived([SEED, TIDE], [TIDE, SEED])).toBe(false);
    expect(alreadyDerived([SEED], [SEED, TIDE])).toBe(false);
    expect(alreadyDerived([], [])).toBe(true);
  });
});
