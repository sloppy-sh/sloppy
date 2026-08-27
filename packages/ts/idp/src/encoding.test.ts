// The encoding is checked against a published vector, not against itself: a
// round trip proves only that this file agrees with this file, and the whole
// point of `did:syr:` is that somebody else's code recovers the same key.

import { describe, expect, it } from "vitest";
import {
  decodeMultibase,
  decodePrivateKey,
  decodePublicKey,
  deriveDid,
  encodeMultibase,
  encodePrivateKey,
  encodePublicKey,
  isValidSyrDid,
  publicKeyFromDid,
} from "./encoding.js";

function hex(text: string): Uint8Array {
  return Uint8Array.from(
    text.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
}

// W3C did:key Ed25519 test vector. `did:syr:` differs only in the method name,
// so this pins the multicodec prefix, the base58btc alphabet and the alignment
// of the two all at once.
const SPEC_KEY = hex(
  "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29",
);
const SPEC_MULTIBASE = "z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp";

describe("multibase base58btc", () => {
  it("encodes the published Ed25519 vector", () => {
    expect(encodePublicKey(SPEC_KEY)).toBe(SPEC_MULTIBASE);
    expect(deriveDid(SPEC_KEY)).toBe(`did:syr:${SPEC_MULTIBASE}`);
  });

  it("recovers the key from the DID it is named by", () => {
    expect(publicKeyFromDid(`did:syr:${SPEC_MULTIBASE}`)).toEqual(SPEC_KEY);
  });

  it("keeps leading zero bytes, which base58 encodes positionally", () => {
    expect(encodeMultibase(new Uint8Array([0, 0, 1]))).toBe("z112");
    expect(decodeMultibase("z112")).toEqual(new Uint8Array([0, 0, 1]));
    expect(decodeMultibase(encodeMultibase(new Uint8Array(4)))).toEqual(
      new Uint8Array(4),
    );
  });

  it("round-trips arbitrary byte strings", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + length * 11) & 0xff;
      expect(decodeMultibase(encodeMultibase(bytes))).toEqual(bytes);
    }
  });

  it("round-trips a private key through its own multicodec prefix", () => {
    expect(decodePrivateKey(encodePrivateKey(SPEC_KEY))).toEqual(SPEC_KEY);
    // The two prefixes must not be interchangeable, or a private key would
    // decode as a public one.
    expect(encodePrivateKey(SPEC_KEY)).not.toBe(encodePublicKey(SPEC_KEY));
  });

  it("refuses anything that is not base58btc under the z prefix", () => {
    expect(() => decodeMultibase("mZGVhZGJlZWY")).toThrow();
    expect(() => decodeMultibase("")).toThrow();
    // 0, O, I and l are the characters base58 leaves out on purpose.
    expect(() => decodeMultibase("z0OIl")).toThrow();
  });

  it("refuses a key of the wrong length", () => {
    expect(() =>
      decodePublicKey(encodeMultibase(new Uint8Array(31))),
    ).toThrow();
  });
});

describe("did:syr", () => {
  it("accepts what it derives and rejects what it did not", () => {
    expect(isValidSyrDid(deriveDid(SPEC_KEY))).toBe(true);
    expect(isValidSyrDid(`did:key:${SPEC_MULTIBASE}`)).toBe(false);
    expect(isValidSyrDid("did:syr:not-multibase")).toBe(false);
    expect(isValidSyrDid("")).toBe(false);
  });
});
