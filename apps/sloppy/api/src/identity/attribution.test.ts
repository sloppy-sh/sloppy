import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  sign as signMultibase,
} from "@sloppy/idp";
import type { BoundKey } from "@sloppy/types";
import { describe, expect, it, vi } from "vitest";
import { attributionOf } from "./attribution";

const checks = vi.hoisted(() => ({ count: 0 }));
vi.mock("./signature", async (original) => {
  const real = await original<typeof import("./signature")>();
  return {
    ...real,
    signatureChecksOut: (
      params: Parameters<typeof real.signatureChecksOut>[0],
    ) => {
      checks.count += 1;
      return real.signatureChecksOut(params);
    },
  };
});

const PAYLOAD = { type: "sloppy-node@v1", title: "A city remembers" };

async function signedBy(pair: Awaited<ReturnType<typeof generateKeypair>>) {
  return encodeMultibase(
    await signMultibase(canonicalize(PAYLOAD), pair.privateKey),
  );
}

function holds(key: string): BoundKey {
  return { scheme: "ed25519-multibase", key, signs: "content" };
}

describe("whose a signed row is", () => {
  it("is theirs where the key it was signed with is one they hold", async () => {
    const pair = await generateKeypair();
    const spelled = encodePublicKey(pair.publicKey);

    expect(
      await attributionOf(
        {
          scheme: "ed25519-multibase",
          payload: PAYLOAD,
          signature: await signedBy(pair),
          publicKey: spelled,
        },
        [holds(spelled)],
      ),
    ).toBe("theirs");
  });

  it("is unattributed where nobody can be shown to hold that key", async () => {
    const theirs = await generateKeypair();
    const stranger = await generateKeypair();

    expect(
      await attributionOf(
        {
          scheme: "ed25519-multibase",
          payload: PAYLOAD,
          signature: await signedBy(stranger),
          publicKey: encodePublicKey(stranger.publicKey),
        },
        [holds(encodePublicKey(theirs.publicKey))],
      ),
    ).toBe("unattributed");
  });

  // The listing is the party being weighed: how long it is, is theirs to
  // choose. Checking the signature once per key in it would let a stranger
  // decide how much of this instance one row costs.
  it("checks the signature once, however many keys the author lists", async () => {
    const stranger = await generateKeypair();
    const claim = {
      scheme: "ed25519-multibase" as const,
      payload: PAYLOAD,
      signature: await signedBy(stranger),
      publicKey: encodePublicKey(stranger.publicKey),
    };
    const many = await Promise.all(
      Array.from({ length: 32 }, async () =>
        holds(encodePublicKey((await generateKeypair()).publicKey)),
      ),
    );

    checks.count = 0;
    expect(await attributionOf(claim, many)).toBe("unattributed");
    expect(checks.count).toBe(1);

    checks.count = 0;
    expect(await attributionOf(claim, [])).toBe("unattributed");
    expect(checks.count).toBe(1);
  });
});
