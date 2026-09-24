// Which keys a syr identity's instance says it has approved to sign content.
// docs/ARCHITECTURE.md § "Who a person is".

import type { BoundKey, Principal, TrustedInstance } from "@sloppy/types";
import { DidSyrSchema } from "@sloppy/types";
import type { HostPolicy } from "../media/remote-host";
import {
  type DelegationEntry,
  type SyrService,
  normalizeInstanceUrl,
} from "../syr/syr.service";

/**
 * The keys that sign for this identity, as the instance at `at` lists them.
 *
 * syr's own binding answers the root key, which signs DELEGATIONS and never
 * content, so enumerating what it has approved is a fetch — and the address it
 * is made to is the caller's to choose, never one taken off the content being
 * weighed. `null` is an instance that said nothing, which is not an identity
 * with no key: the listing is read for its own state, and a delegation that has
 * been revoked or has run out is one that no longer signs for anybody.
 */
export async function approvedKeysFor(
  syr: SyrService,
  principal: Principal,
  at: TrustedInstance,
  reach?: HostPolicy,
): Promise<readonly BoundKey[] | null> {
  if (!DidSyrSchema.safeParse(principal).success) return null;
  const instance = await syr.providerFor(
    normalizeInstanceUrl(at.url),
    principal,
    reach,
  );
  if (instance === null) return null;
  const listing = await syr.listDelegations(instance, principal, reach);
  if (listing === null) return null;
  return listing.filter(stillStands).map((entry) => ({
    scheme: "ed25519-multibase",
    key: entry.delegate_public_key,
    signs: "content",
    from: instance,
  }));
}

/** Absent `revoked_at` and absent `expires_at` both mean it still stands. */
function stillStands(entry: DelegationEntry): boolean {
  if (entry.revoked_at !== undefined) return false;
  return (
    entry.expires_at === undefined || Date.parse(entry.expires_at) > Date.now()
  );
}
