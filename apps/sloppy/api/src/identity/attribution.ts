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
 * **Nothing here refutes out of a listing.** A listing says what signs NOW and
 * the signature was made THEN, so a key its author has rotated away or revoked
 * is one nobody can be shown to hold — the middle answer, beside an instance
 * that said nothing and an author who publishes no key at all.
 */
export async function attributionOf(
  claim: SignedClaim,
  held: readonly BoundKey[] | null,
): Promise<Attribution> {
  if (!(await signatureChecksOut(claim))) return "refuted";
  for (const key of held ?? []) {
    if (key.signs !== "content" || key.scheme !== claim.scheme) continue;
    if (await signatureChecksOut({ ...claim, publicKey: key.key })) {
      return "theirs";
    }
  }
  return "unattributed";
}
