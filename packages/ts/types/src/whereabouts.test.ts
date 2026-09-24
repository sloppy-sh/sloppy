import { RecordId } from "surrealdb";
import { describe, expect, it } from "vitest";
import { UnaskedAnswerError } from "./published.js";
import {
  DeclaredWhereaboutsSchema,
  parseWhereabouts,
  SetWhereaboutsRequestSchema,
  WHEREABOUTS_DOCUMENT,
  WhereaboutsDocumentSchema,
  whereaboutsOf,
} from "./whereabouts.js";

const ADA = "mailto:ada@example.com";
const BOB = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const HERS = "https://sloppy.example";

function served(principal: string, instance: string) {
  return { type: WHEREABOUTS_DOCUMENT, principal, instance };
}

describe("a declaration as it is served", () => {
  it("is read back as what it says", () => {
    expect(parseWhereabouts(served(ADA, HERS), ADA)).toEqual({
      principal: ADA,
      instance: HERS,
    });
  });

  it("is held to the person it was asked about", () => {
    expect(() => parseWhereabouts(served(BOB, HERS), ADA)).toThrow(
      UnaskedAnswerError,
    );
  });

  it("is refused where it is not a declaration at all", () => {
    for (const body of [
      {},
      { principal: ADA, instance: HERS },
      { ...served(ADA, HERS), type: "sloppy-whereabouts@v2" },
      "https://sloppy.example",
      null,
    ]) {
      expect(() => parseWhereabouts(body, ADA)).toThrow(UnaskedAnswerError);
    }
  });

  it("names an instance and never an address inside one", () => {
    for (const named of [
      "https://sloppy.example/ada",
      "https://sloppy.example?who=ada",
      "https://ada@sloppy.example",
      "file:///etc/passwd",
      "sloppy.example",
      "https://sloppy.example:443",
    ]) {
      expect(() => parseWhereabouts(served(ADA, named), ADA)).toThrow(
        UnaskedAnswerError,
      );
      expect(
        SetWhereaboutsRequestSchema.safeParse({ instance: named }).success,
      ).toBe(false);
    }
  });

  it("carries what a reader has not learned yet, unchanged", () => {
    // An instance running ahead of this one says more; a reader takes the
    // declaration and drops the rest rather than refusing the person.
    const ahead = { ...served(ADA, HERS), signed_at: "2026-09-24" };
    expect(parseWhereabouts(ahead, ADA)).toEqual({
      principal: ADA,
      instance: HERS,
    });
  });
});

describe("a declaration as it is kept", () => {
  it("is the same fact the document carries", () => {
    const row = DeclaredWhereaboutsSchema.parse({
      id: new RecordId("whereabouts", {
        created_by: ADA,
        id: "01JWHERE00000000000000000A",
      }),
      created_by: ADA,
      instance: HERS,
      created_at: "2026-09-24T00:00:00.000Z",
      updated_at: "2026-09-24T00:00:00.000Z",
    });

    const said = whereaboutsOf(row);
    expect(said).toEqual({ principal: ADA, instance: HERS });
    expect(
      WhereaboutsDocumentSchema.parse({ ...said, type: WHEREABOUTS_DOCUMENT }),
    ).toEqual(served(ADA, HERS));
  });
});
