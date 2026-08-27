// Platform Delegation v0.1, the instance's half: consent, token, sign,
// challenge, revoke.
//
// The shape of the trust chain is what makes a signature from here mean
// something anywhere else. The person's root key signs a statement naming a
// fresh delegate key and the platform it is for; the delegate key signs
// content; the private halves of both stay on this instance. syr's
// "Platform Delegation v0.1" specification is the document of record.

import {
  nowIso,
  type SyrPlatformChallengeResponse,
  type SyrPlatformSignResponse,
  type SyrPlatformTokenResponse,
  type SyrScope,
} from "@sloppy/types";
import { randomUUID } from "node:crypto";
import { AegisDecryptionError, withSeed } from "./aegis.js";
import { canonicalize, type JsonValue } from "./canonical.js";
import {
  CONSENT_TTL_SECONDS,
  type IdpContext,
  isoIn,
  PLATFORM_TOKEN_TTL_SECONDS,
} from "./context.js";
import {
  type ConsentOutcome,
  type ConsentPrompt,
  type ConsentRequest,
  DEFAULT_SCOPES,
  type DelegationListing,
  DelegationStatementSchema,
  type RevokeOutcome,
  type TokenRequest,
} from "./contracts.js";
import { encodeMultibase, encodePublicKey } from "./encoding.js";
import { IdpError } from "./errors.js";
import { profileOf, requireIdentity } from "./identity.js";
import { generateKeypair, sign, wipe } from "./keys.js";
import { sealSeed, withSealedSeed } from "./sealing.js";
import {
  attachConsentCode,
  consumeConsent,
  createConsent,
  createDelegation,
  deleteConsent,
  type ConsentRow,
  type DelegationRow,
  findActiveDelegation,
  findConsent,
  findDelegationById,
  listDelegations,
  revokeDelegation,
  setDelegationScopes,
} from "./store.js";
import { issueToken, readToken, subjectOf } from "./tokens.js";

const PLATFORM_KIND = "platform";

export interface PlatformGrant {
  did: string;
  delegation: DelegationRow;
}

/**
 * Open a consent request for the signed-in person. The callback must live on
 * the platform's own origin, so a platform cannot name somebody else's site as
 * the place this instance sends a person holding a fresh authorization code.
 */
export async function openConsent(
  ctx: IdpContext,
  did: string,
  request: ConsentRequest,
): Promise<ConsentPrompt> {
  const origin = new URL(request.platform_origin);
  if (new URL(request.callback_url).origin !== origin.origin) {
    throw new IdpError(
      400,
      "invalid_callback",
      "That app's sign-in link is malformed. Ask its author to fix it.",
    );
  }
  // Before the row is written, so a request is never opened against a DID this
  // instance does not hold.
  const profile = await profileOf(ctx, did);

  const row = await createConsent(ctx.db, {
    did,
    platform_origin: request.platform_origin,
    platform_name: request.platform_name ?? origin.hostname,
    callback_url: request.callback_url,
    scopes: request.scopes ?? [...DEFAULT_SCOPES],
    state: request.state,
    created_at: nowIso(),
    expires_at: isoIn(CONSENT_TTL_SECONDS),
  });
  return prompt(row, profile.display_name);
}

export async function readConsent(
  ctx: IdpContext,
  did: string,
  challengeId: string,
): Promise<ConsentPrompt> {
  const row = await requireConsent(ctx, did, challengeId);
  return prompt(row, (await profileOf(ctx, did)).display_name);
}

/**
 * Approve a delegation. The password is here because the root key signs the
 * delegation statement and only the person can open it — a session alone is not
 * the identity's authority.
 */
export async function approveConsent(
  ctx: IdpContext,
  did: string,
  challengeId: string,
  password: string,
): Promise<ConsentOutcome> {
  const consent = await requireConsent(ctx, did, challengeId);
  const identity = await requireIdentity(ctx, did);
  const existing = await findActiveDelegation(
    ctx.db,
    did,
    consent.platform_origin,
    nowIso(),
  );

  // The root key is opened even when a delegation already exists: approving is
  // the moment the person authorises this app, and it has to cost the password
  // every time or a stolen session silently reconnects one.
  let minted: Omit<DelegationRow, "id"> | null;
  try {
    minted = withSeed(identity.aegis, password, (rootSeed) =>
      existing
        ? null
        : mintDelegation({
            did,
            rootSeed,
            sealingKey: ctx.secrets.delegateSealing,
            platformOrigin: consent.platform_origin,
            platformName: consent.platform_name,
            scopes: consent.scopes,
          }),
    );
  } catch (error) {
    if (error instanceof AegisDecryptionError) {
      throw new IdpError(401, "invalid_password", "That password isn't right.");
    }
    throw error;
  }
  // Approving is what grants the scopes, so an app the person is reconnecting
  // gets the set they just read rather than the set they read the first time.
  if (minted) await createDelegation(ctx.db, minted);
  else if (existing)
    await setDelegationScopes(ctx.db, existing.id, consent.scopes);

  const code = randomUUID();
  await attachConsentCode(ctx.db, consent.id, code);

  const callback = new URL(consent.callback_url);
  callback.searchParams.set("code", code);
  // syr's name for the consent request's own id, and what the exchange below
  // looks the request up by.
  callback.searchParams.set("delegation_id", challengeId);
  if (consent.state) callback.searchParams.set("state", consent.state);
  return { redirect_url: callback.toString() };
}

export async function denyConsent(
  ctx: IdpContext,
  did: string,
  challengeId: string,
): Promise<ConsentOutcome> {
  const consent = await requireConsent(ctx, did, challengeId);
  await deleteConsent(ctx.db, consent.id);

  const callback = new URL(consent.callback_url);
  callback.searchParams.set("error", "consent_denied");
  if (consent.state) callback.searchParams.set("state", consent.state);
  return { redirect_url: callback.toString() };
}

/**
 * Trade the callback's code for a platform access token. The code is consumed
 * whatever happens next, so a caller that gets the origin or the callback wrong
 * has spent it and must go back through consent.
 */
export async function exchangeToken(
  ctx: IdpContext,
  request: TokenRequest,
): Promise<SyrPlatformTokenResponse> {
  const consent = await consumeConsent(
    ctx.db,
    request.delegation_id,
    request.code,
    nowIso(),
  );
  if (
    !consent ||
    consent.platform_origin !== request.platform_origin ||
    // Byte-identical, not URL-equivalent: syr compares the strings, and a
    // trailing slash is a different callback.
    consent.callback_url !== request.callback_url
  ) {
    throw new IdpError(
      400,
      "invalid_code",
      "That sign-in link has already been used or has expired. Start again.",
    );
  }

  const delegation = await findActiveDelegation(
    ctx.db,
    consent.did,
    consent.platform_origin,
    nowIso(),
  );
  if (!delegation) throw noDelegation();

  return {
    access_token: issueToken(
      {
        userId: consent.did,
        sessionId: `${PLATFORM_KIND}:${String(delegation.id.id)}`,
      },
      ctx.secrets.tokenSigning,
      PLATFORM_TOKEN_TTL_SECONDS,
    ),
    token_type: "Bearer",
    expires_in: PLATFORM_TOKEN_TTL_SECONDS,
    did: consent.did,
    delegate_public_key: delegation.public_key,
    scopes: consent.scopes,
  };
}

/** The delegation a platform access token names, or null. Revocation is read
 *  per request: a revoked delegation stops signing the moment it is revoked,
 *  not when the token it was issued to runs out. */
export async function resolvePlatformToken(
  ctx: IdpContext,
  token: string,
): Promise<PlatformGrant | null> {
  const claims = readToken(token, ctx.secrets.tokenSigning);
  if (!claims) return null;
  const delegationId = subjectOf(claims.sessionId, PLATFORM_KIND);
  if (!delegationId) return null;
  const delegation = await findDelegationById(ctx.db, delegationId);
  if (!delegation || delegation.did !== claims.userId) return null;
  if (delegation.revoked_at) return null;
  if (delegation.expires_at && delegation.expires_at <= nowIso()) return null;
  return { did: delegation.did, delegation };
}

/**
 * Whether the person approved this app for `scope`. A delegation minted before
 * the instance recorded them is read as `DEFAULT_SCOPES`, so an old grant can
 * still see but cannot write — nobody agreed to more than that.
 */
export function grantAllows(grant: PlatformGrant, scope: SyrScope): boolean {
  const granted = grant.delegation.scopes ?? DEFAULT_SCOPES;
  return granted.includes(scope);
}

export function signPayload(
  ctx: IdpContext,
  delegation: DelegationRow,
  payload: Record<string, unknown>,
): SyrPlatformSignResponse {
  const canonical = canonicalize(payload as JsonValue);
  return {
    signature: signWithDelegate(ctx, delegation, canonical),
    delegate_public_key: delegation.public_key,
    did: delegation.did,
    signed_at: nowIso(),
  };
}

/** Signing a caller-chosen string proves the delegation is still live. It is
 *  guarded by the platform token for the same reason `sign` is: unguarded, it
 *  would sign anything for anyone. */
export function signChallenge(
  ctx: IdpContext,
  delegation: DelegationRow,
  challenge: string,
): SyrPlatformChallengeResponse {
  return {
    signature: signWithDelegate(ctx, delegation, challenge),
    delegate_public_key: delegation.public_key,
    did: delegation.did,
  };
}

export async function revoke(
  ctx: IdpContext,
  did: string,
  platformOrigin: string,
): Promise<RevokeOutcome> {
  const delegation = await findActiveDelegation(
    ctx.db,
    did,
    platformOrigin,
    nowIso(),
  );
  if (!delegation) throw noDelegation();
  await revokeDelegation(ctx.db, delegation.id, nowIso());
  return { status: "revoked" };
}

/** Public: this is what a stranger verifying a signature reads. It carries no
 *  key material beyond the delegate's public half. */
export async function delegationsOf(
  ctx: IdpContext,
  did: string,
): Promise<DelegationListing> {
  const rows = await listDelegations(ctx.db, did);
  return {
    data: rows.map((row) => ({
      delegate_public_key: row.public_key,
      platform_origin: row.platform_origin,
      platform_name: row.platform_name,
      scope: row.scope,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
      expires_at: row.expires_at,
      statement: row.canonical_delegation,
      statement_signature: row.signature,
    })),
  };
}

function prompt(row: ConsentRow, displayName: string | null): ConsentPrompt {
  return {
    challenge_id: String(row.id.id),
    did: row.did,
    display_name: displayName,
    platform_name: row.platform_name,
    platform_origin: row.platform_origin,
    // Checked against this list on the way in, by `ConsentRequestSchema`.
    scopes: row.scopes as SyrScope[],
    expires_in: CONSENT_TTL_SECONDS,
  };
}

/**
 * A fresh delegate keypair, the statement the root key signs over it, and that
 * key sealed for storage — all of it built while the root seed is in hand, and
 * none of it touching the database, so the seed is gone before any await.
 */
function mintDelegation(params: {
  did: string;
  rootSeed: Uint8Array;
  sealingKey: Buffer;
  platformOrigin: string;
  platformName: string;
  scopes: string[];
}): Omit<DelegationRow, "id"> {
  const delegate = generateKeypair();
  try {
    const publicKey = encodePublicKey(delegate.publicKey);
    const createdAt = nowIso();
    const statement = DelegationStatementSchema.parse({
      did: params.did,
      delegate: publicKey,
      scope: "platform",
      platform_origin: params.platformOrigin,
      platform_name: params.platformName,
      createdAt,
    });
    const canonical = canonicalize(statement);
    return {
      did: params.did,
      platform_origin: params.platformOrigin,
      platform_name: params.platformName,
      scope: "platform",
      public_key: publicKey,
      sealed_delegate: sealSeed(delegate.privateKey, params.sealingKey),
      signature: encodeMultibase(sign(canonical, params.rootSeed)),
      canonical_delegation: canonical,
      scopes: params.scopes,
      created_at: createdAt,
    };
  } finally {
    wipe(delegate.privateKey);
  }
}

function signWithDelegate(
  ctx: IdpContext,
  delegation: DelegationRow,
  message: string,
): string {
  return withSealedSeed(
    delegation.sealed_delegate,
    ctx.secrets.delegateSealing,
    (seed) => encodeMultibase(sign(message, seed)),
  );
}

function noDelegation(): IdpError {
  return new IdpError(
    404,
    "no_delegation",
    "That app is not connected to this account.",
  );
}

async function requireConsent(
  ctx: IdpContext,
  did: string,
  challengeId: string,
) {
  const row = await findConsent(ctx.db, challengeId, nowIso());
  // Somebody else's request answers the same as a request that never existed:
  // telling the two apart would be a way to ask whether one is outstanding.
  if (!row || row.did !== did) {
    throw new IdpError(
      410,
      "consent_expired",
      "This sign-in request has expired. Start again from the app.",
    );
  }
  return row;
}
