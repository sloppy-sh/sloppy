import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dummyUnlock } from "./aegis.js";
import { generateKeypair } from "./keys.js";
import { openSeed, sealSeed, withSealedSeed } from "./sealing.js";

const KEY = randomBytes(32);

function elapsed(action: () => void): number {
  const started = performance.now();
  action();
  return performance.now() - started;
}

describe("a sealed delegate seed", () => {
  it("gives back exactly the seed it was given", () => {
    const { privateKey } = generateKeypair();
    const sealed = sealSeed(privateKey, KEY);
    expect(Buffer.from(sealed.nonce, "base64url")).toHaveLength(12);
    expect(Buffer.from(sealed.tag, "base64url")).toHaveLength(16);
    expect(openSeed(sealed, KEY)).toEqual(privateKey);
  });

  it("is different bytes every time, from the same seed and key", () => {
    const { privateKey } = generateKeypair();
    expect(sealSeed(privateKey, KEY).ct).not.toBe(sealSeed(privateKey, KEY).ct);
  });

  it("will not open under another instance's key", () => {
    const sealed = sealSeed(generateKeypair().privateKey, KEY);
    expect(() => openSeed(sealed, randomBytes(32))).toThrow();
  });

  it("will not open once a byte has been changed", () => {
    const sealed = sealSeed(generateKeypair().privateKey, KEY);
    const flipped = Buffer.from(sealed.ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() =>
      openSeed({ ...sealed, ct: flipped.toString("base64url") }, KEY),
    ).toThrow();
    expect(() => openSeed({ ...sealed, nonce: "" }, KEY)).toThrow();
  });

  it("refuses a seed that is not an Ed25519 one", () => {
    expect(() => sealSeed(new Uint8Array(16), KEY)).toThrow();
  });

  it("wipes the seed once the caller is finished, and when it throws", () => {
    const sealed = sealSeed(generateKeypair().privateKey, KEY);
    let escaped: Uint8Array | undefined;
    withSealedSeed(sealed, KEY, (seed) => {
      escaped = seed;
    });
    expect(escaped).toEqual(new Uint8Array(32));

    expect(() =>
      withSealedSeed(sealed, KEY, (seed) => {
        escaped = seed;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(escaped).toEqual(new Uint8Array(32));
  });

  // Every content write signs through `platform.sign`, so this is the guard
  // that stops password stretching from landing back on that path. The two
  // costs are orders of magnitude apart, and both scale with the machine.
  it("opens a hundred seals for less than one password unlock costs", () => {
    const sealed = sealSeed(generateKeypair().privateKey, KEY);
    withSealedSeed(sealed, KEY, () => undefined);
    dummyUnlock();

    const oneUnlock = elapsed(() => dummyUnlock());
    const hundredSeals = elapsed(() => {
      for (let i = 0; i < 100; i++) {
        withSealedSeed(sealed, KEY, () => undefined);
      }
    });
    expect(hundredSeals).toBeLessThan(oneUnlock);
  });
});
