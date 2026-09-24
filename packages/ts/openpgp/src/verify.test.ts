import {
  createMessage,
  generateKey,
  type PrivateKey,
  type PublicKey,
  sign,
} from "openpgp";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyOpenPgpSignature } from "./verify.js";

type Signer = { privateKey: PrivateKey; publicKey: PublicKey };

const PAYLOAD = '{"content":"a note","did":"mailto:alice@example.com"}';

async function newSigner(name: string): Promise<Signer> {
  return await generateKey({
    type: "curve25519",
    userIDs: [{ name, email: `${name}@example.com` }],
    format: "object",
  });
}

async function detach(
  pair: Signer,
  payload: string,
  format: "armored" | "binary",
): Promise<string | Uint8Array> {
  const message = await createMessage({
    binary: new TextEncoder().encode(payload),
  });
  return format === "binary"
    ? await sign({
        message,
        signingKeys: pair.privateKey,
        detached: true,
        format: "binary",
      })
    : await sign({ message, signingKeys: pair.privateKey, detached: true });
}

describe("verifyOpenPgpSignature", () => {
  let alice: Signer;
  let mallory: Signer;

  beforeAll(async () => {
    [alice, mallory] = await Promise.all([
      newSigner("alice"),
      newSigner("mallory"),
    ]);
  });

  it("takes an armoured signature against an armoured key", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(alice, PAYLOAD, "armored"),
        publicKey: alice.publicKey.armor(),
      }),
    ).toBe(true);
  });

  it("takes the binary form of both", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: new TextEncoder().encode(PAYLOAD),
        signature: await detach(alice, PAYLOAD, "binary"),
        publicKey: alice.publicKey.write(),
      }),
    ).toBe(true);
  });

  it("takes either form against either", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(alice, PAYLOAD, "binary"),
        publicKey: alice.publicKey.armor(),
      }),
    ).toBe(true);
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(alice, PAYLOAD, "armored"),
        publicKey: alice.publicKey.write(),
      }),
    ).toBe(true);
  });

  it("refuses a payload altered by one byte", async () => {
    const signature = await detach(alice, PAYLOAD, "armored");
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD.replace("a note", "a nose"),
        signature,
        publicKey: alice.publicKey.armor(),
      }),
    ).toBe(false);
  });

  it("refuses a signature by somebody else's key", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(mallory, PAYLOAD, "armored"),
        publicKey: alice.publicKey.armor(),
      }),
    ).toBe(false);
  });

  it("refuses a signature over a different payload", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(alice, `${PAYLOAD} `, "armored"),
        publicKey: alice.publicKey.armor(),
      }),
    ).toBe(false);
  });

  it("answers rather than throws on material that is not a signature", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: "not a signature",
        publicKey: alice.publicKey.armor(),
      }),
    ).toBe(false);
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(alice, PAYLOAD, "armored"),
        publicKey: "not a key",
      }),
    ).toBe(false);
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: new Uint8Array([1, 2, 3]),
        publicKey: new Uint8Array([4, 5, 6]),
      }),
    ).toBe(false);
  });

  it("takes a signature made while the key was still current", async () => {
    const signedAt = new Date(Date.now() - 600_000);
    const lapsed = await generateKey({
      type: "curve25519",
      userIDs: [{ name: "lapsed", email: "lapsed@example.com" }],
      format: "object",
      date: signedAt,
      keyExpirationTime: 1,
    });
    const signature = await sign({
      message: await createMessage({
        binary: new TextEncoder().encode(PAYLOAD),
      }),
      signingKeys: lapsed.privateKey,
      detached: true,
      date: signedAt,
    });
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature,
        publicKey: lapsed.publicKey.armor(),
      }),
    ).toBe(true);
  });

  it("refuses a revoked key, however old the signature", async () => {
    const signature = await detach(alice, PAYLOAD, "armored");
    const revoked = await alice.privateKey.revoke();
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature,
        publicKey: revoked.toPublic().armor(),
      }),
    ).toBe(false);
  });

  it("takes a key handed in with its secret half", async () => {
    expect(
      await verifyOpenPgpSignature({
        payload: PAYLOAD,
        signature: await detach(alice, PAYLOAD, "armored"),
        publicKey: alice.privateKey.armor(),
      }),
    ).toBe(true);
  });
});
