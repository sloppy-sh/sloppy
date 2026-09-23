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
 *
 * **Narrow on purpose.** This is what syr's wire speaks, what a syr instance is
 * asked about, and what a key is derived from. What a note's owner, its
 * authors, a role's members and every ref hold is a {@link Principal}, of which
 * this is one scheme.
 */
export const DidSyrSchema = z
  .string()
  .regex(
    /^did:syr:z[1-9A-HJ-NP-Za-km-z]+$/,
    "Expected a did:syr identifier, e.g. did:syr:z6Mkt9…",
  );
export type DidSyr = z.infer<typeof DidSyrSchema>;

/**
 * An unquoted local part at a dotted domain of letters, digits and hyphens —
 * narrower than RFC 6068's `addr-spec`, and deliberately so. A quoted local
 * part (`"alice smith"@…`), a domain literal (`alice@[192.0.2.1]`) and a
 * single-label domain (`alice@localhost`) are all refused: the binding this
 * scheme resolves through needs a real domain to ask. `/` is excluded because
 * it separates the halves of an {@link OwnedRef}, and `%` because it would give
 * one address two spellings — a principal is compared byte for byte and never
 * parsed into parts.
 */
const MAILTO =
  /^mailto:[a-z0-9!#$&'*+=?^_`{|}~-]+(?:\.[a-z0-9!#$&'*+=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Somebody who goes by an email address — `mailto:alice@example.com`.
 *
 * **Lowercased on the way in**, so that no caller has to remember to: the
 * binding this scheme will be resolved through lowercases the local part before
 * it hashes it, and an access list in which `Alice@…` and `alice@…` are two
 * people is a way to be locked out of your own graph.
 */
export const MailtoSchema = z
  .string()
  .max(327)
  .toLowerCase()
  .regex(
    MAILTO,
    "Expected a mailto: identifier, e.g. mailto:alice@example.com",
  );
export type Mailto = z.infer<typeof MailtoSchema>;

/**
 * Which scheme an identifier is in. Adding a way for somebody to be named is a
 * value here and an arm of {@link PrincipalSchema} — never a second field
 * beside the first, and never a boolean; AI.md § "Provider-Agnostic Data
 * Shapes".
 */
export const PrincipalSchemeSchema = z.enum(["did:syr", "mailto"]);
export type PrincipalScheme = z.infer<typeof PrincipalSchemeSchema>;

/**
 * Somebody a graph can name: a syr identity, or an email address.
 *
 * Each scheme is recognised and checked on its own terms — a malformed
 * `mailto:` is refused as firmly as a malformed DID — and a string in neither
 * is refused. Everything downstream treats the result as opaque: it is compared
 * byte for byte, it is half of a ref, and it is the column a person's rows are
 * swept by. What a scheme can be RESOLVED or VERIFIED through is a separate
 * question, asked of a `KeyBinding` and of a `VouchResolver`.
 */
export const PrincipalSchema = z.union([DidSyrSchema, MailtoSchema], {
  error:
    "Expected an identifier, e.g. did:syr:z6Mkt9… or mailto:alice@example.com",
});
export type Principal = z.infer<typeof PrincipalSchema>;

/** Which scheme a principal is in, or `undefined` where it is in none. */
export function principalScheme(value: string): PrincipalScheme | undefined {
  if (DidSyrSchema.safeParse(value).success) return "did:syr";
  if (MailtoSchema.safeParse(value).success) return "mailto";
  return undefined;
}

/** Crockford base32, as `ulid()` emits it. */
export const UlidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Expected a ULID");
export type Ulid = z.infer<typeof UlidSchema>;

/**
 * How one row points at another: `<principal>/<ulid>`, deliberately a string
 * and not the SurrealDB record link it looks like it should be.
 * docs/ARCHITECTURE.md § "Data model" says why.
 *
 * Each half is held to its own schema rather than to one regex spanning both,
 * so a ref is exactly a principal and a ULID and nothing that merely looks like
 * the pair. The principal half arrives normalised, as it does anywhere else.
 */
export const OwnedRefSchema = z.string().transform((value, ctx) => {
  const separator = value.lastIndexOf("/");
  const owner =
    separator < 1
      ? undefined
      : PrincipalSchema.safeParse(value.slice(0, separator));
  const localId = UlidSchema.safeParse(value.slice(separator + 1));
  if (owner?.success !== true || !localId.success) {
    ctx.addIssue({
      code: "custom",
      message: "Expected a <principal>/<ulid> reference",
    });
    return z.NEVER;
  }
  return `${owner.data}/${localId.data}`;
});
export type OwnedRef = z.infer<typeof OwnedRefSchema>;

/**
 * How an identity store names a record of its own: `<did>:<local id>`. This is
 * the form syr writes into a comment thread's ancestor chain, so a reply and an
 * ancestor compare as strings without either side taking one apart. The local
 * half is the issuing store's to mint, is not a ULID on every instance, and may
 * carry colons of its own — which is why this is not an `OwnedRef`, and why
 * `splitStoreRef`, the one place it is taken apart, matches the DID rather than
 * counting colons.
 *
 * A record an identity store issued, so the identity is that store's own and is
 * a `did:syr` rather than a {@link Principal}.
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
  created_by: PrincipalSchema,
});
export type OwnedEntity = z.infer<typeof OwnedEntitySchema>;
