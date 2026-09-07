import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const GARDEN = `${DID}/01JGRAPH2ND000000000000000`;

afterEach(() => setHost(""));

/** Answers `status` with `body`, and records what was asked of it. */
function serving(status = 204, body = "") {
  const asked: { method?: string; path: string }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ method: init?.method, path: String(input) });
      return new Response(body || null, { status });
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

describe("closing a graph", () => {
  it("asks for the one named, by the ref it travels by", async () => {
    const { asked, client } = serving();

    await client.closeGraph(GARDEN as never);

    expect(asked).toEqual([
      {
        method: "DELETE",
        path: `/api/graphs/${encodeURIComponent(DID)}/01JGRAPH2ND000000000000000`,
      },
    ]);
  });

  it("takes a graph that has already gone as closed", async () => {
    const { client } = serving(404, "");

    await expect(client.closeGraph(GARDEN as never)).resolves.toBeUndefined();
  });

  it("carries a refusal back with the words it was refused in", async () => {
    const { client } = serving(
      400,
      JSON.stringify({ message: "The graph you started with stays." }),
    );

    await expect(client.closeGraph(GARDEN as never)).rejects.toThrow();
  });
});
