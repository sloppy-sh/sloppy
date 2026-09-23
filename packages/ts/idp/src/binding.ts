// Which key speaks for a `did:syr` — the syr arm of `KeyBinding`.
// docs/ARCHITECTURE.md § "Who a person is".

import {
  type BoundKey,
  DidSyrSchema,
  type KeyBinding,
  type Principal,
} from "@sloppy/types";
import { encodePublicKey, publicKeyFromDid } from "./encoding.js";

/**
 * syr answers from the identifier itself: the method-specific part IS the root
 * public key, so nothing is fetched and nothing can be unreachable.
 *
 * That key signs DELEGATIONS and never content. What signs a note is a key the
 * person's instance holds under a delegation this one approved, so holding this
 * is not yet knowing whose a note's signature is — a reader would need the
 * instance's own listing of what it has approved, which is a fetch, and which
 * is why `peer/attribution.ts` still says a signature that verifies says only
 * that the note has not been altered.
 */
export const syrKeyBinding: KeyBinding = {
  scheme: "did:syr",
  keysFor(principal: Principal): Promise<readonly BoundKey[] | null> {
    if (!DidSyrSchema.safeParse(principal).success) {
      return Promise.resolve(null);
    }
    try {
      return Promise.resolve([
        {
          scheme: "ed25519-multibase",
          key: encodePublicKey(publicKeyFromDid(principal)),
          signs: "delegations",
        },
      ]);
    } catch {
      return Promise.resolve(null);
    }
  },
};
