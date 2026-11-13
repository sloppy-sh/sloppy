// What widening an identifier is allowed to cost: nothing a `did:syr` already
// had. The suite is a property over generated identifiers rather than a handful
// of spelled-out ones, because a regex that accepts more is not by itself a
// proof that it accepts the same things the same way.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ownedRefFrom, recordIdFromOwnedRef, splitOwnedRef } from "./codecs.js";
import {
  asPrincipal,
  DidSyrSchema,
  DomainSchema,
  MailtoSchema,
  OwnedRefSchema,
  PrincipalSchema,
  principalScheme,
  StoreRefSchema,
  W3idSchema,
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

const tld: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[A-Za-z]{2,10}$/),
  fc.stringMatching(/^[a-z0-9]{2,10}$/).map((rest) => `xn--${rest}`),
);

const domain: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.stringMatching(/^[A-Za-z0-9]{1,10}$/), {
      minLength: 1,
      maxLength: 2,
    }),
    tld,
  )
  .map(([labels, last]) => [...labels, last].join("."));

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
            !held.toLowerCase().startsWith("mailto:") &&
            !held.toLowerCase().startsWith("w3id:")
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

  it("is taken wherever the domain ends, .рф and .中国 included", () => {
    for (const spelled of [
      "mailto:alice@example.xn--p1ai",
      "mailto:alice@example.xn--fiqs8s",
      "mailto:alice@xn--r8jz45g.com",
      "mailto:alice@xn--80ak6aa92e.xn--80ak6aa92e",
    ]) {
      expect(PrincipalSchema.parse(spelled)).toBe(spelled);
      expect(
        OwnedRefSchema.parse(`${spelled}/01JQ0000000000000000000000`),
      ).toBe(`${spelled}/01JQ0000000000000000000000`);
    }
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

// The right half of an address above and a domain said on its own are one
// grammar, written once. A test rather than a comment, because two copies of it
// would drift silently.
describe("a domain said on its own", () => {
  it("takes every domain an address is allowed to sit on", () => {
    fc.assert(
      fc.property(domain, (host) => {
        expect(DomainSchema.parse(host)).toBe(host.toLowerCase());
        expect(MailtoSchema.safeParse(`mailto:alice@${host}`).success).toBe(
          true,
        );
      }),
    );
  });

  it("refuses what an address's right half is refused for", () => {
    for (const host of [
      "",
      "localhost",
      "example",
      "example.com.",
      ".example.com",
      "-example.com",
      "example..com",
      "exa mple.com",
      "[192.0.2.1]",
      "example.com:443",
      "example.com/whereabouts",
      "https://example.com",
    ]) {
      expect(DomainSchema.safeParse(host).success).toBe(false);
      expect(MailtoSchema.safeParse(`mailto:alice@${host}`).success).toBe(
        false,
      );
    }
  });
});

const hex = (length: number): fc.Arbitrary<string> =>
  fc.stringMatching(new RegExp(`^[0-9a-fA-F]{${length}}$`));

/** A UUID as RFC 4122 spells one, in either case. */
const uuid: fc.Arbitrary<string> = fc
  .tuple(hex(8), hex(4), hex(4), hex(4), hex(12))
  .map((parts) => parts.join("-"));

describe("a W3ID as an identifier", () => {
  it("is taken, and comes back lowercased", () => {
    fc.assert(
      fc.property(uuid, (id) => {
        const spelled = `w3id:@${id}`;
        expect(PrincipalSchema.parse(spelled)).toBe(spelled.toLowerCase());
        expect(principalScheme(spelled)).toBe("w3id");
        expect(W3idSchema.parse(spelled.toUpperCase())).toBe(
          spelled.toLowerCase(),
        );
      }),
    );
  });

  it("is what a person types as @ and the UUID, and nothing they type is two people", () => {
    fc.assert(
      fc.property(uuid, (id) => {
        const canonical = `w3id:@${id.toLowerCase()}`;
        expect(asPrincipal(`@${id}`)).toBe(canonical);
        expect(asPrincipal(`  @${id.toUpperCase()} `)).toBe(canonical);
        expect(asPrincipal(canonical)).toBe(canonical);
      }),
    );
  });

  it("carries through a ref, and splits where a ref always split", () => {
    fc.assert(
      fc.property(uuid, ulid, (id, localId) => {
        const owner = `w3id:@${id.toLowerCase()}`;
        const ref = OwnedRefSchema.parse(`w3id:@${id}/${localId}`);
        expect(ref).toBe(`${owner}/${localId}`);
        expect(splitOwnedRef(ref)).toEqual({ owner, localId });
      }),
    );
  });

  it("can never be mistaken for another scheme, or another for it", () => {
    fc.assert(
      fc.property(uuid, didSyr, mailto, (id, did, spelled) => {
        const w3id = `w3id:@${id}`;
        expect(DidSyrSchema.safeParse(w3id).success).toBe(false);
        expect(MailtoSchema.safeParse(w3id).success).toBe(false);
        expect(W3idSchema.safeParse(did).success).toBe(false);
        expect(W3idSchema.safeParse(spelled).success).toBe(false);
      }),
    );
  });

  it("normalises once and then stays put", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          uuid.map((id) => `w3id:@${id}`),
          mailto,
          didSyr,
        ),
        (spelled) => {
          const once = PrincipalSchema.parse(spelled);
          expect(PrincipalSchema.parse(once)).toBe(once);
          expect(asPrincipal(once)).toBe(once);
        },
      ),
    );
  });

  it("is refused where it is malformed", () => {
    for (const held of [
      "w3id:",
      "w3id:@",
      "w3id:00000000-0000-5000-8000-000000000001",
      "w3id:@00000000-0000-5000-8000-00000000000",
      "w3id:@00000000-0000-5000-8000-0000000000012",
      "w3id:@000000000000500080000000000000001",
      "w3id:@0000000g-0000-5000-8000-000000000001",
      "w3id:@00000000-0000-5000-8000-000000000001/x",
      "w3id:@{00000000-0000-5000-8000-000000000001}",
      "w3id://00000000-0000-5000-8000-000000000001",
      "@00000000-0000-5000-8000-000000000001",
    ]) {
      expect(PrincipalSchema.safeParse(held).success).toBe(false);
    }
    for (const typed of ["", "@", "@nobody", "alice@example.com", "w3id:@x"]) {
      expect(asPrincipal(typed)).toBeUndefined();
    }
  });
});
