// Whether two spellings name one key.
// docs/ARCHITECTURE.md § "Whose a signed row is".

import { decodePublicKey } from "@sloppy/idp";
import { openPgpFingerprint } from "@sloppy/openpgp";
import type { SignatureScheme } from "@sloppy/types";

/**
 * Whether these two name the same key, each read the way its scheme reads one.
 *
 * **Spelling is not identity**: one Ed25519 key has more than one multibase
 * spelling, and one OpenPGP key arrives armoured or binary, with whatever user
 * IDs and signatures were bundled around it. So each side is taken down to what
 * it actually is — the key's own bytes, or its fingerprint — and those are
 * compared. Anything neither side can be read as is not a match, never a throw.
 */
export async function sameKey(
  scheme: SignatureScheme,
  one: string,
  other: string,
): Promise<boolean> {
  if (one === other) return true;
  try {
    switch (scheme) {
      case "ed25519-multibase": {
        const a = decodePublicKey(one);
        const b = decodePublicKey(other);
        return a.length === b.length && a.every((byte, at) => byte === b[at]);
      }
      case "openpgp": {
        const a = await openPgpFingerprint(one);
        return a !== null && a === (await openPgpFingerprint(other));
      }
    }
  } catch {
    return false;
  }
}
