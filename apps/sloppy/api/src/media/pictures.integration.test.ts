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

import { createServer as createHttpServer } from "node:http";
import { type AddressInfo, createConnection, createServer } from "node:net";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  CustomEmojiSchema,
  MediaAssetSchema,
  OwnedMediaAssetSchema,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";
import { RATE_CAPACITY } from "./proxy.controller";

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
  let app: NestExpressApplication;
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

  /** An address the API minted is a path under it, so a reader spells the rest
   *  — `proxied()` in `@sloppy/client` is the shells' half of this. */
  function shown(src: string): string {
    return `${base}/api${src}`;
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
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
    });
    app.setGlobalPrefix("api", {
      exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
    });
    // As `main.ts` does it: the asset route rations fetches per caller, and who
    // the caller is depends on this.
    const { AppConfigService } = await import("../config/app-config.service");
    app.set("trust proxy", app.get(AppConfigService).trustedProxies);
    await app.listen(port, "127.0.0.1");

    // The API listens before the store is open; these routes need it open.
    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

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

  scenario(
    "takes a file and names it by the upload it arrived on",
    async () => {
      const asset = await upload("block", "pixel.png");
      expect(asset.mime_type).toBe("image/png");
      expect(asset.size).toBe(PIXEL.byteLength);
      // The store's own address is never handed out: it is what tells the machine
      // holding a picture who is looking at it.
      expect(JSON.stringify(asset)).not.toContain("/api/idp/blob/");
    },
  );

  // A note is private until its subtree is published, and the folder a picture
  // lands in is the store's whole access rule — so this is the check, not the
  // route's own answer to a request that carried a session.
  scenario("keeps a note's picture away from a stranger", async () => {
    await upload("block", "private.png");

    const open = await fetch(
      `${base}/api/idp/public/uploads/${encodeURIComponent(did)}`,
    );
    const listed = (await open.json()) as { data: { filename: string }[] };
    expect(listed.data.map((one) => one.filename)).not.toContain("private.png");
  });

  // Using a picture twice means finding the one already sent, and the folder a
  // role lands in is what separates a note's pictures from a profile's.
  scenario(
    "lists the pictures a person put in a note, and only those",
    async () => {
      const inANote = await upload("block", "listed.png");
      await upload("avatar", "not-listed.png");

      const { status, body } = await read("GET", "/api/media/uploads");
      expect(status).toBe(200);
      const listed = OwnedMediaAssetSchema.array().parse(body);
      expect(listed.map((one) => one.filename)).toContain("listed.png");
      expect(listed.map((one) => one.filename)).not.toContain("not-listed.png");
      expect(listed[0].upload_id).toBe(inANote.upload_id);
      expect(JSON.stringify(listed)).not.toContain("/api/idp/blob/");

      expect((await fetch(`${base}/api/media/uploads`)).status).toBe(401);
    },
  );

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

  // The store is the only place one lives, so nothing else in the product can
  // end it: deleting the note that showed it leaves the bytes where they were.
  scenario("takes a picture back out of the person's own store", async () => {
    const asset = await upload("block", "regretted.png");

    expect(
      (
        await fetch(`${base}/api/media/uploads/${asset.upload_id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(401);

    const { status } = await read(
      "DELETE",
      `/api/media/uploads/${asset.upload_id}`,
    );
    expect(status).toBe(200);

    const listed = await read("GET", "/api/media/uploads");
    expect(
      OwnedMediaAssetSchema.array()
        .parse(listed.body)
        .map((one) => one.filename),
    ).not.toContain("regretted.png");

    expect(
      (await call("GET", `/api/media/uploads/${asset.upload_id}`)).status,
    ).toBe(404);
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

  // A far end answering with more than the route will carry is the one case
  // where the cap has to act after the head is already out, and the instance
  // holding somebody's avatar is not ours to trust with how much it sends.
  scenario(
    "keeps serving after a far end sends more than it will",
    async () => {
      const { AssetLinks } = await import("./asset-link");
      const chunk = Buffer.alloc(1024 * 1024, 0x41);
      const flood = createHttpServer((_req, res) => {
        res.writeHead(200, { "content-type": "image/png" });
        const push = () => {
          while (!res.destroyed && !res.writableEnded) {
            if (!res.write(chunk)) {
              res.once("drain", push);
              return;
            }
          }
        };
        push();
      });
      await new Promise<void>((ready) => flood.listen(0, "127.0.0.1", ready));
      const at = `http://127.0.0.1:${(flood.address() as AddressInfo).port}/x.png`;

      try {
        const answer = await fetch(shown(app.get(AssetLinks).to(at)));
        const carried = await answer.arrayBuffer().catch(() => null);
        expect(carried).toBeNull();
      } finally {
        flood.closeAllConnections();
        await new Promise((closed) => flood.close(closed));
      }

      const avatar = await upload("avatar", "after-the-flood.png");
      await read("PATCH", "/api/profile/me", {
        avatar_upload_id: avatar.upload_id,
      });
      const { body } = await read("GET", "/api/profile/me");
      expect((await fetch(shown(body.avatar_src))).status).toBe(200);
    },
  );

  // Signing alone still lets a link launder a document if the far end answers
  // with one.
  scenario("refuses a link of its own that answers with a page", async () => {
    const { AssetLinks } = await import("./asset-link");
    const link = app.get(AssetLinks).to(`${base}/api/health`);

    const refused = await fetch(shown(link));
    expect(refused.status).toBe(502);
  });

  // A ration exists to bound what a stranger can make this instance fetch, so
  // a link it never minted must not spend one — otherwise a caller holding no
  // link at all empties the ration of whoever shares their bucket.
  scenario("spends no ration on a link it did not mint", async () => {
    const from = { "x-forwarded-for": "203.0.113.20" };
    const flood = await Promise.all(
      Array.from({ length: RATE_CAPACITY * 2 }, (_, n) =>
        fetch(`${base}/api/proxy?ref=made-up-${n}`, { headers: from }).then(
          (one) => one.status,
        ),
      ),
    );
    expect(new Set(flood)).toEqual(new Set([403]));

    const avatar = await upload("avatar", "still-loads.png");
    await read("PATCH", "/api/profile/me", {
      avatar_upload_id: avatar.upload_id,
    });
    const { body } = await read("GET", "/api/profile/me");

    const still = await fetch(shown(body.avatar_src), { headers: from });
    expect(still.status).toBe(200);
  });

  // One reader's fetch loop must not fall on everybody else's pictures, which
  // is only true while the instance can tell readers apart — behind a proxy
  // that means `trust proxy`, which `main.ts` sets.
  scenario("rations fetches per caller, and tells callers apart", async () => {
    const { AssetLinks } = await import("./asset-link");
    // Refused before a socket is opened, whatever the deployment allows, so
    // this spends rations and reaches nothing.
    const link = shown(app.get(AssetLinks).to("http://169.254.169.254/x.png"));
    const asReader = (ip: string) => ({ headers: { "x-forwarded-for": ip } });

    // At once, so the steady refill cannot keep up with the loop.
    const flood = await Promise.all(
      Array.from({ length: RATE_CAPACITY * 2 }, () =>
        fetch(link, asReader("203.0.113.1")).then((one) => one.status),
      ),
    );
    expect(flood).toContain(429);
    expect((await fetch(link, asReader("203.0.113.2"))).status).toBe(403);
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
      avatar_upload_id: avatar.upload_id,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      did,
      display_name: "A Painter",
      bio: "Draws things",
    });

    const read_back = await read("GET", "/api/profile/me");
    expect(read_back.body.avatar_src.startsWith("/proxy?ref=")).toBe(true);
    // What a reader is handed is an address here, never the store's own.
    expect(read_back.text).not.toContain("/api/idp/blob/");
  });

  // A peer resolving a DID has to see the avatar, so this one IS in the open —
  // and it is the address the profile answers with that a reader loads, never
  // the store's.
  scenario("shows an avatar to a reader who has no session", async () => {
    const avatar = await upload("avatar", "hello.png");
    await read("PATCH", "/api/profile/me", {
      avatar_upload_id: avatar.upload_id,
    });
    const { body } = await read("GET", "/api/profile/me");

    const drawn = await fetch(shown(body.avatar_src));
    expect(drawn.status).toBe(200);
    expect(drawn.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await drawn.arrayBuffer()).equals(PIXEL)).toBe(true);

    const open = await fetch(
      `${base}/api/idp/public/uploads/${encodeURIComponent(did)}`,
    );
    const listed = (await open.json()) as { data: { filename: string }[] };
    expect(listed.data.map((one) => one.filename)).toContain("hello.png");
  });

  // A profile picture is one of the caller's own uploads and nothing else, so
  // an address they typed cannot become one — Sloppy would fetch it for every
  // reader of that profile, from an address that is this instance's.
  scenario("takes no address for a profile picture", async () => {
    const avatar = await upload("avatar", "kept.png");
    await read("PATCH", "/api/profile/me", {
      avatar_upload_id: avatar.upload_id,
    });
    const before = (await read("GET", "/api/profile/me")).body.avatar_src;

    await read("PATCH", "/api/profile/me", {
      avatar_url: "https://example.com/not-an-image",
      avatar_src: "https://example.com/not-an-image",
    });

    const after = await read("GET", "/api/profile/me");
    expect(after.body.avatar_src).toBe(before);
    const held = await read(
      "GET",
      `/api/idp/public/profile/${encodeURIComponent(did)}`,
    );
    expect(held.body.data.avatar_url).not.toContain("example.com");
  });

  // A profile is read by strangers and a note's picture is not readable by
  // them, so accepting one would leave a picture that nobody — its owner
  // included — can see, and hand every reader of that profile its address.
  scenario("takes no picture from a note as a profile picture", async () => {
    const avatar = await upload("avatar", "kept-mine.png");
    await read("PATCH", "/api/profile/me", {
      avatar_upload_id: avatar.upload_id,
    });
    const before = (await read("GET", "/api/profile/me")).body.avatar_src;

    const inANote = await upload("block", "in-a-note.png");
    const refused = await read("PATCH", "/api/profile/me", {
      avatar_upload_id: inANote.upload_id,
    });
    expect(refused.status).toBe(400);

    expect((await read("GET", "/api/profile/me")).body.avatar_src).toBe(before);
    const held = await read(
      "GET",
      `/api/idp/public/profile/${encodeURIComponent(did)}`,
    );
    expect(held.text).not.toContain(inANote.upload_id.split("/")[1]);
  });

  scenario("clears a profile picture when it is asked to", async () => {
    const avatar = await upload("avatar", "gone.png");
    await read("PATCH", "/api/profile/me", {
      avatar_upload_id: avatar.upload_id,
    });
    expect(
      (await read("GET", "/api/profile/me")).body.avatar_src,
    ).not.toBeNull();

    await read("PATCH", "/api/profile/me", { avatar_upload_id: null });
    expect((await read("GET", "/api/profile/me")).body.avatar_src).toBeNull();
  });

  // Copying names an entry in somebody's catalog, so the bytes that arrive are
  // the ones the reader was shown rather than whatever an address answered.
  scenario("copies an emoji by naming the one that was shown", async () => {
    const asset = await upload("emoji", "borrowed.png");
    const shortcode = `borrowed${Date.now().toString(36)}`;
    const added = await read("POST", "/api/emoji/me", {
      shortcode,
      kind: "emoji",
      upload_id: asset.upload_id,
    });
    const source = CustomEmojiSchema.parse(added.body);

    const copied = await read("POST", "/api/emoji/me/copies", {
      shortcode: `${shortcode}2`,
      kind: "emoji",
      source_emoji_id: source.emoji_id,
    });
    expect(copied.status).toBe(201);
    const copy = CustomEmojiSchema.parse(copied.body);
    expect(copy.emoji_id).not.toBe(source.emoji_id);

    const drawn = await fetch(shown(copy.src));
    expect(drawn.status).toBe(200);
    expect(Buffer.from(await drawn.arrayBuffer()).equals(PIXEL)).toBe(true);

    const refused = await read("POST", "/api/emoji/me/copies", {
      shortcode: `${shortcode}3`,
      kind: "emoji",
      source_emoji_id: `${did}/not-an-entry`,
    });
    expect(refused.status).toBe(400);
  });
});
