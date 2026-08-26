// One configured secret, split into the keys that must not be each other.
//
// Signing a session token and encrypting a delegate key are different jobs, and
// a key that does both leaks one compromise into the other. HKDF gives each its
// own key from the single value an operator has to set.

import { hkdfSync } from "node:crypto";

const MINIMUM_LENGTH = 32;

export interface IdpSecrets {
  /** HMAC key for session and platform access tokens. */
  tokenSigning: Buffer;
  /** Passphrase the delegate keys' Aegis bundles are sealed under. */
  delegateSealing: string;
}

export function deriveIdpSecrets(rootSecret: string): IdpSecrets {
  if (rootSecret.length < MINIMUM_LENGTH) {
    throw new Error(
      `The identity secret must be at least ${MINIMUM_LENGTH} characters`,
    );
  }
  return {
    tokenSigning: subkey(rootSecret, "sloppy-idp:token-signing:v1"),
    delegateSealing: subkey(
      rootSecret,
      "sloppy-idp:delegate-sealing:v1",
    ).toString("hex"),
  };
}

function subkey(rootSecret: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", rootSecret, new Uint8Array(0), purpose, 32),
  );
}
