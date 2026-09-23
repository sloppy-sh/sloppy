import { bindingFor, DidSyrSchema } from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { syrKeyBinding } from "./binding.js";
import { deriveDid, encodePublicKey } from "./encoding.js";
import { generateKeypair } from "./keys.js";

describe("the key that speaks for a did:syr", () => {
  it("is the one the identifier itself carries", async () => {
    const keypair = generateKeypair();
    const did = DidSyrSchema.parse(deriveDid(keypair.publicKey));

    expect(await syrKeyBinding.keysFor(did)).toEqual([
      {
        scheme: "ed25519-multibase",
        key: encodePublicKey(keypair.publicKey),
        signs: "delegations",
      },
    ]);
  });

  it("stands behind what signs, rather than signing", async () => {
    const did = DidSyrSchema.parse(deriveDid(generateKeypair().publicKey));
    const [key] = (await syrKeyBinding.keysFor(did)) ?? [];

    expect(key?.signs).toBe("delegations");
    expect(key?.from).toBeUndefined();
  });

  it("is reached by the scheme the identifier is in", () => {
    const did = DidSyrSchema.parse(deriveDid(generateKeypair().publicKey));

    expect(bindingFor(did, [syrKeyBinding])).toBe(syrKeyBinding);
    expect(
      bindingFor("mailto:ava@example.com", [syrKeyBinding]),
    ).toBeUndefined();
  });

  it("answers nothing for an identifier in another scheme", async () => {
    expect(await syrKeyBinding.keysFor("mailto:ava@example.com")).toBeNull();
  });
});
