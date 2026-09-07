import { describe, expect, it } from "vitest";
import { SyrInstanceManifestSchema } from "./syr.js";

const MANIFEST = {
  name: "syr",
  public_url: "https://syr.example",
  identity_manifest_template: "https://syr.example/.well-known/syr/{did}",
};

describe("where an instance answers about a person by name", () => {
  it("is read off the manifest", () => {
    const read = SyrInstanceManifestSchema.parse({
      ...MANIFEST,
      api: { public_profile: "https://syr.example/api/public/profile" },
    });

    expect(read.api?.public_profile).toBe(
      "https://syr.example/api/public/profile",
    );
  });

  it("is absent on an instance that answers about nobody that way", () => {
    expect(SyrInstanceManifestSchema.parse(MANIFEST).api?.public_profile).toBe(
      undefined,
    );
    expect(
      SyrInstanceManifestSchema.parse({ ...MANIFEST, api: { other: 1 } }).api
        ?.public_profile,
    ).toBe(undefined);
  });
});
