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

const ADA = "mailto:ada@mailbox.example";
const BOB = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const HERS = "https://sloppy.example";
const HER_DOMAIN = "ada.example";

function served(principal: string, instance: string, domain?: string) {
  return {
    type: WHEREABOUTS_DOCUMENT,
    principal,
    ...(domain === undefined ? {} : { domain }),
    instance,
  };
}

describe("a declaration as it is served", () => {
  it("is read back as what it says", () => {
    expect(parseWhereabouts(served(ADA, HERS), ADA)).toEqual({
      principal: ADA,
      instance: HERS,
    });
  });

  // The case R1 names: somebody at a mailbox provider, whose own address will
  // never speak for them, saying which domain does.
  it("carries the domain its subject says is theirs", () => {
    expect(parseWhereabouts(served(ADA, HERS, HER_DOMAIN), ADA)).toEqual({
      principal: ADA,
      domain: HER_DOMAIN,
      instance: HERS,
    });
  });

  it("is a domain and never an address to ask at", () => {
    for (const named of [
      "https://ada.example",
      "ada.example/whereabouts",
      "ada.example:443",
      "localhost",
      "[192.0.2.1]",
      "ada..example",
      "-ada.example",
      "",
    ]) {
      expect(() => parseWhereabouts(served(ADA, HERS, named), ADA)).toThrow(
        UnaskedAnswerError,
      );
      expect(
        SetWhereaboutsRequestSchema.safeParse({
          domain: named,
          instance: HERS,
        }).success,
      ).toBe(false);
    }
  });

  it("reads one domain however it was typed", () => {
    expect(parseWhereabouts(served(ADA, HERS, "ADA.Example"), ADA).domain).toBe(
      HER_DOMAIN,
    );
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
  const kept = (rest: Record<string, unknown>) =>
    DeclaredWhereaboutsSchema.parse({
      id: new RecordId("whereabouts", {
        created_by: ADA,
        id: "01JWHERE00000000000000000A",
      }),
      created_by: ADA,
      created_at: "2026-09-24T00:00:00.000Z",
      updated_at: "2026-09-24T00:00:00.000Z",
      ...rest,
    });

  it("is the same fact the document carries", () => {
    const said = whereaboutsOf(kept({ domain: HER_DOMAIN, instance: HERS }));
    expect(said).toEqual({
      principal: ADA,
      domain: HER_DOMAIN,
      instance: HERS,
    });
    expect(
      WhereaboutsDocumentSchema.parse({ ...said, type: WHEREABOUTS_DOCUMENT }),
    ).toEqual(served(ADA, HERS, HER_DOMAIN));
  });

  // A person on a domain of their own, and every row written before a domain
  // could be said at all: absent is their address's own domain, so the fact
  // travels whole without one.
  it("says nothing about a domain where its subject named none", () => {
    const said = whereaboutsOf(kept({ instance: HERS }));
    expect(said.domain).toBeUndefined();
    expect(JSON.parse(JSON.stringify(said))).toEqual({
      principal: ADA,
      instance: HERS,
    });
    expect(parseWhereabouts(served(ADA, HERS), ADA).domain).toBeUndefined();
  });
});
