import {
  createSigil,
  deriveDid,
  encodePrivateKey,
  encodePublicKey,
  generateKeypair,
  publicKeyFromDid,
  publicKeyFromPrivateKey,
  writeSigil,
} from "@sloppy/idp/crypto";
import { type DidSyr, DidSyrSchema } from "@sloppy/types";
import { decodeText, encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { LocalApi } from "./api.js";
import type { Fetching } from "./delegation.js";
import { MemoryFiles } from "./files.js";
import { LocalGraph } from "./graph.js";
import {
  CARRIED_FILE,
  CARRIED_SEALED_FILE,
  callIt,
  carryIdentityOut,
  type DeviceIdentity,
  holdDelegatedIdentity,
  holdDeviceIdentity,
  holdSealedIdentity,
  Identities,
  type IdentitiesOptions,
  IDENTITIES_FILE,
  IDENTITY_FILE,
  identityOf,
  LocalIdentityError,
  makeLocalIdentity,
  openLocalIdentity,
  readCarriedIdentity,
  readIdentities,
  readLocalKey,
  readSealedIdentity,
  type SealedIdentity,
  SEED_FILE,
  whoWrites,
  withSealedKey,
  writeAs,
  writeIdentities,
} from "./identity.js";

function files(): MemoryFiles {
  return new MemoryFiles({ data: "/data" });
}

/** The lone file a device kept before the list. */
async function asItWas(
  held: MemoryFiles,
  did: string,
  publicKey: string,
): Promise<void> {
  await held
    .at("/data")
    .write(
      IDENTITY_FILE,
      encodeText(
        `${JSON.stringify({ did, public_key: publicKey, seed: SEED_FILE })}\n`,
      ),
    );
}

async function deviceIdentity(
  held: MemoryFiles,
): Promise<{ identity: DeviceIdentity; key: Uint8Array }> {
  const made = makeLocalIdentity();
  const key = made.key.slice();
  return { identity: await holdDeviceIdentity(held, made), key };
}

const PASSPHRASE = "a fixture passphrase";

interface ASigil {
  file: Uint8Array;
  did: DidSyr;
  public_key: string;
  key: Uint8Array;
}

/** One sealed file for every test here — deriving its key is deliberately slow,
 *  and none of these ask which key it is. */
let sealedOnce: Promise<ASigil> | undefined;

function aSigil(): Promise<ASigil> {
  sealedOnce ??= (async () => {
    const { privateKey, publicKey } = generateKeypair();
    return {
      file: writeSigil(await createSigil(privateKey, PASSPHRASE)),
      did: DidSyrSchema.parse(deriveDid(publicKey)),
      public_key: encodePublicKey(publicKey),
      key: privateKey,
    };
  })();
  return sealedOnce;
}

describe("the identities this device holds", () => {
  it("makes one on first run with nothing asked of anybody", async () => {
    const held = files();
    expect((await readIdentities(held)).identities).toEqual([]);

    const identity = await openLocalIdentity(held);
    expect(identity.did).toMatch(/^did:syr:z/);
    expect((await readIdentities(held)).identities).toEqual([
      expect.objectContaining({ did: identity.did, source: "device" }),
    ]);
  });

  it("is the same identity the next time the app opens", async () => {
    const held = files();
    const first = await openLocalIdentity(held);
    expect((await openLocalIdentity(held)).did).toBe(first.did);
  });

  it("names the key it signs with rather than carrying it", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);
    const key = await readLocalKey(held, identity);
    if (!key) throw new Error("no key was kept");

    expect(key).toHaveLength(32);
    const written = await held.at("/data").read(IDENTITIES_FILE);
    expect(new TextDecoder().decode(written ?? new Uint8Array())).not.toContain(
      encodePrivateKey(key),
    );
  });

  it("is a key that answers for the DID it was written beside", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);
    const key = await readLocalKey(held, identity);
    if (!key) throw new Error("no key was kept");

    expect(publicKeyFromPrivateKey(key)).toEqual(
      publicKeyFromDid(identity.did),
    );
  });

  it("answers no key where the file it names is gone", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);
    await held.at("/data").remove(identity.seed);

    expect(await readLocalKey(held, identity)).toBeUndefined();
  });

  it("gives each identity made here its own key file", async () => {
    const held = files();
    const first = await deviceIdentity(held);
    const second = await deviceIdentity(held);

    expect(second.identity.seed).not.toBe(first.identity.seed);
    expect(await readLocalKey(held, first.identity)).toEqual(first.key);
    expect(await readLocalKey(held, second.identity)).toEqual(second.key);
  });

  it("refuses to mint a second identity over a list it cannot read", async () => {
    const held = files();
    await held.at("/data").write(IDENTITIES_FILE, encodeText("not json"));

    await expect(openLocalIdentity(held)).rejects.toBeInstanceOf(
      LocalIdentityError,
    );
  });

  it("keeps one held sealed exactly as it was written", async () => {
    const held = files();
    const { did, public_key } = makeLocalIdentity().identity;
    const sealed: SealedIdentity = {
      did,
      public_key,
      source: "sealed",
      sealed: "identity.sealed",
      name: "Ada",
    };
    await writeIdentities(held, { identities: [sealed], writing: did });

    expect(await readIdentities(held)).toEqual({
      identities: [sealed],
      writing: did,
    });
  });

  it("holds one sealed that nothing says a name for", async () => {
    const held = files();
    const { did, public_key } = makeLocalIdentity().identity;
    const sealed: SealedIdentity = {
      did,
      public_key,
      source: "sealed",
      sealed: "identity.sealed",
    };
    await writeIdentities(held, { identities: [sealed], writing: did });

    expect((await readIdentities(held)).identities).toEqual([sealed]);
  });

  it("refuses the list rather than the row where a sealed one names no key", async () => {
    const held = files();
    const { did, public_key } = makeLocalIdentity().identity;
    await held
      .at("/data")
      .write(
        IDENTITIES_FILE,
        encodeText(
          `${JSON.stringify({ identities: [{ did, public_key, source: "sealed" }] })}\n`,
        ),
      );

    await expect(readIdentities(held)).rejects.toThrow(LocalIdentityError);
  });

  it("reads a list written before a key could arrive shut", async () => {
    const held = files();
    const { did, public_key } = makeLocalIdentity().identity;
    await held.at("/data").write(
      IDENTITIES_FILE,
      encodeText(
        `${JSON.stringify({
          identities: [{ did, public_key, seed: SEED_FILE }],
          writing: did,
        })}\n`,
      ),
    );

    expect(await readIdentities(held)).toEqual({
      identities: [{ did, public_key, source: "device", seed: SEED_FILE }],
      writing: did,
    });
  });

  it("lets go of the seed once it is written down", async () => {
    const made = makeLocalIdentity();
    await holdDeviceIdentity(files(), made);

    expect(made.key.every((byte) => byte === 0)).toBe(true);
  });
});

describe("a device that kept one identity before the list", () => {
  it("reads the lone file as the one identity it made here", async () => {
    const held = files();
    const made = makeLocalIdentity();
    await held.at("/data").write(made.identity.seed, encodeText("unused"));
    await asItWas(held, made.identity.did, made.identity.public_key);

    const list = await readIdentities(held);
    expect(list.identities).toEqual([
      {
        did: made.identity.did,
        public_key: made.identity.public_key,
        source: "device",
        seed: SEED_FILE,
      },
    ]);
    expect(list.writing).toBe(made.identity.did);
  });

  it("writes the list back and stops reading the lone file", async () => {
    const held = files();
    const made = makeLocalIdentity();
    await asItWas(held, made.identity.did, made.identity.public_key);
    await readIdentities(held);

    expect(await held.at("/data").read(IDENTITY_FILE)).toBeUndefined();
    expect(await held.at("/data").read(IDENTITIES_FILE)).toBeDefined();
  });

  it("keeps writing under the identity that folder's graphs belong to", async () => {
    const held = files();
    const made = makeLocalIdentity();
    await asItWas(held, made.identity.did, made.identity.public_key);

    expect((await openLocalIdentity(held)).did).toBe(made.identity.did);
  });

  it("refuses rather than starting over on a lone file it cannot read", async () => {
    const held = files();
    await held.at("/data").write(IDENTITY_FILE, encodeText("not json"));

    await expect(readIdentities(held)).rejects.toBeInstanceOf(
      LocalIdentityError,
    );
  });
});

describe("which identity a write carries", () => {
  const mine = makeLocalIdentity().identity.did;
  const theirs = makeLocalIdentity().identity.did;

  function list(writing?: DidSyr): {
    identities: DeviceIdentity[];
    writing?: DidSyr;
  } {
    return {
      identities: [
        { did: mine, public_key: "zMine", source: "device", seed: "a.key" },
      ],
      ...(writing === undefined ? {} : { writing }),
    };
  }

  it("is the graph's own owner where this device holds it", () => {
    expect(whoWrites(list(), mine)).toBe(mine);
  });

  it("is the one chosen here where the graph belongs to somebody else", () => {
    expect(whoWrites(list(mine), theirs)).toBe(mine);
  });

  it("is the one chosen here where no graph is open", () => {
    expect(whoWrites(list(mine))).toBe(mine);
  });

  it("is nobody on a device holding none", () => {
    expect(whoWrites({ identities: [] }, theirs)).toBeUndefined();
  });

  it("opens under the one named rather than the one chosen", async () => {
    const held = files();
    const first = await deviceIdentity(held);
    const second = await deviceIdentity(held);

    expect((await openLocalIdentity(held, first.identity.did)).did).toBe(
      first.identity.did,
    );
    expect((await openLocalIdentity(held)).did).toBe(second.identity.did);
  });

  it("reads a graph belonging to an identity this device does not hold", async () => {
    const held = files();
    await deviceIdentity(held);

    expect(await openLocalIdentity(held, theirs)).toEqual(identityOf(theirs));
  });

  it("writes under the one somebody chose from then on", async () => {
    const held = files();
    const first = await deviceIdentity(held);
    await deviceIdentity(held);
    await writeAs(held, first.identity.did);

    expect((await readIdentities(held)).writing).toBe(first.identity.did);
    expect((await openLocalIdentity(held)).did).toBe(first.identity.did);
  });

  it("will not write under an identity this device does not hold", async () => {
    const held = files();
    await deviceIdentity(held);

    await expect(writeAs(held, theirs)).rejects.toBeInstanceOf(
      LocalIdentityError,
    );
  });

  it("forgets a chosen identity that is no longer in the list", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);
    await writeIdentities(held, { identities: [], writing: identity.did });

    expect((await readIdentities(held)).writing).toBeUndefined();
  });
});

describe("what a person here calls an identity", () => {
  /** The list as a device wrote it before anybody could name one. */
  async function asRowsWere(
    held: MemoryFiles,
    did: string,
    publicKey: string,
  ): Promise<void> {
    await held.at("/data").write(
      IDENTITIES_FILE,
      encodeText(
        `${JSON.stringify({
          identities: [
            { did, public_key: publicKey, source: "device", seed: SEED_FILE },
          ],
          writing: did,
        })}\n`,
      ),
    );
  }

  it("is nothing on a row written before anybody could name one", async () => {
    const held = files();
    const { did, public_key } = makeLocalIdentity().identity;
    await asRowsWere(held, did, public_key);

    const [one] = (await readIdentities(held)).identities;

    expect(one?.did).toBe(did);
    expect(one?.label).toBeUndefined();
  });

  it("is what they typed, and is still there the next time", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);

    await callIt(held, identity.did, "  Thesis  ");

    const now = await readIdentities(held);
    expect(now.identities[0]?.label).toBe("Thesis");
    expect(now.writing).toBe(identity.did);
  });

  it("goes back to nothing where they leave it empty", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);
    await callIt(held, identity.did, "Thesis");

    await callIt(held, identity.did, "   ");

    const [one] = (await readIdentities(held)).identities;
    expect(one?.label).toBeUndefined();
    expect(JSON.stringify(one)).not.toContain("label");
  });

  it("stays theirs when the same identity arrives here again", async () => {
    const held = files();
    const { identity } = await deviceIdentity(held);
    await callIt(held, identity.did, "Thesis");

    const again = await holdDeviceIdentity(
      held,
      readCarriedIdentity(
        carryIdentityOut(
          identity,
          (await readLocalKey(held, identity)) ?? new Uint8Array(),
        ),
      ),
    );

    expect(again.label).toBe("Thesis");
    expect((await readIdentities(held)).identities[0]?.label).toBe("Thesis");
  });

  it("names nobody this device does not hold", async () => {
    const held = files();
    await deviceIdentity(held);

    await expect(
      callIt(held, makeLocalIdentity().identity.did, "Thesis"),
    ).rejects.toBeInstanceOf(LocalIdentityError);
  });
});

describe("an identity kept by a store somewhere else", () => {
  const did = makeLocalIdentity().identity.did;

  it("is held with nothing of its key, and writes from then on", async () => {
    const held = files();
    await deviceIdentity(held);
    await holdDelegatedIdentity(held, {
      did,
      public_key: "zStored",
      source: "delegated",
      instance_url: "https://keys.example",
      delegate_public_key: "zDelegate",
      access_token: "a-token",
      name: "Ada",
    });

    const list = await readIdentities(held);
    expect(list.writing).toBe(did);
    const one = list.identities.find((held) => held.did === did);
    expect(one).toEqual({
      did,
      public_key: "zStored",
      source: "delegated",
      instance_url: "https://keys.example",
      delegate_public_key: "zDelegate",
      access_token: "a-token",
      name: "Ada",
    });
  });

  it("replaces what this device held of it rather than listing it twice", async () => {
    const held = files();
    const one = {
      did,
      public_key: "zStored",
      source: "delegated",
      instance_url: "https://keys.example",
      delegate_public_key: "zDelegate",
      access_token: "first",
    } as const;
    await holdDelegatedIdentity(held, one);
    await holdDelegatedIdentity(held, { ...one, access_token: "second" });

    const list = await readIdentities(held);
    expect(list.identities).toHaveLength(1);
    expect(list.identities[0]).toMatchObject({ access_token: "second" });
  });
});

describe("an identity carried to another device", () => {
  it("comes back as the same identity it left as", async () => {
    const here = files();
    const { identity, key } = await deviceIdentity(here);
    const file = carryIdentityOut(identity, key);

    const there = files();
    const arrived = await holdDeviceIdentity(there, readCarriedIdentity(file));

    expect(arrived.did).toBe(identity.did);
    expect(arrived.public_key).toBe(identity.public_key);
    expect(await readLocalKey(there, arrived)).toEqual(key);
  });

  it("is named so a person knows what the file is", () => {
    expect(CARRIED_FILE).toBe("sloppy-identity.json");
  });

  it("refuses a file that is not one", () => {
    expect(() => readCarriedIdentity(encodeText("not json"))).toThrow();
    expect(() =>
      readCarriedIdentity(encodeText(JSON.stringify({ did: "did:syr:z1" }))),
    ).toThrow();
  });

  it("refuses a file whose key is not the identity it names", async () => {
    const here = files();
    const { key } = await deviceIdentity(here);
    const somebodyElse = makeLocalIdentity();
    const file = encodeText(
      JSON.stringify({
        sloppy_identity: 1,
        did: somebodyElse.identity.did,
        public_key: somebodyElse.identity.public_key,
        key: encodePrivateKey(key),
      }),
    );

    expect(() => readCarriedIdentity(file)).toThrow();
  });
});

describe("a key that arrived shut", () => {
  /** The same sealed file with somebody else's public key on the outside of
   *  it — a file nothing inside answers for. */
  async function relabelled(): Promise<Uint8Array> {
    const said = JSON.parse(new TextDecoder().decode((await aSigil()).file));
    said.pub = makeLocalIdentity().identity.public_key;
    return encodeText(JSON.stringify(said));
  }

  async function brought(held: MemoryFiles): Promise<SealedIdentity> {
    return holdSealedIdentity(held, readSealedIdentity((await aSigil()).file));
  }

  it("says who it is of with nothing asked of anybody", async () => {
    const one = await aSigil();

    expect(readSealedIdentity(one.file).identity).toEqual({
      did: one.did,
      public_key: one.public_key,
      source: "sealed",
      sealed: `${one.public_key}.sealed`,
    });
  });

  it("is kept byte for byte as it arrived", async () => {
    const held = files();
    const identity = await brought(held);

    expect(await held.at("/data").read(identity.sealed)).toEqual(
      (await aSigil()).file,
    );
  });

  it("leaves nothing on this device that opens without the person", async () => {
    const held = files();
    await brought(held);

    const spelled = encodePrivateKey((await aSigil()).key);
    for (const path of await held.at("/data").list("")) {
      const bytes = await held.at("/data").read(path);
      expect(
        new TextDecoder().decode(bytes ?? new Uint8Array()),
        path,
      ).not.toContain(spelled);
    }
  });

  it("clears the key the same identity was held here in the clear under", async () => {
    const held = files();
    const one = await aSigil();
    const inTheClear = await holdDeviceIdentity(
      held,
      readCarriedIdentity(
        encodeText(
          JSON.stringify({
            sloppy_identity: 1,
            did: one.did,
            public_key: one.public_key,
            key: encodePrivateKey(one.key),
          }),
        ),
      ),
    );
    expect(await held.at("/data").exists(inTheClear.seed)).toBe(true);

    await brought(held);

    expect(await held.at("/data").exists(inTheClear.seed)).toBe(false);
    const spelled = encodePrivateKey(one.key);
    for (const path of await held.at("/data").list("")) {
      const bytes = await held.at("/data").read(path);
      expect(
        new TextDecoder().decode(bytes ?? new Uint8Array()),
        path,
      ).not.toContain(spelled);
    }
  });

  it("opens for one act and lets the key go again", async () => {
    const held = files();
    const identity = await brought(held);
    let handed: Uint8Array | undefined;

    const answered = await withSealedKey(held, identity, PASSPHRASE, (key) => {
      handed = key;
      return encodePublicKey(publicKeyFromPrivateKey(key));
    });

    expect(answered).toBe(identity.public_key);
    expect(handed?.every((byte) => byte === 0)).toBe(true);
  });

  it("lets the key go where the act it opened for throws", async () => {
    const held = files();
    const identity = await brought(held);
    let handed: Uint8Array | undefined;

    await expect(
      withSealedKey(held, identity, PASSPHRASE, (key) => {
        handed = key;
        throw new Error("the act went wrong");
      }),
    ).rejects.toThrow("the act went wrong");

    expect(handed?.every((byte) => byte === 0)).toBe(true);
  });

  it("says what to try where the passphrase does not open it", async () => {
    const held = files();
    const identity = await brought(held);

    await expect(
      withSealedKey(held, identity, "not it", () => "opened"),
    ).rejects.toThrow(/did not open it. Try it again/i);
  });

  it("will not open a file that is not the key it is held as", async () => {
    const held = files();
    const identity = await brought(held);
    await held.at("/data").write(identity.sealed, await relabelled());

    await expect(
      withSealedKey(held, identity, PASSPHRASE, () => "opened"),
    ).rejects.toThrow(/Bring the identity in again/i);
  });

  it("will not open one whose key is not the one written on it", async () => {
    const held = files();
    const identity = await holdSealedIdentity(
      held,
      readSealedIdentity(await relabelled()),
    );

    await expect(
      withSealedKey(held, identity, PASSPHRASE, () => "opened"),
    ).rejects.toThrow(/did not open it/i);
  });

  it("has nothing to open where the file is gone from this device", async () => {
    const held = files();
    const identity = await brought(held);
    await held.at("/data").remove(identity.sealed);

    await expect(
      withSealedKey(held, identity, PASSPHRASE, () => "opened"),
    ).rejects.toThrow(/not on this device any more/i);
  });

  it("refuses a file that is not one", async () => {
    const notOne = /does not hold an identity/i;
    const halfOfOne = (await aSigil()).file.subarray(0, 40);

    expect(() => readSealedIdentity(encodeText("not json"))).toThrow(notOne);
    expect(() =>
      readSealedIdentity(encodeText(JSON.stringify({ v: 1 }))),
    ).toThrow(notOne);
    expect(() => readSealedIdentity(halfOfOne)).toThrow(notOne);
  });

  it("refuses one that arrived cut about", async () => {
    const said = JSON.parse(new TextDecoder().decode((await aSigil()).file));
    said.enc.tag = said.enc.tag.slice(0, 4);

    expect(() => readSealedIdentity(encodeText(JSON.stringify(said)))).toThrow(
      /does not hold an identity/i,
    );
  });
});

describe("the three doors a person is offered", () => {
  const INSTANCE = "https://keys.example";
  const ORIGIN = "https://sloppy.sh";
  const DID = "did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
  const ADA = "did:syr:z6MkrAdaAdaAdaAdaAdaAdaAdaAdaAda";

  const manifest = {
    name: "syr",
    public_url: INSTANCE,
    identity_manifest_template: `${INSTANCE}/.well-known/syr/{did}`,
    platform: {
      consent: `${INSTANCE}/consent`,
      token: `${INSTANCE}/api/platform/token`,
      sign: `${INSTANCE}/api/platform/sign`,
      challenge: `${INSTANCE}/api/platform/challenge`,
      delegations: `${INSTANCE}/api/platform/delegations`,
      revoke: `${INSTANCE}/api/platform/revoke`,
    },
  };

  function store(): { fetching: Fetching } {
    const answers: Record<string, unknown> = {
      [`${INSTANCE}/.well-known/syr`]: manifest,
      [`${INSTANCE}/api/platform/token`]: {
        access_token: "a-token",
        token_type: "Bearer",
        expires_in: 3600,
        did: DID,
        delegate_public_key: "zDelegate",
        scopes: ["identity:read", "profile:read"],
      },
      [`${INSTANCE}/.well-known/syr/${encodeURIComponent(DID)}`]: {
        version: 1,
        did: DID,
        provider: INSTANCE,
        endpoints: {
          profile: `${INSTANCE}/api/profile/ada`,
          uploads: `${INSTANCE}/api/uploads/ada`,
          did_document: `${INSTANCE}/api/did/ada`,
        },
        web_profile: `${INSTANCE}/ada`,
      },
      [`${INSTANCE}/api/profile/ada`]: {
        data: {
          did: DID,
          username: "ada",
          display_name: "Ada Lovelace",
          avatar_url: `${INSTANCE}/pictures/ada.png`,
        },
      },
    };
    const fetching: Fetching = async (url) => {
      const body = answers[url];
      const picture = url === `${INSTANCE}/pictures/ada.png`;
      if (body === undefined && !picture) throw new Error(`nothing at ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        arrayBuffer: async () =>
          new Uint8Array([137, 80, 78, 71]).slice().buffer as ArrayBuffer,
        headers: {
          get: (name) =>
            name === "content-type" && picture ? "image/png" : null,
        },
      };
    };
    return { fetching };
  }

  function identities(
    held: MemoryFiles,
    options: Partial<IdentitiesOptions> = {},
  ): { held: Identities; left: string[]; changes: number } {
    const left: string[] = [];
    const counter = { changes: 0 };
    const one = new Identities(held, {
      fetching: store().fetching,
      origin: ORIGIN,
      leave: (url) => {
        left.push(url);
      },
      changed: () => {
        counter.changes += 1;
      },
      ...options,
    });
    return {
      held: one,
      left,
      get changes() {
        return counter.changes;
      },
    };
  }

  const SEALED_FILE = "identity.sealed";

  async function holdSealed(
    held: MemoryFiles,
    name?: string,
  ): Promise<{ did: DidSyr; public_key: string }> {
    const one = await aSigil();
    await held.at("/data").write(SEALED_FILE, one.file);
    await writeIdentities(held, {
      identities: [
        {
          did: one.did,
          public_key: one.public_key,
          source: "sealed",
          sealed: SEALED_FILE,
          ...(name === undefined ? {} : { name }),
        },
      ],
      writing: one.did,
    });
    return { did: one.did, public_key: one.public_key };
  }

  /** What a store puts on the callback, as the relay hands it over. */
  function cameBack(consent: string, extra: Record<string, string> = {}) {
    const state = new URL(consent).searchParams.get("state") ?? "";
    return new URLSearchParams({
      code: "a-code",
      delegation_id: "a-delegation",
      state,
      ...extra,
    });
  }

  it("makes one here with nothing asked, and writes under it", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);

    const made = await door.held.makeOne();

    expect(made.source).toBe("device");
    expect(made.writing).toBe(true);
    expect(made.carriable).toBe(true);
    expect(await door.held.list()).toEqual([made]);
  });

  it("sends somebody to their store and comes back holding the identity", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);

    await door.held.signIn("keys.example");
    expect(door.left).toHaveLength(1);

    const signedIn = await door.held.finish(cameBack(door.left[0] ?? ""));

    expect(signedIn?.identity.did).toBe(DID);
    expect(signedIn?.identity.source).toBe("delegated");
    expect(signedIn?.identity.instance).toBe("keys.example");
    expect(signedIn?.identity.carriable).toBe(false);
    expect(signedIn?.name).toBe("Ada Lovelace");
    expect(signedIn?.picture?.type).toBe("image/png");
  });

  it("keeps no key of an identity a store holds", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    await door.held.finish(cameBack(door.left[0] ?? ""));

    const list = await readIdentities(files);
    const one = list.identities.find((held) => held.did === DID);
    expect(one?.source).toBe("delegated");
    expect(JSON.stringify(one)).not.toContain("seed");
    expect(
      (await files.at("/data").list("")).filter((path) =>
        path.endsWith(".key"),
      ),
    ).toEqual([]);
  });

  it("leaves a return nobody here asked for alone", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);

    expect(
      await door.held.finish(
        new URLSearchParams({ code: "c", delegation_id: "d", state: "s" }),
      ),
    ).toBeUndefined();
    expect((await readIdentities(files)).identities).toEqual([]);
  });

  it("spends what came back once, so a second read of the same link does nothing", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    const came = cameBack(door.left[0] ?? "");
    await door.held.finish(came);

    expect(await door.held.finish(came)).toBeUndefined();
  });

  it("says what to do next where the store was not approved", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);

    await expect(
      door.held.finish(cameBack(door.left[0] ?? "", { error: "denied" })),
    ).rejects.toThrow(/not signed in/i);
    expect((await readIdentities(files)).identities).toEqual([]);
  });

  it("writes as the graph's own owner where this device holds that identity", async () => {
    const files = new MemoryFiles({ data: "/data" });
    let owner: DidSyr | undefined;
    const door = identities(files, { graphOwner: () => owner });
    const first = await door.held.makeOne();
    const second = await door.held.makeOne();

    owner = first.did;
    const list = await door.held.list();
    expect(list.find((one) => one.did === first.did)?.writing).toBe(true);
    expect(list.find((one) => one.did === second.did)?.writing).toBe(false);
  });

  it("writes as the one chosen here in somebody else's folder", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const theirs = makeLocalIdentity().identity.did;
    const door = identities(files, { graphOwner: () => theirs });
    const first = await door.held.makeOne();
    await door.held.makeOne();
    await door.held.writeAs(first.did);

    const list = await door.held.list();
    expect(list.find((one) => one.did === first.did)?.writing).toBe(true);
  });

  it("carries an identity made here out as a file another device reads", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    const made = await door.held.makeOne();

    const file = await door.held.carryOut(made.did);
    expect(file.name).toBe(CARRIED_FILE);

    const there = new MemoryFiles({ data: "/data" });
    const arrived = await identities(there).held.bring(file.body);
    expect(arrived.did).toBe(made.did);
  });

  it("shows one brought in sealed as shut, and what it is called", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await holdSealed(files, "Ada");

    expect(await identities(files).held.list()).toEqual([
      {
        did: one.did,
        source: "sealed",
        name: "Ada",
        locked: true,
        lapsed: false,
        writing: true,
        carriable: true,
      },
    ]);
  });

  it("brings a sealed identity in and writes under it from then on", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await aSigil();
    const door = identities(files);
    await door.held.makeOne();

    const arrived = await door.held.bringSealed(one.file);

    expect(arrived).toEqual({
      did: one.did,
      source: "sealed",
      locked: true,
      lapsed: false,
      writing: true,
      carriable: true,
    });
    expect((await readIdentities(files)).writing).toBe(one.did);
    expect(door.changes).toBe(2);
  });

  it("lists a sealed identity brought in twice once", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await aSigil();
    const door = identities(files);
    await door.held.bringSealed(one.file);
    await door.held.bringSealed(one.file);

    expect(await door.held.list()).toHaveLength(1);
  });

  it("holds nothing where the file brought in is not a sealed identity", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);

    await expect(door.held.bringSealed(encodeText("not one"))).rejects.toThrow(
      /does not hold an identity/i,
    );
    expect(await door.held.list()).toEqual([]);
  });

  it("carries a sealed identity brought in here to another device, still sealed", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await aSigil();
    const door = identities(files);
    const arrived = await door.held.bringSealed(one.file);

    const file = await door.held.carryOut(arrived.did);
    expect(file.name).toBe(CARRIED_SEALED_FILE);
    expect(file.body).toEqual(one.file);

    const there = new MemoryFiles({ data: "/data" });
    expect((await identities(there).held.bringSealed(file.body)).did).toBe(
      one.did,
    );
  });

  // The passphrase protects the copy as much as the original, so nothing opens
  // the seal to make one and nothing asks.
  it("neither asks for the passphrase nor writes the key in the clear", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await holdSealed(files);

    const file = await identities(files).held.carryOut(one.did);

    const said = JSON.parse(decodeText(file.body)) as Record<string, unknown>;
    expect(said.key).toBeUndefined();
    expect(said.enc).toBeDefined();
    await expect(
      identities(new MemoryFiles({ data: "/data" })).held.bring(file.body),
    ).rejects.toThrow(/does not hold an identity/i);
  });

  it("has nothing to carry where the sealed key is gone from this device", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await holdSealed(files);
    await files.at("/data").remove(SEALED_FILE);

    await expect(identities(files).held.carryOut(one.did)).rejects.toThrow(
      /not on this device any more/i,
    );
  });

  it("keeps what a person calls one when its store says who they are again", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    await door.held.finish(cameBack(door.left[0] ?? ""));
    await door.held.callIt(DID as DidSyr, "Work");

    await door.held.signIn(INSTANCE);
    await door.held.finish(cameBack(door.left[1] ?? ""));

    const [one] = await door.held.list();
    expect(one?.label).toBe("Work");
    expect(one?.name).toBe("Ada Lovelace");
  });

  // What a person calls an identity is this device's word for them. It is on
  // nothing signed, so it is on nothing carried anywhere either.
  it("carries an identity made here out with no name of this device's on it", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    const made = await door.held.makeOne();
    await door.held.callIt(made.did, "Thesis");

    const file = await door.held.carryOut(made.did);

    expect(decodeText(file.body)).not.toContain("Thesis");
    expect(Object.keys(JSON.parse(decodeText(file.body)))).not.toContain(
      "label",
    );
  });

  it("carries a sealed one out byte for byte, whatever it is called here", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const one = await aSigil();
    const door = identities(files);
    const arrived = await door.held.bringSealed(one.file);
    await door.held.callIt(arrived.did, "Thesis");

    const file = await door.held.carryOut(arrived.did);

    expect(file.body).toEqual(one.file);
  });

  it("has no file to carry for an identity kept somewhere else", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    await door.held.finish(cameBack(door.left[0] ?? ""));

    await expect(door.held.carryOut(DID as DidSyr)).rejects.toThrow(
      /kept for you somewhere else/i,
    );
  });

  it("writes what the store says into a graph started under it on a later run", async () => {
    const files = new MemoryFiles({ data: "/data", folder: "/graphs/mine" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    await door.held.finish(cameBack(door.left[0] ?? ""));

    // A later run: nothing the sign-in was holding in memory is here any more.
    const api = new LocalApi(files);
    await api.createGraph({ title: "Thesis" });

    const said = await api.profile();
    expect(said.did).toBe(DID);
    expect(said.display_name).toBe("Ada Lovelace");
    expect(said.avatar_src).not.toBeNull();
  });

  it("keeps one picture of whoever owns a folder started on the run they signed in on", async () => {
    const files = new MemoryFiles({ data: "/data", folder: "/graphs/mine" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    const signedIn = await door.held.finish(cameBack(door.left[0] ?? ""));
    const wearing = signedIn?.picture as { bytes: Uint8Array; type: string };

    const api = new LocalApi(files.at("/graphs/mine"));
    await api.graphHere();
    // What the sign-in was holding, carried in after the folder is there.
    const ticket = await api.createUpload({
      role: "avatar",
      filename: "picture",
      mime_type: wearing.type,
      size: wearing.bytes.byteLength,
    });
    await api.sendUpload(
      ticket,
      new Blob([wearing.bytes.slice().buffer as ArrayBuffer]),
    );
    const asset = await api.completeUpload({ upload_id: ticket.upload_id });
    await api.updateProfile({
      display_name: signedIn?.name as string,
      avatar_upload_id: asset.upload_id,
    });

    const here = files.at("/graphs/mine");
    expect(
      (await here.list("")).filter((path) => path.startsWith("media/")),
    ).toHaveLength(1);
    const said = await api.profile();
    expect(said.display_name).toBe("Ada Lovelace");
    expect(said.avatar_src).not.toBeNull();
  });

  it("writes nothing of itself into a folder somebody else owns", async () => {
    const files = new MemoryFiles({ data: "/data", folder: "/graphs/theirs" });
    const theirs = new LocalApi(files, { writer: ADA as DidSyr });
    await theirs.createGraph({ title: "Thesis" });
    const door = identities(files);
    await door.held.signIn(INSTANCE);
    await door.held.finish(cameBack(door.left[0] ?? ""));

    const here = await LocalGraph.open(files.at("/graphs/theirs"));
    expect(here.did).toBe(ADA);
    expect(here.owner).toEqual({});
  });
});
