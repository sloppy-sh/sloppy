// Platform Delegation as the app performs it for itself, with no Sloppy in the
// middle — docs/ARCHITECTURE.md § "A graph off the device".
//
// This is the one file on this side that speaks syr's wire dialect; the shapes
// it reads are `@sloppy/types`' `syr.ts`, which is the only description of that
// wire. Everything here goes over a `fetch` the caller supplies, because a
// webview's own is bounded by where the page came from.

import {
  type SyrInstanceManifest,
  SyrInstanceManifestSchema,
  type SyrPlatformTokenRequest,
  SyrPlatformTokenRequestSchema,
  type SyrPlatformTokenResponse,
  SyrPlatformTokenResponseSchema,
  type SyrProfile,
  SyrProfileSchema,
  type SyrScope,
  SyrIdentityManifestSchema,
  syrEnvelope,
} from "@sloppy/types";
import { refuse } from "./refusal.js";

/** How this app reaches somebody else's identity store. */
export type Fetching = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

/**
 * What signing in here asks a store for, and the whole of it. Nothing on this
 * device signs content or writes to the store, so asking for `posts:write` the
 * way a hosted Sloppy does would make the consent screen a lie.
 */
export const LOCAL_SCOPES: readonly SyrScope[] = [
  "identity:read",
  "profile:read",
];

/** A person typed this; take a bare hostname and give back an origin. */
export function normalizeInstanceUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

async function readJson(
  fetching: Fetching,
  url: string,
  init: Parameters<Fetching>[1],
  failure: string,
): Promise<unknown> {
  let answer: Awaited<ReturnType<Fetching>>;
  try {
    answer = await fetching(url, init);
  } catch {
    throw refuse(failure);
  }
  if (!answer.ok) throw refuse(failure);
  try {
    return await answer.json();
  } catch {
    throw refuse(failure);
  }
}

function readShape<T>(
  shape: { safeParse(value: unknown): { success: boolean; data?: T } },
  body: unknown,
  failure: string,
): T {
  const read = shape.safeParse(body);
  if (!read.success || read.data === undefined) throw refuse(failure);
  return read.data;
}

export async function readManifest(
  instanceUrl: string,
  fetching: Fetching,
): Promise<SyrInstanceManifest> {
  const body = await readJson(
    fetching,
    `${instanceUrl}/.well-known/syr`,
    { headers: { accept: "application/json" } },
    "Sloppy could not reach that address. Check it and try again.",
  );
  return readShape(
    SyrInstanceManifestSchema,
    body,
    "No identity lives at that address. Check it and try again.",
  );
}

async function platformOf(
  instanceUrl: string,
  fetching: Fetching,
): Promise<NonNullable<SyrInstanceManifest["platform"]>> {
  const { platform } = await readManifest(instanceUrl, fetching);
  if (!platform) {
    throw refuse("You cannot sign in to Sloppy with an identity kept there.");
  }
  return platform;
}

export interface ConsentAsked {
  platform_origin: string;
  platform_name: string;
  /** syr compares this to the exchange's byte for byte, so both come from one
   *  value and this carries no query of its own. */
  callback_url: string;
  state: string;
}

export async function consentUrl(
  instanceUrl: string,
  asked: ConsentAsked,
  fetching: Fetching,
): Promise<string> {
  const { consent } = await platformOf(instanceUrl, fetching);
  const url = new URL(consent);
  url.searchParams.set("platform_origin", asked.platform_origin);
  url.searchParams.set("platform_name", asked.platform_name);
  url.searchParams.set("callback_url", asked.callback_url);
  url.searchParams.set("scopes", LOCAL_SCOPES.join(","));
  url.searchParams.set("state", asked.state);
  return url.toString();
}

export async function exchangeCode(
  instanceUrl: string,
  exchange: SyrPlatformTokenRequest,
  fetching: Fetching,
): Promise<SyrPlatformTokenResponse> {
  const { token } = await platformOf(instanceUrl, fetching);
  const failure = "Sign-in did not finish. Start again from Sloppy.";
  const body = await readJson(
    fetching,
    token,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SyrPlatformTokenRequestSchema.parse(exchange)),
    },
    failure,
  );
  return readShape(SyrPlatformTokenResponseSchema, body, failure);
}

/** What the store calls this person and what it has them wearing. Anyone may
 *  read it: it is the document a peer resolving the DID gets. */
export async function readProfile(
  instanceUrl: string,
  did: string,
  fetching: Fetching,
): Promise<SyrProfile> {
  const failure = "Sloppy could not read that profile. Try again in a moment.";
  const { identity_manifest_template } = await readManifest(
    instanceUrl,
    fetching,
  );
  const manifest = readShape(
    SyrIdentityManifestSchema,
    await readJson(
      fetching,
      identity_manifest_template.replace("{did}", encodeURIComponent(did)),
      { headers: { accept: "application/json" } },
      failure,
    ),
    failure,
  );
  return readShape(
    syrEnvelope(SyrProfileSchema),
    await readJson(
      fetching,
      manifest.endpoints.profile,
      { headers: { accept: "application/json" } },
      failure,
    ),
    failure,
  ).data;
}

/** A picture a store holds, brought here so the graph can keep its own copy.
 *  `undefined` is a picture that could not be read, which costs a face and
 *  nothing else. */
export async function readPicture(
  url: string,
  fetching: Fetching,
): Promise<{ bytes: Uint8Array; type: string } | undefined> {
  try {
    const answer = await fetching(url, { headers: { accept: "image/*" } });
    if (!answer.ok) return undefined;
    const type = answer.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return undefined;
    return { bytes: new Uint8Array(await answer.arrayBuffer()), type };
  } catch {
    return undefined;
  }
}
