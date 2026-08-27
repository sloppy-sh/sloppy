// Everything the identity provider needs that is not a request: the store, the
// derived secrets, and the URL a peer reaches this instance at.

import type { Surreal } from "surrealdb";
import type { IdpSecrets } from "./secrets.js";

export interface IdpContext {
  db: Surreal;
  secrets: IdpSecrets;
  /** Absolute, no trailing slash — every manifest URL is built from it. */
  publicUrl: string;
}

/** A signed-in person, resolved from a bearer token. */
export interface IdpSession {
  did: string;
  sessionId: string;
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** syr recommends short-lived platform tokens; v0.1 defines no refresh, so a
 *  platform whose token runs out re-runs consent. */
export const PLATFORM_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const CONSENT_TTL_SECONDS = 10 * 60;

export function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
