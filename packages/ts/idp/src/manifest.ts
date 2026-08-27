// Discovery. `/.well-known/syr` and `/.well-known/syr/{did}` are the only paths
// in the ecosystem a consumer may assume; everything else it needs is a URL it
// reads out of one of them. Which means these two builders decide where every
// endpoint below lives, and a consumer never has to be told.
//
// A reader may drop what it does not use, and `@sloppy/types`' schemas do — a
// syr consumer running ahead of us stays readable that way. A WRITER has no
// such latitude: syr and slyng mark `api` and the posts and stories endpoints
// required, and reject a manifest without them. So the served shapes below
// widen the readers, and it is these that the builders are held to.

import {
  SyrIdentityManifestSchema,
  SyrInstanceManifestSchema,
} from "@sloppy/types";
import { z } from "zod";

export const ServedInstanceManifestSchema = SyrInstanceManifestSchema.extend({
  api: z.object({
    public_profile: z.url(),
    public_posts: z.url(),
    public_stories: z.url(),
    public_uploads: z.url(),
    public_emojis: z.url(),
  }),
});
export type ServedInstanceManifest = z.infer<
  typeof ServedInstanceManifestSchema
>;

export const ServedIdentityManifestSchema = SyrIdentityManifestSchema.extend({
  endpoints: SyrIdentityManifestSchema.shape.endpoints.extend({
    posts: z.url(),
    stories: z.url(),
    public_emojis: z.url(),
  }),
});
export type ServedIdentityManifest = z.infer<
  typeof ServedIdentityManifestSchema
>;

export interface DidDocument {
  "@context": string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: "Ed25519VerificationKey2020";
    controller: string;
    publicKeyMultibase: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
  service: Array<{
    id: string;
    type: "SyrIdentityProvider";
    serviceEndpoint: string;
  }>;
}

/** Where the provider's routes hang, under the API's own `/api` prefix. The
 *  manifests are built from this, and so is the consent page it points at. */
export function providerApiBase(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/idp`;
}

/** Where this instance's own endpoints live under its public URL. Callers pass
 *  the base; nothing here reads configuration. */
export function instanceManifest(baseUrl: string): ServedInstanceManifest {
  const base = normalizeBaseUrl(baseUrl);
  const api = providerApiBase(base);
  const reads = `${api}/public`;
  return {
    name: "syr",
    public_url: base,
    api: {
      public_profile: `${reads}/profile`,
      public_posts: `${reads}/posts`,
      public_stories: `${reads}/stories`,
      public_uploads: `${reads}/uploads`,
      public_emojis: `${reads}/emojis`,
    },
    identity_manifest_template: `${base}/.well-known/syr/{did}`,
    platform: {
      consent: `${api}/consent`,
      token: `${api}/platform/token`,
      sign: `${api}/platform/sign`,
      challenge: `${api}/platform/challenge`,
      delegations: `${api}/platform/delegations`,
      revoke: `${api}/platform/revoke`,
    },
  };
}

export function identityManifest(
  baseUrl: string,
  did: string,
): ServedIdentityManifest {
  const base = normalizeBaseUrl(baseUrl);
  const api = providerApiBase(base);
  const reads = `${api}/public`;
  const encoded = encodeURIComponent(did);
  return {
    version: 1,
    did,
    provider: base,
    endpoints: {
      profile: `${reads}/profile/${encoded}`,
      posts: `${reads}/posts/${encoded}`,
      stories: `${reads}/stories/${encoded}`,
      uploads: `${reads}/uploads/${encoded}`,
      public_emojis: `${reads}/emojis/${encoded}`,
      did_document: `${api}/identity/${encoded}/document`,
    },
    // TODO(M4 publish-and-pull): serve a person's public page here. It is where
    // a browser resolving this identity is sent, and no route answers it yet.
    web_profile: `${base}/u/${encoded}`,
  };
}

/** W3C DID Core, as syr writes it: one `#root` verification method, and a
 *  `#provider` service naming the instance that answers for this identity. */
export function didDocument(params: {
  did: string;
  publicKeyMultibase: string;
  provider: string;
}): DidDocument {
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id: params.did,
    verificationMethod: [
      {
        id: "#root",
        type: "Ed25519VerificationKey2020",
        controller: params.did,
        publicKeyMultibase: params.publicKeyMultibase,
      },
    ],
    authentication: ["#root"],
    assertionMethod: ["#root"],
    service: [
      {
        id: "#provider",
        type: "SyrIdentityProvider",
        serviceEndpoint: normalizeBaseUrl(params.provider),
      },
    ],
  };
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
