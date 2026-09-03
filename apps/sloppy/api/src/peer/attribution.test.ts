import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign,
} from "@sloppy/idp";
import type { PublishedNode } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { signatureRefutes } from "./attribution";

const AUTHOR = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const LOCAL = "01JQXR000000000000000000A1";

const unsigned: PublishedNode = {
  ref: `${AUTHOR}/${LOCAL}`,
  address: "1a",
  origin: `${AUTHOR}/${LOCAL}`,
  title: "A city remembers",
  tags: [],
  links: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const payloadFor = (node: PublishedNode) => ({
  type: "sloppy-node@v1",
  did: AUTHOR,
  node_id: LOCAL,
  address: node.address,
  title: node.title,
  created_at: node.created_at,
});

/** Signed the way an author's instance signs one: over the canonical form. */
function signedBy(
  node: PublishedNode,
  payload: Record<string, unknown> = payloadFor(node),
): PublishedNode {
  const keys = generateKeypair();
  return {
    ...node,
    signed_payload_json: JSON.stringify(payload),
    content_signature: encodeMultibase(
      sign(canonicalize(payload as JsonValue), keys.privateKey),
    ),
    signing_device_public_key: encodePublicKey(keys.publicKey),
  };
}

describe("what a reader can check about a published note", () => {
  it("says nothing about a note that carries no signature", () => {
    expect(signatureRefutes(unsigned)).toBe(false);
  });

  it("accepts one signed over the note it arrived on", () => {
    expect(signatureRefutes(signedBy(unsigned))).toBe(false);
  });

  it("refuses one whose payload is about another note", () => {
    const elsewhere = signedBy(unsigned, {
      ...payloadFor(unsigned),
      title: "Something else entirely",
    });
    expect(signatureRefutes(elsewhere)).toBe(true);
  });

  it("refuses one whose payload was signed at another address", () => {
    const moved = signedBy(unsigned, {
      ...payloadFor(unsigned),
      address: "1b",
    });
    expect(signatureRefutes(moved)).toBe(true);
  });

  it("refuses one whose signature does not check out", () => {
    const tampered = signedBy(unsigned);
    const keys = generateKeypair();
    expect(
      signatureRefutes({
        ...tampered,
        signing_device_public_key: encodePublicKey(keys.publicKey),
      }),
    ).toBe(true);
  });

  it("refuses a payload that claims to be one and is not", () => {
    expect(
      signatureRefutes({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "sloppy-node@v1" }),
      }),
    ).toBe(true);
  });

  it("holds a note signed by a Sloppy this build has never met", () => {
    expect(
      signatureRefutes({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "sloppy-node@v9" }),
      }),
    ).toBe(false);
  });

  it("holds a note whose payload it cannot read at all", () => {
    expect(
      signatureRefutes({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: "not json",
      }),
    ).toBe(false);
  });
});
