// A delegate seed at rest, sealed under this instance's own key.
//
// Deliberately not Aegis: Argon2id stretches a low-entropy human password, and
// `secrets.ts` hands this a 256-bit key that never leaves the process. The
// stretch would defend nothing and would be paid on every signature. The root
// seed, which a password really does guard, stays in Aegis and stays syr's.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const ADDITIONAL_DATA = Buffer.from("sloppy-idp:delegate-seal:v1");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SEED_BYTES = 32;

const Base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/, "Expected base64url");

/** AES-256-GCM. It never crosses the wire, so it negotiates no parameters:
 *  the one instance that wrote it is the only one that opens it. */
export const SealedSeedSchema = z.object({
  nonce: Base64UrlSchema,
  ct: Base64UrlSchema,
  tag: Base64UrlSchema,
});
export type SealedSeed = z.infer<typeof SealedSeedSchema>;

export function sealSeed(seed: Uint8Array, key: Buffer): SealedSeed {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`A delegate seed must be ${SEED_BYTES} bytes`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(ADDITIONAL_DATA);
  const ct = Buffer.concat([cipher.update(seed), cipher.final()]);
  return {
    nonce: nonce.toString("base64url"),
    ct: ct.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

/** The seed, which the caller owns and must wipe. */
export function openSeed(sealed: SealedSeed, key: Buffer): Uint8Array {
  const parsed = SealedSeedSchema.parse(sealed);
  const nonce = Buffer.from(parsed.nonce, "base64url");
  const tag = Buffer.from(parsed.tag, "base64url");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES)
    throw willNotOpen();
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(ADDITIONAL_DATA);
  decipher.setAuthTag(tag);
  try {
    const seed = Buffer.concat([
      decipher.update(Buffer.from(parsed.ct, "base64url")),
      decipher.final(),
    ]);
    if (seed.length !== SEED_BYTES) throw willNotOpen();
    return new Uint8Array(seed);
  } catch {
    throw willNotOpen();
  }
}

/** Run `action` with the opened seed and wipe it afterwards, so the seed never
 *  outlives the call that needed it — including when `action` throws. */
export function withSealedSeed<T>(
  sealed: SealedSeed,
  key: Buffer,
  action: (seed: Uint8Array) => T,
): T {
  const seed = openSeed(sealed, key);
  try {
    return action(seed);
  } finally {
    seed.fill(0);
  }
}

function willNotOpen(): Error {
  return new Error(
    "A delegate key will not open under this instance's identity secret",
  );
}
