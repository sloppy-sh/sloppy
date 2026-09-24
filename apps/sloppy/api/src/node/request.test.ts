import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthedRequest } from "../auth/authed-request";
import type { Delegation } from "../syr/syr.service";
import { viewerDelegation, viewerDid } from "./request";

const DELEGATION = {
  did: "did:syr:z6MkSomebody",
  syr_instance_url: "https://syr.is",
  delegate_public_key: "z6MkDelegate",
  access_token: "a-token",
} satisfies Delegation;

const asking = (extra: Partial<AuthedRequest> = {}) =>
  ({ headers: {}, ...extra }) as AuthedRequest;

describe("what a route is told about its caller", () => {
  it("names a caller however they signed in", () => {
    expect(
      viewerDid(asking({ viewer: { did: "mailto:alice@example.com" } })),
    ).toBe("mailto:alice@example.com");
  });

  it("hands over the delegation where there is one", () => {
    expect(
      viewerDelegation(
        asking({ viewer: { did: DELEGATION.did }, delegation: DELEGATION }),
      ),
    ).toBe(DELEGATION);
  });

  // The session is good; it is this act that is not on offer. Answering the way
  // a dead credential is answered would sign them out of it.
  it("refuses a signed-in caller with no identity store without ending them", () => {
    expect(() =>
      viewerDelegation(asking({ viewer: { did: "mailto:alice@example.com" } })),
    ).toThrow(ForbiddenException);
  });

  it("still asks nobody at all to sign in", () => {
    expect(() => viewerDelegation(asking())).toThrow(UnauthorizedException);
  });
});
