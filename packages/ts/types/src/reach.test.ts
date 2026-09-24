// What widening the federation shapes is allowed to cost: nothing a `did:syr`
// peer already had. A property over generated identifiers rather than a handful
// of spelled-out ones, because a schema that accepts more is not by itself a
// proof that it accepts the same things the same way.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FollowedIdentitySchema,
  FollowRequestSchema,
  PeerIdentitySchema,
  PeerPublicationsQuerySchema,
} from "./federation.js";
import {
  parsePublishedIndex,
  publishedIndexReader,
  UnaskedAnswerError,
} from "./published.js";
import {
  NodeSignedPayloadSchema,
  NodeSignedPayloadV1Schema,
  NodeSignedPayloadV2Schema,
  nodePayloadVersionOf,
} from "./syr.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Every `did:syr` the narrow schema accepts, which is what a peer on `main`
 *  could be. */
const didSyr: fc.Arbitrary<string> = fc
  .stringMatching(new RegExp(`^[${BASE58}]{1,60}$`))
  .map((rest) => `did:syr:z${rest}`);

const ulid: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...CROCKFORD), { minLength: 26, maxLength: 26 })
  .map((chars) => chars.join(""));

const mailto: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,12}$/),
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z]{2,8}$/),
  )
  .map(([local, host, tld]) => `mailto:${local}@${host}.${tld}`);

/** A listing exactly as an instance on `main` serves one. */
function listing(did: string, localId: string) {
  return {
    did,
    publications: [
      {
        ref: `${did}/${localId}`,
        root_address: "1a",
        title: "A branch",
        latest: {
          ref: `${did}/${localId}`,
          sequence: 1,
          published_at: "2026-03-01T00:00:00.000Z",
        },
      },
    ],
  };
}

describe("a peer named by a did:syr", () => {
  it("follows, and is followed, exactly as before", () => {
    fc.assert(
      fc.property(
        didSyr,
        fc.option(fc.constant("https://store.example"), { nil: undefined }),
        (did, provider) => {
          const followed = FollowedIdentitySchema.safeParse({
            did,
            ...(provider === undefined ? {} : { provider_url: provider }),
          });
          expect(followed.success).toBe(true);
          expect(followed.success && followed.data.did).toBe(did);
          expect(followed.success && followed.data.provider_url).toBe(provider);

          // A store that recorded no instance writes the column null rather
          // than leaving it out, and a follow still takes that spelling.
          expect(
            FollowedIdentitySchema.safeParse({ did, provider_url: null })
              .success,
          ).toBe(true);
          expect(FollowRequestSchema.safeParse({ did }).success).toBe(true);
        },
      ),
    );
  });

  it("is asked about, and answered about, exactly as before", () => {
    fc.assert(
      fc.property(didSyr, (did) => {
        const asked = PeerPublicationsQuerySchema.safeParse({
          did,
          source_url: "https://peer.example",
        });
        expect(asked.success).toBe(true);
        expect(asked.success && asked.data.did).toBe(did);
        expect(asked.success && asked.data.source_url).toBe(
          "https://peer.example",
        );
        const answered = PeerIdentitySchema.safeParse({ did });
        expect(answered.success && answered.data.did).toBe(did);
      }),
    );
  });

  it("has their listing read back whole, and held to who was asked about", () => {
    fc.assert(
      fc.property(didSyr, didSyr, ulid, (did, other, localId) => {
        fc.pre(did !== other);
        const body = listing(did, localId);
        expect(parsePublishedIndex(body, did)).toEqual(body);

        // A listing about somebody else is the refusal it always was, and so
        // is one carrying a publication written by somebody else.
        expect(() => parsePublishedIndex(body, other)).toThrow(
          UnaskedAnswerError,
        );
        expect(() => parsePublishedIndex(listing(other, localId), did)).toThrow(
          UnaskedAnswerError,
        );

        const reading = publishedIndexReader({ did });
        expect(reading.take(body)).toEqual(body);
        expect(() => reading.take(body)).toThrow(UnaskedAnswerError);
      }),
    );
  });
});

describe("a peer named by an email address", () => {
  it("is followed, asked about and listed the way anybody is", () => {
    fc.assert(
      fc.property(mailto, ulid, (principal, localId) => {
        expect(FollowRequestSchema.safeParse({ did: principal }).success).toBe(
          true,
        );
        expect(
          FollowedIdentitySchema.safeParse({ did: principal }).success,
        ).toBe(true);
        expect(
          PeerPublicationsQuerySchema.safeParse({ did: principal }).success,
        ).toBe(true);
        expect(PeerIdentitySchema.safeParse({ did: principal }).success).toBe(
          true,
        );

        const body = listing(principal, localId);
        expect(parsePublishedIndex(body, principal)).toEqual(body);
      }),
    );
  });

  it("is still the only other way to be named", () => {
    for (const said of ["", "peer.example", "https://peer.example", "alice"]) {
      expect(FollowRequestSchema.safeParse({ did: said }).success).toBe(false);
      expect(PeerIdentitySchema.safeParse({ did: said }).success).toBe(false);
    }
  });
});

describe("what a note's signed payload says", () => {
  it("reads a v1 payload exactly as it always did", () => {
    fc.assert(
      fc.property(didSyr, ulid, (did, localId) => {
        const payload = {
          type: "sloppy-node@v1",
          did,
          node_id: localId,
          address: "1a1",
          title: "A city remembers",
          created_at: "2026-03-01T00:00:00.000Z",
        };
        expect(NodeSignedPayloadV1Schema.parse(payload)).toEqual(payload);
        expect(nodePayloadVersionOf(payload)).toBe("sloppy-node@v1");
        // The union routes on the tag rather than trying each arm, so what a
        // v1 payload parses to is what v1 says it is.
        expect(NodeSignedPayloadSchema.parse(payload)).toEqual(payload);
      }),
    );
  });

  it("keeps v1 narrow: the author of one is a syr identity", () => {
    fc.assert(
      fc.property(mailto, ulid, (principal, localId) => {
        const payload = {
          type: "sloppy-node@v1",
          did: principal,
          node_id: localId,
          address: "1a1",
          title: "A city remembers",
          created_at: "2026-03-01T00:00:00.000Z",
        };
        expect(NodeSignedPayloadV1Schema.safeParse(payload).success).toBe(
          false,
        );
        expect(NodeSignedPayloadSchema.safeParse(payload).success).toBe(false);
        // Named, and unreadable: a caller may hold that against the row, which
        // is a different answer from a version this build cannot name.
        expect(nodePayloadVersionOf(payload)).toBe("sloppy-node@v1");
      }),
    );
  });

  it("carries whoever wrote it in v2, labelled or not", () => {
    fc.assert(
      fc.property(fc.oneof(didSyr, mailto), ulid, (principal, localId) => {
        const payload = {
          type: "sloppy-node@v2",
          principal,
          node_id: localId,
          title: "A city remembers",
          created_at: "2026-03-01T00:00:00.000Z",
        };
        expect(NodeSignedPayloadV2Schema.parse(payload)).toEqual(payload);
        expect(NodeSignedPayloadSchema.parse(payload)).toEqual(payload);
        expect(nodePayloadVersionOf(payload)).toBe("sloppy-node@v2");

        const labelled = { ...payload, address: "1a1" };
        expect(NodeSignedPayloadV2Schema.parse(labelled).address).toBe("1a1");
      }),
    );
  });

  it("holds a version it cannot name rather than refusing it", () => {
    for (const payload of [
      { type: "sloppy-node@v3", principal: "did:syr:z6Mk" },
      { type: 7 },
      {},
      "sloppy-node@v1",
      null,
    ]) {
      expect(nodePayloadVersionOf(payload)).toBeUndefined();
    }
  });
});
