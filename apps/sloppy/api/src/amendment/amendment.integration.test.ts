// A change offered on a note that arrives with an archive, against a real
// server and a real store: what a graph here does with one, and what it does
// with somebody trying to offer one. Nothing on a hosted instance offers a
// change, so the offer under test is written into the archive by hand, which is
// exactly how one reaches a server.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  type AmendmentView,
  ArchivePreviewSchema,
  type BlockView,
  type GraphView,
  type NodeView,
  type OwnedRef,
} from "@sloppy/types";
import {
  amendmentPath,
  decodeText,
  encodeText,
  graphFile,
  mediaPath,
  notePath,
  pack,
  unpack,
  VAULT_FORMAT,
  type Vault,
} from "@sloppy/vault";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

const DB_ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const DATABASE = `offers_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** The graph the archive brings, the note in it, the section it stands on, and
 *  the offer standing on that note. The offer proposes a section the note does
 *  not have, so taking it in both adds one and takes one away. */
const GRAPH = "01JCMMNSGRAPH0000000000000";
const NOTE = "01JCMMNSNTE000000000000000";
const SECTION = "01JCMMNSSECTN0000000000000";
const OFFER = "01JAMENDMENT00000000000000";
const OFFERED_SECTION = "01JAMENDSECTN0000000000000";
const SECOND_GRAPH = "01JCMMNSGRAPH0000000000002";
const SECOND_NOTE = "01JCMMNSNTE000000000000002";
const SECOND_OFFER = "01JAMENDMENT00000000000002";

/** A picture only the offer draws, so it travels for the offer's sake or not at
 *  all. */
const PICTURE = "offered-picture";
const PICTURE_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** A graph as one file: a note gated by somebody who is not its author, with a
 *  change standing offered on it by that same person. */
function arriving(author: string, gate: string): Vault {
  const vault: Vault = new Map();
  vault.set(
    "graph.json",
    graphFile({
      format: VAULT_FORMAT,
      graph: GRAPH,
      name: "The commons",
      owner: author,
      ownership: "owned",
    }),
  );
  vault.set(
    notePath(NOTE),
    encodeText(
      [
        "---",
        `ref: ${author}/${NOTE}`,
        "address: 1",
        `owner: ${gate}`,
        "tags:",
        "  - seed",
        "title: As it stands",
        "---",
        `<!-- block ${SECTION} -->`,
        "",
        "What the note says now.",
        "",
      ].join("\n"),
    ),
  );
  vault.set(
    amendmentPath(OFFER),
    encodeText(
      [
        "---",
        `amends: ${author}/${NOTE}`,
        `by: ${gate}`,
        "at: 2026-02-01T00:00:00.000Z",
        "message: A second look at the middle of this",
        "title: As I would have it",
        "tags:",
        "  - seed",
        "  - revisit",
        "---",
        `<!-- block ${OFFERED_SECTION} -->`,
        "",
        "What the note could say instead.",
        "",
        `![](${mediaPath(PICTURE, "png")})`,
        "",
      ].join("\n"),
    ),
  );
  vault.set(mediaPath(PICTURE, "png"), PICTURE_BYTES);
  return vault;
}

/** A second graph, whose offer proposes a section that is already a row on a
 *  note in the first one — what an offer written against a section its author
 *  has since carried somewhere else looks like on arrival. */
function offeringSectionOf(author: string, gate: string, section: string) {
  const vault: Vault = new Map();
  vault.set(
    "graph.json",
    graphFile({
      format: VAULT_FORMAT,
      graph: SECOND_GRAPH,
      name: "The commons, again",
      owner: author,
      ownership: "owned",
    }),
  );
  vault.set(
    notePath(SECOND_NOTE),
    encodeText(
      [
        "---",
        `ref: ${author}/${SECOND_NOTE}`,
        "address: 1",
        `owner: ${gate}`,
        "title: Beside it",
        "---",
        "",
      ].join("\n"),
    ),
  );
  vault.set(
    amendmentPath(SECOND_OFFER),
    encodeText(
      [
        "---",
        `amends: ${author}/${SECOND_NOTE}`,
        `by: ${gate}`,
        "at: 2026-03-01T00:00:00.000Z",
        "title: With that section in it",
        "---",
        `<!-- block ${section} -->`,
        "",
        "Carried over from the note beside it.",
        "",
      ].join("\n"),
    ),
  );
  return vault;
}

/** The first upload a set of sections draws, as they hold it now. */
function pictureIn(
  sections: readonly { content: unknown }[],
): string | undefined {
  let found: string | undefined;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const held of value) walk(held);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const held = value as { type?: unknown; attrs?: { upload_id?: unknown } };
    if (held.type === "picture" && typeof held.attrs?.upload_id === "string") {
      found ??= held.attrs.upload_id;
    }
    for (const inside of Object.values(value)) walk(inside);
  };
  walk(sections.map((section) => section.content));
  return found;
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

interface Person {
  did: string;
  cookie: string;
}

describe("a change offered on a note a graph here holds", () => {
  let runs = false;
  let app: INestApplication;
  let base: string;
  /** Whose graph it is, and who the archive says offered the change. */
  let ada: Person;
  let bram: Person;
  let graph: GraphView;
  let note: NodeView;
  let offer: AmendmentView;

  const scenario = (name: string, run: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async (ctx) => {
        ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
        await run();
      },
      timeout,
    );

  const call = async (
    method: string,
    path: string,
    person: Person,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: person.cookie },
      ...(body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const ok = async (
    method: string,
    path: string,
    person: Person,
    body?: unknown,
  ): Promise<unknown> => {
    const answer = await call(method, path, person, body);
    expect(
      answer.status,
      `${method} ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
    ).toBeLessThan(300);
    return answer.body;
  };

  const at = (ref: OwnedRef) =>
    `${encodeURIComponent(ref.slice(0, ref.lastIndexOf("/")))}/${encodeURIComponent(
      ref.slice(ref.lastIndexOf("/") + 1),
    )}`;

  const offersOn = (person: Person, ref: OwnedRef) =>
    ok("GET", `/nodes/${at(ref)}/amendments`, person) as Promise<
      AmendmentView[]
    >;

  const blocksOf = (person: Person, ref: OwnedRef) =>
    ok("GET", `/nodes/${at(ref)}/blocks`, person) as Promise<BlockView[]>;

  async function archiveOf(person: Person, ref: OwnedRef): Promise<Uint8Array> {
    const response = await fetch(`${base}/api/graphs/${at(ref)}/archive`, {
      headers: { cookie: person.cookie },
    });
    expect(response.status).toBe(200);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function bringIn(
    person: Person,
    bytes: Uint8Array,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${base}/api/graphs/import`, {
      method: "POST",
      headers: { "content-type": "application/zip", cookie: person.cookie },
      body: Buffer.from(bytes) as BodyInit,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function signIn(username: string): Promise<Person> {
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

    const asked = new URL(started.consent_url).searchParams;
    const idp = { authorization: `Bearer ${registered.access_token}` };
    const opened = (await (
      await fetch(`${base}/api/idp/consent`, {
        method: "POST",
        headers: { "content-type": "application/json", ...idp },
        body: JSON.stringify({
          platform_origin: asked.get("platform_origin"),
          platform_name: asked.get("platform_name"),
          callback_url: asked.get("callback_url"),
          scopes: asked.get("scopes")?.split(","),
          state: asked.get("state"),
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
    runs = await integrationTarget(DB_ENDPOINT);
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
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api", {
      exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
    });
    await app.listen(port, "127.0.0.1");

    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

    ada = await signIn(`ada${Date.now().toString(36)}`);
    bram = await signIn(`bram${Date.now().toString(36)}`);
  }, 90_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await dropDatabase(app.get(DbService).handle, DATABASE);
    await app.close();
  });

  scenario(
    "arrives with the graph it was offered in, on a note that graph gates",
    async () => {
      const brought = await bringIn(ada, pack(arriving(ada.did, bram.did)));
      expect(brought.status, JSON.stringify(brought.body)).toBeLessThan(300);
      graph = brought.body as GraphView;
      expect(graph.ownership).toBe("owned");

      const branches = (await ok(
        "GET",
        `/nodes?graph=${encodeURIComponent(graph.ref)}`,
        ada,
      )) as NodeView[];
      expect(branches).toHaveLength(1);
      note = branches[0];
      expect(note.owner).toBe(bram.did);

      const standing = await offersOn(ada, note.ref);
      expect(standing).toHaveLength(1);
      offer = standing[0];
      expect(offer.by).toBe(bram.did);
      expect(offer.message).toBe("A second look at the middle of this");
      expect(offer.title).toBe("As I would have it");
      expect(offer.blocks).toHaveLength(1);
    },
    90_000,
  );

  scenario(
    "is counted in what the file says it holds, before anything is written",
    async () => {
      const answered = await fetch(`${base}/api/graphs/import?preview=1`, {
        method: "POST",
        headers: { "content-type": "application/zip", cookie: ada.cookie },
        body: Buffer.from(pack(arriving(ada.did, bram.did))) as BodyInit,
      });
      const said = ArchivePreviewSchema.parse(await answered.json());

      expect(said.offers).toBe(1);
    },
  );

  scenario("draws the pictures it brought, out of this store", async () => {
    const drawn = pictureIn(offer.blocks);

    expect(drawn?.startsWith(`${ada.did}/`)).toBe(true);
    const held = await fetch(
      `${base}/api/media/uploads/${at(drawn as OwnedRef)}`,
      { headers: { cookie: ada.cookie } },
    );
    expect(held.status).toBe(200);
  });

  scenario("is not what a write on the gated note becomes", async () => {
    const refused = await call("PATCH", `/nodes/${at(note.ref)}`, ada, {
      title: "Mine after all",
    });

    expect(refused.status).toBe(403);
    expect((refused.body as { message: string }).message).toMatch(
      /somebody else's to write/,
    );
  });

  scenario("is not something anybody offers here", async () => {
    const refused = await call("POST", "/amendments", bram, {
      note: note.ref,
      title: "Let me",
      blocks: [],
    });

    expect(refused.status).toBe(400);
    expect((refused.body as { message: string }).message).toMatch(
      /has one writer/,
    );
  });

  scenario("is nobody's to read but the graph it stands in", async () => {
    const refused = await call(
      "GET",
      `/nodes/${at(note.ref)}/amendments`,
      bram,
    );

    expect(refused.status).toBe(404);
  });

  scenario("goes out again with the graph it stands in", async () => {
    const vault = unpack(await archiveOf(ada, graph.ref));
    const written = [...vault.keys()].filter((path) =>
      path.startsWith("amendments/"),
    );

    expect(written).toEqual([amendmentPath(OFFER)]);
    const file = decodeText(vault.get(written[0]) as Uint8Array);
    expect(file).toContain(`amends: ${note.ref}`);
    expect(file).toContain(`by: ${bram.did}`);
  });

  scenario(
    "stays where it is when anybody else asks to take it back",
    async () => {
      const asked = await call("DELETE", `/amendments/${at(offer.ref)}`, ada);

      expect(asked.status).toBe(204);
      expect(await offersOn(ada, note.ref)).toHaveLength(1);
    },
  );

  scenario("is taken back by the person who offered it", async () => {
    const taken = await call("DELETE", `/amendments/${at(offer.ref)}`, bram);

    expect(taken.status).toBe(204);
    expect(await offersOn(ada, note.ref)).toHaveLength(0);
  });

  scenario("comes back when the graph carrying it arrives again", async () => {
    const brought = await bringIn(ada, pack(arriving(ada.did, bram.did)));
    expect(brought.status, JSON.stringify(brought.body)).toBeLessThan(300);

    const standing = await offersOn(ada, note.ref);
    expect(standing).toHaveLength(1);
    offer = standing[0];
  });

  scenario(
    "becomes the note's writing when its graph's owner takes it in",
    async () => {
      const taken = (await ok(
        "POST",
        `/amendments/${at(offer.ref)}/approve`,
        ada,
      )) as NodeView;

      expect(taken.title).toBe("As I would have it");
      expect(taken.tags).toEqual(["revisit", "seed"]);
      expect(taken.contributors).toEqual([bram.did]);
      // Authorship stays the owner's: taking an offer in adds a contributor.
      expect(taken.authors ?? []).not.toContain(bram.did);
      expect(taken.updated_at > note.updated_at).toBe(true);

      const sections = await blocksOf(ada, note.ref);
      expect(sections.map((section) => section.ref)).toEqual([
        `${ada.did}/${OFFERED_SECTION}`,
      ]);
      expect(JSON.stringify(sections[0].content)).toContain(
        "What the note could say instead.",
      );

      expect(await offersOn(ada, note.ref)).toHaveLength(0);
    },
    60_000,
  );

  scenario(
    "is gone from the graph it stood in once it is settled",
    async () => {
      const vault = unpack(await archiveOf(ada, graph.ref));

      expect(
        [...vault.keys()].filter((path) => path.startsWith("amendments/")),
      ).toEqual([]);
    },
  );

  scenario(
    "adds a section of its own rather than taking a row off another note",
    async () => {
      const brought = await bringIn(
        ada,
        pack(offeringSectionOf(ada.did, bram.did, OFFERED_SECTION)),
      );
      expect(brought.status, JSON.stringify(brought.body)).toBeLessThan(300);
      const held = (await ok(
        "GET",
        `/nodes?graph=${encodeURIComponent((brought.body as GraphView).ref)}`,
        ada,
      )) as NodeView[];
      const standing = await offersOn(ada, held[0].ref);
      expect(standing).toHaveLength(1);

      const taken = (await ok(
        "POST",
        `/amendments/${at(standing[0].ref)}/approve`,
        ada,
      )) as NodeView;

      expect(taken.ref).toBe(held[0].ref);
      const sections = await blocksOf(ada, held[0].ref);
      expect(sections).toHaveLength(1);
      expect(sections[0].ref).not.toBe(`${ada.did}/${OFFERED_SECTION}`);
      expect(JSON.stringify(sections[0].content)).toContain(
        "Carried over from the note beside it.",
      );
      expect(
        (await blocksOf(ada, note.ref)).map((section) => section.ref),
      ).toEqual([`${ada.did}/${OFFERED_SECTION}`]);
    },
    90_000,
  );

  scenario(
    "goes with the note it was offered on when that note is purged",
    async () => {
      const brought = await bringIn(bram, pack(arriving(bram.did, ada.did)));
      expect(brought.status, JSON.stringify(brought.body)).toBeLessThan(300);
      const held = (await ok(
        "GET",
        `/nodes?graph=${encodeURIComponent((brought.body as GraphView).ref)}`,
        bram,
      )) as NodeView[];
      expect(await offersOn(bram, held[0].ref)).toHaveLength(1);

      expect(
        (await call("DELETE", `/nodes/${at(held[0].ref)}`, bram)).status,
      ).toBe(204);
      const { NodeRepository } = await import("../node/node.repository");
      const { nowIso } = await import("@sloppy/types");
      await app.get(NodeRepository).purgeExpired(bram.did, nowIso());

      const { DbService } = await import("../db/db.service");
      const [standing] = await app
        .get(DbService)
        .handle.query<[{ note: OwnedRef }[]]>(
          "SELECT note FROM amendment WHERE created_by = $did",
          { did: bram.did },
        );
      expect(standing).toEqual([]);
    },
    90_000,
  );
});
