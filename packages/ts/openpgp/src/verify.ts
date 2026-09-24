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
 * The key is weighed as it stands NOW: one that has expired or been revoked
 * since does not verify, whenever it signed. A detached signature may carry
 * several signatures, and one of them checking out under this key is enough.
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
