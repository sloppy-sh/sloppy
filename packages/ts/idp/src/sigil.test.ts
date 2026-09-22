import { describe, expect, it } from "vitest";
import { encodeMultibase, encodePublicKey } from "./encoding.js";
import { generateKeypair } from "./keys.js";
import {
  createSigil,
  openSigil,
  readSigil,
  type Sigil,
  SigilDecryptionError,
  SigilFormatError,
  sigilDid,
  sigilPublicKey,
  withSigilSeed,
  writeSigil,
} from "./sigil.js";

// Written by syr's own `syr-crypto-sigil::create_sigil` from the seed and
// passphrase below. Regenerate it there — one written here would prove only
// that we agree with ourselves.
const SYR_REFERENCE_SIGIL: Sigil = {
  v: 1,
  kdf: {
    name: "argon2id",
    salt: "BRW5eBlwvESTKX3uIKLGNw",
    mem: 65536,
    it: 3,
    par: 1,
  },
  enc: {
    name: "aes-256-gcm",
    nonce: "lZKEj0abJj_dp5kZ",
    ct: "MC454pw-j501sjfga_d0wh1CIaqdgeZ8lw8DGMsOnuk",
    tag: "EGypnQtfzA4TELyQCL6s2w",
  },
  pub: "z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
};
const SYR_REFERENCE_SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
// Escapes, not literals: a combining acute and an "fi" ligature, so the Sigil
// above opens only under the same NFKC folding syr applies.
const SYR_REFERENCE_PASSPHRASE = "cafe\u0301-\uFB01xture";

const PASSPHRASE = "correct horse battery";

describe("a Sigil", () => {
  it("opens one syr wrote", async () => {
    expect(
      await openSigil(SYR_REFERENCE_SIGIL, SYR_REFERENCE_PASSPHRASE),
    ).toEqual(SYR_REFERENCE_SEED);
  });

  it("names the identity while it stays sealed", () => {
    const sigil = readSigil(writeSigil(SYR_REFERENCE_SIGIL));
    expect(sigil).toEqual(SYR_REFERENCE_SIGIL);
    expect(sigilDid(sigil)).toBe(`did:syr:${SYR_REFERENCE_SIGIL.pub}`);
  });

  it("labels one with the same key syr derives from that seed", async () => {
    const sigil = await createSigil(
      SYR_REFERENCE_SEED,
      SYR_REFERENCE_PASSPHRASE,
    );
    expect(sigil.pub).toBe(SYR_REFERENCE_SIGIL.pub);
  });

  it("gives back exactly the seed it was given", async () => {
    const { privateKey, publicKey } = generateKeypair();
    const sigil = await createSigil(privateKey, PASSPHRASE);
    expect(sigil.v).toBe(1);
    expect(sigil.kdf.name).toBe("argon2id");
    expect(sigil.enc.name).toBe("aes-256-gcm");
    expect({
      mem: sigil.kdf.mem,
      it: sigil.kdf.it,
      par: sigil.kdf.par,
    }).toEqual({ mem: 65536, it: 3, par: 1 });
    expect(Buffer.from(sigil.kdf.salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(sigil.enc.nonce, "base64url")).toHaveLength(12);
    expect(Buffer.from(sigil.enc.ct, "base64url")).toHaveLength(32);
    expect(Buffer.from(sigil.enc.tag, "base64url")).toHaveLength(16);
    expect(sigil.pub).toBe(encodePublicKey(publicKey));

    expect(await openSigil(sigil, PASSPHRASE)).toEqual(privateKey);
  });

  it("spells every field the way syr spells it: base64url, no padding", () => {
    const fields = [
      SYR_REFERENCE_SIGIL.kdf.salt,
      SYR_REFERENCE_SIGIL.enc.nonce,
      SYR_REFERENCE_SIGIL.enc.ct,
      SYR_REFERENCE_SIGIL.enc.tag,
    ];
    for (const field of fields) {
      expect(field).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("survives the trip through a file", async () => {
    const { privateKey } = generateKeypair();
    const written = writeSigil(await createSigil(privateKey, PASSPHRASE));
    expect(await openSigil(readSigil(written), PASSPHRASE)).toEqual(privateKey);
  });

  it("refuses a wrong passphrase and a tampered file the same way", async () => {
    const sigil = await createSigil(generateKeypair().privateKey, "right");
    await expect(openSigil(sigil, "wrong")).rejects.toThrow(
      SigilDecryptionError,
    );
    const flipped = Buffer.from(sigil.enc.ct, "base64url");
    flipped[0] ^= 0xff;
    await expect(
      openSigil(
        { ...sigil, enc: { ...sigil.enc, ct: flipped.toString("base64url") } },
        "right",
      ),
    ).rejects.toThrow(SigilDecryptionError);
  });

  it("opens one whose key on the outside is written without the prefix", async () => {
    const { privateKey, publicKey } = generateKeypair();
    const sigil = await createSigil(privateKey, PASSPHRASE);
    const unprefixed = { ...sigil, pub: encodeMultibase(publicKey) };
    expect(unprefixed.pub).not.toBe(sigil.pub);

    expect(sigilPublicKey(unprefixed)).toBe(sigil.pub);
    expect(sigilDid(unprefixed)).toBe(sigilDid(sigil));
    await expect(openSigil(unprefixed, PASSPHRASE)).resolves.toEqual(
      privateKey,
    );
  });

  it("refuses a seed whose key is not the one on the outside", async () => {
    const sigil = await createSigil(generateKeypair().privateKey, PASSPHRASE);
    const somebodyElse = encodePublicKey(generateKeypair().publicKey);
    await expect(
      openSigil({ ...sigil, pub: somebodyElse }, PASSPHRASE),
    ).rejects.toThrow(SigilDecryptionError);
  });

  it("normalises the passphrase, so the same keystrokes always open it", async () => {
    // Escapes rather than literals: these are the same character typed two
    // ways, and a source file that got normalised would test nothing.
    const composed = "caf\u00E9";
    const decomposed = "cafe\u0301";
    expect(composed).not.toBe(decomposed);
    const sigil = await createSigil(generateKeypair().privateKey, composed);
    await expect(openSigil(sigil, decomposed)).resolves.toBeDefined();
  });

  it("refuses a seed that is not an Ed25519 one", async () => {
    await expect(createSigil(new Uint8Array(16), PASSPHRASE)).rejects.toThrow();
  });

  it("refuses a version, a KDF or a cipher it does not know", () => {
    for (const other of [
      { ...SYR_REFERENCE_SIGIL, v: 2 },
      {
        ...SYR_REFERENCE_SIGIL,
        kdf: { ...SYR_REFERENCE_SIGIL.kdf, name: "scrypt" },
      },
      {
        ...SYR_REFERENCE_SIGIL,
        enc: { ...SYR_REFERENCE_SIGIL.enc, name: "chacha20-poly1305" },
      },
    ]) {
      expect(() => readSigil(JSON.stringify(other))).toThrow(SigilFormatError);
    }
  });

  it("refuses parameters no key derives from, and ones that would make deriving it unbounded work", async () => {
    for (const kdf of [
      { mem: 262145 },
      { it: 11 },
      { par: 5 },
      { mem: 0 },
      { it: 0 },
      { par: 0 },
      { mem: 4 },
      { mem: 16, par: 4 },
    ]) {
      const other = {
        ...SYR_REFERENCE_SIGIL,
        kdf: { ...SYR_REFERENCE_SIGIL.kdf, ...kdf },
      };
      expect(() => readSigil(JSON.stringify(other))).toThrow(SigilFormatError);
      await expect(
        openSigil(other as Sigil, SYR_REFERENCE_PASSPHRASE),
      ).rejects.toThrow(SigilFormatError);
    }
  });

  it("refuses a salt, a nonce or a tag that is not the size it must be", () => {
    const short = Buffer.alloc(4).toString("base64url");
    for (const other of [
      {
        ...SYR_REFERENCE_SIGIL,
        kdf: { ...SYR_REFERENCE_SIGIL.kdf, salt: short },
      },
      {
        ...SYR_REFERENCE_SIGIL,
        enc: {
          ...SYR_REFERENCE_SIGIL.enc,
          nonce: Buffer.alloc(16).toString("base64url"),
        },
      },
      {
        ...SYR_REFERENCE_SIGIL,
        enc: { ...SYR_REFERENCE_SIGIL.enc, tag: short },
      },
    ]) {
      expect(() => readSigil(JSON.stringify(other))).toThrow(SigilFormatError);
    }
  });

  it("refuses a file that is not one at all", () => {
    for (const not of ["", "{}", "[]", "not json", '{"v":1}']) {
      expect(() => readSigil(not)).toThrow(SigilFormatError);
    }
  });

  it("refuses a public key that is not an Ed25519 one", () => {
    expect(() =>
      readSigil(JSON.stringify({ ...SYR_REFERENCE_SIGIL, pub: "zNotAKey" })),
    ).toThrow(SigilFormatError);
  });

  it("wipes the seed once the caller is finished with it", async () => {
    const { privateKey } = generateKeypair();
    const sigil = await createSigil(privateKey, PASSPHRASE);
    let escaped: Uint8Array | undefined;
    await withSigilSeed(sigil, PASSPHRASE, (seed) => {
      escaped = seed;
      expect(seed).toEqual(privateKey);
    });
    expect(escaped).toEqual(new Uint8Array(32));
  });

  it("wipes the seed even when the caller throws", async () => {
    const sigil = await createSigil(generateKeypair().privateKey, PASSPHRASE);
    let escaped: Uint8Array | undefined;
    await expect(
      withSigilSeed(sigil, PASSPHRASE, (seed) => {
        escaped = seed;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(escaped).toEqual(new Uint8Array(32));
  });
});
