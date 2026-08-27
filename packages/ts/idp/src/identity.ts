// Creating an identity here, and coming back to it.
//
// A registration mints a real Ed25519 root key and derives a `did:syr:` from
// it, so the identity is the same kind of thing whether it was made on a plane
// or on a hosted instance — and it stays verifiable by anyone who only has the
// DID.

import { nowIso } from "@sloppy/types";
import {
  AegisDecryptionError,
  createAegisBundle,
  dummyUnlock,
  withSeed,
} from "./aegis.js";
import {
  type IdpContext,
  type IdpSession,
  SESSION_TTL_SECONDS,
  isoIn,
} from "./context.js";
import type {
  LoginRequest,
  Profile,
  ProfilePatch,
  RegisterRequest,
  SessionGrant,
} from "./contracts.js";
import { encodePublicKey, deriveDid } from "./encoding.js";
import { IdpError } from "./errors.js";
import { generateKeypair, wipe } from "./keys.js";
import {
  type AccountRow,
  createAccount,
  createIdentity,
  createSession,
  deleteSession,
  findAccountByDid,
  findAccountByUsername,
  findIdentity,
  findSession,
  type IdentityRow,
  mergeAccountProfile,
} from "./store.js";
import { issueToken, readToken, subjectOf } from "./tokens.js";

const SESSION_KIND = "session";

export async function register(
  ctx: IdpContext,
  request: RegisterRequest,
): Promise<SessionGrant> {
  if (await findAccountByUsername(ctx.db, request.username)) {
    throw new IdpError(409, "username_taken", "That name is taken.");
  }

  const keypair = generateKeypair();
  const did = deriveDid(keypair.publicKey);
  let aegis: ReturnType<typeof createAegisBundle>;
  try {
    aegis = createAegisBundle(keypair.privateKey, request.password);
  } finally {
    wipe(keypair.privateKey);
  }

  const identity = await createIdentity(ctx.db, {
    did,
    public_key: encodePublicKey(keypair.publicKey),
    aegis,
    created_at: nowIso(),
  });
  try {
    await createAccount(ctx.db, {
      did,
      username: request.username,
      display_name: request.display_name ?? null,
      created_at: nowIso(),
    });
  } catch (error) {
    // The unique index is what settles a race for the same name, so losing it
    // has to leave no identity behind for a DID nobody can sign in as.
    await ctx.db.delete(identity.id);
    if (await findAccountByUsername(ctx.db, request.username)) {
      throw new IdpError(409, "username_taken", "That name is taken.");
    }
    throw error;
  }

  return grantSession(ctx, did);
}

export async function login(
  ctx: IdpContext,
  request: LoginRequest,
): Promise<SessionGrant> {
  const account = await findAccountByUsername(ctx.db, request.username);
  const identity = account ? await findIdentity(ctx.db, account.did) : null;
  if (!identity) {
    // Same work either way, so how long this takes says nothing about whether
    // the name exists.
    dummyUnlock();
    throw invalidCredentials();
  }
  // Opening the sealed root key IS the password check: a second stored verifier
  // would be one more thing to keep in step with the key it guards.
  try {
    withSeed(identity.aegis, request.password, () => undefined);
  } catch (error) {
    if (error instanceof AegisDecryptionError) throw invalidCredentials();
    throw error;
  }
  return grantSession(ctx, identity.did);
}

export async function logout(
  ctx: IdpContext,
  session: IdpSession,
): Promise<void> {
  await deleteSession(ctx.db, session.sessionId);
}

/** The person a bearer token names, or null. The session row is read on every
 *  request so that a signed-out session stops working at once rather than when
 *  its token would have expired. */
export async function resolveSession(
  ctx: IdpContext,
  token: string,
): Promise<IdpSession | null> {
  const claims = readToken(token, ctx.secrets.tokenSigning);
  if (!claims) return null;
  const sessionId = subjectOf(claims.sessionId, SESSION_KIND);
  if (!sessionId) return null;
  const row = await findSession(ctx.db, sessionId);
  if (!row || row.did !== claims.userId || row.expires_at <= nowIso()) {
    return null;
  }
  return { did: row.did, sessionId };
}

export async function profileOf(
  ctx: IdpContext,
  did: string,
): Promise<Profile> {
  const account = await findAccountByDid(ctx.db, did);
  if (!account) throw unknownIdentity();
  return profileView(account);
}

/**
 * What the person chose to be called, and the pictures they chose. `username`
 * is not here: it is what a peer resolves, and changing it is a different
 * decision with different consequences.
 */
export async function updateProfile(
  ctx: IdpContext,
  did: string,
  patch: ProfilePatch,
): Promise<Profile> {
  const account = await findAccountByDid(ctx.db, did);
  if (!account) throw unknownIdentity();
  if (Object.keys(patch).length === 0) return profileView(account);
  return profileView(await mergeAccountProfile(ctx.db, account.id, patch));
}

function profileView(account: AccountRow): Profile {
  return {
    did: account.did,
    username: account.username,
    display_name: account.display_name ?? null,
    avatar_url: account.avatar_url ?? null,
    banner_url: account.banner_url ?? null,
    bio: account.bio ?? null,
  };
}

export async function requireIdentity(
  ctx: IdpContext,
  did: string,
): Promise<IdentityRow> {
  const identity = await findIdentity(ctx.db, did);
  if (!identity) throw unknownIdentity();
  return identity;
}

export function unknownIdentity(): IdpError {
  return new IdpError(
    404,
    "unknown_did",
    "This instance does not hold that identity.",
  );
}

function invalidCredentials(): IdpError {
  return new IdpError(
    401,
    "invalid_credentials",
    "Check your name and password and try again.",
  );
}

async function grantSession(
  ctx: IdpContext,
  did: string,
): Promise<SessionGrant> {
  const row = await createSession(ctx.db, {
    did,
    created_at: nowIso(),
    expires_at: isoIn(SESSION_TTL_SECONDS),
  });
  return {
    access_token: issueToken(
      { userId: did, sessionId: `${SESSION_KIND}:${String(row.id.id)}` },
      ctx.secrets.tokenSigning,
      SESSION_TTL_SECONDS,
    ),
    token_type: "Bearer",
    expires_in: SESSION_TTL_SECONDS,
    did,
  };
}
