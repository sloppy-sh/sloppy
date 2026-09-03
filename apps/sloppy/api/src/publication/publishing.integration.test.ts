// Publishing all the way through, over real HTTP: a branch copied into a
// version, read back by somebody with no session, held still while its author
// writes on, compared against a second version, and taken down with its
// pictures.
//
// None of this is observable from the source. That a peer reads a COPY rather
// than the author's live rows is the whole of the milestone, and the only place
// it can be seen is a running instance with a store behind it.
//
// Skipped when the dev stack is not up, so a clone without it still runs
// `pnpm test`. `docker compose up -d` is what turns it on.

import { type AddressInfo, createConnection, createServer } from "node:net";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  type Address,
  addressDepth,
  type BlockView,
  childAddress,
  createOwnedRecordId,
  EMOJI_UPLOAD_ATTR,
  type NodeView,
  type OwnedRef,
  type PublicationView,
  type PublishedChangesPage,
  type PublishedIndex,
  type PublishedSubtreePage,
  siblingAddress,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";

const DB_ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const STORE_ENDPOINT = new URL(
  process.env.S3_ENDPOINT ?? "http://localhost:9010",
);
const DATABASE = `publishing_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** A one-pixel PNG. Nothing here decodes it; it only has to be bytes with a
 *  type. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A branch long enough that one answer cannot carry it. */
const LONG_BRANCH = 260;

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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const found = server.address() as AddressInfo | null;
      server.close(() =>
        found ? resolve(found.port) : reject(new Error("no free port")),
      );
    });
  });
}

interface Person {
  did: string;
  cookie: string;
}

describe("publishing a branch, and what a peer reads back", () => {
  let listening = false;
  let app: NestExpressApplication;
  let base: string;
  let ada: Person;

  const scenario = (name: string, run: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async (ctx) => {
        ctx.skip(!listening, "the dev stack is not up");
        await run();
      },
      timeout,
    );

  async function call(
    method: string,
    path: string,
    person: Person | null,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(person ? { cookie: person.cookie } : {}),
      },
      ...(body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  const ok = async (
    method: string,
    path: string,
    person: Person | null,
    body?: unknown,
  ): Promise<unknown> => {
    const answer = await call(method, path, person, body);
    expect(
      answer.status,
      `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
    ).toBeLessThan(300);
    return answer.body;
  };

  /** The two path segments a reference binds as. */
  const at = (ref: OwnedRef) =>
    `${encodeURIComponent(ref.slice(0, ref.lastIndexOf("/")))}/${encodeURIComponent(
      ref.slice(ref.lastIndexOf("/") + 1),
    )}`;

  const newNode = (request: Record<string, unknown>): Promise<NodeView> =>
    ok("POST", "/nodes", ada, request) as Promise<NodeView>;

  const newBlock = (
    node: OwnedRef,
    content: Record<string, unknown>,
  ): Promise<BlockView> =>
    ok("POST", "/blocks", ada, { node, content }) as Promise<BlockView>;

  const publish = (root: OwnedRef): Promise<PublicationView> =>
    ok("POST", "/publications", ada, { root }) as Promise<PublicationView>;

  /** As a peer's instance reads it: no session at all. */
  const read = async (
    publication: OwnedRef,
    query = "",
  ): Promise<PublishedSubtreePage | null> =>
    (await ok(
      "GET",
      `/public/publications/${at(publication)}${query}`,
      null,
    )) as PublishedSubtreePage | null;

  /** Steps one to three, as a device does them. */
  async function upload(filename: string, role = "block"): Promise<string> {
    const ticket = (await ok("POST", "/media/uploads", ada, {
      role,
      filename,
      mime_type: "image/png",
      size: PIXEL.byteLength,
    })) as { upload_id: string; upload_url: string; upload_headers: object };
    const sent = await fetch(ticket.upload_url, {
      method: "PUT",
      headers: ticket.upload_headers as Record<string, string>,
      body: PIXEL,
    });
    if (!sent.ok) throw new Error(`PUT ${sent.status}`);
    await ok("POST", "/media/uploads/complete", ada, {
      upload_id: ticket.upload_id,
    });
    return ticket.upload_id;
  }

  /** A picture read back as its owner, which answers bytes rather than JSON. */
  async function picture(uploadId: string): Promise<number> {
    const response = await fetch(
      `${base}/api/media/uploads/${at(uploadId as OwnedRef)}`,
      { headers: { cookie: ada.cookie, accept: "image/*" } },
    );
    await response.arrayBuffer();
    return response.status;
  }

  /** What anybody holding the author's identity can enumerate. */
  async function publicFilenames(): Promise<string[]> {
    const listed = (await (
      await fetch(
        `${base}/api/idp/public/uploads/${encodeURIComponent(ada.did)}?limit=100`,
      )
    ).json()) as { data: { filename: string }[] };
    return listed.data.map((one) => one.filename);
  }

  async function signIn(username: string): Promise<Person> {
    const post = (path: string, body: unknown, token?: string) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }).then((response) => response.json());

    const registered = (await post("/api/idp/register", {
      username,
      password: PASSWORD,
      display_name: username,
    })) as { did: string; access_token: string };
    const started = (await post("/api/auth/login", { instance_url: base })) as {
      consent_url: string;
    };
    const asked = new URL(started.consent_url).searchParams;
    const opened = (await post(
      "/api/idp/consent",
      {
        platform_origin: asked.get("platform_origin"),
        platform_name: asked.get("platform_name"),
        callback_url: asked.get("callback_url"),
        scopes: asked.get("scopes")?.split(","),
        state: asked.get("state"),
      },
      registered.access_token,
    )) as { challenge_id: string };
    const approved = (await post(
      `/api/idp/consent/${opened.challenge_id}/approve`,
      { password: PASSWORD },
      registered.access_token,
    )) as { redirect_url: string };
    const landed = await fetch(approved.redirect_url, { redirect: "manual" });
    const cookie = landed.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("sloppy_session="))
      ?.split(";")[0];
    if (!cookie) throw new Error(`no session for ${username}`);
    return { did: registered.did, cookie };
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
    const { AppConfigService } = await import("../config/app-config.service");
    app.set("trust proxy", app.get(AppConfigService).trustedProxies);
    await app.listen(port, "127.0.0.1");

    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();
    ada = await signIn(`ada${Date.now().toString(36)}`);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService: Db } = await import("../db/db.service");
    await app
      .get<DbService>(Db)
      .handle.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
    await app.close();
  });

  scenario("serves a branch to somebody with no session at all", async () => {
    const root = await newNode({ title: "A city remembers" });
    const branch = await newNode({
      from: { relation: "under", note: root.ref },
      title: "Its water",
    });
    const under = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "The aqueduct",
    });
    await newBlock(branch.ref, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "It rained." }] },
      ],
    });

    const publication = await publish(branch.ref);
    expect(publication.root_address).toBe(branch.address);
    expect(publication.latest.sequence).toBe(1);

    const page = await read(publication.ref);
    if (!page) throw new Error("nothing was served");
    expect(page.nodes.map((node) => node.address)).toEqual([
      branch.address,
      under.address,
    ]);
    // The region's own root: its parent is outside the publication, so naming
    // one would say a note exists that nobody published.
    const served = page.nodes[0];
    expect(served.parent).toBeUndefined();
    expect(served.origin).toBe(branch.ref);
    expect(page.nodes[1].parent).toBe(branch.ref);
    expect(page.nodes[1].origin).toBe(branch.ref);
    expect(served).not.toHaveProperty("depth");
    expect(page.blocks).toHaveLength(1);
    expect(page.next_cursor).toBeUndefined();
    // Nothing above or beside the branch travelled with it.
    expect(JSON.stringify(page)).not.toContain(root.ref);
  });

  scenario(
    "keeps the copy still while its author writes on, and publishes again to move it",
    async () => {
      const branch = await newNode({ title: "As it stood" });
      const section = await newBlock(branch.ref, {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First." }] },
        ],
      });
      const publication = await publish(branch.ref);
      const first = publication.latest;

      await ok("PATCH", `/nodes/${at(branch.ref)}`, ada, {
        title: "As it stands",
      });
      await ok("PATCH", `/blocks/${at(section.ref)}`, ada, {
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Second." }] },
          ],
        },
      });

      const held = await read(publication.ref);
      expect(held?.nodes[0].title).toBe("As it stood");
      expect(JSON.stringify(held?.blocks)).toContain("First.");
      expect(JSON.stringify(held?.blocks)).not.toContain("Second.");

      const again = await publish(branch.ref);
      expect(again.ref).toBe(publication.ref);
      expect(again.latest.sequence).toBe(2);
      expect(again.latest.ref).not.toBe(first.ref);

      const now = await read(publication.ref);
      expect(now?.nodes[0].title).toBe("As it stands");
      // The version a peer was already reading is untouched.
      const before = await read(
        publication.ref,
        `?version=${encodeURIComponent(first.ref)}`,
      );
      expect(before?.nodes[0].title).toBe("As it stood");
      expect(JSON.stringify(before?.blocks)).toContain("First.");

      const chain = (await ok(
        "GET",
        `/publications/${at(publication.ref)}/versions`,
        ada,
      )) as { sequence: number }[];
      expect(chain.map((version) => version.sequence)).toEqual([2, 1]);
    },
  );

  scenario("answers what the writing did between two versions", async () => {
    const branch = await newNode({ title: "Before" });
    const kept = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Stays",
    });
    const rewritten = await newBlock(branch.ref, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A." }] }],
    });
    const publication = await publish(branch.ref);
    const first = publication.latest.ref;

    await ok("PATCH", `/nodes/${at(branch.ref)}`, ada, { title: "After" });
    await ok("PATCH", `/blocks/${at(rewritten.ref)}`, ada, {
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "B." }] },
        ],
      },
    });
    await ok("DELETE", `/nodes/${at(kept.ref)}`, ada);
    const arrived = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Arrived",
    });
    const second = (await publish(branch.ref)).latest.ref;

    const page = (await ok(
      "GET",
      `/public/publications/${at(publication.ref)}/changes?from=${encodeURIComponent(first)}&to=${encodeURIComponent(second)}`,
      null,
    )) as PublishedChangesPage;
    expect(page.from).toBe(first);
    expect(page.to).toBe(second);
    const byRef = new Map(page.changes.map((one) => [one.note.ref, one]));
    const changed = byRef.get(branch.ref);
    if (changed?.change !== "changed") throw new Error("expected a change");
    expect(changed.before.title).toBe("Before");
    expect(changed.note.title).toBe("After");
    expect(changed.sections).toHaveLength(1);
    expect(byRef.get(kept.ref)?.change).toBe("removed");
    expect(byRef.get(arrived.ref)?.change).toBe("added");
  });

  scenario(
    "carries a picture as the publication's own copy, and leaves the original where it was",
    async () => {
      const uploadId = await upload("in-a-note.png");
      const branch = await newNode({ title: "With a picture" });
      await newBlock(branch.ref, {
        type: "doc",
        content: [{ type: "picture", attrs: { upload_id: uploadId } }],
      });

      const publication = await publish(branch.ref);
      const page = await read(publication.ref);
      const drawn = (page?.blocks[0].content.content?.[0].attrs ?? {}) as {
        upload_id?: string;
      };
      expect(drawn.upload_id).toBeDefined();
      expect(drawn.upload_id).not.toBe(uploadId);

      // The one a peer reads is readable by anybody; the one in the note is not.
      const open = await publicFilenames();
      expect(open).toContain("in-a-note.png");
      expect(
        open.filter((filename) => filename === "in-a-note.png"),
      ).toHaveLength(1);
      expect(await picture(uploadId)).toBe(200);

      // Publishing again reuses the copy rather than sending the bytes twice.
      await publish(branch.ref);
      const after = await read(publication.ref);
      const again = (after?.blocks[0].content.content?.[0].attrs ?? {}) as {
        upload_id?: string;
      };
      expect(again.upload_id).toBe(drawn.upload_id);
      expect(
        (await publicFilenames()).filter((f) => f === "in-a-note.png"),
      ).toHaveLength(1);
    },
    60_000,
  );

  scenario(
    "draws an emoji from the snapshot, so emptying the catalog changes nothing",
    async () => {
      const uploadId = await upload("kite.png", "emoji");
      const emoji = (await ok("POST", "/emoji/me", ada, {
        shortcode: "kite",
        kind: "emoji",
        upload_id: uploadId,
      })) as { emoji_id: string; src: string };

      const branch = await newNode({ title: "With an emoji" });
      await newBlock(branch.ref, {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "emoji",
                attrs: {
                  name: "kite",
                  char: "",
                  src: emoji.src,
                  sticker: false,
                },
              },
            ],
          },
        ],
      });

      const publication = await publish(branch.ref);
      const drawn = (await read(publication.ref))?.blocks[0].content
        .content?.[0].content?.[0].attrs as Record<string, unknown>;
      expect(drawn[EMOJI_UPLOAD_ATTR]).toBeDefined();
      expect(drawn.src).toBeUndefined();

      const [emojiDid, emojiLocal] = [
        emoji.emoji_id.slice(0, emoji.emoji_id.lastIndexOf("/")),
        emoji.emoji_id.slice(emoji.emoji_id.lastIndexOf("/") + 1),
      ];
      await ok(
        "DELETE",
        `/emoji/me/${encodeURIComponent(emojiDid)}/${encodeURIComponent(emojiLocal)}`,
        ada,
      );
      const after = (await read(publication.ref))?.blocks[0].content
        .content?.[0].content?.[0].attrs as Record<string, unknown>;
      expect(after[EMOJI_UPLOAD_ATTR]).toBe(drawn[EMOJI_UPLOAD_ATTR]);
    },
    60_000,
  );

  // A citation carries the words it was cited under, which are the CITED note's
  // title. Blanking the reference alone would still hand a stranger the title
  // of a note nobody published.
  scenario("says nothing at all about a note nobody published", async () => {
    const secret = await newNode({ title: "Bones under the water plant" });
    const branch = await newNode({ title: "What is safe to say" });
    await newBlock(branch.ref, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "reference",
              attrs: { note: secret.ref, label: secret.title },
            },
          ],
        },
      ],
    });
    await ok("PATCH", `/nodes/${at(branch.ref)}`, ada, {
      links: [secret.ref],
    });

    const publication = await publish(branch.ref);
    const page = await read(publication.ref);
    const answer = JSON.stringify(page);
    expect(answer).not.toContain("Bones under the water plant");
    expect(answer).not.toContain(secret.ref);
    expect(page?.nodes[0].links).toEqual([]);
    const cited = page?.blocks[0].content.content?.[0].content?.[0].attrs as {
      note: string;
      label: string;
    };
    expect(cited).toEqual({ note: "", label: "" });
  });

  scenario("marks the notes a version carries, and only those", async () => {
    const branch = await newNode({ title: "Marked" });
    const under = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Also marked",
    });
    const publication = await publish(branch.ref);

    const marked = async (ref: OwnedRef) =>
      ((await ok("GET", `/nodes/${at(ref)}`, ada)) as NodeView).published;
    expect(await marked(branch.ref)).toBe(true);
    expect(await marked(under.ref)).toBe(true);

    // A note written under a published ancestor is in no version until its
    // author publishes again, and a mark that said otherwise would be the
    // interface lying about what has left.
    const later = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Written since",
    });
    expect(await marked(later.ref)).toBe(false);

    await ok("DELETE", `/publications/${at(publication.ref)}`, ada);
    expect(await marked(branch.ref)).toBe(false);
    expect(await marked(under.ref)).toBe(false);
  });

  scenario(
    "takes the whole chain down, and the copies with it",
    async () => {
      const uploadId = await upload("goes-with-it.png");
      const branch = await newNode({ title: "Not for long" });
      await newBlock(branch.ref, {
        type: "doc",
        content: [{ type: "picture", attrs: { upload_id: uploadId } }],
      });
      const publication = await publish(branch.ref);
      await publish(branch.ref);
      expect(await publicFilenames()).toContain("goes-with-it.png");

      await ok("DELETE", `/publications/${at(publication.ref)}`, ada);

      expect(await read(publication.ref)).toBeNull();
      expect(await publicFilenames()).not.toContain("goes-with-it.png");
      const listed = (await ok("GET", "/publications", ada)) as {
        ref: OwnedRef;
      }[];
      expect(listed.map((one) => one.ref)).not.toContain(publication.ref);
      const index = (await ok(
        "GET",
        `/public/publications/${encodeURIComponent(ada.did)}`,
        null,
      )) as PublishedIndex;
      expect(index.publications.map((one) => one.ref)).not.toContain(
        publication.ref,
      );
      // The picture it was made from is the author's, and is still theirs.
      expect(await picture(uploadId)).toBe(200);
    },
    60_000,
  );

  // A publish that cannot finish must leave nothing readable and no picture
  // made public by an act that failed.
  scenario("publishes whole or not at all", async () => {
    const branch = await newNode({ title: "Half a thing" });
    const uploadId = await upload("real.png");
    await newBlock(branch.ref, {
      type: "doc",
      content: [
        { type: "picture", attrs: { upload_id: uploadId } },
        {
          type: "picture",
          attrs: { upload_id: `${ada.did}/01GONEGONEGONEGONEGONEGONE` },
        },
      ],
    });

    const refused = await call("POST", "/publications", ada, {
      root: branch.ref,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(branch.address);

    const listed = (await ok("GET", "/publications", ada)) as PublicationView[];
    expect(listed.map((one) => one.root)).not.toContain(branch.ref);
    const index = (await ok(
      "GET",
      `/public/publications/${encodeURIComponent(ada.did)}`,
      null,
    )) as PublishedIndex;
    expect(index.publications.map((one) => one.root_address)).not.toContain(
      branch.address,
    );
    // The copy the attempt had already made is not left public.
    expect(await publicFilenames()).not.toContain("real.png");
  });

  scenario("lists what an identity publishes, and nothing else", async () => {
    const shown = await newNode({ title: "On the shelf" });
    const hidden = await newNode({ title: "In the drawer" });
    const publication = await publish(shown.ref);

    const index = (await ok(
      "GET",
      `/public/publications/${encodeURIComponent(ada.did)}`,
      null,
    )) as PublishedIndex;
    expect(index.did).toBe(ada.did);
    const listed = index.publications.find(
      (one) => one.ref === publication.ref,
    );
    expect(listed?.title).toBe("On the shelf");
    expect(listed?.root_address).toBe(shown.address);
    expect(listed?.latest.sequence).toBe(1);
    expect(JSON.stringify(index)).not.toContain("In the drawer");
    expect(JSON.stringify(index)).not.toContain(hidden.ref);
  });

  scenario(
    "reads a branch too long for one answer a page at a time",
    async () => {
      const root = await newNode({ title: "A long run" });
      const db = app.get<DbService>(
        (await import("../db/db.service")).DbService,
      );
      const rows: Record<string, unknown>[] = [];
      const now = new Date().toISOString();
      let address = childAddress(root.address as Address);
      for (let i = 1; i <= LONG_BRANCH; i++) {
        rows.push({
          id: createOwnedRecordId("node", ada.did),
          created_by: ada.did,
          address,
          depth: addressDepth(address),
          parent: root.ref,
          origin: root.ref,
          title: `Note ${i}`,
          tags: [],
          links: [],
          published: false,
          created_at: now,
          updated_at: now,
        });
        address = siblingAddress(address);
      }
      for (let at = 0; at < rows.length; at += 200) {
        await db.handle.query("INSERT INTO node $rows", {
          rows: rows.slice(at, at + 200),
        });
      }

      const publication = await publish(root.ref);
      const held: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await read(
          publication.ref,
          cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`,
        );
        if (!page) throw new Error("nothing was served");
        pages += 1;
        // Every reference resolves in the page carrying it or one already sent.
        for (const node of page.nodes) {
          if (node.parent !== undefined) expect(held).toContain(node.parent);
          held.push(node.ref);
        }
        cursor = page.next_cursor;
      } while (cursor !== undefined);

      expect(pages).toBeGreaterThan(1);
      expect(held).toHaveLength(LONG_BRANCH + 1);
      expect(new Set(held).size).toBe(held.length);
    },
    120_000,
  );
});
