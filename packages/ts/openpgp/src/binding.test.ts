import { generateKey, type PublicKey, revokeKey } from "openpgp";
import { beforeAll, describe, expect, it } from "vitest";
import { type KeyAnswer, mailtoKeyBinding } from "./binding.js";

const ALICE = "mailto:alice@example.com";
const KEYSERVER = "https://keys.test";

const ADVANCED =
  "https://openpgpkey.example.com/.well-known/openpgpkey/example.com" +
  "/hu/kei1q4tipxxu1yj79k9kfukdhfy631xe?l=alice";
const DIRECT =
  "https://example.com/.well-known/openpgpkey" +
  "/hu/kei1q4tipxxu1yj79k9kfukdhfy631xe?l=alice";
const LOOKUP = `${KEYSERVER}/vks/v1/by-email/alice%40example.com`;

const held = (block: Uint8Array): KeyAnswer => ({ answer: "held", block });
const NONE: KeyAnswer = { answer: "none" };
const UNREACHABLE: KeyAnswer = { answer: "unreachable" };

/** What each address said, and nothing said at an address not named here. */
function reading(said: Record<string, KeyAnswer>) {
  const asked: string[] = [];
  const binding = mailtoKeyBinding({
    keyserver: KEYSERVER,
    read: (url) => {
      asked.push(url);
      return Promise.resolve(said[url] ?? UNREACHABLE);
    },
  });
  return { asked, binding };
}

async function keyFor(
  email: string,
  options: { date?: Date; keyExpirationTime?: number } = {},
): Promise<PublicKey> {
  const pair = await generateKey({
    type: "curve25519",
    userIDs: [{ name: "Somebody", email }],
    format: "object",
    ...options,
  });
  return pair.publicKey;
}

describe("which key speaks for an email address", () => {
  let alice: PublicKey;
  let armoured: Uint8Array;
  let binary: Uint8Array;

  beforeAll(async () => {
    alice = await keyFor("alice@example.com");
    armoured = new TextEncoder().encode(alice.armor());
    binary = alice.write();
  });

  it("asks about nobody named in another scheme", async () => {
    const { binding, asked } = reading({});
    expect(await binding.keysFor("did:syr:z6MkpTHR8VNs")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("takes the key the person's own domain serves", async () => {
    const { binding, asked } = reading({ [ADVANCED]: held(binary) });
    const keys = await binding.keysFor(ALICE);
    expect(keys).toEqual([
      {
        scheme: "openpgp",
        key: alice.armor(),
        signs: "content",
        from: ADVANCED,
      },
    ]);
    expect(asked).toEqual([ADVANCED]);
  });

  it("asks the domain itself where the subdomain is not there", async () => {
    const { binding, asked } = reading({ [DIRECT]: held(armoured) });
    const keys = await binding.keysFor(ALICE);
    expect(keys?.[0]?.from).toBe(DIRECT);
    expect(asked).toEqual([ADVANCED, DIRECT]);
  });

  it("asks a keyserver last, and records that it was the one that answered", async () => {
    const { binding, asked } = reading({
      [ADVANCED]: NONE,
      [DIRECT]: NONE,
      [LOOKUP]: held(armoured),
    });
    const keys = await binding.keysFor(ALICE);
    expect(keys?.[0]?.from).toBe(LOOKUP);
    expect(asked).toEqual([ADVANCED, DIRECT, LOOKUP]);
  });

  it("answers nobody where every address answered and none served a key", async () => {
    const { binding } = reading({
      [ADVANCED]: NONE,
      [DIRECT]: NONE,
      [LOOKUP]: NONE,
    });
    expect(await binding.keysFor(ALICE)).toEqual([]);
  });

  it("answers nothing where nothing answered", async () => {
    const { binding } = reading({
      [ADVANCED]: UNREACHABLE,
      [DIRECT]: UNREACHABLE,
      [LOOKUP]: UNREACHABLE,
    });
    expect(await binding.keysFor(ALICE)).toBeNull();
  });

  it("keeps no key that names somebody else", async () => {
    const mallory = await keyFor("mallory@example.com");
    const { binding } = reading({ [ADVANCED]: held(mallory.write()) });
    expect(await binding.keysFor(ALICE)).toEqual([]);
  });

  it("keeps a key whose user ID is spelled in another case", async () => {
    const shouting = await keyFor("Alice@Example.com");
    const { binding } = reading({ [ADVANCED]: held(shouting.write()) });
    expect((await binding.keysFor(ALICE))?.length).toBe(1);
  });

  it("keeps no key that has been revoked", async () => {
    const pair = await generateKey({
      type: "curve25519",
      userIDs: [{ name: "Somebody", email: "alice@example.com" }],
      format: "object",
    });
    const { publicKey } = await revokeKey({
      key: pair.publicKey,
      revocationCertificate: pair.revocationCertificate,
      format: "object",
    });
    const { binding } = reading({ [ADVANCED]: held(publicKey.write()) });
    expect(await binding.keysFor(ALICE)).toEqual([]);
  });

  it("keeps no key that has expired", async () => {
    const expired = await keyFor("alice@example.com", {
      date: new Date(Date.now() - 86_400_000),
      keyExpirationTime: 60,
    });
    const { binding } = reading({ [ADVANCED]: held(expired.write()) });
    expect(await binding.keysFor(ALICE)).toEqual([]);
  });

  it("reads past an address that served something that is not a key", async () => {
    const { binding } = reading({
      [ADVANCED]: held(new TextEncoder().encode("<html>not here</html>")),
      [DIRECT]: held(binary),
    });
    expect((await binding.keysFor(ALICE))?.[0]?.from).toBe(DIRECT);
  });
});
