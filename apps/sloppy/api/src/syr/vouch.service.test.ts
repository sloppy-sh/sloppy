import { Logger } from "@nestjs/common";
import { DidSyrSchema } from "@sloppy/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyrService } from "./syr.service";
import { VouchService } from "./vouch.service";

const INSTANCE = "https://syr.is";
const DID = DidSyrSchema.parse("did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva");
const DELEGATIONS = "/api/platform/delegations";
const IDENTITY = `/.well-known/syr/${encodeURIComponent(DID)}`;

const MANIFEST = {
  name: "syr",
  public_url: INSTANCE,
  identity_manifest_template: `${INSTANCE}/.well-known/syr/{did}`,
  platform: {
    consent: `${INSTANCE}/auth/platform-consent`,
    token: `${INSTANCE}/api/platform/token`,
    sign: `${INSTANCE}/api/platform/sign`,
    challenge: `${INSTANCE}/api/platform/challenge`,
    delegations: `${INSTANCE}${DELEGATIONS}`,
    revoke: `${INSTANCE}/api/platform/revoke`,
  },
};

const IDENTITY_MANIFEST = {
  version: 1,
  did: DID,
  provider: INSTANCE,
  endpoints: {
    profile: `${INSTANCE}/api/public/profile/${DID}`,
    uploads: `${INSTANCE}/api/public/uploads/${DID}`,
    did_document: `${INSTANCE}/api/identity/${DID}/document`,
  },
  web_profile: `${INSTANCE}/u/${DID}`,
};

type Answer = { status?: number; body?: unknown };

function instance(answers: Record<string, Answer> = {}) {
  const fetchImpl = vi.fn(async (input: unknown) => {
    const asked = new URL(String(input));
    const held =
      answers[asked.pathname] ??
      (asked.pathname === "/.well-known/syr"
        ? { body: MANIFEST }
        : asked.pathname === IDENTITY
          ? { body: IDENTITY_MANIFEST }
          : { status: 404, body: {} });
    return new Response(JSON.stringify(held.body ?? null), {
      status: held.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

function vouching() {
  return new VouchService(new SyrService());
}

afterEach(() => vi.unstubAllGlobals());

describe("whether anybody stands behind an identity", () => {
  it("cannot say where nobody said where to look, and asks nobody", async () => {
    const fetchImpl = instance();
    const answer = await vouching().vouchFor(DID);
    expect(answer.state).toBe("unknown");
    expect(answer.instance).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot say where the record could not be reached", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    instance({ [IDENTITY]: { status: 404, body: {} } });
    expect((await vouching().vouchFor(DID, INSTANCE)).state).toBe("unknown");
  });

  it("cannot say where the record answered and the authority listing did not", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    instance({ [DELEGATIONS]: { status: 500, body: {} } });
    expect((await vouching().vouchFor(DID, INSTANCE)).state).toBe("unknown");
  });

  it("says vouched where the listing carries authority that still stands", async () => {
    instance({
      [DELEGATIONS]: {
        body: {
          data: [
            {
              delegate_public_key: "z6MkOld",
              revoked_at: "2026-01-01T00:00:00Z",
            },
            { delegate_public_key: "z6MkNow" },
          ],
        },
      },
    });
    const answer = await vouching().vouchFor(DID, "syr.is");
    expect(answer.state).toBe("vouched");
    expect(answer.instance).toBe(INSTANCE);
  });

  it("says anonymous where the listing answered with nothing standing", async () => {
    instance({ [DELEGATIONS]: { body: { data: [] } } });
    expect((await vouching().vouchFor(DID, INSTANCE)).state).toBe("anonymous");

    instance({
      [DELEGATIONS]: {
        body: [
          {
            delegate_public_key: "z6MkGone",
            expires_at: "2020-01-01T00:00:00Z",
          },
        ],
      },
    });
    expect((await vouching().vouchFor(DID, INSTANCE)).state).toBe("anonymous");
  });
});
