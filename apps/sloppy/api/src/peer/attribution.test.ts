import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign,
} from "@sloppy/idp";
import type { PublishedNode } from "@sloppy/types";
import { createMessage, generateKey, sign as openPgpSign } from "openpgp";
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

/** Signed the way somebody with their own OpenPGP key signs one: over the
 *  same canonical form, and never over the JSON as it happens to be spelled. */
async function openPgpSignedBy(node: PublishedNode): Promise<PublishedNode> {
  const payload = payloadFor(node);
  const pair = await generateKey({
    type: "curve25519",
    userIDs: [{ name: "Alice", email: "alice@example.com" }],
    format: "object",
  });
  const signature = await openPgpSign({
    message: await createMessage({
      binary: new TextEncoder().encode(canonicalize(payload as JsonValue)),
    }),
    signingKeys: pair.privateKey,
    detached: true,
  });
  return {
    ...node,
    signature_scheme: "openpgp",
    signed_payload_json: JSON.stringify(payload),
    content_signature: signature,
    signing_device_public_key: pair.publicKey.armor(),
  };
}

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
  it("says nothing about a note that carries no signature", async () => {
    expect(await signatureRefutes(unsigned)).toBe(false);
  });

  it("accepts one signed over the note it arrived on", async () => {
    expect(await signatureRefutes(signedBy(unsigned))).toBe(false);
  });

  it("refuses one whose payload is about another note", async () => {
    const elsewhere = signedBy(unsigned, {
      ...payloadFor(unsigned),
      title: "Something else entirely",
    });
    expect(await signatureRefutes(elsewhere)).toBe(true);
  });

  it("refuses one whose payload was signed at another address", async () => {
    const moved = signedBy(unsigned, {
      ...payloadFor(unsigned),
      address: "1b",
    });
    expect(await signatureRefutes(moved)).toBe(true);
  });

  it("refuses one whose signature does not check out", async () => {
    const tampered = signedBy(unsigned);
    const keys = generateKeypair();
    expect(
      await signatureRefutes({
        ...tampered,
        signing_device_public_key: encodePublicKey(keys.publicKey),
      }),
    ).toBe(true);
  });

  it("refuses a payload that claims to be one and is not", async () => {
    expect(
      await signatureRefutes({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "sloppy-node@v1" }),
      }),
    ).toBe(true);
  });

  it("holds a note signed by a Sloppy this build has never met", async () => {
    expect(
      await signatureRefutes({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "sloppy-node@v9" }),
      }),
    ).toBe(false);
  });

  it("holds a note signed in a scheme this build cannot check", async () => {
    const tampered = signedBy(unsigned);
    expect(
      await signatureRefutes({
        ...tampered,
        signature_scheme: "ml-dsa-87",
        content_signature: "not an ed25519 signature",
      }),
    ).toBe(false);
  });

  it("accepts one its author signed with their own OpenPGP key", async () => {
    expect(await signatureRefutes(await openPgpSignedBy(unsigned))).toBe(false);
  });

  it("refuses an OpenPGP signature over another note", async () => {
    const signed = await openPgpSignedBy(unsigned);
    expect(
      await signatureRefutes({ ...signed, title: "Something else entirely" }),
    ).toBe(true);
  });

  it("refuses an OpenPGP signature made by somebody else's key", async () => {
    const signed = await openPgpSignedBy(unsigned);
    const mallory = await generateKey({
      type: "curve25519",
      userIDs: [{ name: "Mallory", email: "mallory@example.com" }],
      format: "object",
    });
    expect(
      await signatureRefutes({
        ...signed,
        signing_device_public_key: mallory.publicKey.armor(),
      }),
    ).toBe(true);
  });

  it("checks a note that names the scheme an untagged one is in", async () => {
    const signed = signedBy(unsigned);
    expect(
      await signatureRefutes({
        ...signed,
        signature_scheme: "ed25519-multibase",
      }),
    ).toBe(false);
    expect(
      await signatureRefutes({
        ...signed,
        signature_scheme: "ed25519-multibase",
        title: "Something else entirely",
      }),
    ).toBe(true);
  });

  it("holds a note whose payload it cannot read at all", async () => {
    expect(
      await signatureRefutes({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: "not json",
      }),
    ).toBe(false);
  });
});
