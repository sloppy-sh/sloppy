// The manifests are parsed with the schemas Sloppy uses to read SOMEBODY
// ELSE'S instance. That is the whole test: if what this instance publishes will
// not go through `@sloppy/types`' reader, it is not a syr instance.

import {
  SyrIdentityManifestSchema,
  SyrInstanceManifestSchema,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import { didDocument, identityManifest, instanceManifest } from "./manifest.js";

const BASE = "https://sloppy.example";
const DID = "did:syr:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp";

describe("the instance manifest", () => {
  it("is one Sloppy's own reader accepts", () => {
    expect(() =>
      SyrInstanceManifestSchema.parse(instanceManifest(BASE)),
    ).not.toThrow();
  });

  it("declares every platform endpoint the delegation flow needs", () => {
    const { platform } = SyrInstanceManifestSchema.parse(
      instanceManifest(BASE),
    );
    expect(Object.keys(platform ?? {}).sort()).toEqual([
      "challenge",
      "consent",
      "delegations",
      "revoke",
      "sign",
      "token",
    ]);
  });

  it("resolves the identity template into the path it serves", () => {
    const manifest = instanceManifest(BASE);
    expect(manifest.identity_manifest_template.replace("{did}", DID)).toBe(
      `${BASE}/.well-known/syr/${DID}`,
    );
  });

  it("does not double a trailing slash into every URL", () => {
    expect(instanceManifest(`${BASE}/`).public_url).toBe(BASE);
  });
});

describe("the identity manifest", () => {
  it("is one Sloppy's own reader accepts", () => {
    expect(() =>
      SyrIdentityManifestSchema.parse(identityManifest(BASE, DID)),
    ).not.toThrow();
  });

  it("escapes the DID into every endpoint that carries one", () => {
    const { endpoints } = identityManifest(BASE, DID);
    for (const url of Object.values(endpoints)) {
      expect(url).toContain(encodeURIComponent(DID));
    }
  });
});

describe("the DID document", () => {
  it("names the root key as both authentication and assertion", () => {
    const document = didDocument({
      did: DID,
      publicKeyMultibase: DID.slice("did:syr:".length),
      provider: `${BASE}/`,
    });
    expect(document.id).toBe(DID);
    expect(document.verificationMethod[0].id).toBe("#root");
    expect(document.authentication).toEqual(["#root"]);
    expect(document.assertionMethod).toEqual(["#root"]);
    expect(document.service[0].serviceEndpoint).toBe(BASE);
  });
});
