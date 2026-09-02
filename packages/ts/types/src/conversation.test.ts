import { describe, expect, it } from "vitest";
import { splitOwnedRef, splitStoreRef, storeRefFor } from "./codecs.js";
import { StoreRefSchema } from "./common.js";
import {
  CreateNoteCommentRequestSchema,
  NoteCommentSchema,
} from "./conversation.js";
import { SyrCommentSchema } from "./syr.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NODE = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const LOCAL = "01JCOMMENT0000000000000000";
const NOTE = `${NODE}/01JMARK0000000000000000000`;

/** Exactly how syr writes an entry: `${did}:${local_id}`, from its own thread. */
const ANCESTOR = `${AUTHOR}:${LOCAL}`;

function comment(fields: Record<string, unknown> = {}) {
  return {
    comment_id: ANCESTOR,
    author: AUTHOR,
    node: NOTE,
    content: "Said back",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

describe("how a comment is cited", () => {
  it("is the form the store writes into a thread, so a reply compares to one", () => {
    expect(storeRefFor(AUTHOR, LOCAL)).toBe(ANCESTOR);
    const parsed = NoteCommentSchema.parse(comment({ reply_to: ANCESTOR }));
    expect(parsed.reply_to).toBe(parsed.comment_id);
  });

  it("splits at the last colon, not at the two the DID carries", () => {
    expect(splitStoreRef(ANCESTOR)).toEqual({ did: AUTHOR, localId: LOCAL });
    expect(AUTHOR.split(":")).toHaveLength(3);
  });

  it("survives a local id the issuing store minted its own way", () => {
    // Not a ULID anywhere but here, which is why a comment is not an OwnedRef.
    for (const localId of ["7", "a-b-c", "01JZZZ", "cmt_9f2"]) {
      const ref = storeRefFor(AUTHOR, localId);
      expect(StoreRefSchema.parse(ref)).toBe(ref);
      expect(splitStoreRef(ref)).toEqual({ did: AUTHOR, localId });
    }
  });

  it("is not the reference a note is cited by, and neither reads as the other", () => {
    expect(() => StoreRefSchema.parse(NOTE)).toThrow();
    expect(() => splitOwnedRef(ANCESTOR)).toThrow();
    expect(() =>
      NoteCommentSchema.parse(comment({ comment_id: `${AUTHOR}/${LOCAL}` })),
    ).toThrow();
    expect(() =>
      CreateNoteCommentRequestSchema.parse({
        node: NOTE,
        content: "Said back",
        reply_to: `${AUTHOR}/${LOCAL}`,
      }),
    ).toThrow();
  });

  it("reads a store's own ancestor chain without either side reshaping it", () => {
    const served = SyrCommentSchema.parse({
      did: AUTHOR,
      local_id: LOCAL,
      post_did: NODE,
      post_id: "01JMARK0000000000000000000",
      ancestor_chain: [ANCESTOR],
      content: "Said back",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    const parent = served.ancestor_chain.at(-1);
    expect(
      NoteCommentSchema.parse(comment({ reply_to: parent })).reply_to,
    ).toBe(ANCESTOR);
  });
});

describe("what a comment carries about who wrote it", () => {
  it("keeps the signature its store served, and does not require one", () => {
    const signed = NoteCommentSchema.parse(
      comment({
        content_signature: "z3signature",
        signed_payload_json: '{"type":"comment@v1"}',
        signing_device_public_key: "z6MkDevice",
      }),
    );
    expect(signed.content_signature).toBe("z3signature");
    expect(signed.signed_payload_json).toBe('{"type":"comment@v1"}');
    expect(signed.signing_device_public_key).toBe("z6MkDevice");

    const unsigned = NoteCommentSchema.parse(comment());
    expect(unsigned.content_signature).toBeUndefined();
  });

  it("survives a store that serves one, since that is where a comment is signed", () => {
    const served = SyrCommentSchema.parse({
      did: AUTHOR,
      local_id: LOCAL,
      post_did: NODE,
      post_id: "01JMARK0000000000000000000",
      content: "Said back",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      content_signature: "z3signature",
      signed_payload_json: '{"type":"comment@v1"}',
      signing_device_public_key: "z6MkDevice",
    });
    expect(served.content_signature).toBe("z3signature");
    expect(served.ancestor_chain).toEqual([]);
  });
});
