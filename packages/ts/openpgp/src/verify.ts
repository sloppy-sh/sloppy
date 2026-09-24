// Checking an OpenPGP signature the way a stranger would: the payload, the
// signature, the key, and nothing else.
// docs/ARCHITECTURE.md § "Who a person is".

import {
  createMessage,
  type PublicKey,
  readKey,
  type Signature,
  readSignature,
  verify,
} from "openpgp";

/**
 * Whether this key signed these exact bytes.
 *
 * A string payload is its UTF-8 bytes, which is what the signature is over; a
 * string signature or key is the armoured form, a `Uint8Array` the binary one.
 * Nothing is fetched and no key is discovered — the caller has already decided
 * which key it is asking about, so **a signature that checks out says the
 * payload has not been altered, and never whose key this is.**
 *
 * The key is weighed as it stood when the signature was made: one that has
 * expired since still checks out, while a revoked one never does, however old
 * the signature. A detached signature may carry several signatures, and one of
 * them checking out under this key is enough.
 */
export async function verifyOpenPgpSignature(params: {
  payload: string | Uint8Array;
  signature: string | Uint8Array;
  publicKey: string | Uint8Array;
}): Promise<boolean> {
  try {
    const { signatures } = await verify({
      message: await createMessage({ binary: bytesOf(params.payload) }),
      signature: await detachedSignature(params.signature),
      verificationKeys: await publicKeyOf(params.publicKey),
      format: "binary",
    });
    // Each rejection is handled in the same turn it is made. Awaiting them one
    // at a time leaves the others unhandled, which ends the process rather than
    // the check.
    const checked = await Promise.all(
      signatures.map((one) => one.verified.then(() => true).catch(() => false)),
    );
    return checked.some((ok) => ok);
  } catch {
    return false;
  }
}

function bytesOf(payload: string | Uint8Array): Uint8Array {
  return typeof payload === "string"
    ? new TextEncoder().encode(payload)
    : payload;
}

/**
 * Whether this key can sign NOW, and signed these exact bytes for something
 * issued between `notBefore` and `notAfter`.
 *
 * Attribution and authentication ask different questions of one signature.
 * {@link verifyOpenPgpSignature} weighs a key as it stood when the signature
 * says it was made, which is what reading old content needs: a note somebody
 * signed in 2019 is still theirs after the key expired. A credential is the
 * other way round — the key must be one its owner has not retired, and the
 * signature must have been made for the statement in front of us.
 *
 * **A signature's creation time is chosen by whoever makes it**, so the window
 * is not itself proof of freshness. It is what closes the gap the two rules
 * leave between them: dated now, a retired key fails because the key is judged
 * at that instant; dated back inside the key's old validity, it fails the
 * window. Neither check alone refuses both.
 */
export async function verifyOpenPgpCredential(params: {
  payload: string | Uint8Array;
  signature: string | Uint8Array;
  publicKey: string | Uint8Array;
  notBefore: Date;
  notAfter: Date;
}): Promise<boolean> {
  try {
    const key = await publicKeyOf(params.publicKey);
    if (await key.isRevoked()) return false;
    const expires = await key.getExpirationTime();
    if (expires instanceof Date && expires <= new Date()) return false;

    const { signatures } = await verify({
      message: await createMessage({ binary: bytesOf(params.payload) }),
      signature: await detachedSignature(params.signature),
      verificationKeys: key,
      format: "binary",
    });
    // Each rejection is handled in the turn it is made, as above: every
    // callback runs to its first `await` before any of them resumes.
    const checked = await Promise.all(
      signatures.map(async (one) => {
        try {
          await one.verified;
          const made = (await one.signature).packets[0]?.created;
          return (
            made instanceof Date &&
            made >= params.notBefore &&
            made <= params.notAfter
          );
        } catch {
          return false;
        }
      }),
    );
    return checked.some((ok) => ok);
  } catch {
    return false;
  }
}

/** The public half alone, so a key handed in with a secret half leaves none of
 *  it here: AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store". */
async function publicKeyOf(key: string | Uint8Array): Promise<PublicKey> {
  const read =
    typeof key === "string"
      ? await readKey({ armoredKey: key })
      : await readKey({ binaryKey: key });
  return read.toPublic();
}

function detachedSignature(signature: string | Uint8Array): Promise<Signature> {
  return typeof signature === "string"
    ? readSignature({ armoredSignature: signature })
    : readSignature({ binarySignature: signature });
}
