import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { DidSyrSchema, type OwnedRef } from "@sloppy/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLinks } from "../media/asset-link";
import { SyrService } from "../syr/syr.service";
import { SocialService } from "./social.service";

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

function social(): SocialService {
  const config = { get: () => "a-session-secret" } as unknown as ConfigService;
  return new SocialService(new SyrService(), new AssetLinks(config));
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
