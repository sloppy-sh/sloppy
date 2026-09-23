import { describe, expect, it } from "vitest";
import { nowIso } from "./common.js";
import {
  KnownIdentitySchema,
  VouchStateSchema,
  anonymousVouch,
  standingVouch,
  vouchFrom,
} from "./vouch.js";

const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const INSTANCE = "https://syr.example";
const AT = "2026-09-23T10:00:00.000Z";

describe("what resolving an identity says", () => {
  it("has a third state, because not answering is not an answer", () => {
    expect(VouchStateSchema.options).toEqual([
      "vouched",
      "anonymous",
      "unknown",
    ]);
  });

  it("is unknown where nothing answered, never anonymous", () => {
    expect(vouchFrom(AVA, INSTANCE, null, AT)).toEqual({
      did: AVA,
      state: "unknown",
      at: AT,
    });
  });

  it("is anonymous where an instance answered with nobody standing behind it", () => {
    expect(vouchFrom(AVA, INSTANCE, [], AT).state).toBe("anonymous");
    expect(
      vouchFrom(AVA, INSTANCE, [{ revoked_at: "2026-01-01T00:00:00.000Z" }], AT)
        .state,
    ).toBe("anonymous");
    expect(
      vouchFrom(AVA, INSTANCE, [{ expires_at: "2026-09-23T09:59:59.000Z" }], AT)
        .state,
    ).toBe("anonymous");
  });

  it("is vouched where one statement of authority still stands", () => {
    const answer = vouchFrom(
      AVA,
      INSTANCE,
      [
        { revoked_at: "2026-01-01T00:00:00.000Z" },
        { expires_at: "2027-09-23T10:00:00.000Z" },
      ],
      AT,
    );
    expect(answer).toEqual({
      did: AVA,
      state: "vouched",
      instance: INSTANCE,
      at: AT,
    });
  });

  it("names no instance where nobody said where to look", () => {
    expect(vouchFrom(AVA, undefined, [], AT)).toEqual({
      did: AVA,
      state: "anonymous",
      at: AT,
    });
  });

  it("is anonymous for an identity minted here, with nobody to ask", () => {
    expect(anonymousVouch(AVA, AT)).toEqual({
      did: AVA,
      state: "anonymous",
      at: AT,
    });
  });
});

describe("the answer to act on", () => {
  const unreachable = { did: AVA, state: "unknown", at: AT } as const;

  it("is what resolution just said, wherever it said anything", () => {
    const fresh = vouchFrom(AVA, INSTANCE, [], AT);
    expect(standingVouch(fresh, { vouch: "vouched", checked_at: AT })).toBe(
      fresh,
    );
  });

  it("keeps what an unreachable instance last settled on", () => {
    const held = {
      vouch: "vouched",
      checked_at: "2026-09-01T00:00:00.000Z",
    } as const;
    expect(standingVouch(unreachable, held)).toEqual({
      did: AVA,
      state: "vouched",
      at: held.checked_at,
    });
  });

  it("stays unknown where nothing was ever settled", () => {
    expect(standingVouch(unreachable, undefined)).toBe(unreachable);
    expect(standingVouch(unreachable, { vouch: undefined })).toBe(unreachable);
  });
});

describe("an identity this instance has written down", () => {
  it("remembers where to look, and what was settled, and neither is required", () => {
    const row = {
      id: undefined,
      created_by: AVA,
      did: AVA,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const parsed = KnownIdentitySchema.omit({ id: true }).parse(row);
    expect(parsed.instance).toBeUndefined();
    expect(parsed.vouch).toBeUndefined();
    expect(parsed.checked_at).toBeUndefined();
  });

  it("never remembers that nothing answered", () => {
    expect(
      KnownIdentitySchema.omit({ id: true }).safeParse({
        created_by: AVA,
        did: AVA,
        vouch: "unknown",
        created_at: nowIso(),
        updated_at: nowIso(),
      }).success,
    ).toBe(false);
  });
});
