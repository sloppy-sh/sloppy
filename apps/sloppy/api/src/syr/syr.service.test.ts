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

/** One fake instance, answering by path. Records what it was asked. */
function instance(answers: Record<string, Answer> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const answer =
      answers[new URL(url).pathname] ??
      (new URL(url).pathname === "/.well-known/syr"
        ? { body: MANIFEST }
        : { status: 404, body: {} });
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
  it("sends the dimensions with the ticket, where the store keeps them", async () => {
    const { calls } = store();

    await new SyrService().createUpload(DELEGATION, {
      ...A_FILE,
      width: 800,
      height: 600,
    });

    expect(posted(calls, UPLOADS)).toMatchObject({
      metadata: { width: 800, height: 600 },
    });
  });

  it("leaves the dimensions out where nothing measured them", async () => {
    const { calls } = store();
    await new SyrService().createUpload(DELEGATION, A_FILE);
    expect(posted(calls, UPLOADS)).not.toHaveProperty("metadata");
  });

  it("puts a role's blobs where a peer may read them", async () => {
    const { calls } = store();

    await new SyrService().createUpload(DELEGATION, {
      ...A_FILE,
      role: "avatar",
    });

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
      new SyrService().createUpload(DELEGATION, A_FILE),
    ).rejects.toMatchObject({
      status: 400,
      response: { message: "You have used all of your space." },
    });
  });

  it("still asks again where the instance itself is having a bad day", async () => {
    store({ "/api/uploads": { status: 503, body: {} } });

    await expect(
      new SyrService().createUpload(DELEGATION, A_FILE),
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
