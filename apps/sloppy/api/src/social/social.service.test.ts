import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  canonicalize,
  encodeMultibase,
  encodePublicKey,
  generateKeypair,
  type JsonValue,
  sign,
} from "@sloppy/idp";
import { DidSyrSchema, type OwnedRef, type RefusedVoice } from "@sloppy/types";
import { RecordId } from "surrealdb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import type { IdentityKeysService } from "../identity/identity-keys.service";
import { AssetLinks } from "../media/asset-link";
import type { NodeRepository } from "../node/node.repository";
import { SyrService } from "../syr/syr.service";
import type { PointerRepository } from "./pointer.repository";
import type { RefusalRepository } from "./refusal.repository";
import { SocialService } from "./social.service";

// A store this instance was pointed at is read through the address policy,
// whose connection is undici's own — `media/remote-host.ts`. What these tests
// stand on is what a store ANSWERS, so both reads land on the one stub.
vi.mock("undici", async (real) => {
  const undici = await real<typeof import("undici")>();
  return {
    ...undici,
    fetch: (...args: unknown[]) =>
      (globalThis.fetch as (...given: unknown[]) => unknown)(...args),
  };
});

const INSTANCE = "https://syr.is";
/** Where an identity this reader follows is hosted instead. A DID names a
 *  person and never a place, so nothing about a peer is at INSTANCE. */
const ELSEWHERE = "https://other.example";
const ME = DidSyrSchema.parse("did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva");
const THEM = DidSyrSchema.parse("did:syr:z6MkBoBoBoBoBoBoBoBoBoBoBoBoBoBoBo");
const STRANGER = DidSyrSchema.parse(
  "did:syr:z6MkCyCyCyCyCyCyCyCyCyCyCyCyCyCyCy",
);
const NOTE_ID = "01JAAAAAAAAAAAAAAAAAAAAAAA";
const NOTE = `${ME}/${NOTE_ID}` as OwnedRef;

const DELEGATION = {
  did: ME,
  syr_instance_url: INSTANCE,
  delegate_public_key: "z6MkDelegate",
  access_token: "the-delegated-token",
};

/** An instance answers for itself, so what it says about where identities are
 *  described points at its own host and never at the asker's. */
function instanceManifest(at: string) {
  return {
    name: "syr",
    public_url: at,
    identity_manifest_template: `${at}/.well-known/syr/{did}`,
    platform: {
      consent: `${at}/auth/platform-consent`,
      token: `${at}/api/platform/token`,
      sign: `${at}/api/platform/sign`,
      challenge: `${at}/api/platform/challenge`,
      delegations: `${at}/api/platform/delegations`,
      revoke: `${at}/api/platform/revoke`,
    },
  };
}

const SIGNED = {
  body: {
    signature: "z6Signature",
    delegate_public_key: "z6MkDelegate",
    did: ME,
    signed_at: "2026-03-01T10:00:01.000Z",
  },
};

function identityManifest(did: string, at: string) {
  return {
    version: 1,
    did,
    provider: at,
    endpoints: {
      profile: `${at}/api/public/profile/${did}`,
      uploads: `${at}/api/public/uploads/${did}`,
      did_document: `${at}/api/public/did/${did}`,
      public_emojis: `${at}/api/public/emojis/${did}`,
      public_comments: `${at}/api/public/comments/${did}`,
      public_reactions: `${at}/api/public/reactions/${did}`,
    },
    web_profile: `${at}/u/${did}`,
  };
}

const manifestPath = (did: string) =>
  `/.well-known/syr/${encodeURIComponent(did)}`;
const commentsPath = (did: string) => `/api/public/comments/${did}`;
const reactionsPath = (did: string) => `/api/public/reactions/${did}`;
const emojisPath = (did: string) => `/api/public/emojis/${did}`;
const signaturePath = (localId: string) =>
  `/api/comments/${encodeURIComponent(ME)}/${localId}`;

type Answer = { status?: number; body?: unknown } | Error;

/**
 * The instances a read can reach, answering by path and recording what each was
 * asked. A list answers successive asks for the same path, the last of it
 * standing after. An answer keyed by origin and path binds to that instance
 * alone; keyed by path alone it stands at every one.
 *
 * `hosts` says which instance holds which identity, and defaults to this
 * reader's own.
 */
function instance(
  answers: Record<string, Answer | Answer[]> = {},
  hosts: Record<string, string> = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const asked = new URL(url);
    const path = asked.pathname;
    const held =
      answers[`${asked.origin}${path}`] ??
      answers[path] ??
      standing(asked, (did) => hosts[did] ?? INSTANCE);
    const answer = Array.isArray(held)
      ? ((held.length > 1 ? held.shift() : held[0]) ?? {
          status: 404,
          body: {},
        })
      : held;
    if (answer instanceof Error) throw answer;
    const status = answer.status ?? 200;
    return new Response(
      answer.body === undefined ? null : JSON.stringify(answer.body),
      { status, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, fetchImpl };
}

/** syr's identity manifest route is a local lookup, so an instance answers 404
 *  for a DID it does not host — `.well-known/syr/[did]/+server.ts`. */
function standing(asked: URL, hostOf: (did: string) => string): Answer {
  if (asked.pathname === "/.well-known/syr") {
    return { body: instanceManifest(asked.origin) };
  }
  for (const did of [ME, THEM, STRANGER]) {
    if (asked.pathname !== manifestPath(did)) continue;
    return hostOf(did) === asked.origin
      ? { body: identityManifest(did, asked.origin) }
      : { status: 404, body: {} };
  }
  return { status: 404, body: {} };
}

/** Which addresses this build will connect to, as the deployment answers it.
 *  A test instance is at a public name, so nothing here turns on the range. */
const REACH = {
  isProduction: false,
  publicUrl: "https://sloppy.example",
} as unknown as AppConfigService;

/** The two stores of Sloppy's own a conversation reads: what a note has been
 *  answered by, and who the reader will not be shown. */
function assembledFrom(
  pointers: Partial<Record<keyof PointerRepository, unknown>> = {},
  refusals: RefusedVoice[] = [],
  notes: Record<string, unknown> = {},
): SocialService {
  const config = { get: () => "a-session-secret" } as unknown as ConfigService;
  return new SocialService(
    new SyrService(),
    new AssetLinks(config),
    {
      voicesOn: async () => [],
      answersFrom: async () => null,
      leave: async () => undefined,
      answered: async () => [],
      sourceOf: async () => null,
      ...pointers,
    } as unknown as PointerRepository,
    REACH,
    {
      listRefusals: async () => refusals,
      refuse: async () => refusals[0],
      allow: async () => undefined,
    } as unknown as RefusalRepository,
    { many: async () => [], ...notes } as unknown as NodeRepository,
    // Nobody is asked who holds a key here: a signature that checks out under
    // one nothing serves is a comment kept and drawn as unattributed, which is
    // what every comment in these tests is.
    {
      contentKeysFor: async () => new Map(),
    } as unknown as IdentityKeysService,
  );
}

/** No pointer has been left and nobody is refused, so the reachable set is the
 *  reader and who they follow. */
function social(): SocialService {
  return assembledFrom();
}

function comment(
  did: string,
  localId: string,
  over: Record<string, unknown> = {},
) {
  return {
    did,
    local_id: localId,
    post_did: ME,
    post_id: NOTE_ID,
    ancestor_chain: [],
    content: `${localId} said`,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...over,
  };
}

function reaction(over: Record<string, unknown> = {}) {
  return {
    did: ME,
    local_id: "r1",
    parent_type: "post",
    parent_did: ME,
    parent_id: NOTE_ID,
    kind: "unicode",
    value: "🎉",
    created_at: "2026-03-01T10:00:00Z",
    ...over,
  };
}

/** Who the reader follows, as their own store keeps it: a bare DID for somebody
 *  whose provider it never recorded, or the DID with the instance beside it. */
function following(...followed: (string | { did: string; at: string })[]) {
  return {
    data: followed.map((one) =>
      typeof one === "string"
        ? { followed_did: one }
        : { followed_did: one.did, followed_provider_url: one.at },
    ),
  };
}

// An identity store that will not answer is reported, not thrown; the log line
// is noise in a suite that is asserting on the answer instead.
beforeEach(() =>
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {}),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what a note's conversation can reach", () => {
  it("reads the caller's own store and the stores of who they follow", async () => {
    const { calls } = instance({
      "/api/follows": { body: following(THEM) },
      [commentsPath(ME)]: { body: { data: [comment(ME, "mine")] } },
      [commentsPath(THEM)]: { body: { data: [comment(THEM, "theirs")] } },
      [commentsPath(STRANGER)]: {
        body: { data: [comment(STRANGER, "unreachable")] },
      },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.author)).toEqual([ME, THEM]);
    expect(
      calls.some((call) => call.url.includes(commentsPath(STRANGER))),
    ).toBe(false);
  });

  it("brings a store's own timestamp to the one width Sloppy's wire has", async () => {
    instance({
      "/api/follows": { body: following() },
      [commentsPath(ME)]: { body: { data: [comment(ME, "mine")] } },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said[0].created_at).toBe("2026-03-01T10:00:00.000Z");
  });

  it("costs one identity's words, not the conversation, when a store is down", async () => {
    instance({
      "/api/follows": { body: following(THEM) },
      [commentsPath(ME)]: { body: { data: [comment(ME, "mine")] } },
      [commentsPath(THEM)]: { status: 500, body: {} },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.author)).toEqual([ME]);
  });

  it("drops what a store answers that is about another note", async () => {
    instance({
      "/api/follows": { body: following() },
      [commentsPath(ME)]: {
        body: {
          data: [
            comment(ME, "here"),
            comment(ME, "elsewhere", { post_id: "01JZZZZZZZZZZZZZZZZZZZZZZZ" }),
          ],
        },
      },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.comment_id)).toEqual([`${ME}:here`]);
  });

  it("names the comment a reply answers, out of the chain the store kept", async () => {
    instance({
      "/api/follows": { body: following() },
      [commentsPath(ME)]: {
        body: {
          data: [
            comment(ME, "root"),
            comment(ME, "leaf", {
              ancestor_chain: [`${ME}:root`, `${ME}:middle`],
            }),
          ],
        },
      },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.find((one) => one.comment_id === `${ME}:root`)?.reply_to).toBe(
      undefined,
    );
    expect(said.find((one) => one.comment_id === `${ME}:leaf`)?.reply_to).toBe(
      `${ME}:middle`,
    );
  });
});

describe("a voice hosted on another instance", () => {
  const hosted = { [THEM]: ELSEWHERE };

  it("reads their words from their own instance and not from the reader's", async () => {
    const { calls } = instance(
      {
        "/api/follows": { body: following({ did: THEM, at: ELSEWHERE }) },
        [`${INSTANCE}${commentsPath(ME)}`]: {
          body: { data: [comment(ME, "mine")] },
        },
        [`${ELSEWHERE}${commentsPath(THEM)}`]: {
          body: { data: [comment(THEM, "theirs")] },
        },
      },
      hosted,
    );

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.author)).toEqual([ME, THEM]);
    expect(
      calls.some((call) => call.url === `${INSTANCE}${manifestPath(THEM)}`),
    ).toBe(false);
  });

  it("draws their catalog reaction out of the catalog their instance holds", async () => {
    instance(
      {
        "/api/follows": { body: following({ did: THEM, at: ELSEWHERE }) },
        [`${ELSEWHERE}${reactionsPath(THEM)}`]: {
          body: {
            data: [
              reaction({
                did: THEM,
                local_id: "theirs",
                kind: "custom_emoji",
                value: "party",
              }),
            ],
          },
        },
        [`${ELSEWHERE}${emojisPath(THEM)}`]: {
          body: {
            data: [
              {
                did: THEM,
                local_id: "e1",
                shortcode: "party",
                url: `${ELSEWHERE}/files/party.png`,
                is_sticker: false,
              },
            ],
          },
        },
      },
      hosted,
    );

    const made = await social().reactions(DELEGATION, NOTE);

    expect(made).toHaveLength(1);
    const drawn = made[0];
    if (drawn.kind !== "emoji") throw new Error("expected a catalog reaction");
    expect(drawn.emoji.emoji_id).toBe(`${THEM}/e1`);
    expect(drawn.emoji.src.startsWith("/proxy?ref=")).toBe(true);
  });

  it("threads a reply to them under the chain their own instance kept", async () => {
    const { calls } = instance(
      {
        "/api/follows": { body: following({ did: THEM, at: ELSEWHERE }) },
        [`${ELSEWHERE}${commentsPath(THEM)}`]: {
          body: {
            data: [
              comment(THEM, "parent", { ancestor_chain: [`${THEM}:root`] }),
            ],
          },
        },
        "/api/comments": { body: { data: comment(ME, "new") } },
        "/api/platform/sign": SIGNED,
        [signaturePath("new")]: { body: {} },
      },
      hosted,
    );

    await social().comment(DELEGATION, {
      node: NOTE,
      content: "answering",
      reply_to: `${THEM}:parent`,
    });

    const create = calls.find(
      (call) =>
        call.init?.method === "POST" && call.url === `${INSTANCE}/api/comments`,
    );
    expect(JSON.parse(String(create?.init?.body)).ancestor_chain).toEqual([
      `${THEM}:root`,
      `${THEM}:parent`,
    ]);
  });

  it("drops what their instance answers in a name it does not hold", async () => {
    instance(
      {
        "/api/follows": { body: following({ did: THEM, at: ELSEWHERE }) },
        [`${INSTANCE}${commentsPath(ME)}`]: {
          body: { data: [comment(ME, "mine")] },
        },
        [`${ELSEWHERE}${commentsPath(THEM)}`]: {
          body: {
            data: [
              comment(THEM, "theirs"),
              // Their instance, answering as the reader and as a third party.
              comment(ME, "forged", { content: "I never wrote this" }),
              comment(STRANGER, "hearsay"),
            ],
          },
        },
      },
      hosted,
    );

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.comment_id)).toEqual([
      `${ME}:mine`,
      `${THEM}:theirs`,
    ]);
  });

  it("drops a reaction their instance puts under somebody else's name", async () => {
    instance(
      {
        "/api/follows": { body: following({ did: THEM, at: ELSEWHERE }) },
        [`${INSTANCE}${reactionsPath(ME)}`]: { body: { data: [] } },
        [`${ELSEWHERE}${reactionsPath(THEM)}`]: {
          body: {
            data: [
              reaction({ did: THEM, local_id: "theirs" }),
              reaction({ did: ME, local_id: "forged" }),
            ],
          },
        },
      },
      hosted,
    );

    const made = await social().reactions(DELEGATION, NOTE);

    expect(made.map((one) => one.reaction_id)).toEqual([`${THEM}:theirs`]);
  });

  it("will not thread a reply under a chain read off a forged parent", async () => {
    const { calls } = instance(
      {
        "/api/follows": { body: following({ did: THEM, at: ELSEWHERE }) },
        [`${ELSEWHERE}${commentsPath(THEM)}`]: {
          body: {
            data: [
              comment(STRANGER, "parent", {
                ancestor_chain: [`${STRANGER}:root`],
              }),
            ],
          },
        },
        "/api/comments": { body: { data: comment(ME, "new") } },
        "/api/platform/sign": SIGNED,
        [signaturePath("new")]: { body: {} },
      },
      hosted,
    );

    await social().comment(DELEGATION, {
      node: NOTE,
      content: "answering",
      reply_to: `${THEM}:parent`,
    });

    const create = calls.find(
      (call) =>
        call.init?.method === "POST" && call.url === `${INSTANCE}/api/comments`,
    );
    expect(JSON.parse(String(create?.init?.body)).ancestor_chain).toEqual([
      `${THEM}:parent`,
    ]);
  });

  it("leaves a chain of one where the parent's author is nobody it can reach", async () => {
    const { calls } = instance({
      "/api/follows": { body: following() },
      "/api/comments": { body: { data: comment(ME, "new") } },
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
    });

    await social().comment(DELEGATION, {
      node: NOTE,
      content: "answering",
      reply_to: `${STRANGER}:parent`,
    });

    const create = calls.find(
      (call) =>
        call.init?.method === "POST" && call.url === `${INSTANCE}/api/comments`,
    );
    expect(JSON.parse(String(create?.init?.body)).ancestor_chain).toEqual([
      `${STRANGER}:parent`,
    ]);
    expect(
      calls.some((call) => call.url.includes(commentsPath(STRANGER))),
    ).toBe(false);
  });
});

describe("writing a comment", () => {
  const written = { body: { data: comment(ME, "new") } };

  it("threads a reply under its parent's whole chain", async () => {
    const { calls } = instance({
      [commentsPath(ME)]: {
        body: {
          data: [comment(ME, "parent", { ancestor_chain: [`${ME}:root`] })],
        },
      },
      "/api/comments": written,
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
    });

    await social().comment(DELEGATION, {
      node: NOTE,
      content: "answering",
      reply_to: `${ME}:parent`,
    });

    const create = calls.find(
      (call) =>
        call.init?.method === "POST" && call.url === `${INSTANCE}/api/comments`,
    );
    expect(JSON.parse(String(create?.init?.body)).ancestor_chain).toEqual([
      `${ME}:root`,
      `${ME}:parent`,
    ]);
  });

  it("signs it in a second call, over what the store actually wrote", async () => {
    const { calls } = instance({
      "/api/comments": written,
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
    });

    await social().comment(DELEGATION, { node: NOTE, content: "hello" });

    const signing = calls.find((call) => call.url.endsWith("/platform/sign"));
    expect(JSON.parse(String(signing?.init?.body)).payload).toMatchObject({
      type: "comment@v1",
      comment_id: "new",
      post_did: ME,
      post_id: NOTE_ID,
      // The store's own serialization, not one normalized on the way past.
      created_at: "2026-03-01T10:00:00Z",
    });
    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body)).content_signature).toBe(
      "z6Signature",
    );
  });

  it("signs the chain the store wrote, not the one it was sent", async () => {
    const { calls } = instance({
      "/api/follows": { body: following() },
      [commentsPath(ME)]: {
        body: {
          data: [comment(ME, "parent", { ancestor_chain: [`${ME}:root`] })],
        },
      },
      "/api/comments": {
        body: {
          data: comment(ME, "new", { ancestor_chain: [`${ME}:parent`] }),
        },
      },
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
    });

    await social().comment(DELEGATION, {
      node: NOTE,
      content: "answering",
      reply_to: `${ME}:parent`,
    });

    const create = calls.find(
      (call) =>
        call.init?.method === "POST" && call.url === `${INSTANCE}/api/comments`,
    );
    expect(JSON.parse(String(create?.init?.body)).ancestor_chain).toEqual([
      `${ME}:root`,
      `${ME}:parent`,
    ]);
    const signing = calls.find((call) => call.url.endsWith("/platform/sign"));
    expect(
      JSON.parse(String(signing?.init?.body)).payload.ancestor_chain,
    ).toEqual([`${ME}:parent`]);
  });

  it("keeps the comment when the signature will not land", async () => {
    instance({
      "/api/comments": written,
      "/api/platform/sign": { status: 500, body: {} },
    });

    const said = await social().comment(DELEGATION, {
      node: NOTE,
      content: "hello",
    });

    expect(said.comment_id).toBe(`${ME}:new`);
  });
});

describe("reacting to a note", () => {
  it("answers with the mark they already made rather than sending it again", async () => {
    const { calls } = instance({
      [reactionsPath(ME)]: { body: { data: [reaction({ local_id: "held" })] } },
      "/api/reactions": { body: { data: reaction({ local_id: "fresh" }) } },
    });

    const made = await social().react(DELEGATION, {
      node: NOTE,
      kind: "character",
      character: "🎉",
    });

    // The create route toggles: sending this would have taken the mark off.
    expect(
      calls.filter((call) => call.url === `${INSTANCE}/api/reactions`),
    ).toHaveLength(0);
    expect(made).toMatchObject({
      kind: "character",
      character: "🎉",
      reaction_id: `${ME}:held`,
    });
  });

  it("sends a mark they have not made, and leaves the rest of theirs alone", async () => {
    const { calls } = instance({
      [reactionsPath(ME)]: {
        body: { data: [reaction({ local_id: "held", value: "🌱" })] },
      },
      "/api/reactions": { body: { data: reaction({ local_id: "fresh" }) } },
    });

    const made = await social().react(DELEGATION, {
      node: NOTE,
      kind: "character",
      character: "🎉",
    });

    expect(
      calls.filter((call) => call.url === `${INSTANCE}/api/reactions`),
    ).toHaveLength(1);
    expect(made.reaction_id).toBe(`${ME}:fresh`);
  });

  it("puts back a reaction the store's own toggle took off", async () => {
    const { calls } = instance({
      [reactionsPath(ME)]: { body: { data: [] } },
      "/api/reactions": [
        { body: { status: "success", action: "removed" } },
        { body: { data: reaction() } },
      ],
    });

    const made = await social().react(DELEGATION, {
      node: NOTE,
      kind: "character",
      character: "🎉",
    });

    expect(
      calls.filter((call) => call.url === `${INSTANCE}/api/reactions`),
    ).toHaveLength(2);
    expect(made).toMatchObject({
      kind: "character",
      character: "🎉",
      reaction_id: `${ME}:r1`,
    });
  });

  it("drops one it has no way to draw and keeps the rest", async () => {
    instance({
      "/api/follows": { body: following() },
      [reactionsPath(ME)]: {
        body: {
          data: [
            reaction({ local_id: "keep" }),
            reaction({ local_id: "drop", kind: "gif", value: "party" }),
            reaction({
              local_id: "elsewhere",
              parent_id: "01JZZZZZZZZZZZZZZZZZZZZZZZ",
            }),
          ],
        },
      },
    });

    const made = await social().reactions(DELEGATION, NOTE);

    expect(made.map((one) => one.reaction_id)).toEqual([`${ME}:keep`]);
  });

  it("draws a catalog reaction from the catalog of whoever made it", async () => {
    instance({
      "/api/follows": { body: following() },
      [reactionsPath(ME)]: {
        body: {
          data: [
            reaction({
              local_id: "mine",
              kind: "custom_emoji",
              value: "party",
            }),
          ],
        },
      },
      [emojisPath(ME)]: {
        body: {
          data: [
            {
              did: ME,
              local_id: "e1",
              shortcode: "party",
              url: `${INSTANCE}/files/party.png`,
              is_sticker: false,
            },
          ],
        },
      },
    });

    const made = await social().reactions(DELEGATION, NOTE);

    expect(made).toHaveLength(1);
    const drawn = made[0];
    if (drawn.kind !== "emoji") throw new Error("expected a catalog reaction");
    expect(drawn.emoji.emoji_id).toBe(`${ME}/e1`);
    // The picture reads from this instance, never from the store that holds it.
    expect(drawn.emoji.src.startsWith("/proxy?ref=")).toBe(true);
  });
});

describe("an answer from somebody the reader does not follow", () => {
  /** Where the stranger's store actually answers, as this reader's own instance
   *  resolves the DID. Nothing about a pointer says it. */
  const THEIR_STORE = "https://elsewhere.example";
  /** A service whose author has one pointer standing on their own note. */
  function withPointer(
    over: Record<string, unknown> = {},
    refused: RefusedVoice[] = [],
  ): SocialService {
    return assembledFrom(
      {
        voicesOn: async () => [STRANGER],
        answersFrom: async () => INSTANCE,
        ...over,
      },
      refused,
    );
  }

  // The whole point: pull-only federation tells an instance nothing, so without
  // the pointer a stranger's answer stays unreachable however long they wait.
  it("reaches the store a pointed-at identity is resolved to", async () => {
    const asked: string[] = [];
    vi.spyOn(SyrService.prototype, "listFollowing").mockResolvedValue([]);
    const resolved = vi
      .spyOn(SyrService.prototype, "providerFor")
      .mockResolvedValue(THEIR_STORE);
    vi.spyOn(SyrService.prototype, "listPublicComments").mockImplementation(
      async (where: string) => {
        asked.push(where);
        return [];
      },
    );

    await withPointer().comments(DELEGATION, NOTE);

    // Resolved through the reader's own instance: a depositor vouching for the
    // identity they claim to be is a depositor vouching for themselves.
    expect(resolved).toHaveBeenCalledWith(INSTANCE, STRANGER);
    expect(asked).toContain(THEIR_STORE);
  });

  it("leaves out a voice whose own store cannot be found", async () => {
    const asked: string[] = [];
    vi.spyOn(SyrService.prototype, "listFollowing").mockResolvedValue([]);
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(null);
    vi.spyOn(SyrService.prototype, "listPublicComments").mockImplementation(
      async (_where: string, did: string) => {
        asked.push(did);
        return [];
      },
    );

    await withPointer().comments(DELEGATION, NOTE);

    expect(asked).not.toContain(STRANGER);
  });

  it("asks a store once for somebody both followed and pointed at", async () => {
    const asked: string[] = [];
    vi.spyOn(SyrService.prototype, "listFollowing").mockResolvedValue([
      { followed_did: STRANGER, followed_provider_url: THEIR_STORE },
    ] as never);
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(
      THEIR_STORE,
    );
    vi.spyOn(SyrService.prototype, "listPublicComments").mockImplementation(
      async (_where: string, did: string) => {
        asked.push(did);
        return [];
      },
    );

    await withPointer().comments(DELEGATION, NOTE);

    expect(asked.filter((did) => did === STRANGER)).toHaveLength(1);
  });

  // A store answering in somebody else's name is the whole reason a pointer is
  // a claim rather than a copy.
  it("draws nothing a store says in a name it does not hold", async () => {
    vi.spyOn(SyrService.prototype, "listFollowing").mockResolvedValue([]);
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(
      THEIR_STORE,
    );
    vi.spyOn(SyrService.prototype, "listPublicComments").mockImplementation(
      async (_where: string, did: string) =>
        did === STRANGER
          ? [comment(THEM, "forged"), comment(STRANGER, "theirs")]
          : [],
    );

    const said = await withPointer().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.author)).toEqual([STRANGER]);
  });

  it("holds a foreign store to the addresses this instance will connect to", async () => {
    vi.spyOn(SyrService.prototype, "listFollowing").mockResolvedValue([]);
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(
      THEIR_STORE,
    );
    const read = vi
      .spyOn(SyrService.prototype, "listPublicComments")
      .mockResolvedValue([]);

    await withPointer().comments(DELEGATION, NOTE);

    const own = read.mock.calls.find((call) => call[0] === INSTANCE);
    const foreign = read.mock.calls.find((call) => call[0] === THEIR_STORE);
    expect(own?.[3]).toBeUndefined();
    expect(foreign?.[3]).toEqual({
      allowPrivate: true,
      ownOrigin: "https://sloppy.example",
    });
  });

  it("keeps a pointer on a note that takes no answers out of the store", async () => {
    let left = 0;
    const service = withPointer({
      answersFrom: async () => null,
      leave: async () => {
        left += 1;
      },
    });

    await service.leaveReply(NOTE, {
      voice: STRANGER,
      comment_id: `${STRANGER}:01POINTED`,
    });

    expect(left).toBe(0);
  });

  // The whole of ruling: a slot holds an answer somebody can be shown, so the
  // store is asked before the row exists rather than after.
  it("keeps a claim whose own store serves the comment", async () => {
    let left = 0;
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(
      THEIR_STORE,
    );
    vi.spyOn(SyrService.prototype, "listPublicComments").mockResolvedValue([
      comment(STRANGER, "01POINTED"),
    ] as never);
    const service = withPointer({
      leave: async () => {
        left += 1;
      },
    });

    await service.leaveReply(NOTE, {
      voice: STRANGER,
      comment_id: `${STRANGER}:01POINTED`,
    });

    expect(left).toBe(1);
  });

  it("keeps nothing from a store that serves no such comment", async () => {
    let left = 0;
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(
      THEIR_STORE,
    );
    vi.spyOn(SyrService.prototype, "listPublicComments").mockResolvedValue([]);
    const service = withPointer({
      leave: async () => {
        left += 1;
      },
    });

    await service.leaveReply(NOTE, {
      voice: STRANGER,
      comment_id: `${STRANGER}:01NEVERWRITTEN`,
    });

    expect(left).toBe(0);
  });

  it("keeps nothing from a store answering about another note", async () => {
    let left = 0;
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(
      THEIR_STORE,
    );
    vi.spyOn(SyrService.prototype, "listPublicComments").mockResolvedValue([
      comment(STRANGER, "01POINTED", {
        post_id: "01JZZZZZZZZZZZZZZZZZZZZZZZ",
      }),
    ] as never);
    const service = withPointer({
      leave: async () => {
        left += 1;
      },
    });

    await service.leaveReply(NOTE, {
      voice: STRANGER,
      comment_id: `${STRANGER}:01POINTED`,
    });

    expect(left).toBe(0);
  });

  it("keeps nothing from a voice this instance cannot place", async () => {
    let left = 0;
    vi.spyOn(SyrService.prototype, "providerFor").mockResolvedValue(null);
    const asked = vi.spyOn(SyrService.prototype, "listPublicComments");
    const service = withPointer({
      leave: async () => {
        left += 1;
      },
    });

    await service.leaveReply(NOTE, {
      voice: STRANGER,
      comment_id: `${STRANGER}:01POINTED`,
    });

    expect(left).toBe(0);
    expect(asked).not.toHaveBeenCalled();
  });

  // A comment is cited by the store that issued it, so a citation naming
  // somebody else is a claim about a record the voice does not own.
  it("keeps nothing whose citation names another identity", async () => {
    let left = 0;
    const resolved = vi.spyOn(SyrService.prototype, "providerFor");
    const service = withPointer({
      leave: async () => {
        left += 1;
      },
    });

    await service.leaveReply(NOTE, {
      voice: STRANGER,
      comment_id: `${THEM}:01POINTED`,
    });

    expect(left).toBe(0);
    expect(resolved).not.toHaveBeenCalled();
  });
});

describe("answering somebody else's note", () => {
  /** Where the author's graph is served, as the region the reader holds says. */
  const SOURCE = "https://author.example";
  const THEIR_NOTE = `${THEM}/${NOTE_ID}` as OwnedRef;
  const written = { body: { data: comment(ME, "new", { post_did: THEM }) } };
  const depositPath = `/api/nodes/${encodeURIComponent(THEM)}/${NOTE_ID}/replies`;

  const deposits = (calls: { url: string; init?: RequestInit }[]) =>
    calls.filter((call) => call.url === `${SOURCE}${depositPath}`);

  function holding(source: string | null): SocialService {
    return assembledFrom({ sourceOf: async () => source });
  }

  // Pull-only federation tells an author nothing, so without this the answer is
  // read by the writer and by whoever already follows them, and never reaches
  // the one person it was addressed to.
  it("tells the author's instance that an answer exists", async () => {
    const { calls } = instance({
      "/api/comments": written,
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
      [depositPath]: { status: 204 },
    });

    await holding(SOURCE).comment(DELEGATION, {
      node: THEIR_NOTE,
      content: "answering",
    });

    await vi.waitFor(() => expect(deposits(calls)).toHaveLength(1));
    const left = deposits(calls)[0];
    expect(left.init?.method).toBe("POST");
    // One identity and one citation: no words, and no address of any store.
    expect(JSON.parse(String(left.init?.body))).toEqual({
      voice: ME,
      comment_id: `${ME}:new`,
    });
  });

  it("leaves the writer with their comment when the deposit is refused", async () => {
    const { calls } = instance({
      "/api/comments": written,
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
      [depositPath]: { status: 500, body: {} },
    });

    const said = await holding(SOURCE).comment(DELEGATION, {
      node: THEIR_NOTE,
      content: "answering",
    });

    expect(said.comment_id).toBe(`${ME}:new`);
    await vi.waitFor(() => expect(deposits(calls)).toHaveLength(1));
  });

  it("leaves nothing where the reader holds no copy of the note", async () => {
    const { calls } = instance({
      "/api/comments": written,
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
    });

    await holding(null).comment(DELEGATION, {
      node: THEIR_NOTE,
      content: "answering",
    });

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((call) => call.url.endsWith("/replies"))).toBe(false);
  });

  it("leaves nothing on a note of the writer's own", async () => {
    const { calls } = instance({
      "/api/comments": { body: { data: comment(ME, "new") } },
      "/api/platform/sign": SIGNED,
      [signaturePath("new")]: { body: {} },
    });

    await holding(SOURCE).comment(DELEGATION, { node: NOTE, content: "mine" });

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((call) => call.url.endsWith("/replies"))).toBe(false);
  });
});

describe("a voice somebody will not be shown", () => {
  const refusal = (over: Partial<RefusedVoice> = {}): RefusedVoice =>
    ({
      id: new RecordId("refused_voice", { created_by: ME, id: "01REFUSED" }),
      created_by: ME,
      voice: THEM,
      created_at: "2026-03-01T09:00:00.000Z",
      updated_at: "2026-03-01T09:00:00.000Z",
      ...over,
    }) as RefusedVoice;

  // The follow branch is the one a per-pointer filter would miss: a refused
  // voice the reader also follows arrives by both.
  it("is dropped though the reader follows them", async () => {
    const { calls } = instance({
      "/api/follows": { body: following(THEM) },
      [commentsPath(ME)]: { body: { data: [comment(ME, "mine")] } },
      [commentsPath(THEM)]: { body: { data: [comment(THEM, "theirs")] } },
    });

    const said = await assembledFrom({}, [refusal()]).comments(
      DELEGATION,
      NOTE,
    );

    expect(said.map((one) => one.author)).toEqual([ME]);
    expect(calls.some((call) => call.url.includes(commentsPath(THEM)))).toBe(
      false,
    );
  });

  it("is dropped on the note they were refused on, and nowhere else", async () => {
    const ELSEWHERE_ID = "01JBBBBBBBBBBBBBBBBBBBBBBB";
    const service = assembledFrom({}, [refusal({ note: NOTE })]);

    instance({
      "/api/follows": { body: following(THEM) },
      [commentsPath(ME)]: { body: { data: [comment(ME, "mine")] } },
      [commentsPath(THEM)]: { body: { data: [comment(THEM, "theirs")] } },
    });
    expect(
      (await service.comments(DELEGATION, NOTE)).map((one) => one.author),
    ).toEqual([ME]);

    instance({
      "/api/follows": { body: following(THEM) },
      [commentsPath(ME)]: {
        body: { data: [comment(ME, "mine", { post_id: ELSEWHERE_ID })] },
      },
      [commentsPath(THEM)]: {
        body: { data: [comment(THEM, "theirs", { post_id: ELSEWHERE_ID })] },
      },
    });
    expect(
      (
        await service.comments(DELEGATION, `${ME}/${ELSEWHERE_ID}` as OwnedRef)
      ).map((one) => one.author),
    ).toEqual([ME, THEM]);
  });

  it("has their deposits refused without being told so", async () => {
    let left = 0;
    const resolved = vi.spyOn(SyrService.prototype, "providerFor");
    const service = assembledFrom(
      {
        voicesOn: async () => [STRANGER],
        answersFrom: async () => INSTANCE,
        leave: async () => {
          left += 1;
        },
      },
      [refusal({ voice: STRANGER })],
    );

    await expect(
      service.leaveReply(NOTE, {
        voice: STRANGER,
        comment_id: `${STRANGER}:01POINTED`,
      }),
    ).resolves.toBeUndefined();

    expect(left).toBe(0);
    expect(resolved).not.toHaveBeenCalled();
  });
});

describe("a comment carrying a signature", () => {
  /** As the writer's own instance leaves one: over the canonical form of what
   *  their store wrote. */
  function signed(over: Record<string, unknown>): Record<string, unknown> {
    const keys = generateKeypair();
    const payload = {
      type: "comment@v1",
      did: ME,
      comment_id: "signed",
      post_did: ME,
      post_id: NOTE_ID,
      ancestor_chain: [],
      content: "what was actually signed",
      visibility: "public",
      status: "completed",
      created_at: "2026-03-01T10:00:00Z",
    };
    return {
      ...comment(ME, "signed", { content: payload.content, ...over }),
      content_signature: encodeMultibase(
        sign(canonicalize(payload as JsonValue), keys.privateKey),
      ),
      signed_payload_json: JSON.stringify(payload),
      signing_device_public_key: encodePublicKey(keys.publicKey),
    };
  }

  it("is not drawn beside that name once the words have been changed", async () => {
    instance({
      "/api/follows": { body: following() },
      [commentsPath(ME)]: {
        body: {
          data: [
            comment(ME, "plain"),
            signed({ content: "words nobody signed" }),
          ],
        },
      },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.comment_id)).toEqual([`${ME}:plain`]);
  });

  it("is drawn where it checks out", async () => {
    instance({
      "/api/follows": { body: following() },
      [commentsPath(ME)]: { body: { data: [signed({})] } },
    });

    const said = await social().comments(DELEGATION, NOTE);

    expect(said.map((one) => one.comment_id)).toEqual([`${ME}:signed`]);
  });
});

describe("the notes somebody has been answered on", () => {
  const ANSWERED_ID = "01JCCCCCCCCCCCCCCCCCCCCCCC";
  const ANSWERED = `${ME}/${ANSWERED_ID}` as OwnedRef;

  const note = () => ({
    id: new RecordId("node", { created_by: ME, id: ANSWERED_ID }),
    created_by: ME,
    address: "1a",
    depth: 2,
    origin: `${ME}/01JCCCCCCCCCCCCCCCCCCCCCCB`,
    title: "A city remembers",
    tags: [],
    links: [],
    created_at: "2026-03-01T09:00:00.000Z",
    updated_at: "2026-03-01T09:00:00.000Z",
  });

  it("names the notebook each address is read in, and who answered", async () => {
    const service = assembledFrom(
      { answered: async () => [{ note: ANSWERED, voices: [THEM, STRANGER] }] },
      [],
      { many: async () => [note()] },
    );

    await expect(service.answeredNotes(DELEGATION)).resolves.toEqual([
      {
        note: ANSWERED,
        address: "1a",
        graph: `${ME}/00000000000000000000000000`,
        title: "A city remembers",
        voices: [THEM, STRANGER],
      },
    ]);
  });

  it("leaves out a voice the reader refused, and a note nobody else answered", async () => {
    const refused = {
      id: new RecordId("refused_voice", { created_by: ME, id: "01REFUSED" }),
      created_by: ME,
      voice: THEM,
      created_at: "2026-03-01T09:00:00.000Z",
      updated_at: "2026-03-01T09:00:00.000Z",
    } as RefusedVoice;
    const service = assembledFrom(
      { answered: async () => [{ note: ANSWERED, voices: [THEM] }] },
      [refused],
      { many: async () => [note()] },
    );

    await expect(service.answeredNotes(DELEGATION)).resolves.toEqual([]);
  });

  // A note its author deleted has nowhere to open, however many people
  // answered it while it was there.
  it("leaves out a note that is no longer there", async () => {
    const service = assembledFrom(
      { answered: async () => [{ note: ANSWERED, voices: [THEM] }] },
      [],
      { many: async () => [] },
    );

    await expect(service.answeredNotes(DELEGATION)).resolves.toEqual([]);
  });
});

describe("whether somebody can hold a conversation at all", () => {
  const manifestServing = (endpoints: Record<string, string>) => ({
    version: 1,
    did: ME,
    provider: INSTANCE,
    endpoints: {
      profile: `${INSTANCE}/api/public/profile/${ME}`,
      ...endpoints,
    },
    web_profile: `${INSTANCE}/u/${ME}`,
  });

  it("is what their own store serves, each half on its own", async () => {
    instance();
    vi.spyOn(SyrService.prototype, "identityManifest").mockResolvedValue(
      manifestServing({
        public_comments: `${INSTANCE}${commentsPath(ME)}`,
      }) as never,
    );

    await expect(social().converses(DELEGATION)).resolves.toEqual({
      comments: true,
      reactions: false,
    });
  });

  // What the embedded provider answers, and what an identity kept on another
  // Sloppy's embedded provider answers though it is delegated from here.
  it("is no on a store that publishes neither listing", async () => {
    instance();
    vi.spyOn(SyrService.prototype, "identityManifest").mockResolvedValue(
      manifestServing({}) as never,
    );

    await expect(social().converses(DELEGATION)).resolves.toEqual({
      comments: false,
      reactions: false,
    });
  });
});
