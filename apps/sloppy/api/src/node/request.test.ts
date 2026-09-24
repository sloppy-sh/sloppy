import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthedRequest } from "../auth/authed-request";
import type { Delegation } from "../syr/syr.service";
import {
  didOrRefuse,
  principalOrRefuse,
  viewerDelegation,
  viewerDid,
} from "./request";

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

describe("somebody named in a path", () => {
  const ALICE = "mailto:alice@example.com";

  it("is taken however they are named, where the route is about a person", () => {
    expect(principalOrRefuse(encodeURIComponent(ALICE))).toBe(ALICE);
    expect(principalOrRefuse(encodeURIComponent(DELEGATION.did))).toBe(
      DELEGATION.did,
    );
  });

  // The pair `POST /following` and `DELETE /following/:did` are: a follow this
  // instance takes has to be one it will give back.
  it("is taken by the same routes that admit them", () => {
    expect(() => didOrRefuse(encodeURIComponent(ALICE))).toThrow(
      NotFoundException,
    );
  });

  it("is a page that is not there where it is nobody at all", () => {
    for (const raw of [
      "",
      "alice",
      "did%3Asyr%3A",
      "https%3A%2F%2Fpeer.example",
    ]) {
      expect(() => principalOrRefuse(raw)).toThrow(NotFoundException);
    }
  });
});
