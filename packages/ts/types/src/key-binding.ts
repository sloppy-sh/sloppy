// Which key speaks for an identifier, what scheme a signature is in, and
// whose the row it arrived on is — docs/ARCHITECTURE.md § "Who a person is".

import { z } from "zod";
import type { Principal, PrincipalScheme } from "./common.js";
import { principalScheme } from "./common.js";
import type { InstanceHint } from "./vouch.js";

/**
 * What a signature is in — the schemes this build can name.
 *
 * - `ed25519-multibase` — Ed25519 over the payload's canonical form, the key
 *   multibase-encoded beside it. **This is what an absent tag means**, and it
 *   is every signature written before there was a tag.
 * - `openpgp` — somebody's own OpenPGP key over the same payload, checked by
 *   `@sloppy/openpgp`.
 */
export const SignatureSchemeSchema = z.enum(["ed25519-multibase", "openpgp"]);
export type SignatureScheme = z.infer<typeof SignatureSchemeSchema>;

/**
 * What a signed row carries beside the signature: the scheme's name, bounded
 * but not enumerated.
 *
 * A signature in a scheme a reader has never heard of must arrive whole rather
 * than take the row down with it — the rule `BlockDocumentSchema` already
 * carries for an element kind, for the same reason. **Absent is
 * `ed25519-multibase`**; {@link signatureSchemeOf} is the one reader of that.
 */
export const SignatureSchemeTagSchema = z.string().min(1).max(64);

/** The three columns a signature travels in, wherever one does. */
export interface SignedContent {
  readonly content_signature?: string;
  readonly signed_payload_json?: string;
  readonly signing_device_public_key?: string;
  readonly signature_scheme?: string;
}

/**
 * Which scheme a signature is in. **`undefined` is a scheme this build cannot
 * name**, which is a signature it cannot check and never one it has found
 * wrong.
 */
export function signatureSchemeOf(
  signed: Pick<SignedContent, "signature_scheme">,
): SignatureScheme | undefined {
  if (signed.signature_scheme === undefined) return "ed25519-multibase";
  const named = SignatureSchemeSchema.safeParse(signed.signature_scheme);
  return named.success ? named.data : undefined;
}

/**
 * What a bound key signs.
 *
 * - `content` — this key signs a note or a comment itself, so a signature is
 *   checked against it.
 * - `delegations` — this key stands behind the keys that do. A signature is
 *   checked against a key this one has approved, never against this one, which
 *   is why holding it is not yet knowing whose a signature is.
 */
export const KeySigningSchema = z.enum(["content", "delegations"]);
export type KeySigning = z.infer<typeof KeySigningSchema>;

/** One key that speaks for a principal. */
export interface BoundKey {
  /** The scheme the key is in, and so the scheme of a signature it checks. */
  readonly scheme: SignatureScheme;
  /** The key, spelled the way its scheme spells one. */
  readonly key: string;
  readonly signs: KeySigning;
  /** Where the binding was read, which is what a `Vouch` records as its
   *  instance. Absent where the identifier IS the key and nothing was
   *  fetched. */
  readonly from?: InstanceHint;
}

/**
 * Which key speaks for an identifier right now.
 *
 * This is the question a signature check cannot answer out of the payload it is
 * checking: the key arrives WITH the signature, so verifying says the content
 * has not been altered and says nothing about who signed it. One implementation
 * per principal scheme answers it — syr from the identifier itself, an email
 * address by fetching — and a caller reaches the right one through
 * {@link bindingFor} rather than by knowing which schemes exist.
 */
export interface KeyBinding {
  /** The principal scheme this answers for, and only this one. */
  readonly scheme: PrincipalScheme;
  /**
   * **`null` is a binding that did not answer**, which is never the same as an
   * identifier nobody holds a key for: an empty list is that, and it is an
   * answer. A principal in another scheme is `null` too — nothing was asked.
   */
  keysFor(principal: Principal): Promise<readonly BoundKey[] | null>;
}

/** The binding for this principal's own scheme, or `undefined` where this build
 *  holds none for it. */
export function bindingFor(
  principal: Principal,
  bindings: readonly KeyBinding[],
): KeyBinding | undefined {
  const scheme = principalScheme(principal);
  if (scheme === undefined) return undefined;
  return bindings.find((binding) => binding.scheme === scheme);
}

/**
 * Whose a signed row is, once the key that signed it has been weighed against
 * the keys its named author holds.
 *
 * - `theirs` — the signature checks out under a key that author holds.
 * - `unattributed` — it checks out, and nothing shows that author holds the key
 *   it checks out under. **An instance that did not answer lands here, and so
 *   does a key its author has since rotated away**: a listing says what signs
 *   now and a signature was made then. Not an accusation, and never drawn as
 *   one.
 * - `refuted` — the row does not say what it was signed saying. The one thing
 *   a reader can show without asking anybody, and the only thing a copy is
 *   dropped over.
 *
 * Asked rather than read off a claim, the rule a vouch is held to: no column a
 * peer can write says this, because a forger would write it.
 */
export const AttributionSchema = z.enum(["theirs", "unattributed", "refuted"]);
export type Attribution = z.infer<typeof AttributionSchema>;
