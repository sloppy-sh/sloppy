// Ed25519, over raw 32-byte seeds.
//
// A "private key" here is the seed, never the 64-byte expanded form: it is what
// syr's Aegis bundle carries and what `did:syr:`'s public half is derived from,
// so a caller that hands 64 bytes to any of these has the wrong thing.

import { ed25519 } from "@noble/curves/ed25519.js";

export interface Keypair {
  publicKey: Uint8Array;
  /** 32-byte seed. Zero it with `wipe` once it has done its work. */
  privateKey: Uint8Array;
}

export function generateKeypair(): Keypair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { publicKey, privateKey: secretKey };
}

export function publicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

export function sign(
  payload: Uint8Array | string,
  privateKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(bytes(payload), privateKey);
}

export function verify(
  payload: Uint8Array | string,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, bytes(payload), publicKey);
  } catch {
    return false;
  }
}

/** Overwrite key material in place. Callers do this in a `finally`, so that a
 *  throw between generating a key and storing it still leaves nothing behind. */
export function wipe(secret: Uint8Array): void {
  secret.fill(0);
}

function bytes(payload: Uint8Array | string): Uint8Array {
  return typeof payload === "string"
    ? new TextEncoder().encode(payload)
    : payload;
}
