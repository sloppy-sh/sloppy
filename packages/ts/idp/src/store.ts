// The identity store: the tables this instance keeps because it IS the identity
// provider, kept apart from Sloppy's own graph tables on purpose.
//
// AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store" draws the line
// from the other side; this is its mirror. Nothing here is defined unless the
// embedded provider is switched on, so an instance that delegates identity
// elsewhere never grows a place to put one.

import { ulid } from "@sloppy/types";
import { RecordId, type Surreal } from "surrealdb";
import type { AegisBundle } from "./aegis.js";
import type { SealedSeed } from "./sealing.js";

export const IDENTITY_SCHEMA = `
  DEFINE TABLE IF NOT EXISTS idp_identity SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS idp_account SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS idp_session SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS idp_delegation SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS idp_consent SCHEMALESS;

  -- The owner column every sweep below deletes by, immutable for the reason
  -- @sloppy/data makes created_by immutable: a row reassigned out from under
  -- the purge is somebody's key still answering after they asked to be gone.
  DEFINE FIELD IF NOT EXISTS did ON idp_identity TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_account TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_session TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_delegation TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_consent TYPE string READONLY;

  -- Timestamps are strings here for the same reason they are everywhere else in
  -- Sloppy; docs/ARCHITECTURE.md § "Data model" carries the ruling.
  DEFINE FIELD IF NOT EXISTS created_at ON idp_identity TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_account TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_session TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_delegation TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_consent TYPE string READONLY;

  -- One identity per DID, and one account per name: both are what a stranger
  -- resolves, so a second row claiming either has to fail at the write.
  DEFINE INDEX IF NOT EXISTS idp_identity_did ON idp_identity FIELDS did UNIQUE;
  DEFINE INDEX IF NOT EXISTS idp_account_did ON idp_account FIELDS did UNIQUE;
  DEFINE INDEX IF NOT EXISTS idp_account_username ON idp_account FIELDS username UNIQUE;

  DEFINE INDEX IF NOT EXISTS idp_session_did ON idp_session FIELDS did;
  -- Not unique: a revoked delegation stays, because a verifier checking an old
  -- signature has to be able to find out that it was revoked.
  DEFINE INDEX IF NOT EXISTS idp_delegation_did_origin ON idp_delegation FIELDS did, platform_origin;
  DEFINE INDEX IF NOT EXISTS idp_consent_did ON idp_consent FIELDS did;
  -- The token exchange arrives holding only the code.
  DEFINE INDEX IF NOT EXISTS idp_consent_code ON idp_consent FIELDS code;
`;

const DEFINE_TABLE = /DEFINE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/g;

export const IDENTITY_TABLES: readonly string[] = [
  ...IDENTITY_SCHEMA.matchAll(DEFINE_TABLE),
].map(([, table]) => table);

/** Idempotent, and run on every boot of an instance with the provider on. */
export async function defineIdentitySchema(db: Surreal): Promise<void> {
  await db.query(IDENTITY_SCHEMA);
}

/** Erasing one identity, by the column that names its owner rather than by
 *  walking down from a parent row — @sloppy/data's `purge.ts` says why that is
 *  the only safe sweep, and this is the identity store's half of it. */
export function identityPurgeStatements(): string[] {
  return IDENTITY_TABLES.map((table) => `DELETE ${table} WHERE did = $did;`);
}

export async function purgeIdentity(db: Surreal, did: string): Promise<void> {
  await db.query(identityPurgeStatements().join("\n"), { did });
}

// ── Rows ──────────────────────────────────────────────────────────────────

export interface IdentityRow {
  id: RecordId;
  did: string;
  /** Multibase of the key the DID is derived from. It never rotates here, so
   *  it is always the key a peer recovers from the DID itself. */
  public_key: string;
  /** The root seed, sealed under the person's password. */
  aegis: AegisBundle;
  created_at: string;
}

export interface AccountRow {
  id: RecordId;
  did: string;
  username: string;
  display_name: string | null;
  created_at: string;
}

export interface SessionRow {
  id: RecordId;
  did: string;
  created_at: string;
  expires_at: string;
}

export interface DelegationRow {
  id: RecordId;
  did: string;
  platform_origin: string;
  platform_name: string;
  scope: "platform";
  /** Multibase of the delegate public key — what a verifier checks against. */
  public_key: string;
  /** The delegate seed, sealed under this instance's own key. */
  sealed_delegate: SealedSeed;
  /** The root key's signature over `canonical_delegation`. */
  signature: string;
  canonical_delegation: string;
  created_at: string;
  revoked_at?: string;
  expires_at?: string;
}

export interface ConsentRow {
  id: RecordId;
  did: string;
  platform_origin: string;
  platform_name: string;
  callback_url: string;
  scopes: string[];
  state?: string;
  /** Absent until the person approves; single-use once set. */
  code?: string;
  created_at: string;
  expires_at: string;
}

// ── Reads and writes ──────────────────────────────────────────────────────

function newId(table: string): RecordId {
  return new RecordId(table, ulid());
}

async function first<T>(
  db: Surreal,
  query: string,
  bindings: Record<string, unknown>,
): Promise<T | null> {
  const [rows] = await db.query<[T[]]>(query, bindings);
  return rows?.[0] ?? null;
}

export async function createIdentity(
  db: Surreal,
  row: Omit<IdentityRow, "id">,
): Promise<IdentityRow> {
  return db.create<IdentityRow>(newId("idp_identity")).content(row);
}

export async function findIdentity(
  db: Surreal,
  did: string,
): Promise<IdentityRow | null> {
  return first<IdentityRow>(
    db,
    "SELECT * FROM idp_identity WHERE did = $did LIMIT 1;",
    { did },
  );
}

export async function createAccount(
  db: Surreal,
  row: Omit<AccountRow, "id">,
): Promise<AccountRow> {
  return db.create<AccountRow>(newId("idp_account")).content(row);
}

export async function findAccountByUsername(
  db: Surreal,
  username: string,
): Promise<AccountRow | null> {
  return first<AccountRow>(
    db,
    "SELECT * FROM idp_account WHERE username = $username LIMIT 1;",
    { username },
  );
}

export async function findAccountByDid(
  db: Surreal,
  did: string,
): Promise<AccountRow | null> {
  return first<AccountRow>(
    db,
    "SELECT * FROM idp_account WHERE did = $did LIMIT 1;",
    { did },
  );
}

export async function createSession(
  db: Surreal,
  row: Omit<SessionRow, "id">,
): Promise<SessionRow> {
  return db.create<SessionRow>(newId("idp_session")).content(row);
}

export async function findSession(
  db: Surreal,
  sessionId: string,
): Promise<SessionRow | null> {
  return (
    (await db.select<SessionRow>(new RecordId("idp_session", sessionId))) ??
    null
  );
}

export async function deleteSession(
  db: Surreal,
  sessionId: string,
): Promise<void> {
  await db.delete(new RecordId("idp_session", sessionId));
}

export async function createDelegation(
  db: Surreal,
  row: Omit<DelegationRow, "id">,
): Promise<DelegationRow> {
  return db.create<DelegationRow>(newId("idp_delegation")).content(row);
}

/** The newest delegation for this origin that is neither revoked nor expired. */
export async function findActiveDelegation(
  db: Surreal,
  did: string,
  platformOrigin: string,
  now: string,
): Promise<DelegationRow | null> {
  return first<DelegationRow>(
    db,
    `SELECT * FROM idp_delegation
       WHERE did = $did
         AND platform_origin = $platformOrigin
         AND revoked_at IS NONE
         AND (expires_at IS NONE OR expires_at > $now)
       ORDER BY created_at DESC
       LIMIT 1;`,
    { did, platformOrigin, now },
  );
}

export async function findDelegationById(
  db: Surreal,
  delegationId: string,
): Promise<DelegationRow | null> {
  return (
    (await db.select<DelegationRow>(
      new RecordId("idp_delegation", delegationId),
    )) ?? null
  );
}

export async function listDelegations(
  db: Surreal,
  did: string,
): Promise<DelegationRow[]> {
  const [rows] = await db.query<[DelegationRow[]]>(
    "SELECT * FROM idp_delegation WHERE did = $did ORDER BY created_at DESC;",
    { did },
  );
  return rows ?? [];
}

export async function revokeDelegation(
  db: Surreal,
  id: RecordId,
  revokedAt: string,
): Promise<void> {
  await db.update(id).merge({ revoked_at: revokedAt });
}

export async function createConsent(
  db: Surreal,
  row: Omit<ConsentRow, "id">,
): Promise<ConsentRow> {
  return db.create<ConsentRow>(newId("idp_consent")).content(row);
}

export async function findConsent(
  db: Surreal,
  challengeId: string,
  now: string,
): Promise<ConsentRow | null> {
  return first<ConsentRow>(
    db,
    `SELECT * FROM idp_consent
       WHERE id = $id AND expires_at > $now LIMIT 1;`,
    { id: new RecordId("idp_consent", challengeId), now },
  );
}

export async function attachConsentCode(
  db: Surreal,
  id: RecordId,
  code: string,
): Promise<void> {
  await db.update(id).merge({ code });
}

export async function deleteConsent(db: Surreal, id: RecordId): Promise<void> {
  await db.delete(id);
}

/**
 * Trade a code for the consent it belongs to, exactly once. The delete is the
 * claim: two callers racing the same code both run the statement, and only the
 * one whose DELETE returned a row may go on to mint a token.
 */
export async function consumeConsentCode(
  db: Surreal,
  code: string,
  now: string,
): Promise<ConsentRow | null> {
  const [rows] = await db.query<[ConsentRow[]]>(
    `DELETE idp_consent
       WHERE code = $code AND expires_at > $now
       RETURN BEFORE;`,
    { code, now },
  );
  return rows?.[0] ?? null;
}
