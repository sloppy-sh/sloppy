import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign,
} from "@sloppy/idp";
import type { BoundKey, Principal, PublishedNode } from "@sloppy/types";
import { createMessage, generateKey, sign as openPgpSign } from "openpgp";
import { describe, expect, it } from "vitest";
import type { Keyholdings } from "../identity/identity-keys.service";
import { attributeNodes } from "./attribution";

const AUTHOR = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const BY_ADDRESS = "mailto:alice@example.com";
const LOCAL = "01JQXR000000000000000000A1";

const unsigned: PublishedNode = {
  ref: `${AUTHOR}/${LOCAL}`,
  address: "1a",
  origin: `${AUTHOR}/${LOCAL}`,
  title: "A city remembers",
  tags: [],
  links: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

const payloadFor = (node: PublishedNode) => ({
  type: "sloppy-node@v1",
  did: AUTHOR,
  node_id: LOCAL,
  address: node.address,
  title: node.title,
  created_at: node.created_at,
});

/** The statement a note whose author is named by an address carries, there
 *  being no `v1` that can be about one. */
const payloadV2For = (node: PublishedNode, principal: Principal) => ({
  type: "sloppy-node@v2",
  principal,
  node_id: LOCAL,
  ...(node.address === undefined ? {} : { address: node.address }),
  title: node.title,
  created_at: node.created_at,
});

/** Nobody has been asked about anybody. */
const unasked: Keyholdings = new Map();

function holding(principal: Principal, keys: BoundKey[]): Keyholdings {
  return new Map([[principal, keys]]);
}

/** An instance that did not answer, which is never an author who holds no key. */
function silentAbout(principal: Principal): Keyholdings {
  return new Map([[principal, null]]);
}

async function whose(
  node: PublishedNode,
  held: Keyholdings = unasked,
): Promise<string | undefined> {
  return (await attributeNodes([node], async () => held)).get(node.ref);
}

/** Signed the way an author's instance signs one: over the canonical form. */
function signedBy(
  node: PublishedNode,
  payload: Record<string, unknown> = payloadFor(node),
  keys = generateKeypair(),
): PublishedNode {
  return {
    ...node,
    signed_payload_json: JSON.stringify(payload),
    content_signature: encodeMultibase(
      sign(canonicalize(payload as JsonValue), keys.privateKey),
    ),
    signing_device_public_key: encodePublicKey(keys.publicKey),
  };
}

/** The key the instance signed with, as that instance's listing serves it. */
function approved(key: string): BoundKey {
  return { scheme: "ed25519-multibase", key, signs: "content" };
}

/** Signed the way somebody with their own OpenPGP key signs one: over the
 *  same canonical form, and never over the JSON as it happens to be spelled. */
async function openPgpSignedBy(
  node: PublishedNode,
  payload: Record<string, unknown> = payloadFor(node),
): Promise<{ node: PublishedNode; key: BoundKey }> {
  const pair = await generateKey({
    type: "curve25519",
    userIDs: [{ name: "Alice", email: "alice@example.com" }],
    format: "object",
  });
  const signature = await openPgpSign({
    message: await createMessage({
      binary: new TextEncoder().encode(canonicalize(payload as JsonValue)),
    }),
    signingKeys: pair.privateKey,
    detached: true,
  });
  return {
    node: {
      ...node,
      signature_scheme: "openpgp",
      signed_payload_json: JSON.stringify(payload),
      content_signature: signature,
      signing_device_public_key: pair.publicKey.armor(),
    },
    key: {
      scheme: "openpgp",
      key: pair.publicKey.armor(),
      signs: "content",
      from: "https://openpgpkey.example.com",
    },
  };
}

/** By hand because `JSON.stringify` will not walk this deep either, and
 *  `JSON.parse` will: what a peer can put on the wire is the bound here. */
function payloadJsonDeeperThanAReaderCanWalk(node: PublishedNode): string {
  const nesting = 50_000;
  const body = JSON.stringify(payloadFor(node));
  return `${body.slice(0, -1)},"nested":${"[".repeat(nesting)}${"]".repeat(nesting)}}`;
}

describe("what a reader can show about who wrote a published note", () => {
  it("weighs nothing about a note that carries no signature", async () => {
    expect(await whose(unsigned)).toBeUndefined();
  });

  it("holds a note whose key nobody has been shown to hold", async () => {
    expect(await whose(signedBy(unsigned))).toBe("unattributed");
  });

  it("calls it the author's when they hold the key it was signed with", async () => {
    const keys = generateKeypair();
    const signed = signedBy(unsigned, payloadFor(unsigned), keys);
    expect(
      await whose(
        signed,
        holding(AUTHOR, [approved(encodePublicKey(keys.publicKey))]),
      ),
    ).toBe("theirs");
  });

  it("refutes one signed under none of the keys its author holds", async () => {
    const somebodyElse = generateKeypair();
    expect(
      await whose(
        signedBy(unsigned),
        holding(AUTHOR, [approved(encodePublicKey(somebodyElse.publicKey))]),
      ),
    ).toBe("refuted");
  });

  it("holds one where the instance did not answer, rather than accusing", async () => {
    expect(await whose(signedBy(unsigned), silentAbout(AUTHOR))).toBe(
      "unattributed",
    );
  });

  it("holds one where the author is known to hold no key at all", async () => {
    expect(await whose(signedBy(unsigned), holding(AUTHOR, []))).toBe(
      "unattributed",
    );
  });

  it("holds one where all that is known of the author stands behind signing", async () => {
    const keys = generateKeypair();
    const signed = signedBy(unsigned, payloadFor(unsigned), keys);
    expect(
      await whose(
        signed,
        holding(AUTHOR, [
          {
            scheme: "ed25519-multibase",
            key: encodePublicKey(keys.publicKey),
            signs: "delegations",
          },
        ]),
      ),
    ).toBe("unattributed");
  });

  it("holds one whose author's key is in another scheme entirely", async () => {
    const { key } = await openPgpSignedBy(unsigned);
    expect(await whose(signedBy(unsigned), holding(AUTHOR, [key]))).toBe(
      "unattributed",
    );
  });

  it("refutes one whose payload is about another note", async () => {
    const elsewhere = signedBy(unsigned, {
      ...payloadFor(unsigned),
      title: "Something else entirely",
    });
    expect(await whose(elsewhere)).toBe("refuted");
  });

  it("refutes one whose payload was signed at another address", async () => {
    const moved = signedBy(unsigned, {
      ...payloadFor(unsigned),
      address: "1b",
    });
    expect(await whose(moved)).toBe("refuted");
  });

  it("refutes one whose signature does not check out", async () => {
    const tampered = signedBy(unsigned);
    const keys = generateKeypair();
    expect(
      await whose({
        ...tampered,
        signing_device_public_key: encodePublicKey(keys.publicKey),
      }),
    ).toBe("refuted");
  });

  it("refutes a payload that claims to be one and is not", async () => {
    expect(
      await whose({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "sloppy-node@v1" }),
      }),
    ).toBe("refuted");
  });

  it("weighs nothing about a note signed by a Sloppy it has never met", async () => {
    expect(
      await whose({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: JSON.stringify({ type: "sloppy-node@v9" }),
      }),
    ).toBeUndefined();
  });

  it("weighs nothing about a note signed in a scheme it cannot check", async () => {
    const tampered = signedBy(unsigned);
    expect(
      await whose({
        ...tampered,
        signature_scheme: "ml-dsa-87",
        content_signature: "not an ed25519 signature",
      }),
    ).toBeUndefined();
  });

  it("weighs nothing about a note whose payload it cannot read at all", async () => {
    expect(
      await whose({
        ...unsigned,
        content_signature: "zBogus",
        signing_device_public_key: "zBogus",
        signed_payload_json: "not json",
      }),
    ).toBeUndefined();
  });

  it("calls an OpenPGP note the author's when the address serves that key", async () => {
    const { node, key } = await openPgpSignedBy(unsigned);
    expect(await whose(node, holding(AUTHOR, [key]))).toBe("theirs");
  });

  it("refutes an OpenPGP note signed under a key the author does not hold", async () => {
    const mine = await openPgpSignedBy(unsigned);
    const theirs = await openPgpSignedBy(unsigned);
    expect(await whose(mine.node, holding(AUTHOR, [theirs.key]))).toBe(
      "refuted",
    );
  });

  it("refutes an OpenPGP signature over another note", async () => {
    const { node } = await openPgpSignedBy(unsigned);
    expect(await whose({ ...node, title: "Something else entirely" })).toBe(
      "refuted",
    );
  });

  it("refutes an OpenPGP signature made by somebody else's key", async () => {
    const { node } = await openPgpSignedBy(unsigned);
    const mallory = await generateKey({
      type: "curve25519",
      userIDs: [{ name: "Mallory", email: "mallory@example.com" }],
      format: "object",
    });
    expect(
      await whose({
        ...node,
        signing_device_public_key: mallory.publicKey.armor(),
      }),
    ).toBe("refuted");
  });

  it("checks a note that names the scheme an untagged one is in", async () => {
    const signed = signedBy(unsigned);
    expect(
      await whose({ ...signed, signature_scheme: "ed25519-multibase" }),
    ).toBe("unattributed");
    expect(
      await whose({
        ...signed,
        signature_scheme: "ed25519-multibase",
        title: "Something else entirely",
      }),
    ).toBe("refuted");
  });

  it("refutes an OpenPGP note whose payload no reader can canonicalise", async () => {
    const { node } = await openPgpSignedBy(unsigned);
    await expect(
      whose({
        ...node,
        signed_payload_json: payloadJsonDeeperThanAReaderCanWalk(unsigned),
      }),
    ).resolves.toBe("refuted");
  });
});

describe("how often a page of notes asks who holds a key", () => {
  function counted(held: Keyholdings = unasked) {
    let asks = 0;
    return {
      ask: async () => {
        asks += 1;
        return held;
      },
      made: () => asks,
    };
  }

  it("asks nobody about a page carrying no signature at all", async () => {
    const asking = counted();
    await attributeNodes([unsigned, unsigned], asking.ask);
    expect(asking.made()).toBe(0);
  });

  it("asks once for a page of many signed notes", async () => {
    const asking = counted();
    const page = Array.from({ length: 12 }, () => signedBy(unsigned));
    await attributeNodes(page, asking.ask);
    expect(asking.made()).toBe(1);
  });

  it("asks nobody where every signature is already refuted", async () => {
    const asking = counted();
    const wrong = signedBy(unsigned, {
      ...payloadFor(unsigned),
      title: "Something else entirely",
    });
    await attributeNodes([wrong, wrong], asking.ask);
    expect(asking.made()).toBe(0);
  });
});

describe("a note whose author is named by an address", () => {
  const hers: PublishedNode = {
    ...unsigned,
    ref: `${BY_ADDRESS}/${LOCAL}`,
    origin: `${BY_ADDRESS}/${LOCAL}`,
  };

  it("carries a statement about itself that v1 could not make", async () => {
    const { node, key } = await openPgpSignedBy(
      hers,
      payloadV2For(hers, BY_ADDRESS),
    );
    expect(await whose(node, holding(BY_ADDRESS, [key]))).toBe("theirs");
  });

  it("is refuted where the statement names somebody else", async () => {
    const { node, key } = await openPgpSignedBy(
      hers,
      payloadV2For(hers, AUTHOR),
    );
    expect(await whose(node, holding(BY_ADDRESS, [key]))).toBe("refuted");
  });

  it("can be signed with no label, and matches a note that has none", async () => {
    const unlabelled = { ...hers, address: undefined };
    const { node, key } = await openPgpSignedBy(
      unlabelled,
      payloadV2For(unlabelled, BY_ADDRESS),
    );
    expect(await whose(node, holding(BY_ADDRESS, [key]))).toBe("theirs");
  });

  it("refutes a statement with no label about a note that has one", async () => {
    const { node, key } = await openPgpSignedBy(
      hers,
      payloadV2For({ ...hers, address: undefined }, BY_ADDRESS),
    );
    expect(await whose(node, holding(BY_ADDRESS, [key]))).toBe("refuted");
  });

  it("refutes a v1 statement about a note nobody labelled", async () => {
    const unlabelled = { ...unsigned, address: undefined };
    expect(
      await whose(
        signedBy(unlabelled, { ...payloadFor(unlabelled), address: "1a" }),
      ),
    ).toBe("refuted");
  });
});
