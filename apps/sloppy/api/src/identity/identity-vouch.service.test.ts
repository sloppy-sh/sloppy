import type { BoundKey, Principal, Vouch } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { SyrService } from "../syr/syr.service";
import { VouchService } from "../syr/vouch.service";
import type { IdentityKeysService } from "./identity-keys.service";
import { IdentityVouchService } from "./identity-vouch.service";

const ALICE = "mailto:alice@example.com";
const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const WKD = "https://openpgpkey.example.com/.well-known/openpgpkey/…";

const config = {
  isProduction: false,
  publicUrl: "http://sloppy.example",
} as unknown as AppConfigService;

function resolving(held: readonly BoundKey[] | null): IdentityVouchService {
  const keys = {
    keysFor: (_: Principal) => Promise.resolve(held),
  } as unknown as IdentityKeysService;
  return new IdentityVouchService(
    new VouchService(new SyrService(), config),
    keys,
  );
}

const key: BoundKey = {
  scheme: "openpgp",
  key: "-----BEGIN PGP PUBLIC KEY BLOCK-----",
  signs: "content",
  from: WKD,
};

describe("whether anybody stands behind somebody named by email address", () => {
  it("stands behind somebody a key is served for, and says which served it", async () => {
    const answer: Vouch = await resolving([key]).vouchFor(ALICE);
    expect(answer.state).toBe("vouched");
    expect(answer.instance).toBe(WKD);
  });

  it("stands behind nobody where every address answered and none served one", async () => {
    const answer = await resolving([]).vouchFor(ALICE);
    expect(answer.state).toBe("anonymous");
    expect(answer.instance).toBeUndefined();
  });

  it("says nothing where nothing answered", async () => {
    expect((await resolving(null).vouchFor(ALICE)).state).toBe("unknown");
  });

  it("asks nobody about a syr identity with no address to start from", async () => {
    expect((await resolving(null).vouchFor(DID)).state).toBe("unknown");
  });

  it("says nothing about somebody named in no scheme at all", async () => {
    expect((await resolving([key]).vouchFor("alice")).state).toBe("unknown");
  });
});
