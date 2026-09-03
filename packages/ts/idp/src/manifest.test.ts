// The manifests are parsed twice: with the schemas Sloppy uses to read SOMEBODY
// ELSE'S instance, and with the wider served shapes that carry what syr and
// slyng refuse a manifest for omitting. Passing only the first is how an
// instance ends up published in a dialect nobody but us accepts.

import {
  SyrIdentityManifestSchema,
  SyrInstanceManifestSchema,
} from "@sloppy/types";
import { describe, expect, it } from "vitest";
import {
  didDocument,
  identityManifest,
  instanceManifest,
  ServedIdentityManifestSchema,
  ServedInstanceManifestSchema,
} from "./manifest.js";

const BASE = "https://sloppy.example";
const DID = "did:syr:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp";

describe("the instance manifest", () => {
  it("is one Sloppy's own reader accepts", () => {
    expect(() =>
      SyrInstanceManifestSchema.parse(instanceManifest(BASE)),
    ).not.toThrow();
  });

  it("carries the api block a syr reader requires", () => {
    const { api } = ServedInstanceManifestSchema.parse(instanceManifest(BASE));
    expect(Object.keys(api).sort()).toEqual([
      "public_emojis",
      "public_posts",
      "public_profile",
      "public_stories",
      "public_uploads",
    ]);
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

  it("carries the endpoints a syr reader requires", () => {
    const { endpoints } = ServedIdentityManifestSchema.parse(
      identityManifest(BASE, DID),
    );
    expect(Object.keys(endpoints).sort()).toEqual([
      "did_document",
      "posts",
      "profile",
      "public_emojis",
      "public_following",
      "stories",
      "uploads",
    ]);
  });

  it("hangs each listing under the base the instance advertises", () => {
    const { api } = instanceManifest(BASE);
    const { endpoints } = identityManifest(BASE, DID);
    const encoded = encodeURIComponent(DID);
    expect(endpoints.profile).toBe(`${api.public_profile}/${encoded}`);
    expect(endpoints.posts).toBe(`${api.public_posts}/${encoded}`);
    expect(endpoints.stories).toBe(`${api.public_stories}/${encoded}`);
    expect(endpoints.uploads).toBe(`${api.public_uploads}/${encoded}`);
    expect(endpoints.public_emojis).toBe(`${api.public_emojis}/${encoded}`);
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
