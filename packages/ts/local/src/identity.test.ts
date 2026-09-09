import {
  encodePrivateKey,
  publicKeyFromDid,
  publicKeyFromPrivateKey,
} from "@sloppy/idp/crypto";
import { encodeText } from "@sloppy/vault";
import { describe, expect, it } from "vitest";
import { MemoryFiles } from "./files.js";
import {
  IDENTITY_FILE,
  LocalIdentityError,
  makeLocalIdentity,
  openLocalIdentity,
  readLocalIdentity,
  readLocalKey,
  writeLocalIdentity,
} from "./identity.js";

describe("the identity this device writes under", () => {
  it("is made on first run with nothing asked of anybody", async () => {
    const files = new MemoryFiles({ data: "/data" });
    expect(await readLocalIdentity(files)).toBeUndefined();

    const identity = await openLocalIdentity(files);
    expect(identity.did).toMatch(/^did:syr:z/);
    expect(await readLocalIdentity(files)).toEqual(identity);
  });

  it("is the same identity the next time the app opens", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const first = await openLocalIdentity(files);
    expect(await openLocalIdentity(files)).toEqual(first);
  });

  it("names the key it signs with rather than carrying it", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const identity = await openLocalIdentity(files);
    const key = await readLocalKey(files, identity);
    if (!key) throw new Error("no key was kept");

    expect(key).toHaveLength(32);
    const written = await files.at("/data").read(IDENTITY_FILE);
    expect(new TextDecoder().decode(written ?? new Uint8Array())).not.toContain(
      encodePrivateKey(key),
    );
  });

  it("is a key that answers for the DID it was written beside", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const identity = await openLocalIdentity(files);
    const key = await readLocalKey(files, identity);
    if (!key) throw new Error("no key was kept");

    expect(publicKeyFromPrivateKey(key)).toEqual(
      publicKeyFromDid(identity.did),
    );
  });

  it("answers no key where the file it names is gone", async () => {
    const files = new MemoryFiles({ data: "/data" });
    const identity = await openLocalIdentity(files);
    await files.at("/data").remove(identity.seed);

    expect(await readLocalKey(files, identity)).toBeUndefined();
  });

  it("refuses to mint a second identity over one it cannot read", async () => {
    const files = new MemoryFiles({ data: "/data" });
    await files.at("/data").write(IDENTITY_FILE, encodeText("not json"));

    await expect(openLocalIdentity(files)).rejects.toBeInstanceOf(
      LocalIdentityError,
    );
  });

  it("lets go of the seed once it is written down", async () => {
    const made = makeLocalIdentity();
    const files = new MemoryFiles({ data: "/data" });
    await writeLocalIdentity(files, made);

    expect(made.key.every((byte) => byte === 0)).toBe(true);
  });
});
