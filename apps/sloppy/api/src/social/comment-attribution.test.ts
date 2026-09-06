import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign,
} from "@sloppy/idp";
import type { SyrComment } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { commentRefutes } from "./comment-attribution";

const VOICE = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const NOTE = {
  post_did: "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG",
  post_id: "01JQXR000000000000000000A1",
};

const unsigned: SyrComment = {
  did: VOICE,
  local_id: "c1",
  post_did: NOTE.post_did,
  post_id: NOTE.post_id,
  ancestor_chain: [],
  content: "The second chapter says the opposite.",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const payloadFor = (comment: SyrComment) => ({
  type: "comment@v1",
  did: comment.did,
  comment_id: comment.local_id,
  post_did: NOTE.post_did,
  post_id: NOTE.post_id,
  ancestor_chain: comment.ancestor_chain,
  content: comment.content,
  visibility: "public",
  status: "completed",
  created_at: comment.created_at,
});

/** Signed the way the writer's own instance signs one: over the canonical
 *  form of what the store wrote. */
function signedBy(
  comment: SyrComment,
  payload: Record<string, unknown> = payloadFor(comment),
): SyrComment {
  const keys = generateKeypair();
  return {
    ...comment,
    signed_payload_json: JSON.stringify(payload),
    content_signature: encodeMultibase(
      sign(canonicalize(payload as JsonValue), keys.privateKey),
    ),
    signing_device_public_key: encodePublicKey(keys.publicKey),
  };
}

describe("what a reader can check about a comment", () => {
  it("says nothing about one that carries no signature", () => {
    expect(commentRefutes(unsigned, NOTE)).toBe(false);
  });

  it("accepts one signed over the comment it arrived on", () => {
    expect(commentRefutes(signedBy(unsigned), NOTE)).toBe(false);
  });

  it("refuses one whose words are not the words that were signed", () => {
    const rewritten = signedBy({
      ...unsigned,
      content: "I agree with all of it.",
    });
    expect(
      commentRefutes(
        { ...rewritten, content: "Everything here is wrong." },
        NOTE,
      ),
    ).toBe(true);
  });

  it("refuses one carrying a payload about another note", () => {
    const elsewhere = signedBy(unsigned, {
      ...payloadFor(unsigned),
      post_id: "01JQXR000000000000000000B2",
    });
    expect(commentRefutes(elsewhere, NOTE)).toBe(true);
  });

  it("refuses one signed in somebody else's name", () => {
    const borrowed = signedBy(unsigned, {
      ...payloadFor(unsigned),
      did: NOTE.post_did,
    });
    expect(commentRefutes(borrowed, NOTE)).toBe(true);
  });

  it("refuses one whose reply was threaded somewhere else after signing", () => {
    const rethreaded = signedBy(unsigned);
    expect(
      commentRefutes(
        { ...rethreaded, ancestor_chain: [`${VOICE}:elsewhere`] },
        NOTE,
      ),
    ).toBe(true);
  });

  it("refuses one whose signature does not check out", () => {
    const tampered = signedBy(unsigned);
    const keys = generateKeypair();
    expect(
      commentRefutes(
        {
          ...tampered,
          signing_device_public_key: encodePublicKey(keys.publicKey),
        },
        NOTE,
      ),
    ).toBe(true);
  });

  it("refuses a payload that claims to be one and is not", () => {
    expect(
      commentRefutes(
        {
          ...unsigned,
          content_signature: "zBogus",
          signing_device_public_key: "zBogus",
          signed_payload_json: JSON.stringify({ type: "comment@v1" }),
        },
        NOTE,
      ),
    ).toBe(true);
  });

  it("holds one whose payload it cannot read at all", () => {
    expect(
      commentRefutes(
        {
          ...unsigned,
          content_signature: "zBogus",
          signing_device_public_key: "zBogus",
          signed_payload_json: "not json",
        },
        NOTE,
      ),
    ).toBe(false);
  });

  // A build that cannot read a payload cannot check one, and a comment signed
  // by a later Sloppy is held rather than dropped.
  it("holds one signed under a kind it does not know", () => {
    const later = signedBy(unsigned, {
      ...payloadFor(unsigned),
      type: "comment@v2",
    });
    expect(commentRefutes(later, NOTE)).toBe(false);
  });
});
