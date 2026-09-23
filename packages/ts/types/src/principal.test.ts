// What widening an identifier is allowed to cost: nothing a `did:syr` already
// had. The suite is a property over generated identifiers rather than a handful
// of spelled-out ones, because a regex that accepts more is not by itself a
// proof that it accepts the same things the same way.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ownedRefFrom, recordIdFromOwnedRef, splitOwnedRef } from "./codecs.js";
import {
  DidSyrSchema,
  MailtoSchema,
  OwnedRefSchema,
  PrincipalSchema,
  principalScheme,
  StoreRefSchema,
} from "./common.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Every `did:syr` the old regex accepted, and nothing else. */
const didSyr: fc.Arbitrary<string> = fc
  .stringMatching(new RegExp(`^[${BASE58}]{1,60}$`))
  .map((rest) => `did:syr:z${rest}`);

const ulid: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...CROCKFORD), { minLength: 26, maxLength: 26 })
  .map((chars) => chars.join(""));

const localPart: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[A-Za-z0-9!#$&'*+=?^_`{|}~-]{1,12}$/), {
    minLength: 1,
    maxLength: 3,
  })
  .map((atoms) => atoms.join("."));

const domain: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.stringMatching(/^[A-Za-z0-9]{1,10}$/), {
      minLength: 1,
      maxLength: 2,
    }),
    fc.stringMatching(/^[A-Za-z]{2,10}$/),
  )
  .map(([labels, tld]) => [...labels, tld].join("."));

const mailto: fc.Arbitrary<string> = fc
  .tuple(localPart, domain)
  .map(([local, host]) => `mailto:${local}@${host}`);

describe("widening what an identifier may be", () => {
  it("takes every did:syr it took before, unchanged", () => {
    fc.assert(
      fc.property(didSyr, (did) => {
        const parsed = PrincipalSchema.safeParse(did);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toBe(did);
        expect(DidSyrSchema.safeParse(did).success).toBe(true);
        expect(principalScheme(did)).toBe("did:syr");
      }),
    );
  });

  it("takes every ref over one, and splits it where it always split", () => {
    fc.assert(
      fc.property(didSyr, ulid, (did, localId) => {
        const spelled = `${did}/${localId}`;
        const parsed = OwnedRefSchema.safeParse(spelled);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toBe(spelled);
        expect(splitOwnedRef(spelled)).toEqual({ owner: did, localId });
      }),
    );
  });

  it("keys a row by the same two halves it keyed one by", () => {
    fc.assert(
      fc.property(didSyr, ulid, (did, localId) => {
        const ref = OwnedRefSchema.parse(`${did}/${localId}`);
        const id = recordIdFromOwnedRef("node", ref);
        expect(id.id).toEqual({ created_by: did, id: localId });
        expect(ownedRefFrom(id)).toBe(ref);
      }),
    );
  });

  it("leaves a did:syr's comparisons alone, whatever its casing", () => {
    fc.assert(
      fc.property(didSyr, (did) => {
        const shouted = did.toUpperCase();
        if (shouted === did) return;
        expect(PrincipalSchema.safeParse(shouted).success).toBe(false);
      }),
    );
  });

  it("still refuses what was never an identifier", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }).filter((held) => {
          return (
            !held.startsWith("did:syr:z") &&
            !held.toLowerCase().startsWith("mailto:")
          );
        }),
        (held) => {
          expect(PrincipalSchema.safeParse(held).success).toBe(false);
          expect(OwnedRefSchema.safeParse(held).success).toBe(false);
        },
      ),
    );
  });

  it("names a syr record the way it always did", () => {
    fc.assert(
      fc.property(
        didSyr,
        fc.string({ minLength: 1, maxLength: 20 }),
        (did, local) => {
          expect(StoreRefSchema.safeParse(`${did}:${local}`).success).toBe(
            true,
          );
        },
      ),
    );
  });
});

describe("an email address as an identifier", () => {
  it("is taken, and comes back lowercased", () => {
    fc.assert(
      fc.property(mailto, (spelled) => {
        const parsed = PrincipalSchema.safeParse(spelled);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toBe(spelled.toLowerCase());
        expect(principalScheme(spelled)).toBe("mailto");
      }),
    );
  });

  it("is one principal however it was typed", () => {
    fc.assert(
      fc.property(mailto, (spelled) => {
        const shouted = MailtoSchema.parse(spelled.toUpperCase());
        const whispered = MailtoSchema.parse(spelled.toLowerCase());
        expect(shouted).toBe(whispered);
      }),
    );
  });

  it("carries through a ref, normalised on the way", () => {
    fc.assert(
      fc.property(mailto, ulid, (spelled, localId) => {
        const ref = OwnedRefSchema.parse(`${spelled.toUpperCase()}/${localId}`);
        expect(ref).toBe(`${spelled.toLowerCase()}/${localId}`);
        expect(splitOwnedRef(ref)).toEqual({
          owner: spelled.toLowerCase(),
          localId,
        });
        expect(recordIdFromOwnedRef("node", ref).id).toEqual({
          created_by: spelled.toLowerCase(),
          id: localId,
        });
      }),
    );
  });

  it("is refused where it is malformed, as firmly as a DID is", () => {
    for (const held of [
      "mailto:",
      "mailto:alice",
      "mailto:alice@",
      "mailto:@example.com",
      "mailto:alice@example",
      "mailto:alice..bob@example.com",
      "mailto:.alice@example.com",
      "mailto:alice@example.com?subject=hi",
      "mailto:alice@example.com,bob@example.com",
      "mailto:alice%40example.com@example.com",
      "mailto:ali/ce@example.com",
      "mailto:alice@exam ple.com",
      "alice@example.com",
      "did:syr:alice@example.com",
    ]) {
      expect(PrincipalSchema.safeParse(held).success).toBe(false);
      const ref = `${held}/01JQ0000000000000000000000`;
      expect(OwnedRefSchema.safeParse(ref).success).toBe(false);
    }
  });

  it("can never be mistaken for a syr identity, or it for one", () => {
    fc.assert(
      fc.property(mailto, didSyr, (spelled, did) => {
        expect(MailtoSchema.safeParse(did).success).toBe(false);
        expect(DidSyrSchema.safeParse(spelled).success).toBe(false);
        expect(PrincipalSchema.parse(spelled)).not.toBe(
          PrincipalSchema.parse(did),
        );
      }),
    );
  });

  it("normalises once and then stays put", () => {
    fc.assert(
      fc.property(fc.oneof(mailto, didSyr), (spelled) => {
        const once = PrincipalSchema.parse(spelled);
        expect(PrincipalSchema.parse(once)).toBe(once);
      }),
    );
  });

  it("is not a syr record's name", () => {
    expect(StoreRefSchema.safeParse("mailto:alice@example.com:1").success).toBe(
      false,
    );
  });
});
