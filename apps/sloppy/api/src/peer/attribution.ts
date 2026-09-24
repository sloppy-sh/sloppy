// Whose a published note is, as far as a reader can be shown.

import {
  type Attribution,
  type NodeSignedPayload,
  NodeSignedPayloadSchema,
  type OwnedRef,
  type Principal,
  type PublishedNode,
  nodePayloadVersionOf,
  signatureSchemeOf,
  splitOwnedRef,
} from "@sloppy/types";
import { type SignedClaim, attributionOf } from "../identity/attribution";
import type {
  AskWhoHolds,
  Keyholdings,
} from "../identity/identity-keys.service";

/**
 * What a reader makes of each signed note on a page — its author's, nobody's
 * that can be shown, or not the author's at all.
 *
 * **A note carrying no signature is absent from the answer**, which is the
 * ordinary state of one and says nothing either way. So is one signed in a
 * scheme, or under a payload version, this build cannot name: what it cannot
 * check it holds, rather than presenting as altered.
 *
 * **`ask` is made at most once, and only where a page carries a signature worth
 * weighing** — docs/ARCHITECTURE.md § "Whose a signed row is".
 */
export async function attributeNodes(
  nodes: readonly PublishedNode[],
  ask: AskWhoHolds,
): Promise<ReadonlyMap<OwnedRef, Attribution>> {
  const said = new Map<OwnedRef, Attribution>();
  let held: Keyholdings | undefined;
  for (const node of nodes) {
    const read = readSignature(node);
    if (read === undefined) continue;
    if (read === "refuted") {
      said.set(node.ref, "refuted");
      continue;
    }
    held ??= await ask();
    said.set(
      node.ref,
      await attributionOf(read.claim, held.get(read.author) ?? null),
    );
  }
  return said;
}

/**
 * What the row alone settles: nothing to weigh, a statement that contradicts
 * the note it arrived on, or a signature still to be weighed against somebody's
 * keys.
 */
function readSignature(
  node: PublishedNode,
):
  | undefined
  | "refuted"
  | { readonly claim: SignedClaim; readonly author: Principal } {
  const { content_signature, signed_payload_json, signing_device_public_key } =
    node;
  if (
    content_signature === undefined ||
    signed_payload_json === undefined ||
    signing_device_public_key === undefined
  ) {
    return undefined;
  }
  const scheme = signatureSchemeOf(node);
  if (scheme === undefined) return undefined;

  const payload = parseObject(signed_payload_json);
  if (payload === null) return undefined;
  if (nodePayloadVersionOf(payload) === undefined) return undefined;

  const said = NodeSignedPayloadSchema.safeParse(payload);
  if (!said.success) return "refuted";
  const { owner, localId } = splitOwnedRef(node.ref);
  if (!claimsThisNote(said.data, node, owner, localId)) return "refuted";

  return {
    // The parsed object rather than the schema's output: a signature is over
    // the canonical form of what was sent, and zod strips what it does not
    // declare.
    claim: {
      scheme,
      payload,
      signature: content_signature,
      publicKey: signing_device_public_key,
    },
    author: owner,
  };
}

/**
 * Whether the statement that was signed is about the note it arrived on.
 *
 * A `v1` statement names a `did:syr`, so a note owned by an address can carry
 * none that is about itself and carries a `v2` instead. **A `v2` with no
 * address is a claim about a note its author gave no label** — it matches one
 * that has none, and never one that happens to sit at an address.
 */
function claimsThisNote(
  claim: NodeSignedPayload,
  node: PublishedNode,
  owner: Principal,
  localId: string,
): boolean {
  const who = claim.type === "sloppy-node@v1" ? claim.did : claim.principal;
  return (
    who === owner &&
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
