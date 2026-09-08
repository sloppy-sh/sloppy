import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NOTE = `${DID}/01JWRDSA000000000000000000`;
const GRAPH = `${DID}/01JGRAPH2ND000000000000000`;

afterEach(() => setHost(""));

/** Answers with `body`, and records what was asked of it. */
function serving(body: unknown) {
  const asked: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    asked,
    client: new SloppyClient({
      token: "a-session",
      fetch: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe("finding a note by what it says", () => {
  const hit = {
    note: NOTE,
    address: "1a",
    graph: GRAPH,
    title: "Mushrooms",
    snippet: "seeds and mushrooms",
  };

  it("asks for the words, across every graph where none is named", async () => {
    const { asked, client } = serving([hit]);

    const hits = await client.searchNotes("mushroom");

    expect(hits.map((one) => one.note)).toEqual([NOTE]);
    expect(asked[0]).toBe("/api/nodes/search?q=mushroom");
  });

  it("carries the graph where one is", async () => {
    const { asked, client } = serving([]);

    await client.searchNotes("a b", GRAPH);

    expect(asked[0]).toBe(
      `/api/nodes/search?q=a+b&graph=${encodeURIComponent(GRAPH)}`,
    );
  });

  it("reads a hit that says nothing about where it came from as the reader's own", async () => {
    const { client } = serving([hit]);

    const [one] = await client.searchNotes("mushroom");

    expect(one.held).toBe(false);
  });

  it("reads a hit whose match was the title alone", async () => {
    const { client } = serving([{ ...hit, snippet: undefined, held: true }]);

    const [one] = await client.searchNotes("mushroom");

    expect(one).toMatchObject({ snippet: "", held: true });
  });
});

describe("what was written last", () => {
  const note = {
    ref: NOTE,
    created_by: DID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    address: "1a",
    depth: 2,
    origin: NOTE,
    title: "",
    tags: [],
    links: [],
    published: false,
  };

  it("asks for it with nothing bound where nothing was named", async () => {
    const { asked, client } = serving([note]);

    const recent = await client.recentNotes();

    expect(recent.map((one) => one.ref)).toEqual([NOTE]);
    expect(asked[0]).toBe("/api/nodes/recent");
  });

  it("carries the graph and how many are wanted", async () => {
    const { asked, client } = serving([]);

    await client.recentNotes({ graph: GRAPH, limit: 5 });

    expect(asked[0]).toBe(
      `/api/nodes/recent?graph=${encodeURIComponent(GRAPH)}&limit=5`,
    );
  });

  it("takes a note whose address says nothing about how deep it sits", async () => {
    // A person writes their own addresses, so `2` on a note two deep is a
    // label and not a disagreement — the parent chain is what depth answers to.
    const { client } = serving([{ ...note, address: "2", depth: 2 }]);

    const [read] = await client.recentNotes();
    expect(read.address).toBe("2");
    expect(read.depth).toBe(2);
  });

  it("refuses a depth no note could sit at", async () => {
    const { client } = serving([{ ...note, depth: 0 }]);

    await expect(client.recentNotes()).rejects.toThrow();
  });
});
