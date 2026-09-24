// Whose a signed row is: the signature weighed against the keys its named
// author holds. docs/ARCHITECTURE.md § "Whose a signed row is".

import type { Attribution, BoundKey, SignatureScheme } from "@sloppy/types";
import { signatureChecksOut } from "./signature";

/** One signature and what it is over, as the row it arrived on carries them. */
export interface SignedClaim {
  readonly scheme: SignatureScheme;
  readonly payload: Record<string, unknown>;
  readonly signature: string;
  /** The key that arrived WITH the content, which is nobody's until somebody
   *  is shown to hold it. */
  readonly publicKey: string;
}

/**
 * Whose this row is, given the keys its named author is known to hold.
 *
 * A key of the author's is asked to check the same signature rather than
 * compared to the one on the row: one spelling of a key is not another, and
 * what settles whose a signature is, is which key it was made with.
 *
 * **`held` being `null` and `held` holding none of this scheme's signing keys
 * come to the same answer** — {@link Attribution} carries why neither of them
 * is an accusation.
 */
export async function attributionOf(
  claim: SignedClaim,
  held: readonly BoundKey[] | null,
): Promise<Attribution> {
  if (!(await signatureChecksOut(claim))) return "refuted";
  const theirs = (held ?? []).filter(
    (key) => key.signs === "content" && key.scheme === claim.scheme,
  );
  if (theirs.length === 0) return "unattributed";
  for (const key of theirs) {
    if (await signatureChecksOut({ ...claim, publicKey: key.key })) {
      return "theirs";
    }
  }
  return "refuted";
}
