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
  DEFINE TABLE IF NOT EXISTS idp_folder SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS idp_upload SCHEMALESS;
  DEFINE TABLE IF NOT EXISTS idp_emoji SCHEMALESS;

  -- The owner column every sweep below deletes by, immutable for the reason
  -- @sloppy/data makes created_by immutable: a row reassigned out from under
  -- the purge is somebody's key still answering after they asked to be gone.
  DEFINE FIELD IF NOT EXISTS did ON idp_identity TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_account TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_session TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_delegation TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_consent TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_folder TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_upload TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS did ON idp_emoji TYPE string READONLY;

  -- Timestamps are strings here for the same reason they are everywhere else in
  -- Sloppy; docs/ARCHITECTURE.md § "Data model" carries the ruling.
  DEFINE FIELD IF NOT EXISTS created_at ON idp_identity TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_account TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_session TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_delegation TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_consent TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_folder TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_upload TYPE string READONLY;
  DEFINE FIELD IF NOT EXISTS created_at ON idp_emoji TYPE string READONLY;

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

  -- One folder per name under a parent, and one shortcode per identity: both
  -- are looked up by that pair, and two rows answering to it is a coin toss.
  -- Root is the empty string rather than NONE so the index covers it too.
  DEFINE INDEX IF NOT EXISTS idp_folder_did_parent_name ON idp_folder FIELDS did, parent_id, name UNIQUE;
  DEFINE INDEX IF NOT EXISTS idp_emoji_did_shortcode ON idp_emoji FIELDS did, shortcode UNIQUE;
  DEFINE INDEX IF NOT EXISTS idp_upload_did ON idp_upload FIELDS did;
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

/**
 * `removeBlob` is a parameter and not an option, because the rows are only half
 * of what an identity left behind: a sweep that erases the uploads and keeps
 * their bytes has not deleted anybody's pictures. The object store belongs to
 * the API, so the caller is what knows how to reach it.
 *
 * Bytes first: a row still naming a key is what lets a second attempt finish
 * the job after a store that was down for the first.
 */
export async function purgeIdentity(
  db: Surreal,
  did: string,
  removeBlob: (key: string) => Promise<void>,
): Promise<void> {
  const [rows] = await db.query<[{ key: string }[]]>(
    `SELECT key FROM idp_upload WHERE did = $did;`,
    { did },
  );
  for (const row of rows ?? []) await removeBlob(row.key);
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

/** The fields a person may change about themselves. Absent is "never set" and
 *  null is "cleared"; both read back as null. */
export type AccountProfile = {
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
};

export interface AccountRow extends AccountProfile {
  id: RecordId;
  did: string;
  username: string;
  display_name: string | null;
  created_at: string;
}

/** A folder in somebody's own file store. `parent_id` is the empty string at
 *  the root, which is what the unique index above needs it to be. */
export interface FolderRow {
  id: RecordId;
  did: string;
  name: string;
  parent_id: string;
  created_at: string;
}

/**
 * A blob this instance holds. `url` is where it reads back from once the bytes
 * have landed and is stable for the row's life; `key` is where they sit in the
 * object store, which nothing outside the store may be told.
 */
export interface UploadRow {
  id: RecordId;
  did: string;
  filename: string;
  mime_type: string;
  size: number;
  sha256?: string;
  folder_id: string;
  key: string;
  url: string;
  is_public: boolean;
  /** `pending` until the bytes arrive; `completed` once they have. */
  status: "pending" | "completed";
  metadata?: { width?: number; height?: number };
  created_at: string;
}

export interface EmojiRow {
  id: RecordId;
  did: string;
  shortcode: string;
  url: string;
  mime_type: string;
  size: number;
  is_sticker: boolean;
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
  /** What the person approved this app for, re-recorded on every approval.
   *  Absent on a delegation minted before the instance kept them, which is
   *  read as the read-only default rather than as everything. */
  scopes?: string[];
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

export async function mergeAccountProfile(
  db: Surreal,
  id: RecordId,
  patch: AccountProfile,
): Promise<AccountRow> {
  return db.update<AccountRow>(id).merge(patch);
}

export async function findFolder(
  db: Surreal,
  did: string,
  parentId: string,
  name: string,
): Promise<FolderRow | null> {
  return first<FolderRow>(
    db,
    `SELECT * FROM idp_folder
       WHERE did = $did AND parent_id = $parentId AND name = $name LIMIT 1;`,
    { did, parentId, name },
  );
}

export async function listFolders(
  db: Surreal,
  did: string,
  parentId: string,
): Promise<FolderRow[]> {
  const [rows] = await db.query<[FolderRow[]]>(
    `SELECT * FROM idp_folder
       WHERE did = $did AND parent_id = $parentId ORDER BY name;`,
    { did, parentId },
  );
  return rows ?? [];
}

export async function createFolder(
  db: Surreal,
  row: Omit<FolderRow, "id">,
): Promise<FolderRow> {
  return db.create<FolderRow>(newId("idp_folder")).content(row);
}

export async function findFolderById(
  db: Surreal,
  folderId: string,
): Promise<FolderRow | null> {
  return (
    (await db.select<FolderRow>(new RecordId("idp_folder", folderId))) ?? null
  );
}

export async function createUpload(
  db: Surreal,
  row: Omit<UploadRow, "id">,
  localId: string,
): Promise<UploadRow> {
  return db.create<UploadRow>(new RecordId("idp_upload", localId)).content(row);
}

export async function findUpload(
  db: Surreal,
  localId: string,
): Promise<UploadRow | null> {
  return (
    (await db.select<UploadRow>(new RecordId("idp_upload", localId))) ?? null
  );
}

export async function updateUpload(
  db: Surreal,
  id: RecordId,
  patch: Partial<Omit<UploadRow, "id" | "did" | "created_at">>,
): Promise<UploadRow> {
  return db.update<UploadRow>(id).merge(patch);
}

/** Everything one identity has in a folder, newest first — the owner's own
 *  listing, so a pending upload is in it too. */
export async function listUploadsIn(
  db: Surreal,
  did: string,
  folderId: string,
  page: { limit: number; offset: number },
): Promise<{ rows: UploadRow[]; total: number }> {
  const [rows, counted] = await db.query<[UploadRow[], { total: number }[]]>(
    `SELECT * FROM idp_upload WHERE did = $did AND folder_id = $folderId
       ORDER BY created_at DESC LIMIT $limit START $offset;
     SELECT count() AS total FROM idp_upload
       WHERE did = $did AND folder_id = $folderId GROUP ALL;`,
    { did, folderId, limit: page.limit, offset: page.offset },
  );
  return { rows: rows ?? [], total: counted?.[0]?.total ?? 0 };
}

/** Completed uploads only, and public ones only: this answers a stranger. */
export async function listPublicUploads(
  db: Surreal,
  did: string,
  page: { limit: number; offset: number },
): Promise<{ rows: UploadRow[]; total: number }> {
  const [rows, counted] = await db.query<[UploadRow[], { total: number }[]]>(
    `SELECT * FROM idp_upload
       WHERE did = $did AND is_public = true AND status = 'completed'
       ORDER BY created_at DESC LIMIT $limit START $offset;
     SELECT count() AS total FROM idp_upload
       WHERE did = $did AND is_public = true AND status = 'completed'
       GROUP ALL;`,
    { did, limit: page.limit, offset: page.offset },
  );
  return { rows: rows ?? [], total: counted?.[0]?.total ?? 0 };
}

export async function createEmoji(
  db: Surreal,
  row: Omit<EmojiRow, "id">,
): Promise<EmojiRow> {
  return db.create<EmojiRow>(newId("idp_emoji")).content(row);
}

export async function listEmoji(
  db: Surreal,
  did: string,
  page: { limit: number; offset: number },
): Promise<{ rows: EmojiRow[]; total: number }> {
  const [rows, counted] = await db.query<[EmojiRow[], { total: number }[]]>(
    `SELECT * FROM idp_emoji WHERE did = $did
       ORDER BY shortcode LIMIT $limit START $offset;
     SELECT count() AS total FROM idp_emoji WHERE did = $did GROUP ALL;`,
    { did, limit: page.limit, offset: page.offset },
  );
  return { rows: rows ?? [], total: counted?.[0]?.total ?? 0 };
}

export async function findEmojiByShortcode(
  db: Surreal,
  did: string,
  shortcode: string,
): Promise<EmojiRow | null> {
  return first<EmojiRow>(
    db,
    "SELECT * FROM idp_emoji WHERE did = $did AND shortcode = $shortcode LIMIT 1;",
    { did, shortcode },
  );
}

export async function findEmoji(
  db: Surreal,
  localId: string,
): Promise<EmojiRow | null> {
  return (
    (await db.select<EmojiRow>(new RecordId("idp_emoji", localId))) ?? null
  );
}

export async function deleteEmoji(db: Surreal, id: RecordId): Promise<void> {
  await db.delete(id);
}

export async function deleteUpload(db: Surreal, id: RecordId): Promise<void> {
  await db.delete(id);
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

export async function setDelegationScopes(
  db: Surreal,
  id: RecordId,
  scopes: string[],
): Promise<void> {
  await db.update(id).merge({ scopes });
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
 * Trade a consent's id and code for the consent itself, exactly once. The
 * delete is the claim: two callers racing the same code both run the statement,
 * and only the one whose DELETE returned a row may go on to mint a token.
 */
export async function consumeConsent(
  db: Surreal,
  consentId: string,
  code: string,
  now: string,
): Promise<ConsentRow | null> {
  const [rows] = await db.query<[ConsentRow[]]>(
    `DELETE idp_consent
       WHERE id = $id AND code = $code AND expires_at > $now
       RETURN BEFORE;`,
    { id: new RecordId("idp_consent", consentId), code, now },
  );
  return rows?.[0] ?? null;
}
