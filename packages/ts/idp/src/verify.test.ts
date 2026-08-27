import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonical.js";
import { DelegationStatementSchema } from "./contracts.js";
import { deriveDid, encodeMultibase, encodePublicKey } from "./encoding.js";
import { generateKeypair, sign } from "./keys.js";
import { verifyDelegationStatement, verifySignedPayload } from "./verify.js";

describe("verifying a signed payload", () => {
  it("accepts a signature over the same object written another way", () => {
    const { privateKey, publicKey } = generateKeypair();
    const payload = { b: "two", a: "one", n: 3 };
    const signature = encodeMultibase(sign(canonicalize(payload), privateKey));
    // The verifier reconstructs the object with the keys in a different order,
    // which is exactly what canonicalization is for.
    expect(
      verifySignedPayload({
        payload: { n: 3, a: "one", b: "two" },
        signature,
        publicKeyMultibase: encodePublicKey(publicKey),
      }),
    ).toBe(true);
  });

  it("rejects a payload that has been edited since it was signed", () => {
    const { privateKey, publicKey } = generateKeypair();
    const signature = encodeMultibase(
      sign(canonicalize({ title: "one" }), privateKey),
    );
    expect(
      verifySignedPayload({
        payload: { title: "two" },
        signature,
        publicKeyMultibase: encodePublicKey(publicKey),
      }),
    ).toBe(false);
  });

  it("rejects rather than throws on malformed input", () => {
    expect(
      verifySignedPayload({
        payload: {},
        signature: "not-multibase",
        publicKeyMultibase: "also-not",
      }),
    ).toBe(false);
  });
});

describe("verifying a delegation statement", () => {
  it("checks the root signature against the key the DID itself names", () => {
    const root = generateKeypair();
    const delegate = generateKeypair();
    const did = deriveDid(root.publicKey);
    const statement = DelegationStatementSchema.parse({
      did,
      delegate: encodePublicKey(delegate.publicKey),
      scope: "platform",
      platform_origin: "https://app.example",
      platform_name: "Example",
      createdAt: new Date().toISOString(),
    });
    const canonicalStatement = canonicalize(statement);
    const signature = encodeMultibase(
      sign(canonicalStatement, root.privateKey),
    );

    // Nothing is fetched: the DID carries the root public key, which is what
    // makes a delegation verifiable by a peer that has never met this instance.
    expect(
      verifyDelegationStatement({ canonicalStatement, signature, did }),
    ).toBe(true);
    expect(
      verifyDelegationStatement({
        canonicalStatement,
        signature,
        did: deriveDid(delegate.publicKey),
      }),
    ).toBe(false);
  });
});
