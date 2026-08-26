// How a key becomes a name. `did:syr:` is multibase base58btc over the
// multicodec-prefixed raw key, so the DID *is* the public key and a stranger
// can verify a signature from the identifier alone.

const BASE58BTC = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58BTC_VALUES = new Map(
  [...BASE58BTC].map((character, value) => [character, value]),
);

/** varint 0xed — Ed25519 public key. */
export const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
/** varint 0x1300 — Ed25519 private key. */
export const ED25519_PRIV_MULTICODEC_PREFIX = new Uint8Array([0x80, 0x26]);

function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros++;
  }
  const digits: number[] = [];
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let d = 0; d < digits.length; d++) {
      carry += digits[d] << 8;
      digits[d] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(leadingZeros);
  for (let d = digits.length - 1; d >= 0; d--) out += BASE58BTC[digits[d]];
  return out;
}

function base58Decode(text: string): Uint8Array {
  let leadingZeros = 0;
  while (leadingZeros < text.length && text[leadingZeros] === "1") {
    leadingZeros++;
  }
  const bytes: number[] = [];
  for (let i = leadingZeros; i < text.length; i++) {
    const value = BASE58BTC_VALUES.get(text[i]);
    if (value === undefined) {
      throw new Error(`Not base58btc: ${JSON.stringify(text[i])}`);
    }
    let carry = value;
    for (let b = 0; b < bytes.length; b++) {
      carry += bytes[b] * 58;
      bytes[b] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let b = 0; b < bytes.length; b++) {
    out[leadingZeros + bytes.length - 1 - b] = bytes[b];
  }
  return out;
}

export function encodeMultibase(bytes: Uint8Array): string {
  return `z${base58Encode(bytes)}`;
}

/** `z` is the only base syr writes, so any other prefix is rejected rather
 *  than guessed at. */
export function decodeMultibase(encoded: string): Uint8Array {
  if (!encoded.startsWith("z")) {
    throw new Error(`Expected a base58btc multibase string, got ${encoded}`);
  }
  return base58Decode(encoded.slice(1));
}

function decodeKey(
  encoded: string,
  prefix: Uint8Array,
  label: string,
): Uint8Array {
  const bytes = decodeMultibase(encoded);
  const prefixed =
    bytes.length === 34 && bytes[0] === prefix[0] && bytes[1] === prefix[1];
  const raw = prefixed ? bytes.subarray(2) : bytes;
  if (raw.length !== 32) {
    throw new Error(`Expected a 32-byte ${label}, got ${raw.length} bytes`);
  }
  return raw;
}

export function encodePublicKey(raw: Uint8Array): string {
  return encodeMultibase(concat(ED25519_MULTICODEC_PREFIX, raw));
}

export function decodePublicKey(encoded: string): Uint8Array {
  return decodeKey(encoded, ED25519_MULTICODEC_PREFIX, "public key");
}

export function encodePrivateKey(raw: Uint8Array): string {
  return encodeMultibase(concat(ED25519_PRIV_MULTICODEC_PREFIX, raw));
}

export function decodePrivateKey(encoded: string): Uint8Array {
  return decodeKey(encoded, ED25519_PRIV_MULTICODEC_PREFIX, "private key");
}

export function deriveDid(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Expected a 32-byte public key, got ${publicKey.length}`);
  }
  return `did:syr:${encodePublicKey(publicKey)}`;
}

/** The Ed25519 key a `did:syr:` names. Throws on anything that is not one. */
export function publicKeyFromDid(did: string): Uint8Array {
  if (!did.startsWith("did:syr:")) {
    throw new Error(`Expected a did:syr identifier, got ${did}`);
  }
  return decodePublicKey(did.slice("did:syr:".length));
}

export function isValidSyrDid(did: string): boolean {
  try {
    publicKeyFromDid(did);
    return true;
  } catch {
    return false;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
