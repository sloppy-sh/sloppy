// Discovery. `/.well-known/syr` and `/.well-known/syr/{did}` are the only paths
// in the ecosystem a consumer may assume; everything else it needs is a URL it
// reads out of one of them. Which means these two builders decide where every
// endpoint below lives, and a consumer never has to be told.

import type { SyrIdentityManifest, SyrInstanceManifest } from "@sloppy/types";

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

/** Where this instance's own endpoints live under its public URL. Callers pass
 *  the base; nothing here reads configuration. */
export function instanceManifest(baseUrl: string): SyrInstanceManifest {
  const base = normalizeBaseUrl(baseUrl);
  return {
    name: "syr",
    public_url: base,
    identity_manifest_template: `${base}/.well-known/syr/{did}`,
    platform: {
      // TODO(M1 app-core page track): render this page. It is where an app sends
      // a person to approve a delegation, and no route answers it yet, so local
      // sign-in dead-ends here.
      consent: `${base}/auth/platform-consent`,
      token: `${base}/api/idp/platform/token`,
      sign: `${base}/api/idp/platform/sign`,
      challenge: `${base}/api/idp/platform/challenge`,
      delegations: `${base}/api/idp/platform/delegations`,
      revoke: `${base}/api/idp/platform/revoke`,
    },
  };
}

export function identityManifest(
  baseUrl: string,
  did: string,
): SyrIdentityManifest {
  const base = normalizeBaseUrl(baseUrl);
  const identity = `${base}/api/idp/identity/${encodeURIComponent(did)}`;
  return {
    version: 1,
    did,
    provider: base,
    endpoints: {
      profile: `${identity}/profile`,
      uploads: `${identity}/uploads`,
      did_document: `${identity}/document`,
    },
    // TODO(M1 app-core page track): render this page; no route answers it yet.
    web_profile: `${base}/u/${encodeURIComponent(did)}`,
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
