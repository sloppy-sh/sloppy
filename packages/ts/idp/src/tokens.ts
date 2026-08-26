// Bearer tokens in syr's format: HS256, issuer `syr`, audience `syr-api`,
// claims `{ userId, sessionId }`. An identity minted here answers to a syr
// client without a translation layer, which is the point of the whole package.
//
// The algorithm is fixed rather than read from the token, so the family of
// attacks that begins by rewriting the header's `alg` has nothing to rewrite.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const ISSUER = "syr";
const AUDIENCE = "syr-api";
const HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT" }),
).toString("base64url");

/** `sessionId` is what the token is FOR: a signed-in person's session, or a
 *  platform delegation. `subjectOf` reads it back. */
export interface TokenClaims {
  userId: string;
  sessionId: string;
}

const PayloadSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  iss: z.literal(ISSUER),
  aud: z.literal(AUDIENCE),
  iat: z.int(),
  exp: z.int(),
});

export function issueToken(
  claims: TokenClaims,
  signingKey: Buffer,
  ttlSeconds: number,
): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      ...claims,
      iss: ISSUER,
      aud: AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
    }),
  ).toString("base64url");
  const body = `${HEADER}.${payload}`;
  return `${body}.${sign(body, signingKey)}`;
}

/** The claims, or `null` for anything that does not check out — a bad
 *  signature, an expired token, a token minted for somewhere else. The caller
 *  gets one answer because it can act on only one. */
export function readToken(
  token: string,
  signingKey: Buffer,
): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, presented] = parts;
  if (header !== HEADER) return null;

  const expected = Buffer.from(sign(`${header}.${payload}`, signingKey));
  const given = Buffer.from(presented);
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  const claims = PayloadSchema.safeParse(parseJson(payload));
  if (!claims.success) return null;
  if (claims.data.exp <= Math.floor(Date.now() / 1000)) return null;
  return { userId: claims.data.userId, sessionId: claims.data.sessionId };
}

/** The part of a `sessionId` after its kind, or null if it names another kind.
 *  Session ids are `<kind>:<id>` so one token format can carry both a person's
 *  session and a platform delegation without either being mistaken for the
 *  other. */
export function subjectOf(sessionId: string, kind: string): string | null {
  const prefix = `${kind}:`;
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : null;
}

function sign(body: string, signingKey: Buffer): string {
  return createHmac("sha256", signingKey)
    .update(body)
    .digest()
    .toString("base64url");
}

function parseJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
