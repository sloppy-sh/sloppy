// Sigil (PIEF v1) — how a person carries an identity between the things that
// hold one, sealed under their passphrase the whole way.
//
// This is syr's portable format, reproduced byte for byte: Argon2id over the
// NFKC-normalized passphrase, AES-256-GCM with the additional data `pief:v1`,
// every field base64url with no padding. A Sigil written by syr has to open
// here and one written here has to open there, so none of the constants below
// are ours to tune. Aegis (`aegis.ts`) is the same construction for a seed at
// rest; this one travels, so it runs where a webview can run it — no
// `node:crypto`, and `crypto.ts` carries it out to the app.

import { argon2id } from "@noble/hashes/argon2.js";
import { z } from "zod";
import { decodePublicKey, deriveDid, encodePublicKey } from "./encoding.js";
import { publicKeyFromPrivateKey } from "./keys.js";

const ADDITIONAL_DATA = new TextEncoder().encode("pief:v1");
const SALT_BYTES = 16;
const MIN_SALT_BYTES = 8;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SEED_BYTES = 32;

const KDF = { mem: 65536, it: 3, par: 1 } as const;

// A Sigil carries the parameters it was written with, so one written by
// another implementation opens here. Bounded because deriving a key is the one
// thing whoever wrote the file can make arbitrarily expensive by lying about
// them.
const KDF_LIMITS = { mem: 262144, it: 10, par: 4 } as const;

const Base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/, "Expected base64url");

export const SigilSchema = z.object({
  v: z.literal(1),
  kdf: z.object({
    name: z.literal("argon2id"),
    salt: Base64UrlSchema,
    mem: z.int().positive().max(KDF_LIMITS.mem),
    it: z.int().positive().max(KDF_LIMITS.it),
    par: z.int().positive().max(KDF_LIMITS.par),
  }),
  enc: z.object({
    name: z.literal("aes-256-gcm"),
    nonce: Base64UrlSchema,
    ct: Base64UrlSchema,
    tag: Base64UrlSchema,
  }),
  /** Multibase public key of the seed inside — a label, never the authority. */
  pub: z.string().min(1),
});
export type Sigil = z.infer<typeof SigilSchema>;

export class SigilFormatError extends Error {
  constructor() {
    super("That file is not a Sigil.");
    this.name = "SigilFormatError";
  }
}

export class SigilDecryptionError extends Error {
  constructor() {
    super("Sigil decryption failed: wrong passphrase or corrupted file");
    this.name = "SigilDecryptionError";
  }
}

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUES = new Map(
  [...BASE64URL].map((character, value) => [character, value]),
);

function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL[(accumulator >> bits) & 63];
    }
  }
  if (bits > 0) out += BASE64URL[(accumulator << (6 - bits)) & 63];
  return out;
}

function decodeBase64Url(text: string): Uint8Array {
  const out = new Uint8Array((text.length * 3) >> 2);
  let accumulator = 0;
  let bits = 0;
  let at = 0;
  for (const character of text) {
    const value = BASE64URL_VALUES.get(character);
    if (value === undefined) throw new SigilFormatError();
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (accumulator >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}

function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  kdf: { mem: number; it: number; par: number },
): Uint8Array {
  return argon2id(passphrase.normalize("NFKC"), salt, {
    t: kdf.it,
    m: kdf.mem,
    p: kdf.par,
    dkLen: KEY_BYTES,
  });
}

function aesKey(key: Uint8Array) {
  return globalThis.crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * A Sigil as it arrived, checked for shape and for a public key that is one.
 * No passphrase: the key inside is sealed, the one on the outside is not, so a
 * DID can be shown while the file stays shut.
 *
 * Takes the file, as bytes or as its text.
 */
export function readSigil(file: Uint8Array | string): Sigil {
  let said: unknown;
  try {
    said =
      typeof file === "string"
        ? JSON.parse(file)
        : JSON.parse(new TextDecoder().decode(file));
  } catch {
    throw new SigilFormatError();
  }
  const parsed = SigilSchema.safeParse(said);
  if (!parsed.success) throw new SigilFormatError();
  const sigil = parsed.data;
  if (
    decodeBase64Url(sigil.kdf.salt).length < MIN_SALT_BYTES ||
    decodeBase64Url(sigil.enc.nonce).length !== NONCE_BYTES ||
    decodeBase64Url(sigil.enc.tag).length !== TAG_BYTES
  ) {
    throw new SigilFormatError();
  }
  try {
    decodePublicKey(sigil.pub);
  } catch {
    throw new SigilFormatError();
  }
  return sigil;
}

/** The identity a Sigil is of, which is readable while it stays sealed. */
export function sigilDid(sigil: Sigil): string {
  return deriveDid(decodePublicKey(sigil.pub));
}

/** The file, as it is written out. */
export function writeSigil(sigil: Sigil): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(sigil, null, 2)}\n`);
}

export async function createSigil(
  seed: Uint8Array,
  passphrase: string,
): Promise<Sigil> {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`A Sigil seed must be ${SEED_BYTES} bytes`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = deriveKey(passphrase, salt, KDF);
  try {
    const sealed = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: ADDITIONAL_DATA },
        await aesKey(key),
        seed,
      ),
    );
    return {
      v: 1,
      kdf: {
        name: "argon2id",
        salt: encodeBase64Url(salt),
        ...KDF,
      },
      enc: {
        name: "aes-256-gcm",
        nonce: encodeBase64Url(nonce),
        ct: encodeBase64Url(sealed.subarray(0, sealed.length - TAG_BYTES)),
        tag: encodeBase64Url(sealed.subarray(sealed.length - TAG_BYTES)),
      },
      pub: encodePublicKey(publicKeyFromPrivateKey(seed)),
    };
  } finally {
    key.fill(0);
  }
}

/** The seed, which the caller owns and must wipe — {@link withSigilSeed} does.
 *  Throws `SigilDecryptionError` for a wrong passphrase and for a tampered
 *  file alike: the two are not distinguishable, and telling them apart is what
 *  an attacker would want. */
export async function openSigil(
  sigil: Sigil,
  passphrase: string,
): Promise<Uint8Array> {
  const parsed = SigilSchema.safeParse(sigil);
  if (!parsed.success) throw new SigilFormatError();
  const salt = decodeBase64Url(parsed.data.kdf.salt);
  const nonce = decodeBase64Url(parsed.data.enc.nonce);
  const ct = decodeBase64Url(parsed.data.enc.ct);
  const tag = decodeBase64Url(parsed.data.enc.tag);
  if (
    salt.length < MIN_SALT_BYTES ||
    nonce.length !== NONCE_BYTES ||
    tag.length !== TAG_BYTES
  ) {
    throw new SigilFormatError();
  }
  const sealed = new Uint8Array(ct.length + tag.length);
  sealed.set(ct);
  sealed.set(tag, ct.length);
  const key = deriveKey(passphrase, salt, parsed.data.kdf);
  let seed: Uint8Array;
  try {
    seed = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: ADDITIONAL_DATA },
        await aesKey(key),
        sealed,
      ),
    );
  } catch {
    throw new SigilDecryptionError();
  } finally {
    key.fill(0);
  }
  if (seed.length !== SEED_BYTES) {
    seed.fill(0);
    throw new SigilDecryptionError();
  }
  if (encodePublicKey(publicKeyFromPrivateKey(seed)) !== parsed.data.pub) {
    seed.fill(0);
    throw new SigilDecryptionError();
  }
  return seed;
}

/** Run `action` with the seed and wipe it afterwards, so it never outlives the
 *  act that needed it — including when `action` throws. */
export async function withSigilSeed<T>(
  sigil: Sigil,
  passphrase: string,
  action: (seed: Uint8Array) => T | Promise<T>,
): Promise<T> {
  const seed = await openSigil(sigil, passphrase);
  try {
    return await action(seed);
  } finally {
    seed.fill(0);
  }
}
