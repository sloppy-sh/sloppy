// Whose a comment is, as far as a reader can be shown.

import {
  type Attribution,
  CommentSignedPayloadV1Schema,
  type SyrComment,
  signatureSchemeOf,
} from "@sloppy/types";
import { type SignedClaim, attributionOf } from "../identity/attribution";
import type {
  AskWhoHolds,
  Keyholdings,
} from "../identity/identity-keys.service";

/**
 * What a reader makes of each signed comment on a note — its author's,
 * nobody's that can be shown, or not the author's at all. The rule a published
 * note's signature already carries, answered in the same three ways.
 *
 * **An unsigned comment is absent from the answer**, which is the ordinary
 * state of one: syr's create route drops the envelope it accepts, so a comment
 * whose second step never landed is unsigned and not suspect. So is one signed
 * in a scheme this build cannot name.
 *
 * **`ask` is made at most once, and only where a thread carries a signature
 * worth weighing** — never once per comment.
 */
export async function attributeComments(
  comments: readonly SyrComment[],
  post: { post_did: string; post_id: string },
  ask: AskWhoHolds,
): Promise<readonly (Attribution | undefined)[]> {
  const said: (Attribution | undefined)[] = [];
  let held: Keyholdings | undefined;
  for (const comment of comments) {
    const read = readSignature(comment, post);
    if (read === undefined || read === "refuted") {
      said.push(read);
      continue;
    }
    held ??= await ask();
    said.push(await attributionOf(read, held.get(comment.did) ?? null));
  }
  return said;
}

/**
 * What the row alone settles: nothing to weigh, a statement that contradicts
 * the comment it arrived on, or a signature still to be weighed against
 * somebody's keys.
 */
function readSignature(
  comment: SyrComment,
  post: { post_did: string; post_id: string },
): undefined | "refuted" | SignedClaim {
  const { content_signature, signed_payload_json, signing_device_public_key } =
    comment;
  if (
    content_signature === undefined ||
    signed_payload_json === undefined ||
    signing_device_public_key === undefined
  ) {
    return undefined;
  }
  const scheme = signatureSchemeOf(comment);
  if (scheme === undefined) return undefined;

  const payload = parseObject(signed_payload_json);
  if (payload === null) return undefined;
  if (payload.type !== CommentSignedPayloadV1Schema.shape.type.value) {
    return undefined;
  }

  const claim = CommentSignedPayloadV1Schema.safeParse(payload);
  if (!claim.success) return "refuted";
  if (!claimsThisComment(claim.data, comment, post)) return "refuted";

  // The parsed object rather than the schema's output: a signature is over the
  // canonical form of what was sent, and zod strips what it does not declare.
  return {
    scheme,
    payload,
    signature: content_signature,
    publicKey: signing_device_public_key,
  };
}

function claimsThisComment(
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
