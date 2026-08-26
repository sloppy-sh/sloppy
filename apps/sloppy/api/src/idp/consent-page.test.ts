// The manifest names a URL and a person's browser follows it, so the promise
// and the routing table have to be the same fact. Nothing else in the flow
// fails when they drift: the instance keeps answering, and sign-in dead-ends.

import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import { instanceManifest, providerApiBase } from "@sloppy/idp";
import { describe, expect, it } from "vitest";
import { consentPage } from "./consent-page";
import { ConsentController } from "./consent.controller";

const BASE = "https://sloppy.example";

// `main.ts` mounts everything but the two discovery documents under this.
const API_PREFIX = "api";

describe("the consent page the manifest promises", () => {
  it("is served by the controller the manifest points at", () => {
    const controller = Reflect.getMetadata(PATH_METADATA, ConsentController);
    expect(instanceManifest(BASE).platform?.consent).toBe(
      `${BASE}/${API_PREFIX}/${controller}`,
    );
  });

  it("drives the provider's own endpoints and nothing else's", () => {
    const html = consentPage(providerApiBase(BASE));
    expect(html).toContain(`"${providerApiBase(BASE)}"`);
    expect(html.startsWith("<html")).toBe(true);
  });
});
