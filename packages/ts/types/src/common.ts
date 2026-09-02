// What every stored row carries, and how an owner is named. Everything else in
// this package builds on these.

import { RecordId } from "surrealdb";
import { z } from "zod";

// Annotated rather than inferred: surrealdb exports `RecordId` as an alias for
// a class it does not export, so an inferred type spells the class out inline
// and declaration emit fails on its private fields (TS4094).
export const RecordIdSchema: z.ZodType<RecordId> = z.instanceof(RecordId, {
  message: "Expected a SurrealDB RecordId",
});

/**
 * ISO-8601 UTC at fixed millisecond precision — the one encoding a timestamp
 * has in the row, on the wire, and inside a signed payload. The precision is
 * pinned rather than merely permitted; docs/ARCHITECTURE.md § "Data model" says
 * why there is only the one encoding, and why it is one width.
 */
export const TimestampSchema = z.iso.datetime({ precision: 3 });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** The one mint for `created_at` and `updated_at`. */
export function nowIso(): Timestamp {
  return new Date().toISOString();
}

/**
 * Somebody else's ISO-8601 timestamp, brought to the width above. A peer's
 * instance writes whatever precision it likes, and a listing that failed to
 * parse over a missing millisecond would be a whole conversation lost to a
 * digit. The caller must have validated the string as a datetime first.
 */
export function asTimestamp(value: string): Timestamp {
  return new Date(value).toISOString();
}

/**
 * A syr identity. The method-specific part is a multibase base58btc-encoded
 * Ed25519 public key, so the DID is the key rather than a lookup into one.
 */
export const DidSyrSchema = z
  .string()
  .regex(
    /^did:syr:z[1-9A-HJ-NP-Za-km-z]+$/,
    "Expected a did:syr identifier, e.g. did:syr:z6Mkt9…",
  );
export type DidSyr = z.infer<typeof DidSyrSchema>;

/** Crockford base32, as `ulid()` emits it. */
export const UlidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Expected a ULID");
export type Ulid = z.infer<typeof UlidSchema>;

/**
 * How one row points at another: `<did>/<ulid>`, deliberately a string and not
 * the SurrealDB record link it looks like it should be. docs/ARCHITECTURE.md
 * § "Data model" says why.
 */
export const OwnedRefSchema = z
  .string()
  .regex(
    /^did:syr:z[1-9A-HJ-NP-Za-km-z]+\/[0-9A-HJKMNP-TV-Z]{26}$/,
    "Expected a <did>/<ulid> reference",
  );
export type OwnedRef = z.infer<typeof OwnedRefSchema>;

/**
 * How an identity store names a record of its own: `<did>:<local id>`. This is
 * the form syr writes into a comment thread's ancestor chain, so a reply and an
 * ancestor compare as strings without either side taking one apart. The local
 * half is the issuing store's to mint, is not a ULID on every instance, and may
 * carry colons of its own — which is why this is not an `OwnedRef`, and why
 * `splitStoreRef`, the one place it is taken apart, matches the DID rather than
 * counting colons.
 */
export const StoreRefSchema = z
  .string()
  .regex(
    /^did:syr:z[1-9A-HJ-NP-Za-km-z]+:.+$/,
    "Expected a <did>:<local id> reference",
  );
export type StoreRef = z.infer<typeof StoreRefSchema>;

export const BaseEntitySchema = z.object({
  id: RecordIdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/**
 * A row somebody owns. `created_by` repeats the owner half of the composite
 * record id as a flat, immutable column, and it is the column the per-user
 * purge deletes by; docs/ARCHITECTURE.md § "Data model" says why the flat copy
 * and that sweep are both necessary.
 */
export const OwnedEntitySchema = BaseEntitySchema.extend({
  created_by: DidSyrSchema,
});
export type OwnedEntity = z.infer<typeof OwnedEntitySchema>;
