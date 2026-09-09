// A graph taken out as a folder of files and brought back in under somebody
// else's identity, against a real server and a real store. The halves are
// tested apart from this — the builder against stubs, the reader in
// `@sloppy/vault` — and neither can see the seam: whether what one person's
// graph reads as is what another person's graph becomes.
//
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

import { createServer } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  ArchivePreviewSchema,
  type BlockView,
  type GraphView,
  type NodeView,
  type OwnedRef,
  splitOwnedRef,
} from "@sloppy/types";
import { decodeText, encodeText, noteAt, pack, unpack } from "@sloppy/vault";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";

const DB_ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const STORE_ENDPOINT = new URL(
  process.env.S3_ENDPOINT ?? "http://localhost:9010",
);
const DATABASE = `archive_${Date.now()}`;
const PASSWORD = "a-long-enough-passphrase";

/** A one-pixel PNG. Nothing here decodes it; it only has to be bytes with a
 *  type. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const INK = { strokes: [{ points: [1, 2, 3, 4] }], width: 600, height: 200 };

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

/** The kinds a section can hold that markdown has no syntax of its own for,
 *  beside the ones it does. */
function elementsOf(blocks: readonly BlockView[]): string[] {
  const kinds: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const held of value) walk(held);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const type = (value as { type?: unknown }).type;
    if (typeof type === "string") kinds.push(type);
    for (const inside of Object.values(value)) walk(inside);
  };
  walk(blocks.map((block) => block.content));
  return kinds;
}

function pictureIn(blocks: readonly BlockView[]): string | undefined {
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
  walk(blocks.map((block) => block.content));
  return found;
}

describe("a graph handed over as an archive", () => {
  let runs = false;
  let app: INestApplication;
  let base: string;
  let ada: Person;
  let bram: Person;
  let garden: GraphView;
  let first: NodeView;
  let second: NodeView;
  /** The label the second note was given before its author renamed it, which
   *  keeps leading to it. */
  let wasAt: string | undefined;
  let archive: Uint8Array;

  const scenario = (name: string, run: () => Promise<void>, timeout?: number) =>
    it(
      name,
      async (ctx) => {
        ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");
        await run();
      },
      timeout,
    );

  const ok = async (
    method: string,
    path: string,
    person: Person,
    body?: unknown,
  ): Promise<unknown> => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: person.cookie },
      ...(body === undefined || method === "GET"
        ? {}
        : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    expect(
      response.status,
      `${method} ${path} answered ${response.status}: ${text}`,
    ).toBeLessThan(300);
    return text ? JSON.parse(text) : null;
  };

  const at = (ref: OwnedRef) =>
    `${encodeURIComponent(ref.slice(0, ref.lastIndexOf("/")))}/${encodeURIComponent(
      ref.slice(ref.lastIndexOf("/") + 1),
    )}`;

  /** Every note of one graph: a plain read answers with its branches, and each
   *  branch's own read answers with the tree under it. */
  async function notesOf(person: Person, graph: OwnedRef): Promise<NodeView[]> {
    const roots = (await ok(
      "GET",
      `/nodes?graph=${encodeURIComponent(graph)}`,
      person,
    )) as NodeView[];
    const trees = await Promise.all(
      roots.map(
        (root) =>
          ok(
            "GET",
            `/nodes?origin=${encodeURIComponent(root.ref)}`,
            person,
          ) as Promise<NodeView[]>,
      ),
    );
    return trees.flat();
  }

  const blocksOf = (person: Person, note: OwnedRef) =>
    ok("GET", `/nodes/${at(note)}/blocks`, person) as Promise<BlockView[]>;

  async function upload(person: Person): Promise<string> {
    const ticket = (await ok("POST", "/media/uploads", person, {
      role: "block",
      filename: "tree.png",
      mime_type: "image/png",
      size: PIXEL.byteLength,
    })) as {
      upload_id: string;
      upload_url: string;
      upload_headers: HeadersInit;
    };
    const sent = await fetch(ticket.upload_url, {
      method: "PUT",
      headers: ticket.upload_headers,
      body: PIXEL,
    });
    if (!sent.ok) throw new Error(`PUT ${sent.status}`);
    await ok("POST", "/media/uploads/complete", person, {
      upload_id: ticket.upload_id,
    });
    return ticket.upload_id;
  }

  async function importing(
    person: Person,
    bytes: Uint8Array,
    preview: boolean,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(
      `${base}/api/graphs/import${preview ? "?preview=1" : ""}`,
      {
        method: "POST",
        headers: { "content-type": "application/zip", cookie: person.cookie },
        body: bytes as BodyInit,
      },
    );
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
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api", {
      exclude: ["/.well-known/syr", "/.well-known/syr/:did"],
    });
    await app.listen(port, "127.0.0.1");

    const { DbService: Store } = await import("../db/db.service");
    await app.get(Store).whenOpen();

    ada = await signIn(`ada${Date.now().toString(36)}`);
    bram = await signIn(`bram${Date.now().toString(36)}`);

    garden = (await ok("POST", "/graphs", ada, {
      title: "The garden",
    })) as GraphView;
    first = (await ok("POST", "/nodes", ada, {
      from: { relation: "branch", graph: garden.ref },
      title: "A city remembers",
      tags: ["biology"],
    })) as NodeView;
    second = (await ok("POST", "/nodes", ada, {
      from: { relation: "under", note: first.ref },
      title: "Under it",
    })) as NodeView;
    second = (await ok("PATCH", `/nodes/${at(second.ref)}`, ada, {
      links: [first.ref],
    })) as NodeView;
    // Renaming a label leaves the one it had leading to the same note, which is
    // the alias an archive has to carry.
    wasAt = second.address;
    second = (await ok("PUT", `/nodes/${at(second.ref)}/address`, ada, {
      address: "1b",
    })) as NodeView;

    const picture = await upload(ada);
    await ok("POST", "/blocks", ada, {
      node: first.ref,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "The city " },
              {
                type: "text",
                text: "remembers",
                marks: [
                  { type: "link", attrs: { href: "https://example.org/" } },
                ],
              },
              { type: "text", text: " what " },
              { type: "reference", attrs: { note: second.ref } },
            ],
          },
          { type: "mathBlock", attrs: { tex: "a^2 + b^2 = c^2" } },
          {
            type: "diagram",
            attrs: { language: "mermaid", source: "graph TD;\n  a-->b;" },
          },
          { type: "picture", attrs: { upload_id: picture, width: 8 } },
          { type: "ink", attrs: INK },
        ],
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (!app) return;
    const { DbService } = await import("../db/db.service");
    await dropDatabase(app.get(DbService).handle, DATABASE);
    await app.close();
  });

  scenario(
    "streams as a file named after the graph and the day",
    async () => {
      const response = await fetch(
        `${base}/api/graphs/${at(garden.ref)}/archive`,
        { headers: { cookie: ada.cookie } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/zip");
      const filename = /filename="([^"]+)"/.exec(
        response.headers.get("content-disposition") ?? "",
      )?.[1] as string;
      expect(filename).toMatch(/^The garden \d{4}-\d{2}-\d{2}\.sloppy$/);
      archive = new Uint8Array(await response.arrayBuffer());
      expect(archive.byteLength).toBeGreaterThan(0);
    },
    60_000,
  );

  scenario(
    "says what it would bring before it brings any of it",
    async () => {
      const answered = await importing(bram, archive, true);

      expect(answered.status).toBeLessThan(300);
      const preview = ArchivePreviewSchema.parse(answered.body);
      expect(preview.name).toBe("The garden");
      expect(preview.owner).toBe(ada.did);
      expect(preview.graph).toBe(splitOwnedRef(garden.ref).localId);
      expect(preview.notes).toBe(2);
      expect(preview.pictures).toBe(1);
      expect(preview.replaces).toBe(false);
      expect(preview.replacing).toBe(0);
      expect(preview.collisions).toEqual([]);
      expect(
        await notesOf(bram, `${bram.did}/${preview.graph}` as OwnedRef),
      ).toEqual([]);
    },
    60_000,
  );

  scenario(
    "arrives whole under the identity that took it in",
    async () => {
      const answered = await importing(bram, archive, false);
      expect(answered.status).toBeLessThan(300);
      const landed = answered.body as GraphView;

      expect(landed.title).toBe("The garden");
      expect(splitOwnedRef(landed.ref).did).toBe(bram.did);
      expect(splitOwnedRef(landed.ref).localId).toBe(
        splitOwnedRef(garden.ref).localId,
      );

      const notes = (await notesOf(bram, landed.ref)).sort((a, b) =>
        a.depth - b.depth === 0
          ? a.ref.localeCompare(b.ref)
          : a.depth - b.depth,
      );
      expect(notes).toHaveLength(2);
      const [root, under] = notes;

      // The ULID half of every ref is kept and the DID half is the importer's.
      expect(root.ref).toBe(
        `${bram.did}/${splitOwnedRef(first.ref).localId}` as OwnedRef,
      );
      expect(root.title).toBe("A city remembers");
      expect(root.address).toBe(first.address);
      expect(root.tags).toEqual(["biology"]);

      expect(under.parent).toBe(root.ref);
      expect(under.depth).toBe(2);
      expect(under.origin).toBe(root.ref);
      expect(under.address).toBe("1b");
      expect(under.aliases).toEqual([wasAt]);
      expect(under.links).toEqual([root.ref]);

      const stack = await blocksOf(bram, root.ref);
      expect(stack).toHaveLength(1);
      const kinds = elementsOf(stack);
      expect(kinds).toContain("mathBlock");
      expect(kinds).toContain("diagram");
      expect(kinds).toContain("ink");
      expect(kinds).toContain("picture");
      expect(kinds).toContain("link");
      // A citation is re-keyed with everything else, so the line it draws
      // still lands on the note it was written about.
      expect(root.references).toEqual([under.ref]);

      const carried = pictureIn(stack);
      expect(carried?.startsWith(`${bram.did}/`)).toBe(true);
      const drawn = await fetch(
        `${base}/api/media/uploads/${at(carried as OwnedRef)}`,
        {
          headers: { cookie: bram.cookie },
        },
      );
      expect(drawn.status).toBe(200);
    },
    120_000,
  );

  scenario(
    "brought in a second time replaces what it brought the first",
    async () => {
      const preview = ArchivePreviewSchema.parse(
        (await importing(bram, archive, true)).body,
      );
      expect(preview.replaces).toBe(true);
      expect(preview.replacing).toBe(2);
      expect(preview.collisions).toEqual([]);

      const answered = await importing(bram, archive, false);
      expect(answered.status).toBeLessThan(300);
      const landed = answered.body as GraphView;

      const notes = await notesOf(bram, landed.ref);
      expect(notes).toHaveLength(2);
      expect(notes.map((one) => one.address).sort()).toEqual(["1", "1b"]);
      expect(notes.find((one) => one.address === "1b")?.aliases).toEqual([
        wasAt,
      ]);
      expect(
        (await blocksOf(bram, notes.sort((a, b) => a.depth - b.depth)[0].ref))
          .length,
      ).toBe(1);
    },
    120_000,
  );

  scenario(
    "opens a graph of its own rather than writing over the one they started with",
    async () => {
      const home = (
        (await ok("GET", "/graphs", ada)) as GraphView[]
      )[0] as GraphView;
      const response = await fetch(
        `${base}/api/graphs/${at(home.ref)}/archive`,
        {
          headers: { cookie: ada.cookie },
        },
      );
      const theirs = new Uint8Array(await response.arrayBuffer());

      const preview = ArchivePreviewSchema.parse(
        (await importing(bram, theirs, true)).body,
      );
      expect(preview.replaces).toBe(false);

      const landed = (await importing(bram, theirs, false)).body as GraphView;
      const bramsHome = (
        (await ok("GET", "/graphs", bram)) as GraphView[]
      )[0] as GraphView;
      expect(landed.ref).not.toBe(bramsHome.ref);
    },
    120_000,
  );

  scenario(
    "refuses a graph that puts two notes at one number, naming both",
    async () => {
      const bent = unpack(archive);
      for (const [path, bytes] of bent) {
        if (noteAt(path) === undefined) continue;
        const text = decodeText(bytes);
        if (!text.includes("\naddress: 1b\n")) continue;
        bent.set(
          path,
          encodeText(text.replace("\naddress: 1b\n", "\naddress: 1\n")),
        );
      }

      const answered = await importing(bram, pack(bent), true);

      expect(answered.status).toBe(400);
      const said = (answered.body as { message: string }).message;
      expect(said).toContain("are numbered 1 —");
      expect(said).toContain("“A city remembers”");
      expect(said).toContain("“Under it”");
    },
    60_000,
  );

  scenario(
    "refuses a file that is not a graph, in words",
    async () => {
      const answered = await importing(
        bram,
        new Uint8Array([1, 2, 3, 4]),
        true,
      );

      expect(answered.status).toBe(400);
      expect((answered.body as { message: string }).message).toBe(
        "This file isn't a Sloppy graph.",
      );
    },
    60_000,
  );
});
