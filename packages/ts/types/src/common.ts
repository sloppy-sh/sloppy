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
export type RecordIdValue = z.infer<typeof RecordIdSchema>;

export const TimestampSchema = z.instanceof(Date, {
  message: "Expected a Date",
});
export type Timestamp = z.infer<typeof TimestampSchema>;

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
 * How one row points at another: `<did>/<ulid>`.
 *
 * A string rather than a SurrealDB record link, which is the shape it looks
 * like it should be. Measured on 3.1.3: an index on a column holding a
 * COMPOSITE record id still enforces UNIQUE but is never chosen by the query
 * planner, so `WHERE node = $node` falls back to a full table scan — the same
 * family as the nested-path rule in AI.md, and the reason `created_by` is a
 * column too. A reference also has to survive JSON to reach a peer, and this is
 * already the form it travels in.
 */
export const OwnedRefSchema = z
  .string()
  .regex(
    /^did:syr:z[1-9A-HJ-NP-Za-km-z]+\/[0-9A-HJKMNP-TV-Z]{26}$/,
    "Expected a <did>/<ulid> reference",
  );
export type OwnedRef = z.infer<typeof OwnedRefSchema>;

export const BaseEntitySchema = z.object({
  id: RecordIdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/**
 * A row somebody owns. `created_by` repeats the owner half of the composite
 * record id on purpose: SurrealDB will not use a composite index whose second
 * column is a nested path, and this is the column the per-user purge deletes by
 * — reaching a row through its parent instead leaves every orphan behind.
 * `schema.ts` makes it immutable, so ownership cannot be reassigned out from
 * under the purge.
 */
export const OwnedEntitySchema = BaseEntitySchema.extend({
  created_by: DidSyrSchema,
});
export type OwnedEntity = z.infer<typeof OwnedEntitySchema>;
