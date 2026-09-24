import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign as signMultibase,
} from "@sloppy/idp";
import { createMessage, generateKey, sign } from "openpgp";
import { beforeAll, describe, expect, it } from "vitest";
import { signatureChecksOut } from "./signature";

const PAYLOAD = { type: "sloppy-node@v1", title: "A city remembers", at: 1 };

function deeperThanCanonicalizeCanWalk(): Record<string, unknown> {
  const depth = 50_000;
  return {
    ...PAYLOAD,
    nested: JSON.parse(`${"[".repeat(depth)}${"]".repeat(depth)}`) as JsonValue,
  };
}

describe("checking a signature in the scheme its row names", () => {
  let publicKey: string;
  let signOver: (bytes: string) => Promise<string>;

  beforeAll(async () => {
    const pair = await generateKey({
      type: "curve25519",
      userIDs: [{ name: "Alice", email: "alice@example.com" }],
      format: "object",
    });
    publicKey = pair.publicKey.armor();
    signOver = async (bytes) =>
      await sign({
        message: await createMessage({
          binary: new TextEncoder().encode(bytes),
        }),
        signingKeys: pair.privateKey,
        detached: true,
      });
  });

  it("takes an OpenPGP signature over the payload's canonical form", async () => {
    expect(
      await signatureChecksOut({
        scheme: "openpgp",
        payload: PAYLOAD,
        signature: await signOver(canonicalize(PAYLOAD as JsonValue)),
        publicKey,
      }),
    ).toBe(true);
  });

  it("takes no signature over the payload as it happened to be spelled", async () => {
    expect(
      await signatureChecksOut({
        scheme: "openpgp",
        payload: PAYLOAD,
        signature: await signOver(JSON.stringify(PAYLOAD, null, 2)),
        publicKey,
      }),
    ).toBe(false);
  });

  it("answers an OpenPGP payload that has no canonical form", async () => {
    await expect(
      signatureChecksOut({
        scheme: "openpgp",
        payload: deeperThanCanonicalizeCanWalk(),
        signature: await signOver(canonicalize(PAYLOAD as JsonValue)),
        publicKey,
      }),
    ).resolves.toBe(false);
  });

  it("answers a multibase payload that has no canonical form", async () => {
    const keys = generateKeypair();
    await expect(
      signatureChecksOut({
        scheme: "ed25519-multibase",
        payload: deeperThanCanonicalizeCanWalk(),
        signature: encodeMultibase(
          signMultibase(canonicalize(PAYLOAD as JsonValue), keys.privateKey),
        ),
        publicKey: encodePublicKey(keys.publicKey),
      }),
    ).resolves.toBe(false);
  });
});
