import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign,
} from "@sloppy/idp";
import type { BoundKey, SyrComment } from "@sloppy/types";
import { createMessage, generateKey, sign as openPgpSign } from "openpgp";
import { describe, expect, it } from "vitest";
import type { Keyholdings } from "../identity/identity-keys.service";
import { attributeComments } from "./comment-attribution";

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
  keys = generateKeypair(),
): SyrComment {
  return {
    ...comment,
    signed_payload_json: JSON.stringify(payload),
    content_signature: encodeMultibase(
      sign(canonicalize(payload as JsonValue), keys.privateKey),
    ),
    signing_device_public_key: encodePublicKey(keys.publicKey),
  };
}

/** Signed the way somebody with their own OpenPGP key signs one: over the
 *  same canonical form, and never over the JSON as it happens to be spelled. */
async function openPgpSignedBy(comment: SyrComment): Promise<SyrComment> {
  const payload = payloadFor(comment);
  const pair = await generateKey({
    type: "curve25519",
    userIDs: [{ name: "Alice", email: "alice@example.com" }],
    format: "object",
  });
  return {
    ...comment,
    signature_scheme: "openpgp",
    signed_payload_json: JSON.stringify(payload),
    content_signature: await openPgpSign({
      message: await createMessage({
        binary: new TextEncoder().encode(canonicalize(payload as JsonValue)),
      }),
      signingKeys: pair.privateKey,
      detached: true,
    }),
    signing_device_public_key: pair.publicKey.armor(),
  };
}

/** Nobody has been asked about anybody. */
const unasked: Keyholdings = new Map();

function holding(principal: string, keys: BoundKey[]): Keyholdings {
  return new Map([[principal, keys]]);
}

/** The key the writer's own instance signed with, as its listing serves it. */
function approved(key: string): BoundKey {
  return { scheme: "ed25519-multibase", key, signs: "content" };
}

async function whose(
  comment: SyrComment,
  held: Keyholdings = unasked,
): Promise<string | undefined> {
  return (await attributeComments([comment], NOTE, async () => held))[0];
}

describe("what a reader can show about who wrote a comment", () => {
  it("weighs nothing about one that carries no signature", async () => {
    expect(await whose(unsigned)).toBeUndefined();
  });

  it("holds one whose key nobody has been shown to hold", async () => {
    expect(await whose(signedBy(unsigned))).toBe("unattributed");
  });

  it("calls it the writer's when they hold the key it was signed with", async () => {
    const keys = generateKeypair();
    const signed = signedBy(unsigned, payloadFor(unsigned), keys);
    expect(
      await whose(
        signed,
        holding(VOICE, [approved(encodePublicKey(keys.publicKey))]),
      ),
    ).toBe("theirs");
  });

  // A listing is what signs now, and this comment was signed then: a writer who
  // has rotated their key since must not lose the words they left behind.
  it("holds one signed under none of the keys its writer holds now", async () => {
    const retired = generateKeypair();
    const standing = generateKeypair();
    expect(
      await whose(
        signedBy(unsigned, payloadFor(unsigned), retired),
        holding(VOICE, [approved(encodePublicKey(standing.publicKey))]),
      ),
    ).toBe("unattributed");
  });

  it("holds one where the instance did not answer, rather than accusing", async () => {
    expect(await whose(signedBy(unsigned), new Map([[VOICE, null]]))).toBe(
      "unattributed",
    );
  });

  it("refuses one whose words are not the words that were signed", async () => {
    const rewritten = signedBy({
      ...unsigned,
      content: "I agree with all of it.",
    });
    expect(
      await whose({ ...rewritten, content: "Everything here is wrong." }),
    ).toBe("refuted");
  });

  it("refuses one carrying a payload about another note", async () => {
    const elsewhere = signedBy(unsigned, {
      ...payloadFor(unsigned),
      post_id: "01JQXR000000000000000000B2",
    });
    expect(await whose(elsewhere)).toBe("refuted");
  });

  it("refuses one signed in somebody else's name", async () => {
    const borrowed = signedBy(unsigned, {
      ...payloadFor(unsigned),
      did: NOTE.post_did,
    });
    expect(await whose(borrowed)).toBe("refuted");
  });

  it("refuses one whose reply was threaded somewhere else after signing", async () => {
    const rethreaded = signedBy(unsigned);
    expect(
      await whose({ ...rethreaded, ancestor_chain: [`${VOICE}:elsewhere`] }),
    ).toBe("refuted");
  });

  it("refuses one whose signature does not check out", async () => {
    const tampered = signedBy(unsigned);
    const keys = generateKeypair();
    expect(
      await whose({
        ...tampered,
        signing_device_public_key: encodePublicKey(keys.publicKey),
      }),
    ).toBe("refuted");
  });

  it("refuses a payload that claims to be one and is not", async () => {
    expect(
      await whose({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "comment@v1" }),
      }),
    ).toBe("refuted");
  });

  it("weighs nothing about one whose payload it cannot read at all", async () => {
    expect(
      await whose({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: "not json",
      }),
    ).toBeUndefined();
  });

  it("holds one its writer signed with a key nobody serves for them", async () => {
    expect(await whose(await openPgpSignedBy(unsigned))).toBe("unattributed");
  });

  it("refuses an OpenPGP signature over other words", async () => {
    const signed = await openPgpSignedBy(unsigned);
    expect(
      await whose({ ...signed, content: "Everything here is wrong." }),
    ).toBe("refuted");
  });

  it("weighs nothing about one signed in a scheme it cannot check", async () => {
    const signed = signedBy(unsigned);
    expect(
      await whose({
        ...signed,
        signature_scheme: "ml-dsa-87",
        content_signature: "zNo",
      }),
    ).toBeUndefined();
  });

  // A build that cannot read a payload cannot check one, and a comment signed
  // by a later Sloppy is held rather than dropped.
  it("asks nobody where no comment on the thread is signed", async () => {
    let asks = 0;
    await attributeComments([unsigned, unsigned], NOTE, async () => {
      asks += 1;
      return unasked;
    });
    expect(asks).toBe(0);
  });

  it("asks once for a thread of many signed comments", async () => {
    let asks = 0;
    const thread = Array.from({ length: 8 }, (_, at) =>
      signedBy({ ...unsigned, local_id: `c${at}` }),
    );
    await attributeComments(thread, NOTE, async () => {
      asks += 1;
      return unasked;
    });
    expect(asks).toBe(1);
  });

  it("weighs nothing about one signed under a kind it does not know", async () => {
    const later = signedBy(unsigned, {
      ...payloadFor(unsigned),
      type: "comment@v2",
    });
    expect(await whose(later)).toBeUndefined();
  });
});
