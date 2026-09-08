import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const COMMENT = `${AUTHOR}:01JCOMMENT0000000000000000`;
const PEER = "https://peer.example";
const PUBLICATION = `${AUTHOR}/01JPB000000000000000000000`;
const VERSION = `${AUTHOR}/01JPB00000000000000000000B`;
const EARLIER = `${AUTHOR}/01JPB00000000000000000000A`;

const version = {
  ref: VERSION,
  sequence: 2,
  published_at: "2026-02-01T00:00:00.000Z",
};

afterEach(() => setHost(""));

/** Answers with `body`, and records what was asked of it. */
function serving(body: unknown) {
  const asked: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return {
    asked,
    client: new SloppyClient({
      token: "a-session",
      fetch: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe("what an identity publishes", () => {
  const index = {
    did: AUTHOR,
    publications: [
      {
        ref: PUBLICATION,
        root_address: "1",
        title: "A branch",
        latest: version,
      },
    ],
  };

  it("names no instance where the reader named none", async () => {
    const { asked, client } = serving(index);

    const page = await client.publishedBy(AUTHOR);

    expect(page.publications.map((p) => p.ref)).toEqual([PUBLICATION]);
    expect(asked[0].url).toBe(
      `/api/peers/publications?did=${encodeURIComponent(AUTHOR)}`,
    );
  });

  it("names the instance to ask, because a DID does not answer where", async () => {
    const { asked, client } = serving(index);

    await client.publishedBy(AUTHOR, { sourceUrl: PEER });

    expect(asked[0].url).toContain(`source_url=${encodeURIComponent(PEER)}`);
  });

  it("asks for more where the listing goes on", async () => {
    const { asked, client } = serving({ ...index, next_cursor: "past-1" });

    const page = await client.publishedBy(AUTHOR);
    await client.publishedBy(AUTHOR, { cursor: page.next_cursor });

    expect(page.next_cursor).toBe("past-1");
    expect(asked[1].url).toContain("cursor=past-1");
  });

  it("is asked by the API and never by the browser", async () => {
    const { asked, client } = serving(index);

    await client.publishedBy(AUTHOR, { sourceUrl: PEER });

    // Whatever instance is named, the request leaves for our own API: a fetch
    // straight at the peer would tell them who is reading.
    expect(asked[0].url.startsWith("/api/")).toBe(true);
  });
});

describe("whoever a name names", () => {
  it("is resolved by the API, so the browser never asks their instance", async () => {
    const { asked, client } = serving({ did: AUTHOR });

    const found = await client.peerIdentity("charles", { sourceUrl: PEER });

    expect(found.did).toBe(AUTHOR);
    expect(asked[0].url.startsWith("/api/peers/identity?")).toBe(true);
    expect(asked[0].url).toContain("name=charles");
    expect(asked[0].url).toContain(`source_url=${encodeURIComponent(PEER)}`);
  });

  it("names no instance where the reader named none", async () => {
    const { asked, client } = serving({ did: AUTHOR });

    await client.peerIdentity("charles");

    expect(asked[0].url).toBe("/api/peers/identity?name=charles");
  });
});

describe("a publication's history", () => {
  const chain = { publication: PUBLICATION, versions: [version] };

  it("is asked for by the publication, wherever it is served", async () => {
    const { asked, client } = serving(chain);

    const page = await client.publishedVersions(PUBLICATION, {
      sourceUrl: PEER,
    });

    expect(page.versions).toHaveLength(1);
    expect(asked[0].url).toContain(
      `publication=${encodeURIComponent(PUBLICATION)}`,
    );
    expect(asked[0].url).toContain(`source_url=${encodeURIComponent(PEER)}`);
  });

  it("is refused when the answer is another publication's", async () => {
    const { client } = serving({
      ...chain,
      publication: `${AUTHOR}/01JPB00000000000000000ZZ`,
    });

    await expect(client.publishedVersions(PUBLICATION)).rejects.toThrow();
  });
});

describe("what changed between two versions", () => {
  const difference = {
    publication: PUBLICATION,
    root_address: "1",
    from: EARLIER,
    to: VERSION,
    changes: [],
  };

  it("names both versions, so the answer can be held to the question", async () => {
    const { asked, client } = serving(difference);

    await client.publishedChanges(PUBLICATION, EARLIER, VERSION);

    expect(asked[0].url).toContain(`from=${encodeURIComponent(EARLIER)}`);
    expect(asked[0].url).toContain(`to=${encodeURIComponent(VERSION)}`);
  });

  it("is refused when the answer compares another pair", async () => {
    const { client } = serving({ ...difference, from: VERSION });

    await expect(
      client.publishedChanges(PUBLICATION, EARLIER, VERSION),
    ).rejects.toThrow();
  });
});

describe("taking a region", () => {
  const pull = {
    ref: `${AUTHOR}/01JPEER0000000000000000000`,
    created_by: AUTHOR,
    publication: PUBLICATION,
    version,
    root_address: "1a",
    comments: "anyone",
    source_url: PEER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  it("carries where the publication is served, so a refresh can ask again", async () => {
    const { asked, client } = serving(pull);

    const region = await client.pullSubtree(PUBLICATION, { sourceUrl: PEER });

    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({
      publication: PUBLICATION,
      source_url: PEER,
    });
    expect(region.source_url).toBe(PEER);
    expect(region.version.sequence).toBe(2);
  });

  it("leaves it out for an author who keeps their graph here", async () => {
    const { asked, client } = serving({
      ...pull,
      source_url: "https://sloppy.test",
    });

    await client.pullSubtree(PUBLICATION);

    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({
      publication: PUBLICATION,
    });
  });

  it("names a version where the reader wants one rather than the newest", async () => {
    const { asked, client } = serving(pull);

    await client.pullSubtree(PUBLICATION, { version: EARLIER });

    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({
      publication: PUBLICATION,
      version: EARLIER,
    });
  });
});

describe("a note the reader already holds", () => {
  const NOTE = `${AUTHOR}/01JHE0000000000000000000AA`;
  const hit = {
    note: {
      ref: NOTE,
      created_by: AUTHOR,
      graph: `${AUTHOR}/00000000000000000000000000`,
      address: "1a1",
      depth: 3,
      origin: `${AUTHOR}/01JHE0000000000000000000AB`,
      parent: `${AUTHOR}/01JHE0000000000000000000AB`,
      title: "A thought",
      tags: [],
      links: [],
      published: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    pull: {
      ref: `${AUTHOR}/01JPEER0000000000000000000`,
      created_by: AUTHOR,
      publication: PUBLICATION,
      version,
      root_address: "1a",
      comments: "anyone",
      source_url: PEER,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  };

  it("is found by the ref its author addresses it by, with the region it came from", async () => {
    const { asked, client } = serving(hit);

    const found = await client.heldNoteBySource(NOTE);

    expect(asked[0].url).toBe(
      `/api/pulls/nodes/${encodeURIComponent(AUTHOR)}/01JHE0000000000000000000AA`,
    );
    expect(found?.note.address).toBe("1a1");
    expect(found?.pull.source_url).toBe(PEER);
  });

  it("is nothing where the reader holds no copy", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new SloppyClient({ token: "a-session", fetch: fetchImpl });

    await expect(client.heldNoteBySource(NOTE)).resolves.toBeNull();
  });
});

describe("a comment somebody wrote", () => {
  it("is dropped by the id its own store issued, as one segment", async () => {
    const { asked, client } = serving(null);

    await client.removeComment(COMMENT);

    // A `<did>/<ulid>` route would have split this at a slash it does not have.
    expect(asked[0].method).toBe("DELETE");
    expect(asked[0].url).toBe(`/api/comments/${encodeURIComponent(COMMENT)}`);
  });

  it("is dropped the same way a reaction is", async () => {
    const { asked, client } = serving(null);

    await client.removeReaction(COMMENT);

    expect(asked[0].url).toBe(`/api/reactions/${encodeURIComponent(COMMENT)}`);
  });
});

describe("what a caller may aim this instance at", () => {
  it("is an instance and not an address, and is refused before the send", async () => {
    const { asked, client } = serving({ did: AUTHOR, publications: [] });

    for (const aimed of [
      "http://127.0.0.1:8010/rpc",
      "https://peer.example/1a",
      "https://reader:secret@peer.example",
      "file:///etc/passwd",
    ]) {
      await expect(
        client.publishedBy(AUTHOR, { sourceUrl: aimed }),
      ).rejects.toThrow();
      await expect(
        client.pullSubtree(PUBLICATION, { sourceUrl: aimed }),
      ).rejects.toThrow();
      await expect(
        client.publishedVersions(PUBLICATION, { sourceUrl: aimed }),
      ).rejects.toThrow();
    }
    expect(asked).toHaveLength(0);
  });
});

describe("what a peer answered with", () => {
  const NOTE = `${AUTHOR}/01JPEERA000000000000000000`;
  const BELOW = `${AUTHOR}/01JPEERB000000000000000000`;

  function note(ref: string, address: string | undefined, parent?: string) {
    return {
      ref,
      ...(address === undefined ? {} : { address }),
      origin: NOTE,
      ...(parent === undefined ? {} : { parent }),
      title: "A thought",
      tags: [],
      links: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
  }

  function page(over: Record<string, unknown>) {
    return {
      publication: PUBLICATION,
      version,
      root_address: "1a",
      comments: "anyone",
      nodes: [],
      blocks: [],
      ...over,
    };
  }

  it("is refused when it is not the publication that was asked for", async () => {
    const { client } = serving(
      page({ publication: `${AUTHOR}/01JPB00000000000000000ZZ` }),
    );

    await expect(client.readPublishedSubtree(PUBLICATION)).rejects.toThrow();
  });

  it("is followed to the end where it does not fit in one answer", async () => {
    const pages = [
      page({ nodes: [note(NOTE, "1a")], next_cursor: "past-1a" }),
      page({ nodes: [note(BELOW, "1a1", NOTE)] }),
    ];
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify(pages[asked.length - 1]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new SloppyClient({ token: "a-session", fetch: fetchImpl });

    const region = await client.readPublishedSubtree(PUBLICATION);

    expect(region?.nodes.map((n) => n.address)).toEqual(["1a", "1a1"]);
    expect(region?.version.ref).toBe(VERSION);
    expect(asked[1]).toContain("cursor=past-1a");
  });

  it("is asked for one version where the reader named one", async () => {
    const { asked, client } = serving(page({ nodes: [note(NOTE, "1a")] }));

    await client.readPublishedSubtree(PUBLICATION, VERSION);

    expect(asked[0].url).toContain(`version=${encodeURIComponent(VERSION)}`);
  });

  // The notebook an address is read in, and the name the author gave it, are
  // what tell two regions rooted at `1a` apart once both are held.
  it("keeps the notebook the addresses were read in", async () => {
    const { client } = serving(
      page({
        nodes: [note(NOTE, "1a")],
        graph: `${AUTHOR}/01JGRAPH2ND000000000000000`,
        graph_title: "The thesis",
      }),
    );

    const region = await client.readPublishedSubtree(PUBLICATION);

    expect(region?.graph).toBe(`${AUTHOR}/01JGRAPH2ND000000000000000`);
    expect(region?.graph_title).toBe("The thesis");
  });

  // A branch its author gave no number is read like any other: the note it is
  // rooted at is what the region is, and the pages carry it.
  it("keeps a region its author gave no address, and the note it is rooted at", async () => {
    const { client } = serving(
      page({
        root: NOTE,
        root_address: undefined,
        nodes: [note(NOTE, undefined), note(BELOW, undefined, NOTE)],
      }),
    );

    const region = await client.readPublishedSubtree(PUBLICATION);

    expect(region?.root).toBe(NOTE);
    expect(region?.root_address).toBeUndefined();
    expect(region?.nodes.map((n) => n.ref)).toEqual([NOTE, BELOW]);
  });

  it("reads a peer that names no notebook as naming none", async () => {
    const { client } = serving(page({ nodes: [note(NOTE, "1a")] }));

    const region = await client.readPublishedSubtree(PUBLICATION);

    expect(region?.graph).toBeUndefined();
    expect(region?.graph_title).toBeUndefined();
  });

  it("carries the look its author gave a mark, and no picture of one", async () => {
    const { client } = serving(
      page({
        nodes: [
          {
            ...note(NOTE, "1a"),
            look: { ring_weight: "heavy", mark_radius: "large" },
          },
        ],
      }),
    );

    const region = await client.readPublishedSubtree(PUBLICATION);

    expect(region?.nodes[0].look).toEqual({
      ring_weight: "heavy",
      mark_radius: "large",
    });
  });

  it("is nothing at all where nothing is published there", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new SloppyClient({ token: "a-session", fetch: fetchImpl });

    await expect(client.readPublishedSubtree(PUBLICATION)).resolves.toBeNull();
  });
});
