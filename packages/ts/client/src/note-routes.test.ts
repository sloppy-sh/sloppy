// What a note's own routes send and read back. The wire boundary is
// `parseNodeView`, which drops whatever it does not know, so a field is only
// carried where a test says so.

import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NOTE = `${DID}/01JMVEDNTE0000000000000000`;
const AT = "2026-01-01T00:00:00.000Z";
const COMMIT = "9c6eb7e0f1a24c3b5d6e7f8091a2b3c4d5e6f708";

afterEach(() => setHost(""));

function note(over: Record<string, unknown> = {}) {
  return {
    ref: NOTE,
    created_by: DID,
    address: "1a",
    depth: 2,
    origin: NOTE,
    title: "Why the parser forks",
    tags: [],
    links: [],
    published: false,
    created_at: AT,
    updated_at: AT,
    ...over,
  };
}

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

describe("saying a note's reasoning still holds", () => {
  it("sends the commit it was read against, and nothing else", async () => {
    const { asked, client } = serving(note({ checked: COMMIT }));

    const confirmed = await client.updateNode(NOTE, { checked: COMMIT });

    expect(asked[0].method).toBe("PATCH");
    expect(asked[0].url).toBe(
      `/api/nodes/${encodeURIComponent(DID)}/01JMVEDNTE0000000000000000`,
    );
    expect(JSON.parse(asked[0].body)).toEqual({ checked: COMMIT });
    expect(confirmed.checked).toBe(COMMIT);
  });

  it("reads a note nobody has confirmed as one nobody has confirmed", async () => {
    const { client } = serving(note());

    expect((await client.getNode(NOTE))?.checked).toBeUndefined();
  });
});
