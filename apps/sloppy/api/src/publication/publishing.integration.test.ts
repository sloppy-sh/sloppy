// Publishing all the way through, over real HTTP: a branch copied into a
// version, read back by somebody with no session, held still while its author
// writes on, compared against a second version, taken down with its pictures,
// and answered by a stranger with no relationship to its author.
//
// None of this is observable from the source. That a peer reads a COPY rather
// than the author's live rows is the whole of the milestone, and the only place
// it can be seen is a running instance with a store behind it.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer as createHttpServer, type Server } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  type Address,
  addressDepth,
  compareAddresses,
  type BlockView,
  childAddress,
  createOwnedRecordId,
  EMOJI_UPLOAD_ATTR,
  homeGraphRef,
  type NodeView,
  type OwnedRef,
  POINTERS_PER_NOTE,
  POINTERS_PER_VOICE,
  type PublicationView,
  type PublishedIndex,
  type PublishedSubtreePage,
  parsePublishedIndex,
  publishedChangesReader,
  publishedSubtreeReader,
  recordIdFromOwnedRef,
  siblingAddress,
  syrPostRefFor,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbService } from "../db/db.service";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

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

/** Somebody the author has never heard of, whose identity is kept somewhere
 *  this instance has no relationship with. */
const STRANGER = "did:syr:z6MkStrangerStrangerStrangerStranger";
/** Somebody else again, for a claim citing a comment in a name its depositor
 *  does not hold. */
const OTHER = "did:syr:z6MkSecondVoiceSpeakingHere";

/**
 * An identity store the stranger is kept on, answering the two endpoints a
 * deposit is checked against: where a DID's store is, and what that identity
 * has said in public about one note. The embedded provider serves no
 * conversation at all, so without one of these a claim can never be backed —
 * which is itself what the refusals below assert.
 */
function strangerStore(said: {
  did: string;
  localId: string;
  post: { post_did: string; post_id: string };
}): Promise<{ url: string; close: () => Promise<void>; asked: string[] }> {
  const asked: string[] = [];
  let url = "";
  const server: Server = createHttpServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    asked.push(path);
    const answer = (body: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (path === "/.well-known/syr") {
      return answer({
        name: "syr",
        public_url: url,
        identity_manifest_template: `${url}/.well-known/syr/{did}`,
      });
    }
    if (path === `/.well-known/syr/${encodeURIComponent(said.did)}`) {
      return answer({
        version: 1,
        did: said.did,
        provider: url,
        endpoints: {
          profile: `${url}/profile`,
          uploads: `${url}/uploads`,
          did_document: `${url}/did`,
          public_comments: `${url}/comments`,
        },
        web_profile: `${url}/u`,
      });
    }
    if (path === "/comments") {
      return answer({
        data: [
          {
            did: said.did,
            local_id: said.localId,
            ...said.post,
            ancestor_chain: [],
            content: "I read this",
            created_at: "2026-03-01T10:00:00.000Z",
            updated_at: "2026-03-01T10:00:00.000Z",
          },
        ],
      });
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const found = server.address() as AddressInfo | null;
      if (!found) return reject(new Error("no port"));
      url = `http://127.0.0.1:${found.port}`;
      resolve({
        url,
        asked,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
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
  let runs = false;
  let app: NestExpressApplication;
  let base: string;
  let ada: Person;

  const scenario = (name: string, run: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async (ctx) => {
        ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
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

  /** Somebody else's instance leaving a claim, with no session of any kind. */
  const reply = async (
    note: OwnedRef,
    voice: string,
    commentId: string,
  ): Promise<number> =>
    (
      await call("POST", `/nodes/${at(note)}/replies`, null, {
        voice,
        comment_id: commentId,
      })
    ).status;

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

  /** What that identity publishes, held to the identity it was asked about. */
  async function published(): Promise<PublishedIndex> {
    return parsePublishedIndex(
      await ok(
        "GET",
        `/public/publications/${encodeURIComponent(ada.did)}`,
        null,
      ),
      ada.did,
    );
  }

  /** A move, as much of one as publishing can see: moving a note is
   *  `POST /nodes/:did/:localId/move`'s, and what publishing has to carry out
   *  is the note's new place and the row a move leaves at its old address. */
  async function carry(
    note: OwnedRef,
    from: { address: Address; parent: OwnedRef },
    to: { address: Address; parent: OwnedRef; origin: OwnedRef },
  ): Promise<void> {
    const { DbService: Db } = await import("../db/db.service");
    const when = new Date().toISOString();
    await app.get<DbService>(Db).handle.query(
      `UPDATE $note SET address = $address, depth = $depth, parent = $parent,
                        origin = $origin, updated_at = $when;
       INSERT INTO node_alias $left;`,
      {
        note: recordIdFromOwnedRef("node", note),
        address: to.address,
        depth: addressDepth(to.address),
        parent: to.parent,
        origin: to.origin,
        when,
        left: {
          id: createOwnedRecordId("node_alias", ada.did),
          created_by: ada.did,
          graph: homeGraphRef(ada.did),
          parent: from.parent,
          address: from.address,
          note,
          created_at: when,
          updated_at: when,
        },
      },
    );
  }

  /** What somebody with no relationship to the author has left pointing at one
   *  of their notes. Straight off the store: the read that draws one asks an
   *  identity store, and the embedded IdP serves no conversation. */
  async function pointersOn(note: OwnedRef): Promise<{ voice: string }[]> {
    const { DbService: Db } = await import("../db/db.service");
    const [rows] = await app
      .get<DbService>(Db)
      .handle.query<[{ voice: string }[]]>(
        "SELECT voice FROM comment_pointer WHERE created_by = $did AND note = $note",
        { did: ada.did, note },
      );
    return rows;
  }

  /** Where the author's identity answers, as a publish recorded it. Pointed at
   *  a store this test is running, because the embedded provider carries no
   *  conversation for anybody to have answered from. */
  async function answersFrom(
    publication: OwnedRef,
    identityStore: string,
  ): Promise<void> {
    const { DbService: Db } = await import("../db/db.service");
    await app
      .get<DbService>(Db)
      .handle.query(
        "UPDATE $id SET identity_store = $identityStore WHERE created_by = $did",
        {
          id: recordIdFromOwnedRef("publication", publication),
          did: ada.did,
          identityStore,
        },
      );
  }

  /** Straight off the store, because a chain with no version is served to
   *  nobody — which is the whole reason one left behind would be a problem. */
  async function chainsRootedAt(root: OwnedRef): Promise<unknown[]> {
    const { DbService: Db } = await import("../db/db.service");
    const [rows] = await app
      .get<DbService>(Db)
      .handle.query<[unknown[]]>(
        "SELECT VALUE id FROM publication WHERE created_by = $did AND root = $root",
        { did: ada.did, root },
      );
    return rows;
  }

  /**
   * Enough of the author's own emoji sorting before `shortcode` to push it off
   * the first page a catalog is served in. Only the shortcodes matter, so these
   * go in as rows rather than through the route that mints one.
   */
  async function fillCatalogBefore(shortcode: string): Promise<void> {
    const rows = Array.from({ length: 100 }, (_, at) => ({
      did: ada.did,
      shortcode: `aa${String(at).padStart(4, "0")}`,
      url: "https://example.invalid/filler.png",
      mime_type: "image/png",
      size: 1,
      is_sticker: false,
      created_at: new Date().toISOString(),
    }));
    expect(rows.every((row) => row.shortcode < shortcode)).toBe(true);
    const { DbService: Db } = await import("../db/db.service");
    await app
      .get<DbService>(Db)
      .handle.query("INSERT INTO idp_emoji $rows", { rows });
  }

  /** What anybody holding the author's identity can enumerate. */
  /** What anybody can read out of the author's store, as their instance lists
   *  it — which is where a peer's instance finds a published picture. */
  async function publicUploads(): Promise<
    { filename: string; local_id: string }[]
  > {
    const listed = (await (
      await fetch(
        `${base}/api/idp/public/uploads/${encodeURIComponent(ada.did)}?limit=100`,
      )
    ).json()) as { data: { filename: string; local_id: string }[] };
    return listed.data;
  }

  async function publicFilenames(): Promise<string[]> {
    return (await publicUploads()).map((one) => one.filename);
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
    runs = await integrationTarget(DB_ENDPOINT, STORE_ENDPOINT);
    if (!runs) return;

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
    await dropDatabase(app.get<DbService>(Db).handle, DATABASE);
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

    // Taken the way a peer's instance takes it: `publishedSubtreeReader` is the
    // boundary every rule about what may be in an answer is enforced at, and an
    // answer that breaks one is refused whole rather than stored.
    const reader = publishedSubtreeReader({ publication: publication.ref });
    const page = reader.take(await read(publication.ref));
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

  scenario("puts every note somebody chose out, each on its own", async () => {
    const first = await newNode({ title: "Aqueducts" });
    const under = await newNode({
      from: { relation: "under", note: first.ref },
      title: "The channel",
    });
    const beside = await newNode({ title: "Cisterns" });
    await newBlock(under.ref, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Stone, and a slope." }],
        },
      ],
    });

    // `under` is chosen as well, and goes out inside the note that carries it.
    const done = (await ok("POST", "/nodes/bulk", ada, {
      notes: [first.ref, under.ref, beside.ref],
      act: { act: "publish" },
    })) as { reached: number; missed: number; notes: NodeView[] };
    expect(done).toMatchObject({ reached: 3, missed: 0 });
    expect(done.notes.every((note) => note.published)).toBe(true);

    const mine = (await ok("GET", "/publications", ada)) as PublicationView[];
    const rooted = new Set(mine.map((one) => one.root_address));
    expect(rooted.has(first.address)).toBe(true);
    expect(rooted.has(beside.address)).toBe(true);
    expect(rooted.has(under.address)).toBe(false);

    const publication = mine.find((one) => one.root_address === first.address);
    if (!publication) throw new Error("the chosen note published nothing");
    const page = publishedSubtreeReader({
      publication: publication.ref,
    }).take(await read(publication.ref));
    expect(page.nodes.map((node) => node.address)).toEqual([
      first.address,
      under.address,
    ]);
    expect(page.blocks).toHaveLength(1);

    // Chosen again, it is another version of what is already out.
    await ok("POST", "/nodes/bulk", ada, {
      notes: [first.ref],
      act: { act: "publish" },
    });
    const after = (
      (await ok("GET", "/publications", ada)) as PublicationView[]
    ).find((one) => one.ref === publication.ref);
    expect(after?.latest.sequence).toBe(2);
  });

  // A chain of its own is its own. The carrier's new snapshot does not advance
  // it, so leaving it out would leave a peer holding its address on the older
  // one while the set was told it went out.
  scenario("sends a chosen note's own chain again inside another", async () => {
    const first = await newNode({ title: "Roads" });
    const under = await newNode({
      from: { relation: "under", note: first.ref },
      title: "Milestones",
    });
    await ok("POST", "/publications", ada, { root: under.ref });

    const done = (await ok("POST", "/nodes/bulk", ada, {
      notes: [first.ref, under.ref],
      act: { act: "publish" },
    })) as { reached: number; missed: number };
    expect(done).toMatchObject({ reached: 2, missed: 0 });

    const mine = (await ok("GET", "/publications", ada)) as PublicationView[];
    const rooted = new Set(mine.map((one) => one.root_address));
    const inner = mine.find((one) => one.root_address === under.address);
    expect(rooted.has(first.address)).toBe(true);
    expect(inner?.latest.sequence).toBe(2);
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

    const page = publishedChangesReader({
      publication: publication.ref,
      from: first,
      to: second,
    }).take(
      await ok(
        "GET",
        `/public/publications/${at(publication.ref)}/changes?from=${encodeURIComponent(first)}&to=${encodeURIComponent(second)}`,
        null,
      ),
    );
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
    "sends the addresses a note was carried away from, and says one moved",
    async () => {
      const branch = await newNode({ title: "A branch that shifts" });
      const carried = await newNode({
        from: { relation: "under", note: branch.ref },
        title: "Spores",
      });
      const publication = await publish(branch.ref);
      const first = publication.latest.ref;
      const before = await read(publication.ref);
      expect(
        before?.nodes.find((node) => node.ref === carried.ref),
      ).not.toHaveProperty("aliases");

      const was = carried.address as Address;
      const now = siblingAddress(was);
      await carry(
        carried.ref,
        { address: was, parent: branch.ref },
        { address: now, parent: branch.ref, origin: branch.ref },
      );
      const second = (await publish(branch.ref)).latest.ref;

      const page = await read(publication.ref);
      const sent = page?.nodes.find((node) => node.ref === carried.ref);
      expect(sent?.address).toBe(now);
      expect(sent?.aliases).toEqual([was]);

      const difference = publishedChangesReader({
        publication: publication.ref,
        from: first,
        to: second,
      }).take(
        await ok(
          "GET",
          `/public/publications/${at(publication.ref)}/changes?from=${encodeURIComponent(first)}&to=${encodeURIComponent(second)}`,
          null,
        ),
      );
      const entry = difference.changes.find(
        (one) => one.note.ref === carried.ref,
      );
      if (entry?.change !== "changed") throw new Error("expected a change");
      expect(entry.before.address).toBe(was);
      expect(entry.note.address).toBe(now);
    },
  );

  // An address the note held in a branch nobody published is a number in a part
  // of the author's graph the publication does not cover — docs/ARCHITECTURE.md
  // § "A published node carries only refs a peer may follow".
  scenario(
    "sends no address from outside the branch it published",
    async () => {
      const branch = await newNode({ title: "A branch that goes out" });
      const elsewhere = await newNode({ title: "A branch that stays home" });
      const carried = await newNode({
        from: { relation: "under", note: elsewhere.ref },
        title: "Spores",
      });

      const away = carried.address as Address;
      const arriving = childAddress(branch.address as Address);
      await carry(
        carried.ref,
        { address: away, parent: elsewhere.ref },
        { address: arriving, parent: branch.ref, origin: branch.ref },
      );
      const settled = siblingAddress(arriving);
      await carry(
        carried.ref,
        { address: arriving, parent: branch.ref },
        { address: settled, parent: branch.ref, origin: branch.ref },
      );

      const publication = await publish(branch.ref);
      const page = await read(publication.ref);
      const sent = page?.nodes.find((node) => node.ref === carried.ref);
      expect(sent?.address).toBe(settled);
      expect(sent?.aliases).toEqual([arriving]);
    },
  );

  // The decision to publish again is made on this, so it answers about the
  // draft — where a comparison of two versions cannot, every picture in a draft
  // citing the author's own upload rather than a published copy.
  scenario("answers what the branch has done since it went out", async () => {
    const branch = await newNode({ title: "Root" });
    const renamed = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Called this",
    });
    const retagged = await newNode({
      from: { relation: "under", note: renamed.ref },
      title: "Tagged",
      tags: ["seed"],
    });
    const written = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Written in",
    });
    const leaving = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "On its way out",
    });
    const untouched = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "Left alone",
    });
    const publication = await publish(branch.ref);

    const nothing = (await ok(
      "GET",
      `/publications/${at(publication.ref)}/unpublished`,
      ada,
    )) as { changes: unknown[]; total: number };
    expect(nothing).toMatchObject({ changes: [], total: 0 });

    await ok("PATCH", `/nodes/${at(renamed.ref)}`, ada, {
      title: "Called that",
    });
    await ok("PATCH", `/nodes/${at(retagged.ref)}`, ada, { tags: ["sprout"] });
    await newBlock(written.ref, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Since." }] },
      ],
    });
    await ok("DELETE", `/nodes/${at(leaving.ref)}`, ada);
    const arrived = await newNode({
      from: { relation: "under", note: branch.ref },
      title: "New since",
    });

    const moved = (await ok(
      "GET",
      `/publications/${at(publication.ref)}/unpublished`,
      ada,
    )) as {
      since: { ref: OwnedRef };
      total: number;
      changes: {
        note: OwnedRef;
        address: Address;
        change: string;
        was_titled?: string;
        tags_gained: string[];
        tags_lost: string[];
        written: boolean;
      }[];
    };

    expect(moved.since.ref).toBe(publication.latest.ref);
    const byRef = new Map(moved.changes.map((one) => [one.note, one]));
    expect(moved.total).toBe(5);
    expect(byRef.get(renamed.ref)).toMatchObject({
      change: "changed",
      was_titled: "Called this",
    });
    expect(byRef.get(retagged.ref)).toMatchObject({
      change: "changed",
      tags_gained: ["sprout"],
      tags_lost: ["seed"],
    });
    expect(byRef.get(written.ref)).toMatchObject({
      change: "changed",
      written: true,
    });
    expect(byRef.get(leaving.ref)?.change).toBe("removed");
    expect(byRef.get(arrived.ref)?.change).toBe("added");
    // A note nobody touched is not a change, and neither is the root.
    expect(byRef.has(untouched.ref)).toBe(false);
    expect(byRef.has(branch.ref)).toBe(false);
    // In address order, which is the order the branch reads in.
    const order = moved.changes.map((one) => one.address);
    expect(order).toEqual([...order].sort(compareAddresses));
  });

  scenario(
    "names a note carried somewhere else inside a branch that is already out",
    async () => {
      const branch = await newNode({ title: "A branch already out" });
      const first = await newNode({
        from: { relation: "under", note: branch.ref },
        title: "Spores",
      });
      const second = await newNode({
        from: { relation: "under", note: branch.ref },
        title: "Seeds",
      });
      const publication = await publish(branch.ref);
      const was = first.address as Address;

      const landed = (await ok("POST", `/nodes/${at(first.ref)}/move`, ada, {
        to: { relation: "under", note: second.ref },
      })) as NodeView[];
      const now = landed.find((note) => note.ref === first.ref)?.address;
      expect(now).not.toBe(was);

      const since = (await ok(
        "GET",
        `/publications/${at(publication.ref)}/unpublished`,
        ada,
      )) as {
        total: number;
        changes: {
          note: OwnedRef;
          address: Address;
          was_at?: Address;
          change: string;
        }[];
      };

      expect(since.changes.find((one) => one.note === first.ref)).toMatchObject(
        { address: now, was_at: was, change: "changed" },
      );
    },
  );

  // `published` says a version carries the note — docs/ARCHITECTURE.md § "Data
  // model" — and a move rewrites no version, so the copy that went out is
  // still out and a mark that stopped saying so would claim it had come back.
  scenario(
    "keeps the mark on a note carried out of a branch that is already out",
    async () => {
      const out = await newNode({ title: "A branch that goes out" });
      const leaving = await newNode({
        from: { relation: "under", note: out.ref },
        title: "Spores",
      });
      const home = await newNode({ title: "A branch that stays home" });
      const arriving = await newNode({
        from: { relation: "under", note: home.ref },
        title: "Seeds",
      });
      await publish(out.ref);

      await ok("POST", `/nodes/${at(leaving.ref)}/move`, ada, {
        to: { relation: "under", note: home.ref },
      });
      await ok("POST", `/nodes/${at(arriving.ref)}/move`, ada, {
        to: { relation: "under", note: out.ref },
      });

      const carriedOut = (await ok(
        "GET",
        `/nodes/${at(leaving.ref)}`,
        ada,
      )) as NodeView;
      const carriedIn = (await ok(
        "GET",
        `/nodes/${at(arriving.ref)}`,
        ada,
      )) as NodeView;

      expect(carriedOut.published).toBe(true);
      // And a note carried into it is out only once the branch goes again.
      expect(carriedIn.published).toBe(false);
    },
  );

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
      const listed = await publicUploads();
      const open = listed.map((one) => one.filename);
      expect(open).toContain("in-a-note.png");
      expect(
        open.filter((filename) => filename === "in-a-note.png"),
      ).toHaveLength(1);
      expect(await picture(uploadId)).toBe(200);

      // And the copy the block cites is the one that listing answers to, which
      // is the only way a peer's instance can find it.
      const copy = String(drawn.upload_id);
      expect(listed.map((one) => one.local_id)).toContain(
        copy.slice(copy.lastIndexOf("/") + 1),
      );

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
    "draws an emoji from anywhere in the catalog, and keeps it once emptied",
    async () => {
      // A catalog is served a page at a time, ordered by shortcode, and a
      // shortcode publishing cannot find is taken for one the author deleted.
      // So `kite` sits past the first page, where reading one page would drop
      // its picture and say nothing about having done so.
      await fillCatalogBefore("kite");
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
      const index = await published();
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
    const sections = [
      await newBlock(branch.ref, {
        type: "doc",
        content: [
          { type: "picture", attrs: { upload_id: uploadId } },
          {
            type: "picture",
            attrs: { upload_id: `${ada.did}/01GONEGONEGONEGONEGONEGONE` },
          },
        ],
      }),
    ];

    const refused = await call("POST", "/publications", ada, {
      root: branch.ref,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(branch.address);

    const listed = (await ok("GET", "/publications", ada)) as PublicationView[];
    expect(listed.map((one) => one.root)).not.toContain(branch.ref);
    const index = await published();
    expect(index.publications.map((one) => one.root_address)).not.toContain(
      branch.address,
    );
    // The copy the attempt had already made is not left public.
    expect(await publicFilenames()).not.toContain("real.png");

    // And no publication is left owning it. A chain nothing serves is invisible
    // to its author, so one that outlived a failed attempt would be a picture
    // they could neither see nor take down.
    expect(await chainsRootedAt(branch.ref)).toEqual([]);

    // Taking the picture out is what the answer asked for, and publishing then
    // starts the history at 1 rather than continuing one nobody could see.
    await ok("PATCH", `/blocks/${at(sections[0].ref)}`, ada, {
      content: {
        type: "doc",
        content: [{ type: "picture", attrs: { upload_id: uploadId } }],
      },
    });
    expect((await publish(branch.ref)).latest.sequence).toBe(1);
  });

  // The sweep that clears a chain a failed publish opened is guarded, because a
  // second publish of the same root shares that chain. Either claim on it — a
  // version, or a copy the store still holds — has to hold it in place.
  scenario(
    "will not clear a chain anything is still hanging off",
    async () => {
      const uploadId = await upload("still-owned.png");
      const branch = await newNode({ title: "Still owned" });
      await newBlock(branch.ref, {
        type: "doc",
        content: [{ type: "picture", attrs: { upload_id: uploadId } }],
      });
      const publication = await publish(branch.ref);

      const { PublicationRepository } = await import(
        "./publication.repository"
      );
      const repository = app.get(PublicationRepository);
      await repository.removeEmptyChain(ada.did, publication.ref);
      expect(await chainsRootedAt(branch.ref)).toHaveLength(1);

      const { DbService: Db } = await import("../db/db.service");
      await app.get<DbService>(Db).handle.query(
        `DELETE publication_version
             WHERE created_by = $did AND publication = $publication`,
        { did: ada.did, publication: publication.ref },
      );
      await repository.removeEmptyChain(ada.did, publication.ref);
      expect(await chainsRootedAt(branch.ref)).toHaveLength(1);

      await ok("DELETE", `/publications/${at(publication.ref)}`, ada);
      expect(await chainsRootedAt(branch.ref)).toEqual([]);
      expect(await publicFilenames()).not.toContain("still-owned.png");
    },
    60_000,
  );

  // Deleting is the author taking a branch back, so what it was serving stops
  // being served on the way out.
  scenario(
    "stops serving a branch its author deleted",
    async () => {
      const uploadId = await upload("deleted-branch.png");
      const branch = await newNode({ title: "Out, then taken back" });
      await newBlock(branch.ref, {
        type: "doc",
        content: [{ type: "picture", attrs: { upload_id: uploadId } }],
      });
      const publication = await publish(branch.ref);
      expect((await read(publication.ref))?.nodes).toHaveLength(1);

      await ok("DELETE", `/nodes/${at(branch.ref)}`, ada);

      expect(await read(publication.ref)).toBeNull();
      const index = await published();
      expect(index.publications.map((one) => one.root_address)).not.toContain(
        branch.address,
      );
      expect(await chainsRootedAt(branch.ref)).toEqual([]);
      expect(await publicFilenames()).not.toContain("deleted-branch.png");
    },
    60_000,
  );

  // Two publishes of one branch share the chain's copies, so they take their
  // turns: interleaved, the one that lost the race for a version number would
  // take back the copy the one that won had just published a version around.
  scenario(
    "publishes one branch twice at once as two versions",
    async () => {
      const uploadId = await upload("at-once.png");
      const branch = await newNode({ title: "Twice at once" });
      await newBlock(branch.ref, {
        type: "doc",
        content: [{ type: "picture", attrs: { upload_id: uploadId } }],
      });

      const [first, second] = await Promise.all([
        publish(branch.ref),
        publish(branch.ref),
      ]);
      expect(first.ref).toBe(second.ref);
      expect(
        [first.latest.sequence, second.latest.sequence].sort((a, b) => a - b),
      ).toEqual([1, 2]);
      // One copy, made by whichever went first and reused by the other, and
      // still there for the version that cites it.
      expect(
        (await publicFilenames()).filter((one) => one === "at-once.png"),
      ).toHaveLength(1);
      const page = await read(first.ref);
      const drawn = (page?.blocks[0].content.content?.[0].attrs ?? {}) as {
        upload_id?: string;
      };
      expect(drawn.upload_id).toBeDefined();
      expect(drawn.upload_id).not.toBe(uploadId);
    },
    60_000,
  );

  scenario("lists what an identity publishes, and nothing else", async () => {
    const shown = await newNode({ title: "On the shelf" });
    const hidden = await newNode({ title: "In the drawer" });
    const publication = await publish(shown.ref);

    const index = await published();
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

  // Two of one author's notebooks each hand a reader a `1a`, so the name is
  // what tells the two regions apart — AI.md § "The Genealogy Is the
  // Protocol".
  scenario("names the notebook a branch's addresses are read in", async () => {
    const [home] = (await ok("GET", "/graphs", ada)) as {
      ref: OwnedRef;
      title: string;
    }[];
    await ok("PATCH", `/graphs/${at(home.ref)}`, ada, {
      title: "Waterworks",
    });
    const root = await newNode({ title: "A named notebook" });
    const publication = await publish(root.ref);

    const listed = (await published()).publications.find(
      (one) => one.ref === publication.ref,
    );
    expect(listed?.graph_title).toBe("Waterworks");
    expect((await read(publication.ref))?.graph_title).toBe("Waterworks");
  });

  scenario(
    "sends the shape an author gave a mark, and no picture",
    async () => {
      const root = await newNode({ title: "A shaped branch" });
      const plain = await newNode({
        from: { relation: "under", note: root.ref },
        title: "Left as it was",
      });
      const upload_id = await upload("on-the-mark.png");
      await ok("PATCH", `/nodes/${at(root.ref)}`, ada, {
        appearance: {
          ring_weight: "heavy",
          mark_radius: "large",
          preview: upload_id,
        },
      });
      const publication = await publish(root.ref);

      const page = await read(publication.ref);
      const served = page?.nodes.find((node) => node.ref === root.ref);
      expect(served?.look).toEqual({
        ring_weight: "heavy",
        mark_radius: "large",
      });
      expect(
        page?.nodes.find((node) => node.ref === plain.ref),
      ).not.toHaveProperty("look");
      // A mark's picture is the author's own and stays private, however much of
      // the note is published — docs/ARCHITECTURE.md § "Pictures".
      expect(JSON.stringify(page)).not.toContain(upload_id);
    },
  );

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
          graph: homeGraphRef(ada.did),
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
      // The reader holds a RUN of pages to each other: one note per address,
      // one version throughout, and every note springing from the note at its
      // own parent address, which is what makes paging safe to store.
      const reader = publishedSubtreeReader({ publication: publication.ref });
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = reader.take(
          await read(
            publication.ref,
            cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`,
          ),
        );
        pages += 1;
        cursor = page.next_cursor;
      } while (cursor !== undefined);

      expect(pages).toBeGreaterThan(1);
      expect(reader.served().size).toBe(LONG_BRANCH + 1);
    },
    120_000,
  );

  scenario(
    "finishes a long read the author published over half way through",
    async () => {
      const root = await newNode({ title: "A long run held still" });
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
          graph: homeGraphRef(ada.did),
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
      const reader = publishedSubtreeReader({ publication: publication.ref });
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = reader.take(
          await read(
            publication.ref,
            cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`,
          ),
        );
        pages += 1;
        // The author publishes again with the reader one page in, which is what
        // a peer pulling a large branch races against.
        if (pages === 1) {
          const again = await publish(root.ref);
          expect(again.latest.sequence).toBe(2);
        }
        cursor = page.next_cursor;
      } while (cursor !== undefined);

      expect(pages).toBeGreaterThan(1);
      expect(reader.served().size).toBe(LONG_BRANCH + 1);
    },
    120_000,
  );

  // Pull-only federation has no firehose, so a pointer is the whole of how an
  // instance learns that somebody it has never heard of answered one of its
  // notes. The route is public and always answers 204, so what it did is only
  // visible in the store.
  scenario(
    "takes an answer whose own store will back it, and nothing else",
    async () => {
      const branch = await newNode({ title: "Open to answers" });
      const under = await newNode({
        from: { relation: "under", note: branch.ref },
        title: "Also open",
      });
      const publication = await publish(branch.ref);
      const store = await strangerStore({
        did: STRANGER,
        localId: "01ANSWER",
        post: syrPostRefFor(under.ref),
      });
      try {
        await answersFrom(publication.ref, store.url);

        expect(await reply(under.ref, STRANGER, `${STRANGER}:01ANSWER`)).toBe(
          204,
        );
        expect((await pointersOn(under.ref)).map((one) => one.voice)).toEqual([
          STRANGER,
        ]);

        // The same claim twice is the same claim.
        expect(await reply(under.ref, STRANGER, `${STRANGER}:01ANSWER`)).toBe(
          204,
        );
        expect(await pointersOn(under.ref)).toHaveLength(1);

        // A comment that store never served, under a name it does not hold,
        // and about a note it did not answer: none of them is kept, so a note's
        // slots cannot be spent on claims nobody could ever be shown.
        expect(await reply(under.ref, STRANGER, `${STRANGER}:01INVENTED`)).toBe(
          204,
        );
        expect(await reply(under.ref, OTHER, `${OTHER}:01ANSWER`)).toBe(204);
        expect(await reply(branch.ref, STRANGER, `${STRANGER}:01ANSWER`)).toBe(
          204,
        );
        expect(await pointersOn(under.ref)).toHaveLength(1);
        expect(await pointersOn(branch.ref)).toEqual([]);
      } finally {
        await store.close();
      }
    },
  );

  scenario(
    "keeps nothing for a note nobody was invited to answer",
    async () => {
      const nowhere = await newNode({ title: "Never published" });
      expect(await reply(nowhere.ref, STRANGER, `${STRANGER}:01NOWHERE`)).toBe(
        204,
      );
      expect(await pointersOn(nowhere.ref)).toEqual([]);

      const shut = await newNode({ title: "Published, answering nobody" });
      const publication = await publish(shut.ref);
      await ok("PATCH", `/publications/${at(publication.ref)}`, ada, {
        comments: "nobody",
      });
      expect(await reply(shut.ref, STRANGER, `${STRANGER}:01SHUT`)).toBe(204);
      expect(await pointersOn(shut.ref)).toEqual([]);
    },
  );

  // A full note keeps what it holds. Nothing is dropped to admit a newcomer,
  // because every row on it is an answer somebody wrote.
  scenario("takes no more once a note is full", async () => {
    const branch = await newNode({ title: "Answered by a crowd" });
    const publication = await publish(branch.ref);
    const store = await strangerStore({
      did: STRANGER,
      localId: "01LATE",
      post: syrPostRefFor(branch.ref),
    });
    try {
      await answersFrom(publication.ref, store.url);

      // A DID's tail is base58btc, which has no 0, O, I or l in it.
      const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const voice = (which: number) => `did:syr:z6MkCrowd${B58[which]}`;
      const voices = POINTERS_PER_NOTE / POINTERS_PER_VOICE;
      const rows: Record<string, unknown>[] = [];
      const now = new Date().toISOString();
      for (let one = 0; one < voices; one++) {
        for (let held = 0; held < POINTERS_PER_VOICE; held++) {
          rows.push({
            id: createOwnedRecordId("comment_pointer", ada.did),
            created_by: ada.did,
            note: branch.ref,
            voice: voice(one),
            comment_id: `${voice(one)}:c${held}`,
            created_at: now,
            updated_at: now,
          });
        }
      }
      expect(rows).toHaveLength(POINTERS_PER_NOTE);
      const { DbService: Db } = await import("../db/db.service");
      await app
        .get<DbService>(Db)
        .handle.query("INSERT INTO comment_pointer $rows", { rows });

      expect(await reply(branch.ref, STRANGER, `${STRANGER}:01LATE`)).toBe(204);

      const held = await pointersOn(branch.ref);
      expect(held).toHaveLength(POINTERS_PER_NOTE);
      expect(held.filter((one) => one.voice === STRANGER)).toEqual([]);
    } finally {
      await store.close();
    }
  });

  scenario(
    "keeps what pointed at a note that can still come back",
    async () => {
      const branch = await newNode({ title: "Answered, then deleted" });
      const publication = await publish(branch.ref);
      const store = await strangerStore({
        did: STRANGER,
        localId: "01GONE",
        post: syrPostRefFor(branch.ref),
      });
      try {
        await answersFrom(publication.ref, store.url);
        expect(await reply(branch.ref, STRANGER, `${STRANGER}:01GONE`)).toBe(
          204,
        );
        expect(await pointersOn(branch.ref)).toHaveLength(1);
      } finally {
        await store.close();
      }

      // An answer somebody left is not derived from anything, so it could not be
      // rebuilt for a note put back — it waits with the note rather than going.
      await ok("DELETE", `/nodes/${at(branch.ref)}`, ada);
      expect(await pointersOn(branch.ref)).toHaveLength(1);

      await ok("POST", `/nodes/${at(branch.ref)}/restore`, ada);
      expect(await pointersOn(branch.ref)).toHaveLength(1);
    },
  );
});
