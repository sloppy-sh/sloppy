// Pulling against a real store and a real peer: the region a reader holds, what
// a refresh sweeps, what two overlapping regions share, and what an answer has
// to be to get in at all.
//
// The peer here is a plain HTTP server speaking the contract in
// `@sloppy/types` — publishing is another module's, and a peer is its wire.
//
// Skipped when nothing is listening, so a clone without the dev stack still
// runs `pnpm test`. `docker compose up -d` is what turns it on.

import { createConnection, createServer } from "node:net";
import { createServer as createHttp, type Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type {
  BlockView,
  NodeView,
  PublishedBlock,
  PublishedNode,
  PullView,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `pulling_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** The author whose graph is pulled. Their instance is the fake peer below, so
 *  the DID only has to be a well-formed one. */
const AUTHOR = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const STRANGER = "did:syr:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";

function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: ENDPOINT.hostname,
      port: Number(ENDPOINT.port) || (ENDPOINT.protocol === "wss:" ? 443 : 80),
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

describe("holding a region of somebody else's graph", () => {
  let listening = false;
  let app: INestApplication;
  let base: string;
  let peer: Server;
  let peerOrigin: string;
  let reader: { did: string; cookie: string };

  /** What the fake peer answers with, replaced per scenario. */
  let pages: unknown[] = [];
  let asked: string[] = [];

  const scenario = (name: string, run: () => Promise<void>) =>
    it(name, async (ctx) => {
      ctx.skip(!listening, `nothing is listening at ${ENDPOINT.href}`);
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

  const pull = (rootAddress: string) =>
    call("POST", "/pulls", {
      did: AUTHOR,
      root_address: rootAddress,
      source_url: peerOrigin,
    });

  const pulled = async (rootAddress: string): Promise<PullView> =>
    (await ok("POST", "/pulls", {
      did: AUTHOR,
      root_address: rootAddress,
      source_url: peerOrigin,
    })) as PullView;

  const regions = async (): Promise<PullView[]> =>
    (await call("GET", "/pulls")).body as PullView[];

  const heldIn = async (region: PullView, query = ""): Promise<NodeView[]> =>
    (await ok("GET", `/pulls/${at(region.ref)}/nodes${query}`)) as NodeView[];

  const stackOf = async (local: string): Promise<BlockView[]> =>
    (await ok("GET", `/pulls/nodes/${at(ref(local))}/blocks`)) as BlockView[];

  const serves = (...answers: unknown[]) => {
    pages = answers;
    asked = [];
  };

  /** One page of a subtree, with `next_cursor` where more follows. */
  const page = (
    rootAddress: string,
    nodes: PublishedNode[],
    blocks: PublishedBlock[] = [],
    nextCursor?: string,
  ) => ({
    did: AUTHOR,
    root_address: rootAddress,
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
    listening = await probe();
    if (!listening) return;

    const peerPort = await freePort();
    peerOrigin = `http://127.0.0.1:${peerPort}`;
    peer = createHttp((req, res) => {
      const url = new URL(req.url ?? "/", peerOrigin);
      asked.push(url.pathname + url.search);
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

    reader = await signIn(`reader${Date.now().toString(36)}`);
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
        "1",
        [note("1", "1"), note("1", "1a")],
        [section(ID.s1, ID.a, "a0")],
        "1",
      ),
      page(
        "1",
        [note("1", "1a1"), note("1", "1b")],
        [section(ID.s2, ID.b, "a0")],
      ),
    );

    const region = await pulled("1");
    expect(region.source_did).toBe(AUTHOR);
    expect(region.root_address).toBe("1");
    expect(region.source_url).toBe(peerOrigin);
    // The reader owns the copy; the author owns the notes.
    expect(region.created_by).toBe(reader.did);
    expect(asked).toHaveLength(2);

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
        "1a",
        [note("1a", "1a"), note("1a", "1a1")],
        [section(ID.s1, ID.a, "a0")],
      ),
    );
    const region = await pulled("1a");

    expect(
      (await heldIn(region, "?max_depth=1")).map((n) => n.address),
    ).toEqual(["1a"]);
    expect((await heldIn(region)).map((n) => n.address)).toEqual(["1a", "1a1"]);
  });

  scenario("shares the notes two regions both serve", async () => {
    const wide = (await regions()).find((held) => held.root_address === "1");
    expect(wide).toBeDefined();
    if (!wide) return;
    await ok("DELETE", `/pulls/${at(wide.ref)}`);

    const narrow = (await regions()).find((held) => held.root_address === "1a");
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
          "1a",
          [note("1a", "1a"), note("1a", "1a1")],
          [section(ID.s1, ID.a, "a0"), section(ID.s3, ID.a1, "a0")],
        ),
      );
      const region = await pulled("1a");
      expect(await stackOf(ID.a1)).toHaveLength(1);

      serves(page("1a", [note("1a", "1a")], [section(ID.s1, ID.a, "a0")]));
      await pulled("1a");

      expect((await heldIn(region)).map((n) => n.address)).toEqual(["1a"]);
      expect(await stackOf(ID.a1)).toHaveLength(0);
    },
  );

  scenario("replaces a held note the author re-addressed", async () => {
    serves(
      page("1a", [
        note("1a", "1a"),
        { ...note("1a", "1a1"), ref: ref(ID.again), title: "Written again" },
      ]),
    );
    const region = await pulled("1a");

    expect((await heldIn(region)).map((node) => node.ref)).toEqual([
      ref(ID.a),
      ref(ID.again),
    ]);
  });

  scenario("refuses an answer that is not the one asked for", async () => {
    const region = (await regions()).find((held) => held.root_address === "1a");
    expect(region).toBeDefined();
    if (!region) return;
    const before = (await heldIn(region)).map((node) => node.ref);

    // A note outside the subtree that was asked for.
    serves(page("1a", [note("1a", "1a"), note("1", "1b")]));
    expect((await pull("1a")).status).toBeGreaterThanOrEqual(400);

    // A second note at an address the page already used.
    serves(
      page("1a", [
        note("1a", "1a"),
        note("1a", "1a1"),
        { ...note("1a", "1a1"), ref: ref(ID.other) },
      ]),
    );
    expect((await pull("1a")).status).toBeGreaterThanOrEqual(400);

    // A link to a note the author did not write.
    serves(
      page("1a", [{ ...note("1a", "1a"), links: [`${STRANGER}/theirs`] }]),
    );
    expect((await pull("1a")).status).toBeGreaterThanOrEqual(400);

    // A note that does not spring from the note at its own parent address.
    serves(
      page("1a", [
        note("1a", "1a"),
        { ...note("1a", "1a1"), parent: ref(ID.a1) },
      ]),
    );
    expect((await pull("1a")).status).toBeGreaterThanOrEqual(400);

    // A second page that contradicts the first is refused with the first kept.
    serves(
      page("1a", [note("1a", "1a")], [], "1"),
      page("1a", [{ ...note("1a", "1a1"), address: "2" }]),
    );
    expect((await pull("1a")).status).toBeGreaterThanOrEqual(400);

    expect((await heldIn(region)).map((node) => node.ref)).toEqual(before);
  });

  scenario("refuses a note whose own signature says it is not", async () => {
    serves(
      page("1a", [
        {
          ...note("1a", "1a"),
          content_signature: "z2i7YveT8N8bmBrE",
          signing_device_public_key: STRANGER.slice("did:syr:".length),
          signed_payload_json: JSON.stringify({
            type: "sloppy-node@v1",
            did: AUTHOR,
            node_id: "01JQXQ0000000000000000000A",
            address: "1a",
            title: "Somebody else's note",
            created_at: "2026-01-01T00:00:00.000Z",
          }),
        },
      ]),
    );
    expect((await pull("1a")).status).toBeGreaterThanOrEqual(400);
  });

  scenario("holds a note it cannot check the signature on", async () => {
    serves(
      page("1a", [
        {
          ...note("1a", "1a"),
          content_signature: "z2i7YveT8N8bmBrE",
          signing_device_public_key: STRANGER.slice("did:syr:".length),
          // A payload written by a Sloppy this build has never met.
          signed_payload_json: JSON.stringify({ type: "sloppy-node@v9" }),
        },
      ]),
    );
    const region = await pulled("1a");
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

    const region = (await regions()).find((held) => held.root_address === "1a");
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
});
