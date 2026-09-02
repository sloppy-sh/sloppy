import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const AUTHOR = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const COMMENT = `${AUTHOR}:01JCOMMENT0000000000000000`;
const PEER = "https://peer.example";

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
    roots: [
      {
        root_address: "1",
        title: "A branch",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  it("is asked of this instance when nowhere else is named", async () => {
    const { asked, client } = serving(index);

    const roots = await client.publishedBy(AUTHOR);

    expect(roots.map((root) => root.root_address)).toEqual(["1"]);
    expect(asked[0].url).toBe(
      `/api/peers/publications?did=${encodeURIComponent(AUTHOR)}`,
    );
  });

  it("names the instance to ask, because a DID does not answer where", async () => {
    const { asked, client } = serving(index);

    await client.publishedBy(AUTHOR, PEER);

    expect(asked[0].url).toContain(`source_url=${encodeURIComponent(PEER)}`);
  });

  it("is asked by the API and never by the browser", async () => {
    const { asked, client } = serving(index);

    await client.publishedBy(AUTHOR, PEER);

    // Whatever instance is named, the request leaves for our own API: a fetch
    // straight at the peer would tell them who is reading.
    expect(asked[0].url.startsWith("/api/")).toBe(true);
  });
});

describe("taking a region", () => {
  const pull = {
    ref: `${AUTHOR}/01JPEER0000000000000000000`,
    created_by: AUTHOR,
    source_did: AUTHOR,
    root_address: "1a",
    source_url: PEER,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  it("carries where the subtree is served, so a refresh can ask again", async () => {
    const { asked, client } = serving(pull);

    const region = await client.pullSubtree(AUTHOR, "1a", PEER);

    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({
      did: AUTHOR,
      root_address: "1a",
      source_url: PEER,
    });
    expect(region.source_url).toBe(PEER);
  });

  it("leaves it out for an author who keeps their graph here", async () => {
    const { asked, client } = serving({
      ...pull,
      source_url: "https://sloppy.test",
    });

    await client.pullSubtree(AUTHOR, "1a");

    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({
      did: AUTHOR,
      root_address: "1a",
    });
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
    const { asked, client } = serving({ did: AUTHOR, roots: [] });

    for (const aimed of [
      "http://127.0.0.1:8010/rpc",
      "https://peer.example/1a",
      "https://reader:secret@peer.example",
      "file:///etc/passwd",
    ]) {
      await expect(client.publishedBy(AUTHOR, aimed)).rejects.toThrow();
      await expect(client.pullSubtree(AUTHOR, "1a", aimed)).rejects.toThrow();
    }
    expect(asked).toHaveLength(0);
  });
});

describe("what a peer answered with", () => {
  it("is refused when it is not the subtree that was asked for", async () => {
    const { client } = serving({
      did: `${AUTHOR}x`,
      root_address: "1a",
      nodes: [],
      blocks: [],
    });

    await expect(client.readPublishedSubtree(AUTHOR, "1a")).rejects.toThrow();
  });

  it("is nothing at all where nothing is published there", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new SloppyClient({ token: "a-session", fetch: fetchImpl });

    await expect(client.readPublishedSubtree(AUTHOR, "1a")).resolves.toBeNull();
  });
});
