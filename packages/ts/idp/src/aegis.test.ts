import { describe, expect, it } from "vitest";
import {
  AegisDecryptionError,
  createAegisBundle,
  decryptAegisBundle,
  withSeed,
} from "./aegis.js";
import { encodePublicKey } from "./encoding.js";
import { generateKeypair } from "./keys.js";

describe("the Aegis bundle", () => {
  it("gives back exactly the seed it was given", () => {
    const { privateKey, publicKey } = generateKeypair();
    const bundle = createAegisBundle(privateKey, "correct horse battery");
    expect(bundle.kdf).toEqual({ mem: 65536, it: 3, par: 1 });
    // syr's field widths, which an instance on the other side reads by offset.
    expect(Buffer.from(bundle.salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(bundle.nonce, "base64url")).toHaveLength(12);
    expect(Buffer.from(bundle.tag, "base64url")).toHaveLength(16);
    expect(bundle.pub).toBe(encodePublicKey(publicKey));

    expect(decryptAegisBundle(bundle, "correct horse battery")).toEqual(
      privateKey,
    );
  });

  it("refuses a wrong password and a tampered bundle the same way", () => {
    const bundle = createAegisBundle(generateKeypair().privateKey, "right");
    expect(() => decryptAegisBundle(bundle, "wrong")).toThrow(
      AegisDecryptionError,
    );
    const flipped = Buffer.from(bundle.ct, "base64url");
    flipped[0] ^= 0xff;
    expect(() =>
      decryptAegisBundle(
        { ...bundle, ct: flipped.toString("base64url") },
        "right",
      ),
    ).toThrow(AegisDecryptionError);
  });

  it("normalises the password, so the same keystrokes always open it", () => {
    // Escapes rather than literals: these are the same character typed two
    // ways, and a source file that got normalised would test nothing.
    const composed = "caf\u00E9";
    const decomposed = "cafe\u0301";
    expect(composed).not.toBe(decomposed);
    const bundle = createAegisBundle(generateKeypair().privateKey, composed);
    expect(() => decryptAegisBundle(bundle, decomposed)).not.toThrow();
  });

  it("refuses a seed that is not an Ed25519 one", () => {
    expect(() => createAegisBundle(new Uint8Array(16), "pass")).toThrow();
  });

  it("refuses parameters that would make deriving the key unbounded work", () => {
    const bundle = createAegisBundle(generateKeypair().privateKey, "pass");
    expect(() =>
      decryptAegisBundle(
        { ...bundle, kdf: { ...bundle.kdf, mem: 1024 * 1024 * 64 } },
        "pass",
      ),
    ).toThrow();
  });

  it("wipes the seed once the caller is finished with it", () => {
    const { privateKey } = generateKeypair();
    const bundle = createAegisBundle(privateKey, "pass");
    let escaped: Uint8Array | undefined;
    withSeed(bundle, "pass", (seed) => {
      escaped = seed;
      expect(seed).toEqual(privateKey);
    });
    expect(escaped).toEqual(new Uint8Array(32));
  });

  it("wipes the seed even when the caller throws", () => {
    const bundle = createAegisBundle(generateKeypair().privateKey, "pass");
    let escaped: Uint8Array | undefined;
    expect(() =>
      withSeed(bundle, "pass", (seed) => {
        escaped = seed;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(escaped).toEqual(new Uint8Array(32));
  });
});
