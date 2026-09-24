// Checking a signature in the scheme the row it arrived on names.
// docs/ARCHITECTURE.md § "Who a person is".

import { type JsonValue, canonicalize, verifySignedPayload } from "@sloppy/idp";
import { verifyOpenPgpSignature } from "@sloppy/openpgp";
import type { SignatureScheme } from "@sloppy/types";

/**
 * Whether this signature checks out over this payload.
 *
 * **What a signature is over is the payload's canonical form, in every
 * scheme.** A row carries the payload it was signed with, and a reader
 * canonicalises what it parsed rather than trusting the spelling it arrived
 * in — so a signer signs the canonical form or signs something no reader
 * reconstructs.
 *
 * A scheme this build cannot name never reaches here: `signatureSchemeOf`
 * answers `undefined` for one, and its caller holds the row rather than
 * calling a signature it cannot read wrong.
 */
export function signatureChecksOut(params: {
  scheme: SignatureScheme;
  payload: Record<string, unknown>;
  signature: string;
  publicKey: string;
}): Promise<boolean> {
  switch (params.scheme) {
    case "ed25519-multibase":
      return Promise.resolve(
        verifySignedPayload({
          payload: params.payload,
          signature: params.signature,
          publicKeyMultibase: params.publicKey,
        }),
      );
    case "openpgp":
      return verifyOpenPgpSignature({
        payload: canonicalize(params.payload as JsonValue),
        signature: params.signature,
        publicKey: params.publicKey,
      });
  }
}
