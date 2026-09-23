// Whether anybody stands behind an identity — docs/ARCHITECTURE.md § "Who may
// write where".

import {
  type DidSyr,
  DidSyrSchema,
  OwnedEntitySchema,
  type Timestamp,
  TimestampSchema,
} from "./common.js";
import { z } from "zod";

/**
 * What resolving an identity said about whether anybody stands behind it.
 *
 * **Derived by resolution, never read off a claim.** Nothing a writer says
 * about itself decides this, and no column a peer can write carries it.
 *
 * - `vouched` — an instance serving this identity holds authority its root key
 *   approved, and that authority still stands.
 * - `anonymous` — resolution answered, and nobody holds any. An identity minted
 *   on a device is this, and owns freely there.
 * - `unknown` — nothing answered just now. **It grants no authority an identity
 *   did not already carry, and takes none away**, because an instance having a
 *   bad afternoon is not a statement about anybody.
 */
export const VouchStateSchema = z.enum(["vouched", "anonymous", "unknown"]);
export type VouchState = z.infer<typeof VouchStateSchema>;

/** The two states resolution settles on. `unknown` is the absence of an answer,
 *  so nothing remembers it. */
export const AnsweredVouchSchema = z.enum(["vouched", "anonymous"]);
export type AnsweredVouch = z.infer<typeof AnsweredVouchSchema>;

/**
 * Where an identity's record may be found.
 *
 * **Untrusted.** A `did:syr` binds a key and no host, so this says where to
 * look and nothing more: a wrong or hostile one can only fail to resolve, and
 * can never make a resolution say yes.
 */
export const InstanceHintSchema = z.string().min(1).max(2048);
export type InstanceHint = z.infer<typeof InstanceHintSchema>;

/** What resolution answered about one identity, and when. */
export const VouchSchema = z.object({
  did: DidSyrSchema,
  state: VouchStateSchema,
  /** Where the record was read. Absent where nothing was reached, and on an
   *  identity known anonymous without asking anybody. */
  instance: InstanceHintSchema.optional(),
  at: TimestampSchema,
});
export type Vouch = z.infer<typeof VouchSchema>;

/**
 * An identity this person's instance has written down: where to look for its
 * record, and what resolution last settled on.
 *
 * `created_by` is whoever wrote it down — their own address book, swept with
 * them. The row is written by resolution here and by nobody else.
 */
export const KnownIdentitySchema = OwnedEntitySchema.extend({
  did: DidSyrSchema,
  /** Absent is an identity nobody said where to look for, which resolves to
   *  `unknown` rather than to `anonymous`. */
  instance: InstanceHintSchema.optional(),
  /** What resolution last settled on. **Absent is an identity nobody has
   *  resolved yet**, and an `unknown` never writes over it. */
  vouch: AnsweredVouchSchema.optional(),
  /** When it settled. Absent wherever `vouch` is. */
  checked_at: TimestampSchema.optional(),
});
export type KnownIdentity = z.infer<typeof KnownIdentitySchema>;

/**
 * Resolving an identity. The one thing that answers whether anybody stands
 * behind a DID.
 *
 * A caller reads {@link Vouch}`.state` and nothing else, so the mandate chain —
 * root, then agent, then whoever holds the grant — lands here as a different
 * reading rather than as a change to everything that asks. The hint is
 * untrusted metadata the resolver may start from; what it answers is read off
 * the identity's own record.
 */
export interface VouchResolver {
  vouchFor(did: DidSyr, hint?: InstanceHint): Promise<Vouch>;
}

/** One statement of authority as an instance serves it. Absent `revoked_at` and
 *  absent `expires_at` both mean it still stands. */
export interface VouchGrant {
  readonly revoked_at?: string;
  readonly expires_at?: string;
}

/**
 * What a listing of the authority held for an identity comes to.
 *
 * **`null` is an instance that did not answer**, which is `unknown` and never
 * `anonymous`. A listing that answered with nothing standing is an identity
 * nobody stands behind.
 */
export function vouchFrom(
  did: DidSyr,
  instance: InstanceHint | undefined,
  listing: readonly VouchGrant[] | null,
  at: Timestamp,
): Vouch {
  if (listing === null) return { did, state: "unknown", at };
  const now = Date.parse(at);
  const stands = listing.some(
    (grant) =>
      !grant.revoked_at &&
      !(grant.expires_at && Date.parse(grant.expires_at) <= now),
  );
  return {
    state: stands ? "vouched" : "anonymous",
    did,
    ...(instance === undefined ? {} : { instance }),
    at,
  };
}

/**
 * An identity minted here, on this device. There is no instance to ask and the
 * answer is not in doubt: nobody stands behind it, and on the device that
 * minted it nothing asks anybody to.
 */
export function anonymousVouch(did: DidSyr, at: Timestamp): Vouch {
  return { did, state: "anonymous", at };
}

/**
 * The answer to act on: what resolution just said, or — where it said nothing —
 * what it last settled on. One function, so no surface decides on its own that
 * an unreachable instance means somebody lost their access.
 */
export function standingVouch(
  resolved: Vouch,
  remembered: Pick<KnownIdentity, "vouch" | "checked_at"> | undefined,
): Vouch {
  if (resolved.state !== "unknown") return resolved;
  if (!remembered?.vouch || !remembered.checked_at) return resolved;
  return {
    ...resolved,
    state: remembered.vouch,
    at: remembered.checked_at,
  };
}
