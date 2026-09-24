import { canonicalize, type JsonValue } from "@sloppy/idp";
import { createMessage, generateKey, sign } from "openpgp";
import { beforeAll, describe, expect, it } from "vitest";
import { signatureChecksOut } from "./signature";

const PAYLOAD = { type: "sloppy-node@v1", title: "A city remembers", at: 1 };

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
});
