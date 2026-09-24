import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { BoundKey, KeyBinding, Principal } from "@sloppy/types";
import {
  createCleartextMessage,
  createMessage,
  generateKey,
  type PrivateKey,
  readPrivateKey,
  sign,
} from "openpgp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { KeySignInService } from "./key-sign-in.service";
import type { NewSession, SessionStore } from "./session.store";

const HERE = "https://sloppy.sh";
const ALICE = "mailto:alice@example.com";

let alice: { publicKey: string; privateKey: PrivateKey };
let mallory: { publicKey: string; privateKey: PrivateKey };

beforeAll(async () => {
  [alice, mallory] = await Promise.all([keypair(), keypair()]);
}, 30_000);

async function keypair() {
  const made = await generateKey({
    type: "curve25519",
    userIDs: [{ email: "somebody@example.com" }],
    format: "armored",
  });
  return {
    publicKey: made.publicKey,
    privateKey: await readPrivateKey({ armoredKey: made.privateKey }),
  };
}

/** What `gpg --detach-sign --armor` over a file leaves beside it. */
async function signed(text: string, key: PrivateKey): Promise<string> {
  return sign({
    message: await createMessage({ binary: new TextEncoder().encode(text) }),
    signingKeys: key,
    detached: true,
    format: "armored",
  });
}

/** What `gpg --clearsign` hands back instead: the text and the signature
 *  together, which is as readily what somebody pastes. */
async function signedWithTheText(
  text: string,
  key: PrivateKey,
): Promise<string> {
  return sign({
    message: await createCleartextMessage({ text }),
    signingKeys: key,
  });
}

function bindingAnswering(
  keys: readonly BoundKey[] | null,
  scheme: KeyBinding["scheme"] = "mailto",
): KeyBinding {
  return { scheme, keysFor: () => Promise.resolve(keys) };
}

function contentKey(publicKey: string): BoundKey {
  return { scheme: "openpgp", key: publicKey, signs: "content" };
}

/** The rows the door writes, and the credentials it hands back for them. */
function sessions() {
  const written: NewSession[] = [];
  const store = {
    issue: (session: NewSession) => {
      written.push(session);
      return Promise.resolve({
        credential: "a-credential",
        row: {
          created_by: session.did,
          expires_at: session.expires_at,
          ...(session.delegation ?? {}),
        },
      });
    },
  } as unknown as SessionStore;
  return { store, written };
}

function door(
  bindings: readonly KeyBinding[],
  store: SessionStore = sessions().store,
  publicUrl = HERE,
) {
  return new KeySignInService(
    { publicUrl } as AppConfigService,
    "a-secret",
    bindings,
    store,
  );
}

async function signInAs(
  keySignIn: KeySignInService,
  principal: Principal,
  key: PrivateKey,
) {
  const { statement } = keySignIn.challenge(principal);
  return keySignIn.answer({
    statement,
    signature: await signed(statement, key),
  });
}

/** The refusal a door hands back, for comparing one against another. */
async function refusalOf(
  keySignIn: KeySignInService,
  key: PrivateKey,
): Promise<UnauthorizedException> {
  try {
    await signInAs(keySignIn, ALICE, key);
  } catch (refusal) {
    if (refusal instanceof UnauthorizedException) return refusal;
    throw refusal;
  }
  throw new Error("The door settled a session it should have refused");
}

describe("signing in with a key of your own", () => {
  it("settles a session for somebody whose key signs the text", async () => {
    const store = sessions();
    const keySignIn = door(
      [bindingAnswering([contentKey(alice.publicKey)])],
      store.store,
    );

    const settled = await signInAs(keySignIn, ALICE, alice.privateKey);

    expect(settled.token).toBe("a-credential");
    expect(settled.viewer.did).toBe(ALICE);
    expect(store.written).toHaveLength(1);
    expect(store.written[0].delegation).toBeUndefined();
  });

  // Sloppy holds nothing it could act as this person with, and a viewer that
  // said otherwise would have surfaces offering what cannot be done.
  it("answers with a viewer that has no instance and no key behind it", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);

    const { viewer } = await signInAs(keySignIn, ALICE, alice.privateKey);

    expect(viewer.syr_instance_url).toBeUndefined();
    expect(viewer.delegate_public_key).toBeUndefined();
  });

  it("refuses a signature by somebody else's key", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);

    await expect(
      signInAs(keySignIn, ALICE, mallory.privateKey),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // The key that stands behind the keys that sign is not one that signs, so
  // holding it is not being somebody.
  it("refuses a key that signs delegations rather than content", async () => {
    const keySignIn = door([
      bindingAnswering([
        { scheme: "openpgp", key: alice.publicKey, signs: "delegations" },
      ]),
    ]);

    await expect(
      signInAs(keySignIn, ALICE, alice.privateKey),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses where nobody holds a key for the address", async () => {
    const keySignIn = door([bindingAnswering([])]);

    await expect(
      signInAs(keySignIn, ALICE, alice.privateKey),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Two requests cost nothing, so a refusal that told them apart would be a way
  // to work through somebody's addresses and learn which of them publish a key.
  it("refuses a wrong signature and an address with no key in the same words", async () => {
    const wrongKey = await refusalOf(
      door([bindingAnswering([contentKey(alice.publicKey)])]),
      mallory.privateKey,
    );
    const noKey = await refusalOf(
      door([bindingAnswering([])]),
      alice.privateKey,
    );

    expect(noKey.getStatus()).toBe(wrongKey.getStatus());
    expect(noKey.message).toBe(wrongKey.message);
  });

  it("takes the text and the signature pasted back together", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);
    const { statement } = keySignIn.challenge(ALICE);

    await expect(
      keySignIn.answer({
        statement,
        signature: await signedWithTheText(statement, alice.privateKey),
      }),
    ).resolves.toMatchObject({ viewer: { did: ALICE } });
  });

  // What is pasted is read for the signature in it and never for the text: a
  // block somebody else signed is refused however good the signature in it is.
  it("refuses somebody else's key pasted back that way", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);
    const { statement } = keySignIn.challenge(ALICE);

    await expect(
      keySignIn.answer({
        statement,
        signature: await signedWithTheText(statement, mallory.privateKey),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses a text signed alongside one that was issued", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);
    const { statement } = keySignIn.challenge(ALICE);

    await expect(
      keySignIn.answer({
        statement,
        signature: await signedWithTheText(
          `${statement} and something else`,
          alice.privateKey,
        ),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses where this build holds no binding for the scheme", async () => {
    const keySignIn = door([]);

    await expect(
      signInAs(keySignIn, ALICE, alice.privateKey),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // A binding that could not answer is not a statement about anybody, so it is
  // an instance having a bad afternoon rather than a sign-in that was refused.
  it("says it could not check rather than refusing, where the binding did not answer", async () => {
    const keySignIn = door([bindingAnswering(null)]);

    await expect(
      signInAs(keySignIn, ALICE, alice.privateKey),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("takes a signature over the text with the last newline a file would carry", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);
    const { statement } = keySignIn.challenge(ALICE);

    await expect(
      keySignIn.answer({
        statement,
        signature: await signed(`${statement}\n`, alice.privateKey),
      }),
    ).resolves.toMatchObject({ viewer: { did: ALICE } });
  });

  it("will not sign in twice with one text", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);
    const { statement } = keySignIn.challenge(ALICE);
    const signature = await signed(statement, alice.privateKey);

    await expect(
      keySignIn.answer({ statement, signature }),
    ).resolves.toBeTruthy();
    await expect(
      keySignIn.answer({ statement, signature }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // A statement carries the instance it was issued by, so one caught here is
  // not one to present somewhere else.
  it("will not take a text another Sloppy issued", async () => {
    const elsewhere = door(
      [bindingAnswering([contentKey(alice.publicKey)])],
      sessions().store,
      "https://notes.example",
    );
    const { statement } = elsewhere.challenge(ALICE);
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);

    await expect(
      keySignIn.answer({
        statement,
        signature: await signed(statement, alice.privateKey),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // The signature is checked before anything is spent, so getting the paste
  // wrong does not cost the text that was read and weighed.
  it("leaves the text good after a signature that did not check out", async () => {
    const keySignIn = door([bindingAnswering([contentKey(alice.publicKey)])]);
    const { statement } = keySignIn.challenge(ALICE);

    await expect(
      keySignIn.answer({
        statement,
        signature: await signed(statement, mallory.privateKey),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      keySignIn.answer({
        statement,
        signature: await signed(statement, alice.privateKey),
      }),
    ).resolves.toMatchObject({ viewer: { did: ALICE } });
  });

  it("asks the binding about the identity the text names and no other", async () => {
    const keysFor = vi.fn().mockResolvedValue([contentKey(alice.publicKey)]);
    const keySignIn = door([{ scheme: "mailto", keysFor }]);

    await signInAs(keySignIn, ALICE, alice.privateKey);

    expect(keysFor).toHaveBeenCalledExactlyOnceWith(ALICE);
  });
});
