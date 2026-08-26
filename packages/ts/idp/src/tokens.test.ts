import { describe, expect, it, vi } from "vitest";
import { deriveIdpSecrets } from "./secrets.js";
import { issueToken, readToken, subjectOf } from "./tokens.js";

const KEY = deriveIdpSecrets("a".repeat(32)).tokenSigning;
const OTHER = deriveIdpSecrets("b".repeat(32)).tokenSigning;
const CLAIMS = { userId: "did:syr:z6Mk", sessionId: "session:01J" };

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

function retag(token: string, payload: Record<string, unknown>): string {
  const [header, , signature] = token.split(".");
  const rewritten = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${rewritten}.${signature}`;
}

describe("bearer tokens", () => {
  it("carries syr's issuer and audience, so a syr client reads it", () => {
    const claims = payloadOf(issueToken(CLAIMS, KEY, 60));
    expect(claims.iss).toBe("syr");
    expect(claims.aud).toBe("syr-api");
    expect(claims.userId).toBe(CLAIMS.userId);
    expect(claims.sessionId).toBe(CLAIMS.sessionId);
  });

  it("reads back what it issued", () => {
    expect(readToken(issueToken(CLAIMS, KEY, 60), KEY)).toEqual(CLAIMS);
  });

  it("refuses a token signed with another key", () => {
    expect(readToken(issueToken(CLAIMS, OTHER, 60), KEY)).toBeNull();
  });

  it("refuses a rewritten payload", () => {
    const token = issueToken(CLAIMS, KEY, 60);
    const forged = retag(token, {
      ...payloadOf(token),
      userId: "did:syr:zSomebodyElse",
    });
    expect(readToken(forged, KEY)).toBeNull();
  });

  it("refuses a token that claims no algorithm", () => {
    const [, payload] = issueToken(CLAIMS, KEY, 60).split(".");
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    expect(readToken(`${header}.${payload}.`, KEY)).toBeNull();
  });

  it("refuses a token whose lifetime has run out", () => {
    const token = issueToken(CLAIMS, KEY, 60);
    expect(readToken(token, KEY)).toEqual(CLAIMS);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      expect(readToken(token, KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses anything that is not three segments", () => {
    expect(readToken("", KEY)).toBeNull();
    expect(readToken("a.b", KEY)).toBeNull();
    expect(readToken("a.b.c.d", KEY)).toBeNull();
  });
});

describe("session kinds", () => {
  it("keeps a person's session and a platform delegation apart", () => {
    expect(subjectOf("session:01J", "session")).toBe("01J");
    expect(subjectOf("session:01J", "platform")).toBeNull();
    expect(subjectOf("platform:01J", "session")).toBeNull();
  });
});
