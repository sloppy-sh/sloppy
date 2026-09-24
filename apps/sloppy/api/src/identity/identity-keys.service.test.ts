import type { DelegationEntry, SyrService } from "../syr/syr.service";
import type { AppConfigService } from "../config/app-config.service";
import { describe, expect, it } from "vitest";
import { IdentityKeysService, type AskedAt } from "./identity-keys.service";
import type { TrustedInstance } from "@sloppy/types";

const SYR = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const ELSEWHERE = "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const HERS: TrustedInstance = {
  url: "https://syr.example",
  word: "written_down",
};

const HERE = {
  isProduction: false,
  publicUrl: "https://sloppy.example",
} as unknown as AppConfigService;

/** An instance that lists what it has approved, and counts who it was asked
 *  about. */
function listing(entries: DelegationEntry[] | null) {
  const asked: string[] = [];
  const syr = {
    providerFor: async (_at: string, did: string) => {
      asked.push(did);
      return "https://syr.example";
    },
    listDelegations: async () => entries,
  } as unknown as SyrService;
  return { syr, asked };
}

function ask(
  syr: SyrService,
  asked: AskedAt,
): Promise<ReadonlyMap<string, unknown>> {
  return new IdentityKeysService(HERE, syr).contentKeysFor(asked);
}

describe("what somebody signs content with", () => {
  it("is what their instance has approved, and never the key that names them", async () => {
    const { syr } = listing([{ delegate_public_key: "zDelegate" }]);
    const held = await ask(syr, new Map([[SYR, HERS]]));
    expect(held.get(SYR)).toEqual([
      {
        scheme: "ed25519-multibase",
        key: "zDelegate",
        signs: "content",
        from: "https://syr.example",
      },
    ]);
  });

  it("is unanswered where nobody named an instance to ask", async () => {
    const { syr, asked } = listing([{ delegate_public_key: "zDelegate" }]);
    const held = await ask(syr, new Map([[SYR, undefined]]));
    expect(held.get(SYR)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("is unanswered where the instance said nothing", async () => {
    const { syr } = listing(null);
    const held = await ask(syr, new Map([[SYR, HERS]]));
    expect(held.get(SYR)).toBeNull();
  });

  it("leaves out a delegation its holder has retired", async () => {
    const { syr } = listing([
      { delegate_public_key: "zRevoked", revoked_at: "2026-01-01T00:00:00Z" },
      { delegate_public_key: "zRanOut", expires_at: "2026-01-01T00:00:00Z" },
      { delegate_public_key: "zStands" },
    ]);
    const held = await ask(syr, new Map([[SYR, HERS]]));
    expect(held.get(SYR)).toEqual([
      expect.objectContaining({ key: "zStands" }),
    ]);
  });

  it("asks each person's own instance, and nobody else's", async () => {
    const { syr, asked } = listing([{ delegate_public_key: "zDelegate" }]);
    await ask(
      syr,
      new Map([
        [SYR, HERS],
        [ELSEWHERE, HERS],
      ]),
    );
    expect(asked).toEqual([SYR, ELSEWHERE]);
  });
});
