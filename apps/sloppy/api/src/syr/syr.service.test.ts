import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DidSyrSchema } from "@sloppy/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyrService, normalizeInstanceUrl } from "./syr.service";

const INSTANCE = "https://syr.is";
const DID = DidSyrSchema.parse("did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva");
const KEY = "z6MkDelegate";

const MANIFEST = {
  name: "syr",
  public_url: INSTANCE,
  identity_manifest_template: `${INSTANCE}/.well-known/syr/{did}`,
  platform: {
    consent: `${INSTANCE}/auth/platform-consent`,
    token: `${INSTANCE}/api/platform/token`,
    sign: `${INSTANCE}/api/platform/sign`,
    challenge: `${INSTANCE}/api/platform/challenge`,
    delegations: `${INSTANCE}/api/platform/delegations`,
    revoke: `${INSTANCE}/api/platform/revoke`,
  },
};

const DELEGATION = {
  did: DID,
  syr_instance_url: INSTANCE,
  delegate_public_key: KEY,
  access_token: "the-delegated-token",
};

/** `text` is what an instance sent when it is not the JSON `body` would be —
 *  including nothing at all, which is how a store reports a change it made. */
type Answer = { status?: number; body?: unknown; text?: string } | Error;

/** A path answers with one thing, or with whatever the query asked for. */
type Answering = Answer | ((asked: URL) => Answer);

/** One fake instance, answering by path. Records what it was asked. */
function instance(answers: Record<string, Answering> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const asked = new URL(url);
    const held =
      answers[asked.pathname] ??
      (asked.pathname === "/.well-known/syr"
        ? { body: MANIFEST }
        : { status: 404, body: {} });
    const answer = typeof held === "function" ? held(asked) : held;
    if (answer instanceof Error) throw answer;
    const status = answer.status ?? 200;
    const sent =
      answer.text ??
      (answer.body === undefined ? null : JSON.stringify(answer.body));
    return new Response(status === 204 ? null : sent, {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, fetchImpl };
}

afterEach(() => vi.unstubAllGlobals());

describe("normalizing what somebody typed", () => {
  it("assumes https and drops a trailing slash", () => {
    expect(normalizeInstanceUrl("syr.is")).toBe("https://syr.is");
    expect(normalizeInstanceUrl(" https://syr.is/// ")).toBe("https://syr.is");
    expect(normalizeInstanceUrl("http://localhost:5273/")).toBe(
      "http://localhost:5273",
    );
  });
});

describe("reading an instance's manifest", () => {
  it("asks once and answers from what it read after that", async () => {
    const { fetchImpl } = instance();
    const syr = new SyrService();

    await syr.manifest(INSTANCE);
    await syr.manifest(INSTANCE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("says an address it cannot reach is unreachable", async () => {
    instance({ "/.well-known/syr": new Error("ECONNREFUSED") });

    await expect(new SyrService().manifest(INSTANCE)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("says an address answering something else is not an instance", async () => {
    instance({ "/.well-known/syr": { body: { hello: "world" } } });

    await expect(new SyrService().manifest(INSTANCE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("sending somebody for consent", () => {
  it("carries every parameter syr reads, scopes comma-joined", async () => {
    instance();
    const url = new URL(
      await new SyrService().consentUrl(INSTANCE, {
        platform_origin: "https://sloppy.sh",
        platform_name: "Sloppy",
        callback_url: "https://sloppy.sh/api/auth/callback",
        scopes: ["identity:read", "profile:read"],
        state: "state-token",
      }),
    );

    expect(url.origin + url.pathname).toBe(MANIFEST.platform.consent);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      platform_origin: "https://sloppy.sh",
      platform_name: "Sloppy",
      callback_url: "https://sloppy.sh/api/auth/callback",
      scopes: "identity:read,profile:read",
      state: "state-token",
    });
  });

  it("refuses an instance that offers no delegation at all", async () => {
    const { platform: _platform, ...withoutPlatform } = MANIFEST;
    instance({ "/.well-known/syr": { body: withoutPlatform } });

    await expect(
      new SyrService().consentUrl(INSTANCE, {
        platform_origin: "https://sloppy.sh",
        platform_name: "Sloppy",
        callback_url: "https://sloppy.sh/api/auth/callback",
        scopes: ["identity:read"],
        state: "state-token",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("exchanging the code", () => {
  const TOKENS = {
    access_token: "delegated",
    token_type: "Bearer",
    expires_in: 86400,
    did: DID,
    delegate_public_key: KEY,
    scopes: ["identity:read"],
  };

  it("sends the delegation id and the callback URL unchanged", async () => {
    const { calls } = instance({ "/api/platform/token": { body: TOKENS } });

    const result = await new SyrService().exchangeCode(INSTANCE, {
      code: "the-code",
      delegation_id: "the-delegation",
      callback_url: "https://sloppy.sh/api/auth/callback",
      platform_origin: "https://sloppy.sh",
    });

    expect(result.did).toBe(DID);
    const posted = calls.find((c) => c.url === MANIFEST.platform.token);
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      code: "the-code",
      delegation_id: "the-delegation",
      callback_url: "https://sloppy.sh/api/auth/callback",
      platform_origin: "https://sloppy.sh",
    });
  });

  it("gives up where the instance refuses the code", async () => {
    instance({ "/api/platform/token": { status: 400, body: {} } });

    // A spent code is spent for good, so this is not the failure "try again"
    // describes — 4xx from the instance is an answer, not an outage.
    await expect(
      new SyrService().exchangeCode(INSTANCE, {
        code: "spent",
        delegation_id: "the-delegation",
        callback_url: "https://sloppy.sh/api/auth/callback",
        platform_origin: "https://sloppy.sh",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  // A `200` carrying something else is the failure an operator has the least
  // to go on, so it is the one that must reach the log rather than a stack
  // trace.
  it("gives up the same way, in words and in the log, on a token it cannot read", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    instance({
      "/api/platform/token": { body: { ...TOKENS, expires_in: "a day" } },
    });

    await expect(
      new SyrService().exchangeCode(INSTANCE, {
        code: "the-code",
        delegation_id: "the-delegation",
        callback_url: "https://sloppy.sh/api/auth/callback",
        platform_origin: "https://sloppy.sh",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("signing on somebody's behalf", () => {
  it("sends the delegated token and nothing of the key", async () => {
    const { calls } = instance({
      "/api/platform/sign": {
        body: {
          signature: "zSignature",
          delegate_public_key: KEY,
          did: DID,
          signed_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const signed = await new SyrService().signContent(
      DELEGATION,
      { title: "a node" },
      "sloppy-node@v1",
    );

    expect(signed.signature).toBe("zSignature");
    const posted = calls.find((c) => c.url === MANIFEST.platform.sign);
    expect(
      (posted?.init?.headers as Record<string, string>).authorization,
    ).toBe("Bearer the-delegated-token");
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      payload: { title: "a node" },
      payload_type: "sloppy-node@v1",
    });
  });

  it("gives up on a signature it cannot read", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    instance({ "/api/platform/sign": { body: { signature: "zSignature" } } });

    await expect(
      new SyrService().signContent(DELEGATION, { title: "a node" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("whether a delegation still stands", () => {
  const listing = (entries: unknown[]) => ({
    "/api/platform/delegations": { body: { data: entries } },
  });

  it("is active while the instance still lists the key we hold", async () => {
    instance(listing([{ delegate_public_key: KEY }]));

    await expect(new SyrService().delegationState(DELEGATION)).resolves.toBe(
      "active",
    );
  });

  // syr wraps this listing in `{ data }` and slyng returns the bare array;
  // both are real instances somebody's identity can live on. Only a listing
  // actually read can answer "active", so this is the shape that proves it.
  it("reads the listing wrapped or bare", async () => {
    for (const body of [
      { data: [{ delegate_public_key: KEY }] },
      [{ delegate_public_key: KEY }],
    ]) {
      instance({ "/api/platform/delegations": { body } });

      await expect(new SyrService().delegationState(DELEGATION)).resolves.toBe(
        "active",
      );
      vi.unstubAllGlobals();
    }
  });

  it("is ended once it is revoked", async () => {
    instance(
      listing([
        { delegate_public_key: KEY, revoked_at: "2026-01-01T00:00:00.000Z" },
      ]),
    );

    await expect(new SyrService().delegationState(DELEGATION)).resolves.toBe(
      "ended",
    );
  });

  it("is ended once it has expired", async () => {
    instance(
      listing([
        { delegate_public_key: KEY, expires_at: "2020-01-01T00:00:00.000Z" },
      ]),
    );

    await expect(new SyrService().delegationState(DELEGATION)).resolves.toBe(
      "ended",
    );
  });

  it("is ended where the instance no longer knows this key", async () => {
    instance(listing([{ delegate_public_key: "z6MkSomebodyElse" }]));

    await expect(new SyrService().delegationState(DELEGATION)).resolves.toBe(
      "ended",
    );
  });

  // A delegation stuck at "unknown" never signs anybody out, so the one thing
  // it must not be is quiet.
  it("is unknown where the instance said nothing we could read, and says so", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});

    for (const answers of [
      { "/api/platform/delegations": new Error("ECONNREFUSED") },
      { "/api/platform/delegations": { status: 500, body: {} } },
      { "/api/platform/delegations": { body: { data: "not a list" } } },
      { "/api/platform/delegations": { body: "not a listing at all" } },
    ] satisfies Record<string, Answer>[]) {
      warn.mockClear();
      instance(answers);

      await expect(new SyrService().delegationState(DELEGATION)).resolves.toBe(
        "unknown",
      );
      expect(warn).toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
    warn.mockRestore();
  });

  it("asks about the identity that holds it", async () => {
    const { calls } = instance(listing([{ delegate_public_key: KEY }]));
    await new SyrService().delegationState(DELEGATION);

    const asked = calls.find((c) =>
      c.url.startsWith(MANIFEST.platform.delegations),
    );
    expect(new URL(String(asked?.url)).searchParams.get("did")).toBe(DID);
  });
});

describe("handing a file to somebody's store", () => {
  const FOLDERS = `${INSTANCE}/api/folders`;
  const UPLOADS = `${INSTANCE}/api/uploads`;

  function store(extra: Record<string, Answer> = {}) {
    return instance({
      // The fake answers by path, so this one is read as an empty listing by
      // the GET and as the folder it created by the POST that follows it.
      "/api/folders": {
        body: { data: { folders: [], id: "folder", name: "public" } },
      },
      "/api/uploads": {
        body: {
          data: {
            signedUrl: `${INSTANCE}/put/here`,
            finalUrl: `${INSTANCE}/read/here`,
            uploadDid: DID,
            uploadLocalId: "01JUPLOAD",
          },
        },
      },
      ...extra,
    });
  }

  function posted(calls: { url: string; init?: RequestInit }[], to: string) {
    const call = calls.find((c) => c.url === to && c.init?.method === "POST");
    return JSON.parse(String(call?.init?.body));
  }

  const A_FILE = {
    role: "block",
    filename: "a.png",
    mime_type: "image/png",
    size: 1024,
  } as const;

  // syr parses the complete call's body with a schema naming three keys and
  // drops the rest, so dimensions sent there reach no reader at all.
  const ANYWHERE = ["sloppy", "notes"];

  it("sends the dimensions with the ticket, where the store keeps them", async () => {
    const { calls } = store();

    await new SyrService().createUpload(
      DELEGATION,
      { ...A_FILE, width: 800, height: 600 },
      ANYWHERE,
    );

    expect(posted(calls, UPLOADS)).toMatchObject({
      metadata: { width: 800, height: 600 },
    });
  });

  it("leaves the dimensions out where nothing measured them", async () => {
    const { calls } = store();
    await new SyrService().createUpload(DELEGATION, A_FILE, ANYWHERE);
    expect(posted(calls, UPLOADS)).not.toHaveProperty("metadata");
  });

  it("makes the folders the caller named, outermost first", async () => {
    const { calls } = store();

    await new SyrService().createUpload(DELEGATION, A_FILE, [
      "public",
      "sloppy",
      "avatar",
    ]);

    const made = calls
      .filter((c) => c.url === FOLDERS && c.init?.method === "POST")
      .map((c) => JSON.parse(String(c.init?.body)).name);
    expect(made).toEqual(["public", "sloppy", "avatar"]);
  });

  // A store that has run out of room refuses the same way forever, so telling
  // somebody to try again sends them back into the same wall.
  it("passes on what the store said, and does not call it temporary", async () => {
    store({
      "/api/uploads": {
        status: 413,
        body: { message: "You have used all of your space." },
      },
    });

    await expect(
      new SyrService().createUpload(DELEGATION, A_FILE, ANYWHERE),
    ).rejects.toMatchObject({
      status: 400,
      response: { message: "You have used all of your space." },
    });
  });

  it("still asks again where the instance itself is having a bad day", async () => {
    store({ "/api/uploads": { status: 503, body: {} } });

    await expect(
      new SyrService().createUpload(DELEGATION, A_FILE, ANYWHERE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("a change the store made, and what it left a caller to work with", () => {
  const EMOJI = `/api/emojis/${encodeURIComponent(DID)}/01JEMOJI`;
  const remove = () =>
    new SyrService().deleteEmoji(DELEGATION, { did: DID, localId: "01JEMOJI" });

  // A route that deletes and then fails to say so is a surface reporting an
  // error over a list that is already correct. Instances differ on whether
  // "done, nothing to report" is a 204 or an empty 200; neither is JSON.
  it.each([
    { status: 204 },
    { status: 200, text: "" },
  ])("reads an answer with no body as done (%o)", async (answer) => {
    instance({ [EMOJI]: answer });
    await expect(remove()).resolves.toBeUndefined();
  });

  // "Reconnect your account" is a different thing to do next than "that could
  // not be saved", and they are the same 400 unless the status survives.
  it("keeps the status and the code where the account needs reconnecting", async () => {
    instance({
      [EMOJI]: {
        status: 403,
        body: {
          code: "insufficient_scope",
          message: "Connect this app to your account again.",
        },
      },
    });

    await expect(remove()).rejects.toMatchObject({
      status: 403,
      response: {
        code: "insufficient_scope",
        message: "Connect this app to your account again.",
      },
    });
  });

  it("keeps a missing target missing, so deleting twice is one outcome", async () => {
    instance({ [EMOJI]: { status: 404, body: { message: "Not there." } } });
    await expect(remove()).rejects.toMatchObject({ status: 404 });
  });

  it("does not read an answer that is not JSON at all", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    instance({ "/api/user/profile": { text: "<html>nope" } });

    await expect(
      new SyrService().updateProfile(DELEGATION, { display_name: "A" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("reading somebody's own catalog", () => {
  const entries = (total: number) =>
    Array.from({ length: total }, (_, at) => ({
      did: DID,
      local_id: `01ABC${String(at).padStart(3, "0")}`,
      shortcode: `emoji${String(at).padStart(3, "0")}`,
      url: `${INSTANCE}/files/${at}.png`,
      is_sticker: false,
    }));

  /** An instance holding `total` entries, serving the page it is asked for. */
  function holding(total: number) {
    const held = entries(total);
    return instance({
      "/api/emojis": (asked) => ({
        body: {
          data: held.slice(
            Number(asked.searchParams.get("offset")),
            Number(asked.searchParams.get("offset")) +
              Number(asked.searchParams.get("limit")),
          ),
        },
      }),
    });
  }

  // A shortcode this read cannot find is taken to be one the author deleted,
  // and publishing drops the picture. Stopping at the first page would make
  // that true of every emoji past it.
  it("comes back whole where it runs past one page", async () => {
    holding(250);

    const held = await new SyrService().listOwnEmoji(DELEGATION);

    expect(held.map((e) => e.shortcode)).toEqual(
      entries(250).map((e) => e.shortcode),
    );
  });

  it("asks once where the first page is the whole of it", async () => {
    const { calls } = holding(4);

    await new SyrService().listOwnEmoji(DELEGATION);

    expect(calls.filter((c) => c.url.includes("/emojis"))).toHaveLength(1);
  });

  it("stops asking an instance that answers the same page every time", async () => {
    const { calls } = instance({
      "/api/emojis": { body: { data: entries(100) } },
    });

    await new SyrService().listOwnEmoji(DELEGATION);

    expect(calls.length).toBeGreaterThan(1);
  });
});

describe("who somebody follows, in their own identity store", () => {
  const FOLLOWS = "/api/follows";
  const MANIFEST_PATH = `/.well-known/syr/${encodeURIComponent(DID)}`;
  const OTHER = DidSyrSchema.parse(
    "did:syr:z6MkBvbBvbBvbBvbBvbBvbBvbBvbBvbBvb",
  );

  const identityManifest = (endpoints: Record<string, string>) => ({
    version: 1,
    did: DID,
    provider: INSTANCE,
    endpoints: {
      profile: `${INSTANCE}/api/public/profile/${DID}`,
      posts: `${INSTANCE}/api/public/posts/${DID}`,
      stories: `${INSTANCE}/api/public/stories/${DID}`,
      uploads: `${INSTANCE}/api/public/uploads/${DID}`,
      did_document: `${INSTANCE}/api/identity/${DID}/document`,
      ...endpoints,
    },
    web_profile: `${INSTANCE}/u/${DID}`,
  });

  it("reads a store that keeps one, and says so of a store that does not", async () => {
    instance({
      [MANIFEST_PATH]: {
        body: identityManifest({
          public_following: `${INSTANCE}/api/public/following/${DID}`,
        }),
      },
    });
    await expect(new SyrService().keepsFollows(INSTANCE, DID)).resolves.toBe(
      true,
    );

    instance({ [MANIFEST_PATH]: { body: identityManifest({}) } });
    await expect(new SyrService().keepsFollows(INSTANCE, DID)).resolves.toBe(
      false,
    );
  });

  it("lists them, dropping what a row carries beside the two halves", async () => {
    instance({
      [FOLLOWS]: {
        body: {
          data: [
            {
              followed_did: OTHER,
              followed_provider_url: "https://elsewhere.example",
              is_public: true,
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    });

    await expect(
      new SyrService().listFollowing(DELEGATION),
    ).resolves.toStrictEqual([
      {
        followed_did: OTHER,
        followed_provider_url: "https://elsewhere.example",
      },
    ]);
  });

  it("records where an identity lives beside the follow", async () => {
    const { calls } = instance({ [FOLLOWS]: { status: 204 } });
    await new SyrService().follow(DELEGATION, OTHER, INSTANCE);

    const wrote = calls.find((call) => call.url.endsWith(FOLLOWS));
    expect(JSON.parse(String(wrote?.init?.body))).toStrictEqual({
      followed_did: OTHER,
      provider_url: INSTANCE,
    });
    expect(wrote?.init?.headers).toMatchObject({
      authorization: `Bearer ${DELEGATION.access_token}`,
    });
  });

  it("names the follow it is dropping in the query, as the store takes it", async () => {
    const { calls } = instance({ [FOLLOWS]: { status: 204 } });
    await new SyrService().unfollow(DELEGATION, OTHER);

    const asked = calls.find((call) => call.url.includes(FOLLOWS));
    expect(new URL(String(asked?.url)).searchParams.get("followed_did")).toBe(
      OTHER,
    );
    expect(asked?.init?.method).toBe("DELETE");
  });

  it("cannot say where an identity lives when the store does not know", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    instance({ [MANIFEST_PATH]: { status: 404, body: {} } });
    await expect(
      new SyrService().providerFor(INSTANCE, DID),
    ).resolves.toBeNull();
  });
});

describe("what an identity keeps in the open", () => {
  const MANIFEST_PATH = `/.well-known/syr/${encodeURIComponent(DID)}`;
  const UPLOADS = `/api/public/uploads/${DID}`;

  const manifest = {
    version: 1,
    did: DID,
    provider: INSTANCE,
    endpoints: {
      profile: `${INSTANCE}/api/public/profile/${DID}`,
      uploads: `${INSTANCE}${UPLOADS}`,
      did_document: `${INSTANCE}/api/identity/${DID}/document`,
    },
    web_profile: `${INSTANCE}/u/${DID}`,
  };

  const rows = (total: number) =>
    Array.from({ length: total }, (_, at) => ({
      did: DID,
      local_id: `01UPL${String(at).padStart(3, "0")}`,
      filename: `picture-${at}.png`,
      mime_type: "image/png",
      size: 128,
      status: "completed",
      is_public: true,
      url: `${INSTANCE}/files/${at}.png`,
    }));

  /** An instance holding `total` pictures, serving the page it is asked for. */
  const holding = (total: number) => {
    const held = rows(total);
    return instance({
      [MANIFEST_PATH]: { body: manifest },
      [UPLOADS]: (asked) => {
        const from = Number(asked.searchParams.get("offset"));
        return {
          body: {
            data: held.slice(
              from,
              from + Number(asked.searchParams.get("limit")),
            ),
          },
        };
      },
    });
  };

  it("asks the listing the identity's own manifest names, at the page it was given", async () => {
    const { calls } = holding(60);

    const page = await new SyrService().listPublicUploads(INSTANCE, DID, {
      limit: 20,
      offset: 40,
    });

    expect(page.map((row) => row.local_id)).toEqual(
      rows(60)
        .slice(40)
        .map((row) => row.local_id),
    );
    const asked = new URL(
      String(calls.find((call) => call.url.includes(UPLOADS))?.url),
    );
    expect(asked.searchParams.get("limit")).toBe("20");
    expect(asked.searchParams.get("offset")).toBe("40");
  });

  it("carries where the bytes read back from, and what a store says is private", async () => {
    instance({
      [MANIFEST_PATH]: { body: manifest },
      [UPLOADS]: {
        body: {
          data: [
            {
              ...rows(1)[0],
              is_public: false,
              downloadUrl: `${INSTANCE}/download/0.png`,
            },
          ],
        },
      },
    });

    const [row] = await new SyrService().listPublicUploads(INSTANCE, DID, {
      limit: 100,
      offset: 0,
    });

    expect(row.downloadUrl).toBe(`${INSTANCE}/download/0.png`);
    expect(row.is_public).toBe(false);
  });

  it("refuses a listing it cannot read rather than reading half of one", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    instance({
      [MANIFEST_PATH]: { body: manifest },
      [UPLOADS]: { body: { data: "everything" } },
    });

    await expect(
      new SyrService().listPublicUploads(INSTANCE, DID, {
        limit: 100,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
