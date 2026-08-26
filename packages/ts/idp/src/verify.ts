// Checking a signature the way a stranger would.
//
// A verifier has the payload, the signature and a multibase public key, and
// nothing else — no session, no database, not even the instance that signed it.
// That is the whole claim Platform Delegation makes, so it ships as a function
// anyone can call rather than as a paragraph.

import { canonicalize, type JsonValue } from "./canonical.js";
import {
  decodeMultibase,
  decodePublicKey,
  publicKeyFromDid,
} from "./encoding.js";
import { verify } from "./keys.js";

export function verifySignedPayload(params: {
  payload: Record<string, unknown>;
  signature: string;
  publicKeyMultibase: string;
}): boolean {
  try {
    return verify(
      canonicalize(params.payload as JsonValue),
      decodeMultibase(params.signature),
      decodePublicKey(params.publicKeyMultibase),
    );
  } catch {
    return false;
  }
}

/** Whether a delegation statement really was signed by the root key its DID
 *  names. The DID *is* the root public key, so this needs nothing fetched. */
export function verifyDelegationStatement(params: {
  canonicalStatement: string;
  signature: string;
  did: string;
}): boolean {
  try {
    return verify(
      params.canonicalStatement,
      decodeMultibase(params.signature),
      publicKeyFromDid(params.did),
    );
  } catch {
    return false;
  }
}
