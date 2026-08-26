// Aegis (CIGP v1) — how a 32-byte Ed25519 seed is held at rest.
//
// This is syr's at-rest format, reproduced byte for byte: Argon2id over the
// NFKC-normalized password, AES-256-GCM with the additional data `cigp:v1`,
// every field base64url with no padding. It is not a wire shape, but a bundle
// written here has to open on a syr instance and vice versa, so none of the
// constants below are ours to tune.

import { argon2id } from "@noble/hashes/argon2.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { encodePublicKey } from "./encoding.js";
import { publicKeyFromPrivateKey } from "./keys.js";

const ADDITIONAL_DATA = Buffer.from("cigp:v1");
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const SEED_BYTES = 32;

const KDF = { mem: 65536, it: 3, par: 1 } as const;

// A bundle carries the parameters it was written with, so one written by
// another instance opens here. Bounded because deriving a key is the one thing
// a caller can make arbitrarily expensive by lying about them.
const KDF_LIMITS = { mem: 1024 * 1024, it: 10, par: 16 } as const;

const Base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/, "Expected base64url");

export const AegisBundleSchema = z.object({
  /** Multibase public key of the seed inside — a label, never the authority. */
  pub: z.string().min(1),
  salt: Base64UrlSchema,
  nonce: Base64UrlSchema,
  ct: Base64UrlSchema,
  tag: Base64UrlSchema,
  kdf: z.object({
    mem: z.int().positive().max(KDF_LIMITS.mem),
    it: z.int().positive().max(KDF_LIMITS.it),
    par: z.int().positive().max(KDF_LIMITS.par),
  }),
});
export type AegisBundle = z.infer<typeof AegisBundleSchema>;

export class AegisDecryptionError extends Error {
  constructor() {
    super("Aegis decryption failed: wrong password or corrupted bundle");
    this.name = "AegisDecryptionError";
  }
}

function deriveKey(
  password: string,
  salt: Uint8Array,
  kdf: AegisBundle["kdf"],
): Uint8Array {
  return argon2id(password.normalize("NFKC"), salt, {
    t: kdf.it,
    m: kdf.mem,
    p: kdf.par,
    dkLen: KEY_BYTES,
  });
}

export function createAegisBundle(
  seed: Uint8Array,
  password: string,
): AegisBundle {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`Aegis seed must be ${SEED_BYTES} bytes`);
  }
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(password, salt, KDF);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(ADDITIONAL_DATA);
    const ct = Buffer.concat([cipher.update(seed), cipher.final()]);
    return {
      pub: encodePublicKey(publicKeyFromPrivateKey(seed)),
      salt: salt.toString("base64url"),
      nonce: nonce.toString("base64url"),
      ct: ct.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      kdf: { ...KDF },
    };
  } finally {
    key.fill(0);
  }
}

/** The seed, which the caller owns and must wipe. Throws
 *  `AegisDecryptionError` for a wrong password and for a tampered bundle
 *  alike — the two are not distinguishable, and telling them apart is what an
 *  attacker would want. */
export function decryptAegisBundle(
  bundle: AegisBundle,
  password: string,
): Uint8Array {
  const parsed = AegisBundleSchema.parse(bundle);
  const salt = Buffer.from(parsed.salt, "base64url");
  const nonce = Buffer.from(parsed.nonce, "base64url");
  const ct = Buffer.from(parsed.ct, "base64url");
  const tag = Buffer.from(parsed.tag, "base64url");
  if (salt.length < 8 || nonce.length !== NONCE_BYTES || tag.length !== 16) {
    throw new AegisDecryptionError();
  }
  const key = deriveKey(password, salt, parsed.kdf);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(ADDITIONAL_DATA);
    decipher.setAuthTag(tag);
    const seed = Buffer.concat([decipher.update(ct), decipher.final()]);
    if (seed.length !== SEED_BYTES) throw new AegisDecryptionError();
    return new Uint8Array(seed);
  } catch {
    throw new AegisDecryptionError();
  } finally {
    key.fill(0);
  }
}

/** Run `action` with the decrypted seed and wipe it afterwards, so the seed
 *  never outlives the call that needed it — including when `action` throws. */
export function withSeed<T>(
  bundle: AegisBundle,
  password: string,
  action: (seed: Uint8Array) => T,
): T {
  const seed = decryptAegisBundle(bundle, password);
  try {
    return action(seed);
  } finally {
    seed.fill(0);
  }
}

/** Burn the same work an unlock would, so a caller cannot learn from response
 *  time whether an account exists. */
export function dummyUnlock(): void {
  deriveKey("", new Uint8Array(SALT_BYTES), KDF).fill(0);
}
