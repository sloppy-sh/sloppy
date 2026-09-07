// Pulling against a real store and a real peer: the region a reader holds, what
// a refresh sweeps, what two overlapping regions share, what an answer has to
// be to get in at all, and the follow list the reader's own store keeps.
//
// The peer here is a plain HTTP server speaking the contract in
// `@sloppy/types` — publishing is another module's, and a peer is its wire.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import { createServer as createHttp, type Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type {
  BlockView,
  DidSyr,
  FollowedIdentity,
  NodeView,
  PublishedBlock,
  PublishedChangesPage,
  PublishedNode,
  PublishedVersion,
  PublishedVersionsPage,
  PullView,
  SearchHit,
} from "@sloppy/types";
import { homeGraphRef } from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationTarget } from "../testing/integration-target";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `pulling_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** The author whose graph is pulled. Their instance is the fake peer below, so
 *  the DID only has to be a well-formed one. */
const AUTHOR = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const STRANGER = "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";

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

const doc = (words: string) => ({
  type: "doc" as const,
  content: [
    {
      type: "section",
      content: [
        { type: "paragraph", content: [{ type: "text", text: words }] },
      ],
    },
  ],
});

/** A ULID this fixture can tell apart at a glance and `OwnedRefSchema` still
 *  admits: the author's instance mints real ones. */
const ulid = (mark: string) => `01JQXR${"0".repeat(19)}${mark}`;

/** A one-pixel PNG. Nothing here decodes it; it only has to be bytes with a
 *  type. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const ID = {
  root: ulid("1"),
  a: ulid("2"),
  b: ulid("3"),
  a1: ulid("4"),
  again: ulid("5"),
  other: ulid("6"),
  s1: ulid("7"),
  s2: ulid("8"),
  s3: ulid("9"),
  wide: ulid("A"),
  narrow: ulid("B"),
  wideVersion: ulid("C"),
  narrowVersion: ulid("D"),
};

/** Which note this fixture puts at an address, so a parent can be referenced
 *  without a lookup. */
const LOCALS: Record<string, string> = {
  "1": ID.root,
  "1a": ID.a,
  "1b": ID.b,
  "1a1": ID.a1,
};

const ref = (local: string) => `${AUTHOR}/${local}`;

/**
 * One note as an author's instance serializes it INSIDE a given region: the
 * region's root carries no parent and is its own origin, which is what
 * `PublishedNodeSchema` says a published node may name.
 */
function note(
  rootAddress: string,
  address: string,
  extra: Partial<PublishedNode> = {},
): PublishedNode {
  const above = address.slice(0, address.length - 1);
  return {
    ref: ref(LOCALS[address]),
    address,
    origin: ref(LOCALS[rootAddress]),
    title: `Note ${address}`,
    tags: [],
    links: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...(address === rootAddress ? {} : { parent: ref(LOCALS[above]) }),
    ...extra,
  };
}

function section(local: string, node: string, ord: string): PublishedBlock {
  return {
    ref: ref(local),
    node: ref(node),
    ord,
    content: doc(`Section ${local}`),
  };
}

/** One of the author's publications, as this fixture serves it: what a reader
 *  names to pull it, and the snapshot they get back. */
interface Published {
  publication: string;
  version: PublishedVersion;
  root: string;
}

const published = (
  publication: string,
  version: string,
  root: string,
): Published => ({
  publication: ref(publication),
  version: {
    ref: ref(version),
    sequence: 1,
    published_at: "2026-02-01T00:00:00.000Z",
  },
  root,
});

/** Two publications of one graph, one rooted inside the other: what a region
 *  is keyed by, and what two regions sharing notes are made of. */
const WIDE = published(ID.wide, ID.wideVersion, "1");
const NARROW = published(ID.narrow, ID.narrowVersion, "1a");

describe("holding a region of somebody else's graph", () => {
  let runs = false;
  let app: INestApplication;
  let base: string;
  let peer: Server;
  let peerOrigin: string;
  let reader: { did: string; cookie: string };
  /** The name the reader registered under, which is what a peer resolves. */
  let readerName: string;

  /** What the fake peer answers with, replaced per scenario. */
  let pages: unknown[] = [];
  let asked: string[] = [];
  /** What the author's own store keeps in the open, as their instance lists it. */
  let openUploads: Record<string, unknown>[] = [];

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
      await run();
    });

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: reader.cookie },
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
    body?: unknown,
  ): Promise<unknown> => {
    const answer = await call(method, path, body);
    expect(
      answer.status,
      `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
    ).toBeLessThan(300);
    return answer.body;
  };

  const at = (ref: string) =>
    `${encodeURIComponent(ref.slice(0, ref.lastIndexOf("/")))}/${encodeURIComponent(
      ref.slice(ref.lastIndexOf("/") + 1),
    )}`;

  const pull = (of: Published) =>
    call("POST", "/pulls", {
      publication: of.publication,
      source_url: peerOrigin,
    });

  const pulled = async (of: Published): Promise<PullView> =>
    (await ok("POST", "/pulls", {
      publication: of.publication,
      source_url: peerOrigin,
    })) as PullView;

  const regions = async (): Promise<PullView[]> =>
    (await call("GET", "/pulls")).body as PullView[];

  const regionOf = async (of: Published): Promise<PullView | undefined> =>
    (await regions()).find((held) => held.publication === of.publication);

  const heldIn = async (region: PullView, query = ""): Promise<NodeView[]> =>
    (await ok("GET", `/pulls/${at(region.ref)}/nodes${query}`)) as NodeView[];

  const stackOf = async (local: string): Promise<BlockView[]> =>
    (await ok("GET", `/pulls/nodes/${at(ref(local))}/blocks`)) as BlockView[];

  const serves = (...answers: unknown[]) => {
    pages = answers;
    asked = [];
    openUploads = [];
  };

  /** One page of one version, with `next_cursor` where more follows. */
  const page = (
    of: Published,
    nodes: PublishedNode[],
    blocks: PublishedBlock[] = [],
    nextCursor?: string,
  ) => ({
    publication: of.publication,
    version: of.version,
    root_address: of.root,
    comments: "anyone",
    nodes,
    blocks,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
  });

  async function signIn(username: string) {
    const registered = (await (
      await fetch(`${base}/api/idp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password: PASSWORD,
          display_name: username,
        }),
      })
    ).json()) as { did: string; access_token: string };

    const started = (await (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instance_url: base }),
      })
    ).json()) as { consent_url: string };

    const params = new URL(started.consent_url).searchParams;
    const idp = { authorization: `Bearer ${registered.access_token}` };
    const opened = (await (
      await fetch(`${base}/api/idp/consent`, {
        method: "POST",
        headers: { "content-type": "application/json", ...idp },
        body: JSON.stringify({
          platform_origin: params.get("platform_origin"),
          platform_name: params.get("platform_name"),
          callback_url: params.get("callback_url"),
          scopes: params.get("scopes")?.split(","),
          state: params.get("state"),
        }),
      })
    ).json()) as { challenge_id: string };

    const approved = (await (
      await fetch(`${base}/api/idp/consent/${opened.challenge_id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", ...idp },
        body: JSON.stringify({ password: PASSWORD }),
      })
    ).json()) as { redirect_url: string };

    const landed = await fetch(approved.redirect_url, { redirect: "manual" });
    const cookie = landed.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("sloppy_session="))
      ?.split(";")[0];
    if (!cookie) throw new Error(`no session for ${username}`);
    return { did: registered.did, cookie };
  }

  beforeAll(async () => {
    runs = await integrationTarget(ENDPOINT);
    if (!runs) return;

    const peerPort = await freePort();
    peerOrigin = `http://127.0.0.1:${peerPort}`;
    peer = createHttp((req, res) => {
      const url = new URL(req.url ?? "/", peerOrigin);
      asked.push(url.pathname + url.search);

      // The author's own identity store, which is where the pictures inside
      // their published notes are read from.
      const store = {
        "/.well-known/syr": () => ({
          name: "syr",
          public_url: peerOrigin,
          identity_manifest_template: `${peerOrigin}/.well-known/syr/{did}`,
          api: { public_profile: `${peerOrigin}/public/profile` },
        }),
        "/public/profile/charles": () => ({
          data: { did: AUTHOR, username: "charles" },
        }),
        [`/.well-known/syr/${encodeURIComponent(AUTHOR)}`]: () => ({
          version: 1,
          did: AUTHOR,
          provider: peerOrigin,
          endpoints: {
            profile: `${peerOrigin}/public/profile/${AUTHOR}`,
            uploads: `${peerOrigin}/public/uploads/${encodeURIComponent(AUTHOR)}`,
            did_document: `${peerOrigin}/identity/${AUTHOR}/document`,
          },
          web_profile: `${peerOrigin}/u/${AUTHOR}`,
        }),
        [`/public/uploads/${encodeURIComponent(AUTHOR)}`]: () => {
          const from = Number(url.searchParams.get("offset") ?? "0");
          const size = Number(url.searchParams.get("limit") ?? "100");
          return { data: openUploads.slice(from, from + size) };
        },
      }[url.pathname];
      if (store) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(store()));
        return;
      }
      if (url.pathname.startsWith("/files/")) {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PIXEL);
        return;
      }

      const which = Number(url.searchParams.get("cursor") ?? "0");
      const answer = pages[which];
      if (answer === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    });
    await new Promise<void>((resolve) =>
      peer.listen(peerPort, "127.0.0.1", resolve),
    );

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

    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

    readerName = `reader${Date.now().toString(36)}`;
    reader = await signIn(readerName);
  }, 60_000);

  afterAll(async () => {
    peer?.close();
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await app.get(DbService).handle.query(`REMOVE DATABASE ${DATABASE}`);
    await app.close();
  });

  scenario("takes a subtree page by page, addresses intact", async () => {
    serves(
      page(
        WIDE,
        [note("1", "1"), note("1", "1a")],
        [section(ID.s1, ID.a, "a0")],
        "1",
      ),
      page(
        WIDE,
        [note("1", "1a1"), note("1", "1b")],
        [section(ID.s2, ID.b, "a0")],
      ),
    );

    const region = await pulled(WIDE);
    expect(region.publication).toBe(WIDE.publication);
    expect(region.version).toEqual(WIDE.version);
    expect(region.root_address).toBe("1");
    expect(region.comments).toBe("anyone");
    expect(region.source_url).toBe(peerOrigin);
    // The reader owns the copy; the author owns the notes.
    expect(region.created_by).toBe(reader.did);
    expect(asked).toHaveLength(2);
    // The publication is asked for by its own reference, not by an address.
    expect(asked[0]).toBe(
      `/api/public/publications/${encodeURIComponent(AUTHOR)}/${ID.wide}`,
    );

    const held = await heldIn(region);
    expect(held.map((node) => node.address)).toEqual(["1", "1a", "1a1", "1b"]);
    expect(held.every((node) => node.created_by === AUTHOR)).toBe(true);
    expect(held[2].depth).toBe(3);
    expect(held[1].parent).toBe(ref(ID.root));

    const stack = await stackOf(ID.a);
    expect(stack).toHaveLength(1);
    expect(stack[0].node).toBe(ref(ID.a));
  });

  scenario("counts max_depth from the region's own root", async () => {
    serves(
      page(
        NARROW,
        [note("1a", "1a"), note("1a", "1a1")],
        [section(ID.s1, ID.a, "a0")],
      ),
    );
    const region = await pulled(NARROW);

    expect(
      (await heldIn(region, "?max_depth=1")).map((n) => n.address),
    ).toEqual(["1a"]);
    expect((await heldIn(region)).map((n) => n.address)).toEqual(["1a", "1a1"]);
  });

  scenario("shares the notes two regions both serve", async () => {
    const wide = await regionOf(WIDE);
    expect(wide).toBeDefined();
    if (!wide) return;
    await ok("DELETE", `/pulls/${at(wide.ref)}`);

    const narrow = await regionOf(NARROW);
    expect(narrow).toBeDefined();
    if (!narrow) return;
    // `1a` and `1a1` survive their own region, sections included; `1` and `1b`
    // went with the wider one, because nothing else serves them.
    expect((await heldIn(narrow)).map((n) => n.address)).toEqual(["1a", "1a1"]);
    expect(await stackOf(ID.a)).toHaveLength(1);
    expect(await stackOf(ID.b)).toHaveLength(0);
  });

  scenario(
    "sweeps what a refresh no longer carries, sections too",
    async () => {
      serves(
        page(
          NARROW,
          [note("1a", "1a"), note("1a", "1a1")],
          [section(ID.s1, ID.a, "a0"), section(ID.s3, ID.a1, "a0")],
        ),
      );
      const region = await pulled(NARROW);
      expect(await stackOf(ID.a1)).toHaveLength(1);

      serves(page(NARROW, [note("1a", "1a")], [section(ID.s1, ID.a, "a0")]));
      const refreshed = await pulled(NARROW);

      // One region per publication: pulling it again refreshed this row.
      expect(refreshed.ref).toBe(region.ref);
      expect(await regions()).toHaveLength(1);
      expect((await heldIn(region)).map((n) => n.address)).toEqual(["1a"]);
      expect(await stackOf(ID.a1)).toHaveLength(0);
    },
  );

  scenario("replaces a held note the author re-addressed", async () => {
    serves(
      page(NARROW, [
        note("1a", "1a"),
        { ...note("1a", "1a1"), ref: ref(ID.again), title: "Written again" },
      ]),
    );
    const region = await pulled(NARROW);

    expect((await heldIn(region)).map((node) => node.ref)).toEqual([
      ref(ID.a),
      ref(ID.again),
    ]);
  });

  scenario(
    "keeps the addresses the author moved a note away from",
    async () => {
      serves(
        page(NARROW, [
          note("1a", "1a"),
          { ...note("1a", "1a1"), aliases: ["1b2"] },
        ]),
      );
      const region = await pulled(NARROW);

      const held = await heldIn(region);
      expect(held.map((node) => node.aliases)).toEqual([undefined, ["1b2"]]);
    },
  );

  scenario("refuses an answer that is not the one asked for", async () => {
    const region = await regionOf(NARROW);
    expect(region).toBeDefined();
    if (!region) return;
    const before = (await heldIn(region)).map((node) => node.ref);

    // A note outside the subtree that was asked for.
    serves(page(NARROW, [note("1a", "1a"), note("1", "1b")]));
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    // A second note at an address the page already used.
    serves(
      page(NARROW, [
        note("1a", "1a"),
        note("1a", "1a1"),
        { ...note("1a", "1a1"), ref: ref(ID.other) },
      ]),
    );
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    // A link to a note the author did not write.
    serves(
      page(NARROW, [{ ...note("1a", "1a"), links: [`${STRANGER}/theirs`] }]),
    );
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    // A note that does not spring from the note at its own parent address.
    serves(
      page(NARROW, [
        note("1a", "1a"),
        { ...note("1a", "1a1"), parent: ref(ID.a1) },
      ]),
    );
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    // A page of a publication nobody asked about.
    serves(page(WIDE, [note("1", "1")]));
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    // A second page carrying another version of the same publication.
    serves(
      page(NARROW, [note("1a", "1a")], [], "1"),
      page(
        { ...NARROW, version: { ...NARROW.version, ref: ref(ID.wideVersion) } },
        [note("1a", "1a1")],
      ),
    );
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    // A second page that contradicts the first is refused with the first kept.
    serves(
      page(NARROW, [note("1a", "1a")], [], "1"),
      page(NARROW, [{ ...note("1a", "1a1"), address: "2" }]),
    );
    expect((await pull(NARROW)).status).toBeGreaterThanOrEqual(400);

    expect((await heldIn(region)).map((node) => node.ref)).toEqual(before);
  });

  scenario("will not take the reader's own branch as a peer's", async () => {
    const mine = await call("POST", "/pulls", {
      publication: `${reader.did}/${ID.narrow}`,
      source_url: peerOrigin,
    });
    expect(mine.status).toBe(400);
  });

  scenario(
    "leaves out the note whose own signature says it is not, and reads the rest",
    async () => {
      // `1a1` is held from the pull before this one, so the branch arriving
      // without it is also the reader letting go of a copy they can no longer
      // put the author's name to.
      serves(
        page(
          NARROW,
          [
            note("1a", "1a"),
            {
              ...note("1a", "1a1"),
              content_signature: "z2i7YveT8N8bmBrE",
              signing_device_public_key: STRANGER.slice("did:syr:".length),
              signed_payload_json: JSON.stringify({
                type: "sloppy-node@v1",
                did: AUTHOR,
                node_id: ID.a1,
                address: "1a1",
                title: "Somebody else's note",
                created_at: "2026-01-01T00:00:00.000Z",
              }),
            },
          ],
          [section(ID.s1, ID.a, "a0"), section(ID.s3, ID.a1, "a0")],
        ),
      );

      const region = await pulled(NARROW);
      expect((await heldIn(region)).map((n) => n.address)).toEqual(["1a"]);
      expect(await stackOf(ID.a)).toHaveLength(1);
      expect(await stackOf(ID.a1)).toHaveLength(0);
    },
  );

  scenario("holds a note it cannot check the signature on", async () => {
    serves(
      page(NARROW, [
        {
          ...note("1a", "1a"),
          content_signature: "z2i7YveT8N8bmBrE",
          signing_device_public_key: STRANGER.slice("did:syr:".length),
          // A payload written by a Sloppy this build has never met.
          signed_payload_json: JSON.stringify({ type: "sloppy-node@v9" }),
        },
      ]),
    );
    const region = await pulled(NARROW);
    expect((await heldIn(region)).map((n) => n.address)).toEqual(["1a"]);
  });

  scenario("will not let the reader change somebody else's note", async () => {
    const changed = await call("PATCH", `/nodes/${at(ref(ID.a))}`, {
      title: "Mine now",
    });
    expect(changed.status).toBe(404);

    const acted = await call("POST", "/nodes/bulk", {
      notes: [ref(ID.a)],
      act: { act: "delete" },
    });
    expect(acted.status).toBe(404);

    const region = await regionOf(NARROW);
    expect(region).toBeDefined();
    if (!region) return;
    expect((await heldIn(region)).map((n) => n.address)).toContain("1a");
  });

  scenario("lets a region go without touching the author", async () => {
    for (const region of await regions()) {
      await ok("DELETE", `/pulls/${at(region.ref)}`);
    }
    expect(await regions()).toEqual([]);
    expect(await stackOf(ID.a)).toHaveLength(0);
  });

  scenario(
    "reads a publication's history without the browser asking",
    async () => {
      serves({
        publication: WIDE.publication,
        versions: [
          { ...WIDE.version, sequence: 2 },
          { ...WIDE.version, ref: ref(ID.narrowVersion), sequence: 1 },
        ],
      });

      const chain = (await ok(
        "GET",
        `/peers/versions?publication=${encodeURIComponent(WIDE.publication)}` +
          `&source_url=${encodeURIComponent(peerOrigin)}`,
      )) as PublishedVersionsPage;

      expect(chain.versions.map((one) => one.sequence)).toEqual([2, 1]);
      expect(asked).toEqual([
        `/api/public/publications/${at(WIDE.publication)}/versions`,
      ]);
    },
  );

  scenario("reads what changed between two versions the same way", async () => {
    serves({
      publication: WIDE.publication,
      root_address: "1",
      from: ref(ID.narrowVersion),
      to: WIDE.version.ref,
      changes: [
        {
          change: "changed",
          note: { ...note("1", "1"), title: "After" },
          before: note("1", "1"),
          sections: [
            {
              change: "changed",
              section: {
                ...section(ID.s1, ID.root, "a0"),
                content: doc("Now"),
              },
              before: section(ID.s1, ID.root, "a0"),
            },
          ],
        },
        { change: "added", note: note("1", "1a"), sections: [] },
      ],
    });

    const difference = (await ok(
      "GET",
      `/peers/changes?publication=${encodeURIComponent(WIDE.publication)}` +
        `&from=${encodeURIComponent(ref(ID.narrowVersion))}` +
        `&to=${encodeURIComponent(WIDE.version.ref)}` +
        `&source_url=${encodeURIComponent(peerOrigin)}`,
    )) as PublishedChangesPage;

    expect(difference.changes.map((one) => one.change)).toEqual([
      "changed",
      "added",
    ]);
    expect(asked[0]).toContain(`/changes?from=`);
  });

  scenario(
    "refuses a difference between versions nobody asked about",
    async () => {
      serves({
        publication: WIDE.publication,
        root_address: "1",
        from: WIDE.version.ref,
        to: WIDE.version.ref,
        changes: [],
      });

      const answer = await call(
        "GET",
        `/peers/changes?publication=${encodeURIComponent(WIDE.publication)}` +
          `&from=${encodeURIComponent(ref(ID.narrowVersion))}` +
          `&to=${encodeURIComponent(WIDE.version.ref)}` +
          `&source_url=${encodeURIComponent(peerOrigin)}`,
      );

      expect(answer.status).toBe(503);
    },
  );

  // The surface names no instance for a branch of the reader's own, so this
  // instance asks itself — the one path a person actually takes, and the one no
  // fake peer stands in for.
  scenario(
    "reads its own publication's history without being told where",
    async () => {
      const branch = (await ok("POST", "/nodes", {
        title: "Read against itself",
      })) as NodeView;
      await ok("POST", "/blocks", {
        node: branch.ref,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "as first written" }],
            },
          ],
        },
      });
      const first = (await ok("POST", "/publications", {
        root: branch.ref,
      })) as { ref: string; latest: PublishedVersion };
      await ok("PATCH", `/nodes/${at(branch.ref)}`, {
        title: "Read against itself, again",
      });
      const second = (await ok("POST", "/publications", {
        root: branch.ref,
      })) as { ref: string; latest: PublishedVersion };

      const chain = (await ok(
        "GET",
        `/peers/versions?publication=${encodeURIComponent(first.ref)}`,
      )) as PublishedVersionsPage;
      expect(chain.versions.map((one) => one.sequence)).toEqual([2, 1]);

      const difference = (await ok(
        "GET",
        `/peers/changes?publication=${encodeURIComponent(first.ref)}` +
          `&from=${encodeURIComponent(first.latest.ref)}` +
          `&to=${encodeURIComponent(second.latest.ref)}`,
      )) as PublishedChangesPage;
      expect(difference.changes).toHaveLength(1);
      const only = difference.changes[0];
      expect(only.change).toBe("changed");
      expect(only.note.title).toBe("Read against itself, again");
    },
  );

  scenario(
    "says so where the instance has nothing at that address",
    async () => {
      serves();

      const chain = (await ok(
        "GET",
        `/peers/versions?publication=${encodeURIComponent(WIDE.publication)}` +
          `&source_url=${encodeURIComponent(peerOrigin)}`,
      )) as PublishedVersionsPage;
      expect(chain.versions).toEqual([]);

      // An empty difference would say the writing did not move, which is not the
      // same thing as a branch that is no longer served.
      const difference = await call(
        "GET",
        `/peers/changes?publication=${encodeURIComponent(WIDE.publication)}` +
          `&from=${encodeURIComponent(ref(ID.narrowVersion))}` +
          `&to=${encodeURIComponent(WIDE.version.ref)}` +
          `&source_url=${encodeURIComponent(peerOrigin)}`,
      );
      expect(difference.status).toBe(404);
    },
  );

  scenario("records a follow, lists it, and drops it", async () => {
    expect(await ok("GET", "/following")).toEqual([]);

    await ok("POST", "/following", { did: AUTHOR });
    expect(
      ((await ok("GET", "/following")) as FollowedIdentity[]).map(
        (one) => one.did,
      ),
    ).toEqual([AUTHOR]);

    // Following somebody already followed is the same one follow.
    await ok("POST", "/following", { did: AUTHOR });
    expect((await ok("GET", "/following")) as FollowedIdentity[]).toHaveLength(
      1,
    );

    await ok("DELETE", `/following/${encodeURIComponent(AUTHOR)}`);
    expect(await ok("GET", "/following")).toEqual([]);
  });

  scenario(
    "keeps the list on the reader's own identity, and to themselves",
    async () => {
      await ok("POST", "/following", { did: STRANGER });
      expect(
        ((await ok("GET", "/following")) as FollowedIdentity[]).map(
          (one) => one.did,
        ),
      ).toEqual([STRANGER]);

      // Following somebody is not publishing that you did: the endpoint an
      // identity's manifest points a stranger at serves what its owner made
      // public, and nothing here has.
      const answer = await fetch(
        `${base}/api/idp/public/following/${encodeURIComponent(reader.did)}`,
      );
      const page = (await answer.json()) as { data: unknown[] };
      expect(answer.status).toBe(200);
      expect(page.data).toEqual([]);

      await ok("DELETE", `/following/${encodeURIComponent(STRANGER)}`);
    },
  );

  // A person says their name out loud; the identifier is what everything else
  // holds, and this is what closes that gap.
  scenario(
    "finds somebody by the name their instance knows them by",
    async () => {
      serves();

      const found = await ok(
        "GET",
        `/peers/identity?name=charles&source_url=${encodeURIComponent(peerOrigin)}`,
      );
      expect(found).toEqual({ did: AUTHOR });
      expect(asked).toContain("/public/profile/charles");

      const missing = await call(
        "GET",
        `/peers/identity?name=nobody&source_url=${encodeURIComponent(peerOrigin)}`,
      );
      expect(missing.status).toBe(404);
    },
  );

  scenario("resolves a name kept here when no instance is named", async () => {
    expect(await ok("GET", `/peers/identity?name=${readerName}`)).toEqual({
      did: reader.did,
    });
  });

  scenario("will not let a reader follow themselves", async () => {
    const refused = await call("POST", "/following", { did: reader.did });
    expect(refused.status).toBe(400);
  });

  scenario("holds one `1a` of each notebook the author keeps", async () => {
    // The part of this ruling that reaches other people's machines. Two regions
    // of one author, one from each of their graphs: both rooted at `1`, both
    // carrying a `1a`, and the reader ends up holding four notes rather than
    // having the second region evict the first's copies.
    const secondGraph = `${AUTHOR}/${ulid("G")}`;
    const beside = published(ulid("H"), ulid("J"), "1");
    const besideRoot = `${AUTHOR}/${ulid("K")}`;
    const besideChild = `${AUTHOR}/${ulid("M")}`;

    serves(page(WIDE, [note("1", "1"), note("1", "1a")]));
    const home = await pulled(WIDE);
    expect(home.graph).toBe(homeGraphRef(AUTHOR));

    serves({
      ...page(beside, []),
      graph: secondGraph,
      nodes: [
        { ...note("1", "1"), ref: besideRoot, origin: besideRoot },
        {
          ...note("1", "1a"),
          ref: besideChild,
          origin: besideRoot,
          parent: besideRoot,
        },
      ],
    });
    const other = await pulled(beside);

    expect(other.graph).toBe(secondGraph);
    const inOther = await heldIn(other);
    expect(inOther.map((held) => held.address)).toEqual(["1", "1a"]);
    expect(inOther.map((held) => held.ref)).toEqual([besideRoot, besideChild]);
    expect(inOther.every((held) => held.graph === secondGraph)).toBe(true);

    // The notes the first region served are still the ones it serves.
    const inHome = await heldIn(home);
    expect(inHome.map((held) => held.ref)).toEqual([ref(ID.root), ref(ID.a)]);
    expect(inHome.every((held) => held.graph === homeGraphRef(AUTHOR))).toBe(
      true,
    );
  });

  scenario("says what the author calls the notebook it came from", async () => {
    serves({ ...page(WIDE, [note("1", "1")]), graph_title: "The garden" });
    expect((await pulled(WIDE)).graph_title).toBe("The garden");

    // An author who took the name off gets the region back without one, rather
    // than the reader keeping a label nobody stands behind.
    serves(page(WIDE, [note("1", "1")]));
    expect((await pulled(WIDE)).graph_title).toBeUndefined();
  });

  scenario("draws a held mark the shape its author gave it", async () => {
    serves(
      page(WIDE, [
        note("1", "1", {
          look: { ring_weight: "heavy", ring_style: "dashed" },
        }),
        note("1", "1a"),
      ]),
    );

    const held = await heldIn(await pulled(WIDE));

    expect(held[0].appearance).toEqual({
      ring_weight: "heavy",
      ring_style: "dashed",
    });
    expect(held[1].appearance).toBeUndefined();
  });

  scenario("opens a citation to a note the reader already holds", async () => {
    serves(page(WIDE, [note("1", "1"), note("1", "1a")]));
    const region = await pulled(WIDE);

    const hit = (await ok("GET", `/pulls/nodes/${at(ref(ID.a))}`)) as {
      note: NodeView;
      pull: PullView;
    };

    expect(hit.note.ref).toBe(ref(ID.a));
    expect(hit.note.address).toBe("1a");
    expect(hit.pull.ref).toBe(region.ref);

    // A note nobody here has pulled is not a note that was taken down, and the
    // route says so by holding nothing rather than by refusing.
    expect(
      (await call("GET", `/pulls/nodes/${at(ref(ID.other))}`)).body,
    ).toBeNull();
  });

  scenario("draws a picture inside a held note", async () => {
    serves(
      page(
        WIDE,
        [note("1", "1")],
        [
          {
            ...section(ID.s1, ID.root, "a0"),
            content: {
              type: "doc",
              content: [{ type: "picture", attrs: { upload_id: ref(ID.s3) } }],
            },
          },
        ],
      ),
    );
    openUploads = [
      {
        did: AUTHOR,
        local_id: ID.s3,
        filename: "figure.png",
        mime_type: "image/png",
        size: PIXEL.byteLength,
        status: "completed",
        is_public: true,
        url: `${peerOrigin}/files/figure.png`,
      },
    ];
    await pulled(WIDE);

    // What the held block cites is what the route is asked for: the reader
    // draws the picture the note holds, not one this test named.
    const held = (await stackOf(ID.root))[0].content.content?.[0];
    const cited = String(held?.attrs?.upload_id);
    expect(cited).toBe(ref(ID.s3));

    const drawn = await fetch(`${base}/api/media/published/${at(cited)}`, {
      headers: { cookie: reader.cookie, accept: "image/*" },
    });
    const bytes = Buffer.from(await drawn.arrayBuffer());

    expect(drawn.status).toBe(200);
    expect(drawn.headers.get("content-type")).toBe("image/png");
    expect(bytes.equals(PIXEL)).toBe(true);
    // Nothing at all for an author whose branch the reader does not hold.
    expect(
      (
        await fetch(`${base}/api/media/published/${at(`${STRANGER}/ANY`)}`, {
          headers: { cookie: reader.cookie, accept: "image/*" },
        })
      ).status,
    ).toBe(404);
  });

  scenario("finds a held note by what its author wrote in it", async () => {
    serves(
      page(
        WIDE,
        [note("1", "1")],
        [
          {
            ...section(ID.s1, ID.root, "a0"),
            content: doc("A word only the author wrote: quokka."),
          },
        ],
      ),
    );
    await pulled(WIDE);

    const hits = (await ok("GET", "/nodes/search?q=quokka")) as SearchHit[];

    expect(hits.map((one) => one.note)).toEqual([ref(ID.root)]);
    // The address is the author's, read in the author's graph, and the reader
    // is told the note is one they are holding.
    expect(hits[0].address).toBe("1");
    expect(hits[0].graph).toBe(homeGraphRef(AUTHOR));
    expect(hits[0].title).toBe("Note 1");
    expect(hits[0].held).toBe(true);
    expect(hits[0].snippet).toContain("quokka");

    const narrowed = async (graph: string) =>
      (
        (await ok(
          "GET",
          `/nodes/search?q=quokka&graph=${encodeURIComponent(graph)}`,
        )) as SearchHit[]
      ).map((one) => one.note);
    expect(await narrowed(homeGraphRef(AUTHOR))).toEqual([ref(ID.root)]);
    expect(await narrowed(homeGraphRef(reader.did as DidSyr))).toEqual([]);
  });
});
