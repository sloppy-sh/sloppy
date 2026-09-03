// What a reader can check about a published note's signature, and nothing more.

import {
  NodeSignedPayloadV1Schema,
  type PublishedNode,
  splitOwnedRef,
} from "@sloppy/types";
import { verifySignedPayload } from "@sloppy/idp";

/**
 * Whether the signature a published note carries is one this reader can check
 * and finds wrong. `PublishedNodeSchema` states the rule this implements: a
 * reader that cannot verify a signature still renders the note; one that can,
 * and finds it wrong, must not present it as the author's.
 *
 * **Checking out is not the same as being the author's**, which is why there is
 * no third answer here and nothing may draw one. The key that signed the
 * payload arrives WITH it, and binding that key to the DID would take the
 * author's own instance's delegation listing — a fetch nothing here makes. So a
 * signature that verifies says the note has not been altered since it was
 * signed, and says nothing about who signed it.
 *
 * A payload this build does not understand is one it cannot check, so a note
 * signed by a later version of Sloppy is held rather than refused.
 */
export function signatureRefutes(node: PublishedNode): boolean {
  const { content_signature, signed_payload_json, signing_device_public_key } =
    node;
  if (
    content_signature === undefined ||
    signed_payload_json === undefined ||
    signing_device_public_key === undefined
  ) {
    return false;
  }

  const payload = parseObject(signed_payload_json);
  if (payload === null) return false;
  if (payload.type !== NodeSignedPayloadV1Schema.shape.type.value) return false;

  const claim = NodeSignedPayloadV1Schema.safeParse(payload);
  if (!claim.success) return true;
  if (!aboutThisNode(claim.data, node)) return true;

  // The parsed object rather than the schema's output: a signature is over the
  // canonical form of what was sent, and zod strips what it does not declare.
  return !verifySignedPayload({
    payload,
    signature: content_signature,
    publicKeyMultibase: signing_device_public_key,
  });
}

function aboutThisNode(
  claim: ReturnType<typeof NodeSignedPayloadV1Schema.parse>,
  node: PublishedNode,
): boolean {
  const { did, localId } = splitOwnedRef(node.ref);
  return (
    claim.did === did &&
    claim.node_id === localId &&
    claim.address === node.address &&
    claim.title === node.title &&
    claim.created_at === node.created_at
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
