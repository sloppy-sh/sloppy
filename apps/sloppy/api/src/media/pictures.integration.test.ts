// A picture all the way through, over real HTTP: a ticket, the bytes, the emoji
// that names them, the profile that points at them, and the asset route a
// reader loads them from.
//
// Every half of this is tested apart from it — `media.service.test.ts` against a
// stubbed store, `files.integration.test.ts` against `@sloppy/idp` directly —
// and neither can see the seam. The seam is where the two disagree: what Sloppy
// reads from an answer against what the provider writes into one, and a status
// that never travelled a socket is not the status a route gives.
//
// Skipped when nothing is listening, so a clone without the dev stack still runs
// `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection, createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CustomEmojiSchema, MediaAssetSchema } from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";

const DB_ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
/** The same default `AppConfigService` reads, so the probe answers for the
 *  store the app is about to use rather than one beside it. */
const STORE_ENDPOINT = new URL(
  process.env.S3_ENDPOINT ?? "http://localhost:9010",
);
const USERNAME = `painter${Date.now().toString(36)}`;
const PASSWORD = "a-long-enough-passphrase";
const DATABASE = `pictures_${Date.now()}`;

/** A one-pixel PNG. Nothing here decodes it; it only has to be bytes with a
 *  type, and a real file is easier to reason about than a random buffer. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function reachable(endpoint: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: endpoint.hostname,
      port:
        Number(endpoint.port) || (endpoint.protocol === "https:" ? 443 : 80),
    });
    const settle = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/** `PUBLIC_URL` is what every address the provider mints is built from, so the
 *  port has to be known before the app starts. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const found = server.address();
      server.close(() =>
        typeof found === "object" && found
          ? resolve(found.port)
          : reject(new Error("no free port")),
      );
    });
  });
}

describe("a picture through Sloppy's routes and its own provider", () => {
  let listening = false;
  let app: INestApplication;
  let base: string;
  let cookie: string;
  let did: string;

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!listening, "the dev stack is not up");
      await run();
    });

  function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function read(method: string, path: string, body?: unknown) {
    const response = await call(method, path, body);
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      text,
    };
  }

  /** Steps one to three, as a device does them: a ticket, the bytes straight to
   *  where it points, and then the store told they arrived. */
  async function upload(role: string, filename: string) {
    const ticket = await read("POST", "/api/media/uploads", {
      role,
      filename,
      mime_type: "image/png",
      size: PIXEL.byteLength,
    });
    expect(ticket.status).toBe(201);

    const sent = await fetch(ticket.body.upload_url, {
      method: "PUT",
      headers: ticket.body.upload_headers,
      body: PIXEL,
    });
    if (!sent.ok) throw new Error(`PUT ${sent.status}: ${await sent.text()}`);

    const stored = await read("POST", "/api/media/uploads/complete", {
      upload_id: ticket.body.upload_id,
    });
    expect(stored.status).toBe(201);
    return MediaAssetSchema.parse(stored.body);
  }

  beforeAll(async () => {
    listening =
      (await reachable(DB_ENDPOINT)) && (await reachable(STORE_ENDPOINT));
    if (!listening) return;

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    Object.assign(process.env, {
      SLOPPY_LOCAL_IDP: "true",
      SLOPPY_IDP_SECRET: "integration-secret-of-sufficient-length",
      SLOPPY_SESSION_SECRET: "integration-session-secret-of-length",
      PUBLIC_URL: base,
      SURREALDB_NAMESPACE: "sloppy_test",
      SURREALDB_DATABASE: DATABASE,
    });

    const { AppModule } = await import("../app.module");
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api", {
      exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
    });
    await app.listen(port, "127.0.0.1");

    const post = (path: string, body: unknown, token?: string) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }).then(async (response) => response.json());

    const registered = await post("/api/idp/register", {
      username: USERNAME,
      password: PASSWORD,
      display_name: "Someone",
    });
    did = registered.did;

    const started = await post("/api/auth/login", { instance_url: base });
    const consent = new URL(started.consent_url);
    const params = {
      platform_origin: consent.searchParams.get("platform_origin"),
      platform_name: consent.searchParams.get("platform_name"),
      callback_url: consent.searchParams.get("callback_url"),
      scopes: consent.searchParams.get("scopes")?.split(","),
      state: consent.searchParams.get("state"),
    };
    const opened = await post(
      "/api/idp/consent",
      params,
      registered.access_token,
    );
    const approved = await post(
      `/api/idp/consent/${opened.challenge_id}/approve`,
      { password: PASSWORD },
      registered.access_token,
    );
    const landed = await fetch(approved.redirect_url, { redirect: "manual" });
    cookie = landed.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("sloppy_session="))!
      .split(";")[0];
  });

  afterAll(async () => {
    if (!app) return;
    const { DbService: Db } = await import("../db/db.service");
    await app
      .get<DbService>(Db)
      .handle.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
    await app.close();
  });

  scenario("takes a file and answers where it will be read from", async () => {
    const asset = await upload("block", "pixel.png");
    expect(asset.mime_type).toBe("image/png");
    expect(asset.size).toBe(PIXEL.byteLength);
    expect(asset.url.startsWith(base)).toBe(true);
  });

  // A note is private until its subtree is published, and the folder a picture
  // lands in is the store's whole access rule — so this is the check, not the
  // route's own answer to a request that carried a session.
  scenario("keeps a note's picture away from a stranger", async () => {
    const asset = await upload("block", "private.png");

    expect((await fetch(asset.url)).status).toBe(404);

    const open = await fetch(
      `${base}/api/idp/public/uploads/${encodeURIComponent(did)}`,
    );
    const listed = (await open.json()) as { data: { filename: string }[] };
    expect(listed.data.map((one) => one.filename)).not.toContain("private.png");
  });

  scenario("serves that picture back to the person who owns it", async () => {
    const asset = await upload("block", "mine.png");

    const shown = await call("GET", `/api/media/uploads/${asset.upload_id}`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await shown.arrayBuffer()).equals(PIXEL)).toBe(true);

    expect(
      (await fetch(`${base}/api/media/uploads/${asset.upload_id}`)).status,
    ).toBe(401);
  });

  scenario("fetches nothing an address alone asked for", async () => {
    // The open web, and this network, through a route that has to be public.
    for (const target of [
      "https://example.com/",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      const refused = await fetch(
        `${base}/api/proxy?url=${encodeURIComponent(target)}`,
      );
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain("<html");
    }

    expect((await fetch(`${base}/api/proxy`)).status).toBe(403);
    expect((await fetch(`${base}/api/proxy?ref=made-up`)).status).toBe(403);
  });

  // Signing alone still lets a link launder a document if the far end answers
  // with one.
  scenario("refuses a link of its own that answers with a page", async () => {
    const { AssetLinks } = await import("./asset-link");
    const link = app.get(AssetLinks).to(`${base}/api/health`);

    const refused = await fetch(link);
    expect(refused.status).toBe(502);
  });

  scenario("adds an emoji, lists it, and removes it", async () => {
    const asset = await upload("emoji", "wave.png");
    const shortcode = `wave${Date.now().toString(36)}`;

    const added = await read("POST", "/api/emoji/me", {
      shortcode,
      kind: "emoji",
      upload_id: asset.upload_id,
    });
    expect(added.status).toBe(201);
    const emoji = CustomEmojiSchema.parse(added.body);

    const listed = await read("GET", "/api/emoji/me");
    expect(listed.status).toBe(200);
    expect(
      listed.body.map((one: { shortcode: string }) => one.shortcode),
    ).toContain(shortcode);

    // A route that deletes and then fails to say so is a surface showing an
    // error over a list that is already right.
    const removed = await call("DELETE", `/api/emoji/me/${emoji.emoji_id}`);
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");

    const after = await read("GET", "/api/emoji/me");
    expect(
      after.body.map((one: { shortcode: string }) => one.shortcode),
    ).not.toContain(shortcode);
  });

  scenario("reports an emoji that is already gone as gone", async () => {
    const asset = await upload("emoji", "twice.png");
    const added = await read("POST", "/api/emoji/me", {
      shortcode: `twice${Date.now().toString(36)}`,
      kind: "emoji",
      upload_id: asset.upload_id,
    });
    const { emoji_id } = CustomEmojiSchema.parse(added.body);

    expect((await call("DELETE", `/api/emoji/me/${emoji_id}`)).status).toBe(
      204,
    );
    // 404 rather than 400, which is what `SloppyClient.del` reads as the
    // outcome it was asking for — a second tap is not an error.
    expect((await call("DELETE", `/api/emoji/me/${emoji_id}`)).status).toBe(
      404,
    );
  });

  scenario("saves a name and a picture onto the profile", async () => {
    const avatar = await upload("avatar", "face.png");

    const saved = await read("PATCH", "/api/profile/me", {
      display_name: "A Painter",
      bio: "Draws things",
      avatar_url: avatar.url,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      did,
      display_name: "A Painter",
      bio: "Draws things",
    });

    const read_back = await read("GET", "/api/profile/me");
    expect(new URL(read_back.body.avatar_url).pathname).toBe("/api/proxy");
    // What a reader is handed is an address here, never the store's own.
    expect(read_back.text).not.toContain("/api/idp/blob/");
  });

  // A peer resolving a DID has to see the avatar, so this one IS in the open —
  // and it is the address the profile answers with that a reader loads, never
  // the store's.
  scenario("shows an avatar to a reader who has no session", async () => {
    const avatar = await upload("avatar", "hello.png");
    await read("PATCH", "/api/profile/me", { avatar_url: avatar.url });
    const { body } = await read("GET", "/api/profile/me");

    expect(new URL(body.avatar_url).pathname).toBe("/api/proxy");
    const shown = await fetch(body.avatar_url);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await shown.arrayBuffer()).equals(PIXEL)).toBe(true);

    const open = await fetch(
      `${base}/api/idp/public/uploads/${encodeURIComponent(did)}`,
    );
    const listed = (await open.json()) as { data: { filename: string }[] };
    expect(listed.data.map((one) => one.filename)).toContain("hello.png");
  });

  // The picture it was shown is the only address a surface holds, so sending
  // that back has to save the picture rather than a link to this instance.
  scenario("saves a picture a surface sent back as it was shown", async () => {
    const avatar = await upload("avatar", "again.png");
    await read("PATCH", "/api/profile/me", { avatar_url: avatar.url });
    const shown = (await read("GET", "/api/profile/me")).body.avatar_url;

    await read("PATCH", "/api/profile/me", { avatar_url: shown });

    const held = await read(
      "GET",
      `/api/idp/public/profile/${encodeURIComponent(did)}`,
    );
    expect(held.body.data.avatar_url).toBe(avatar.url);
  });
});
