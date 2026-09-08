import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NOTE = `${DID}/01JNAMEDNTE000000000000000`;
const AT = "2026-01-01T00:00:00.000Z";

afterEach(() => setHost(""));

function note(over: Record<string, unknown> = {}) {
  return {
    ref: NOTE,
    created_by: DID,
    depth: 1,
    origin: NOTE,
    title: "Mushrooms",
    tags: [],
    links: [],
    published: false,
    created_at: AT,
    updated_at: AT,
    ...over,
  };
}

/** Answers with `body`, and records what was asked of it and with what. */
function serving(body: unknown) {
  const asked: { url: string; method: string; body: string }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: String(init?.body ?? ""),
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

describe("writing the address a note is cited by", () => {
  it("sends it to the note's own address route", async () => {
    const { asked, client } = serving(note({ address: "1a", depth: 2 }));

    const written = await client.setAddress(NOTE, "1a");

    expect(asked[0].method).toBe("PUT");
    expect(asked[0].url).toBe(
      `/api/nodes/${encodeURIComponent(DID)}/01JNAMEDNTE000000000000000/address`,
    );
    expect(JSON.parse(asked[0].body)).toEqual({ address: "1a" });
    expect(written.address).toBe("1a");
  });

  it("takes it back off with null, and reads the note back with none", async () => {
    const { asked, client } = serving(note());

    const written = await client.setAddress(NOTE, null);

    expect(JSON.parse(asked[0].body)).toEqual({ address: null });
    expect(written.address).toBeUndefined();
  });

  it("writes a note that springs from nothing and carries no address", async () => {
    const { asked, client } = serving(note());

    const written = await client.createNode({ from: { relation: "free" } });

    expect(JSON.parse(asked[0].body)).toEqual({ from: { relation: "free" } });
    expect(written.address).toBeUndefined();
    expect(written.parent).toBeUndefined();
    expect(written.depth).toBe(1);
  });
});
