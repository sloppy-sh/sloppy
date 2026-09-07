import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const NOTE = `${DID}/01JMVEDNTE0000000000000000`;
const CHILD = `${DID}/01JMVEDCHD0000000000000000`;
const LANDING = `${DID}/01JMVEDDEST000000000000000`;
const AT = "2026-01-01T00:00:00.000Z";

afterEach(() => setHost(""));

function note(
  ref: string,
  address: string,
  over: Record<string, unknown> = {},
) {
  return {
    ref,
    created_by: DID,
    address,
    depth: address.replace(/[^a-z0-9]/g, "").length,
    origin: LANDING,
    title: "",
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
  const asked: { url: string; body: string }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(input), body: String(init?.body ?? "") });
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

describe("carrying a note somewhere else", () => {
  it("says where it goes, and answers with the whole subtree at its new addresses", async () => {
    const { asked, client } = serving([
      note(NOTE, "2c", { depth: 2, aliases: ["1a"] }),
      note(CHILD, "2c1", { depth: 3, parent: NOTE, aliases: ["1a1"] }),
    ]);

    const moved = await client.moveNote(NOTE, {
      relation: "under",
      note: LANDING,
    });

    expect(asked[0].url).toBe(
      `/api/nodes/${encodeURIComponent(DID)}/01JMVEDNTE0000000000000000/move`,
    );
    expect(JSON.parse(asked[0].body)).toEqual({
      to: { relation: "under", note: LANDING },
    });
    expect(moved.map((one) => one.address)).toEqual(["2c", "2c1"]);
    expect(moved[0].aliases).toEqual(["1a"]);
  });

  it("reads a note that has never moved as one carrying no other address", async () => {
    const { client } = serving([note(NOTE, "1b", { depth: 2 })]);

    const [moved] = await client.moveNote(NOTE, {
      relation: "after",
      note: LANDING,
    });

    expect(moved.aliases).toBeUndefined();
  });
});
