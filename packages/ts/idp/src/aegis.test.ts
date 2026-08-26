import { describe, expect, it } from "vitest";
import {
  type AegisBundle,
  AegisDecryptionError,
  createAegisBundle,
  decryptAegisBundle,
  withSeed,
} from "./aegis.js";
import { encodePublicKey } from "./encoding.js";
import { generateKeypair } from "./keys.js";

// Minted by syr's own `syr-crypto-aegis::create_aegis_bundle` from the seed and
// password below. Regenerate it there — one minted here would prove only that
// we agree with ourselves.
const SYR_REFERENCE_BUNDLE: AegisBundle = {
  pub: "z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
  salt: "9MoyATyuqrosA4jqfh1mEQ",
  nonce: "yIvba2pZMynXGcLE",
  ct: "Ij_lSOuU-o50IboAsQxEsb4pklPhBHXxYZhyA9C4RrQ",
  tag: "PEvDVgjZDEKfhOH6v_1uaA",
  kdf: { mem: 65536, it: 3, par: 1 },
};
const SYR_REFERENCE_SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
// Escapes, not literals: a combining acute and an "fi" ligature, so the bundle
// above opens only under the same NFKC folding syr applies.
const SYR_REFERENCE_PASSWORD = "cafe\u0301-\uFB01xture";

describe("the Aegis bundle", () => {
  it("opens one syr wrote", () => {
    expect(
      decryptAegisBundle(SYR_REFERENCE_BUNDLE, SYR_REFERENCE_PASSWORD),
    ).toEqual(SYR_REFERENCE_SEED);
  });

  it("labels a bundle with the same key syr derives from that seed", () => {
    const bundle = createAegisBundle(
      SYR_REFERENCE_SEED,
      SYR_REFERENCE_PASSWORD,
    );
    expect(bundle.pub).toBe(SYR_REFERENCE_BUNDLE.pub);
  });

  it("gives back exactly the seed it was given", () => {
    const { privateKey, publicKey } = generateKeypair();
    const bundle = createAegisBundle(privateKey, "correct horse battery");
    expect(bundle.kdf).toEqual({ mem: 65536, it: 3, par: 1 });
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
