import { deriveDid, generateKeypair } from "@sloppy/idp";
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

/** An instance that lists what it has approved, counting who it was asked
 *  about and how many of those asks were open at once. */
function listing(entries: DelegationEntry[] | null) {
  const asked: string[] = [];
  let open = 0;
  let mostOpen = 0;
  const syr = {
    providerFor: async (_at: string, did: string) => {
      asked.push(did);
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      await new Promise((settle) => setTimeout(settle, 0));
      open -= 1;
      return "https://syr.example";
    },
    listDelegations: async () => entries,
  } as unknown as SyrService;
  return { syr, asked, mostOpen: () => mostOpen };
}

/** As many standing delegations as a listing cares to carry. */
function manyStanding(howMany: number): DelegationEntry[] {
  return Array.from({ length: howMany }, (_, at) => ({
    delegate_public_key: `zDelegate${at}`,
  }));
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

  it("is unanswered where more keys are listed than a reader will weigh", async () => {
    const { syr } = listing(manyStanding(1_000));
    const held = await ask(syr, new Map([[SYR, HERS]]));
    expect(held.get(SYR)).toBeNull();
  });

  it("weighs the keys that stand rather than the rows that were listed", async () => {
    const { syr } = listing([
      ...manyStanding(1_000).map((entry) => ({
        ...entry,
        revoked_at: "2026-01-01T00:00:00Z",
      })),
      { delegate_public_key: "zStands" },
    ]);
    const held = await ask(syr, new Map([[SYR, HERS]]));
    expect(held.get(SYR)).toEqual([
      expect.objectContaining({ key: "zStands" }),
    ]);
  });

  it("holds a run of instances open at a time, never a page of them", async () => {
    const { syr, asked, mostOpen } = listing([
      { delegate_public_key: "zDelegate" },
    ]);
    const everyone = Array.from({ length: 20 }, () =>
      deriveDid(generateKeypair().publicKey),
    );
    await ask(syr, new Map(everyone.map((did) => [did, HERS])));
    expect(asked).toHaveLength(20);
    expect(mostOpen()).toBeLessThanOrEqual(8);
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
