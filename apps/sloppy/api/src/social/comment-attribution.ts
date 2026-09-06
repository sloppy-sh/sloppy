// What a reader can check about a comment's signature, and nothing more.

import { CommentSignedPayloadV1Schema, type SyrComment } from "@sloppy/types";
import { verifySignedPayload } from "@sloppy/idp";

/**
 * Whether the signature a comment carries is one this reader can check and
 * finds wrong. It is the rule a published note's signature already carries: a
 * reader that cannot verify one still renders the comment, and one that can,
 * and finds it wrong, must not present it as the author's.
 *
 * **Checking out is not the same as being the author's.** The key that signed
 * the payload arrives WITH it, and binding that key to the DID would take the
 * author's own instance's delegation listing, which nothing here fetches. So a
 * signature that verifies says the comment has not been altered since it was
 * signed, and says nothing about who signed it.
 *
 * A payload this build does not understand is one it cannot check, so a comment
 * signed by a later version of Sloppy is held rather than dropped.
 */
export function commentRefutes(
  comment: SyrComment,
  post: { post_did: string; post_id: string },
): boolean {
  const { content_signature, signed_payload_json, signing_device_public_key } =
    comment;
  if (
    content_signature === undefined ||
    signed_payload_json === undefined ||
    signing_device_public_key === undefined
  ) {
    return false;
  }

  const payload = parseObject(signed_payload_json);
  if (payload === null) return false;
  if (payload.type !== CommentSignedPayloadV1Schema.shape.type.value) {
    return false;
  }

  const claim = CommentSignedPayloadV1Schema.safeParse(payload);
  if (!claim.success) return true;
  if (!aboutThisComment(claim.data, comment, post)) return true;

  // The parsed object rather than the schema's output: a signature is over the
  // canonical form of what was sent, and zod strips what it does not declare.
  return !verifySignedPayload({
    payload,
    signature: content_signature,
    publicKeyMultibase: signing_device_public_key,
  });
}

function aboutThisComment(
  claim: ReturnType<typeof CommentSignedPayloadV1Schema.parse>,
  comment: SyrComment,
  post: { post_did: string; post_id: string },
): boolean {
  return (
    claim.did === comment.did &&
    claim.comment_id === comment.local_id &&
    claim.post_did === post.post_did &&
    claim.post_id === post.post_id &&
    claim.content === comment.content &&
    claim.created_at === comment.created_at &&
    claim.ancestor_chain.length === comment.ancestor_chain.length &&
    claim.ancestor_chain.every((one, at) => one === comment.ancestor_chain[at])
  );
}

function parseObject(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
