import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const DID = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const GARDEN = `${DID}/01JGRAPH2ND000000000000000`;

afterEach(() => setHost(""));

/** Answers `body` with `headers`, and records what was asked of it. */
function serving(body: BodyInit | null, init: ResponseInit = {}) {
  const asked: {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
  }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, request?: RequestInit) => {
      asked.push({
        url: String(input),
        method: request?.method ?? "GET",
        headers: new Headers(request?.headers),
        body: request?.body,
      });
      return new Response(body, { status: 200, ...init });
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

describe("a graph as the folder somebody keeps it in", () => {
  it("is asked for by the ref the graph travels by, and comes back named", async () => {
    const { asked, client } = serving(new Uint8Array([80, 75, 3, 4]), {
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="The garden 2026-09-09.sloppy"',
      },
    });

    const archive = await client.exportArchive(GARDEN as never);

    expect(asked[0].url).toBe(
      `/api/graphs/${encodeURIComponent(DID)}/01JGRAPH2ND000000000000000/archive`,
    );
    expect(asked[0].headers.get("accept")).toBe("application/zip");
    expect([...archive.bytes]).toEqual([80, 75, 3, 4]);
    expect(archive.filename).toBe("The garden 2026-09-09.sloppy");
  });

  it("still has a name where the server named nothing", async () => {
    const { client } = serving(new Uint8Array([80, 75]));

    expect((await client.exportArchive(GARDEN as never)).filename).toBe(
      "graph.sloppy",
    );
  });

  it("carries a refusal back with the words it was refused in", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "That graph is not here." }), {
          status: 400,
        }),
    ) as unknown as typeof fetch;
    const client = new SloppyClient({ token: "a-session", fetch: fetchImpl });

    await expect(client.exportArchive(GARDEN as never)).rejects.toThrow(
      /That graph is not here\./,
    );
  });
});

describe("bringing one in", () => {
  const preview = {
    format: 1,
    graph: "01JGRAPH2ND000000000000000",
    name: "The garden",
    owner: DID,
    notes: 2,
    pictures: 1,
    missing_emoji: ["thinking"],
    collisions: [],
    replaces: false,
    replacing: 0,
  };

  it("asks what would arrive without bringing it", async () => {
    const { asked, client } = serving(JSON.stringify(preview));

    const said = await client.previewArchive(new Uint8Array([80, 75]));

    expect(asked[0].url).toBe("/api/graphs/import?preview=1");
    expect(asked[0].method).toBe("POST");
    expect(asked[0].headers.get("content-type")).toBe("application/zip");
    expect(said.missing_emoji).toEqual(["thinking"]);
  });

  it("brings it, and answers with the graph it became", async () => {
    const { asked, client } = serving(
      JSON.stringify({
        ref: GARDEN,
        created_by: DID,
        title: "The garden",
        created_at: "2026-09-09T00:00:00.000Z",
        updated_at: "2026-09-09T00:00:00.000Z",
      }),
    );

    const graph = await client.importArchive(new Uint8Array([80, 75]));

    expect(asked[0].url).toBe("/api/graphs/import");
    expect(graph.title).toBe("The garden");
  });

  it("sends what the person chose between the two copies beside the file", async () => {
    const { asked, client } = serving(
      JSON.stringify({
        ref: GARDEN,
        created_by: DID,
        title: "The garden",
        created_at: "2026-09-09T00:00:00.000Z",
        updated_at: "2026-09-09T00:00:00.000Z",
      }),
    );

    await client.importArchive(new Uint8Array([80, 75]), {
      resolutions: [
        {
          kind: "note",
          ref: `${DID}/01ARZ3NDEKTSV4RRFFQ69G5FAV`,
          keep: "mine",
        },
      ],
    });

    const body = asked[0].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(body.get("settle")))).toEqual({
      resolutions: [
        {
          kind: "note",
          ref: `${DID}/01ARZ3NDEKTSV4RRFFQ69G5FAV`,
          keep: "mine",
        },
      ],
    });
    expect(body.get("archive")).toBeInstanceOf(Blob);
    // A form mints its boundary with the body, so naming the type would make
    // the parts unreadable.
    expect(asked[0].headers.get("content-type")).toBeNull();
  });

  // A form mints its boundary with the body, so naming the type would make the
  // parts unreadable.
  it("leaves a form to name its own type", async () => {
    const { asked, client } = serving(JSON.stringify(preview));
    const form = new FormData();
    form.set("archive", new Blob([new Uint8Array([80, 75])]), "a.sloppy");

    await client.previewArchive(form);

    expect(asked[0].headers.get("content-type")).toBeNull();
  });
});
