import { describe, expect, it } from "vitest";
import {
  consentUrl,
  exchangeCode,
  type Fetching,
  LOCAL_SCOPES,
  normalizeInstanceUrl,
  readManifest,
  readPicture,
  readProfile,
} from "./delegation.js";

const INSTANCE = "https://keys.example";
const DID = "did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

interface Answer {
  status?: number;
  body?: unknown;
  bytes?: Uint8Array;
  type?: string;
}

/** A store that answers a map of URL → answer, and records what it was asked. */
function store(answers: Record<string, Answer>): {
  fetching: Fetching;
  asked: { url: string; init?: Parameters<Fetching>[1] }[];
} {
  const asked: { url: string; init?: Parameters<Fetching>[1] }[] = [];
  const fetching: Fetching = async (url, init) => {
    asked.push({ url, init });
    const answer = answers[url];
    if (!answer) throw new Error(`nothing at ${url}`);
    const status = answer.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => {
        if (answer.body === undefined) throw new Error("not json");
        return answer.body;
      },
      arrayBuffer: async () =>
        (answer.bytes ?? new Uint8Array()).slice().buffer as ArrayBuffer,
      headers: {
        get: (name) => (name === "content-type" ? (answer.type ?? null) : null),
      },
    };
  };
  return { fetching, asked };
}

const MANIFEST = {
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

function reachable(extra: Record<string, Answer> = {}) {
  return store({
    [`${INSTANCE}/.well-known/syr`]: { body: MANIFEST },
    ...extra,
  });
}

describe("the address somebody typed", () => {
  it("takes a bare hostname for an origin", () => {
    expect(normalizeInstanceUrl(" keys.example ")).toBe("https://keys.example");
  });

  it("leaves a scheme somebody spelled alone, less any trailing slash", () => {
    expect(normalizeInstanceUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });
});

describe("reaching an identity store", () => {
  it("says to check the address where nothing answers", async () => {
    const { fetching } = store({});

    await expect(readManifest(INSTANCE, fetching)).rejects.toThrow(
      /could not reach that address/i,
    );
  });

  it("says no identity lives there where something else answers", async () => {
    const { fetching } = store({
      [`${INSTANCE}/.well-known/syr`]: { body: { hello: "world" } },
    });

    await expect(readManifest(INSTANCE, fetching)).rejects.toThrow(
      /No identity lives at that address/i,
    );
  });

  it("says a store that cannot delegate cannot be signed in to", async () => {
    const { platform: _none, ...withoutPlatform } = MANIFEST;
    const { fetching } = store({
      [`${INSTANCE}/.well-known/syr`]: { body: withoutPlatform },
    });

    await expect(
      consentUrl(
        INSTANCE,
        {
          platform_origin: "https://sloppy.sh",
          platform_name: "Sloppy",
          callback_url: "https://sloppy.sh/auth/return",
          state: "s",
        },
        fetching,
      ),
    ).rejects.toThrow(/cannot sign in to Sloppy with an identity kept there/i);
  });
});

describe("taking somebody to their store", () => {
  it("asks for what signing in here settles, and nothing more", async () => {
    const { fetching } = reachable();

    const url = new URL(
      await consentUrl(
        INSTANCE,
        {
          platform_origin: "https://sloppy.sh",
          platform_name: "Sloppy",
          callback_url: "https://sloppy.sh/auth/return",
          state: "a-state",
        },
        fetching,
      ),
    );

    expect(url.origin + url.pathname).toBe(`${INSTANCE}/consent`);
    expect(url.searchParams.get("platform_origin")).toBe("https://sloppy.sh");
    expect(url.searchParams.get("callback_url")).toBe(
      "https://sloppy.sh/auth/return",
    );
    expect(url.searchParams.get("state")).toBe("a-state");
    // Nothing here signs content or writes to the store, so asking to would be
    // a consent screen that says more than is true.
    expect(url.searchParams.get("scopes")).toBe(LOCAL_SCOPES.join(","));
    expect(url.searchParams.get("scopes")).not.toContain("posts:write");
  });
});

describe("finishing at the store", () => {
  const exchange = {
    code: "a-code",
    delegation_id: "a-delegation",
    callback_url: "https://sloppy.sh/auth/return",
    platform_origin: "https://sloppy.sh",
  };

  it("sends the code back exactly as the callback carried it", async () => {
    const { fetching, asked } = reachable({
      [`${INSTANCE}/api/platform/token`]: {
        body: {
          access_token: "a-token",
          token_type: "Bearer",
          expires_in: 3600,
          did: DID,
          delegate_public_key: "zDelegate",
          scopes: ["identity:read"],
        },
      },
    });

    const opened = await exchangeCode(INSTANCE, exchange, fetching);

    expect(opened.did).toBe(DID);
    expect(opened.access_token).toBe("a-token");
    const sent = asked.find(
      (one) => one.url === `${INSTANCE}/api/platform/token`,
    );
    expect(JSON.parse(sent?.init?.body ?? "{}")).toEqual(exchange);
  });

  it("says to start again where the store turns the code down", async () => {
    const { fetching } = reachable({
      [`${INSTANCE}/api/platform/token`]: { status: 400, body: {} },
    });

    await expect(exchangeCode(INSTANCE, exchange, fetching)).rejects.toThrow(
      /Start again from Sloppy/i,
    );
  });
});

describe("what the store says a person is called", () => {
  it("reads the profile the identity's own manifest points at", async () => {
    const { fetching } = reachable({
      [`${INSTANCE}/.well-known/syr/${encodeURIComponent(DID)}`]: {
        body: {
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
      },
      [`${INSTANCE}/api/profile/ada`]: {
        body: {
          data: {
            did: DID,
            username: "ada",
            display_name: "Ada Lovelace",
            avatar_url: `${INSTANCE}/pictures/ada.png`,
          },
        },
      },
    });

    const profile = await readProfile(INSTANCE, DID, fetching);

    expect(profile.display_name).toBe("Ada Lovelace");
    expect(profile.avatar_url).toBe(`${INSTANCE}/pictures/ada.png`);
  });
});

describe("the picture a store holds", () => {
  it("comes back as bytes the graph can keep its own copy of", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { fetching } = store({
      [`${INSTANCE}/pictures/ada.png`]: { bytes, type: "image/png" },
    });

    expect(await readPicture(`${INSTANCE}/pictures/ada.png`, fetching)).toEqual(
      { bytes, type: "image/png" },
    );
  });

  it("is nothing where the store answers with something that is not one", async () => {
    const { fetching } = store({
      [`${INSTANCE}/pictures/ada.png`]: { type: "text/html" },
    });

    expect(
      await readPicture(`${INSTANCE}/pictures/ada.png`, fetching),
    ).toBeUndefined();
  });

  it("is nothing where the store cannot be reached, which costs a face only", async () => {
    const { fetching } = store({});

    expect(
      await readPicture(`${INSTANCE}/pictures/ada.png`, fetching),
    ).toBeUndefined();
  });
});
