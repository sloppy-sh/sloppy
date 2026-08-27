// The two sides of the same wire, checked against each other.
//
// `@sloppy/types` says what Sloppy SENDS to an instance; this package says what
// an instance ACCEPTS. Both are written by hand, so nothing but a test stops
// them from drifting into two dialects that each look right on their own.

import {
  SyrPlatformChallengeRequestSchema,
  SyrPlatformSignRequestSchema,
  SyrPlatformTokenRequestSchema,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  ChallengeRequestSchema,
  SignRequestSchema,
  TokenRequestSchema,
} from "./contracts.js";

const DID = "did:syr:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp";
const ORIGIN = "https://sloppy.example";
const CALLBACK = "https://sloppy.example/auth/callback";

describe("what Sloppy sends is what this instance accepts", () => {
  it("takes the token request syr itself requires, delegation id and all", () => {
    const sent = SyrPlatformTokenRequestSchema.parse({
      code: "abc",
      delegation_id: "01JRQ0000000000000000000",
      callback_url: CALLBACK,
      platform_origin: ORIGIN,
    });
    expect(() => TokenRequestSchema.parse(sent)).not.toThrow();
    // And refuses what syr refuses, in the words syr refuses it with, rather
    // than being the one instance a caller gets away with omitting it against.
    const refused = TokenRequestSchema.safeParse({
      ...sent,
      delegation_id: undefined,
    });
    expect(refused.error?.issues[0].message).toBe(
      "code and delegation_id are required",
    );
  });

  it("takes the sign request", () => {
    const sent = SyrPlatformSignRequestSchema.parse({
      payload: { type: "sloppy-node@v1", address: "1a" },
      payload_type: "sloppy-node@v1",
    });
    expect(() => SignRequestSchema.parse(sent)).not.toThrow();
  });

  it("takes the challenge request", () => {
    const sent = SyrPlatformChallengeRequestSchema.parse({
      did: DID,
      platform_origin: ORIGIN,
      challenge: "nonce",
    });
    expect(() => ChallengeRequestSchema.parse(sent)).not.toThrow();
  });
});
