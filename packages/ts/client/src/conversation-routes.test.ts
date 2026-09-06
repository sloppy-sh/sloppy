import { describe, expect, it, vi } from "vitest";
import { SloppyClient } from "./index.js";

const AVA = "did:syr:z6MkAvaAvaAvaAvaAvaAvaAvaAvaAvaAva";
const BOB = "did:syr:z6MkBobBobBobBobBobBobBobBobBobBobBob";
const NOTE = `${AVA}/01JNTE000000000000000000AA`;

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

describe("whether this person can hold a conversation at all", () => {
  it("answers each half on its own", async () => {
    const { asked, client } = serving({ comments: true, reactions: false });

    await expect(client.converses()).resolves.toEqual({
      comments: true,
      reactions: false,
    });
    expect(asked[0].url).toBe("/api/converses");
  });

  it("refuses an answer that is neither yes nor no", async () => {
    const { client } = serving({ comments: "maybe", reactions: true });

    await expect(client.converses()).rejects.toThrow();
  });
});

describe("a voice somebody will not be shown", () => {
  const refusal = {
    ref: `${AVA}/01JRFSD000000000000000000A`,
    created_by: AVA,
    voice: BOB,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  it("is refused everywhere they read when no note is named", async () => {
    const { asked, client } = serving(refusal);

    const written = await client.refuseVoice({ voice: BOB });

    expect(asked[0].method).toBe("POST");
    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({ voice: BOB });
    expect(written.note).toBeUndefined();
  });

  it("is refused on one note where one is named", async () => {
    const { asked, client } = serving({ ...refusal, note: NOTE });

    const written = await client.refuseVoice({ voice: BOB, note: NOTE });

    expect(JSON.parse(asked[0].body ?? "{}")).toEqual({
      voice: BOB,
      note: NOTE,
    });
    expect(written.note).toBe(NOTE);
  });

  // Taking one back names the same pair rather than the row it wrote, so a
  // surface that never listed the refusals can still undo one.
  it("is taken back by the pair that made it", async () => {
    const { asked, client } = serving(null);

    await client.allowVoice({ voice: BOB, note: NOTE });

    expect(asked[0].method).toBe("DELETE");
    expect(asked[0].url).toBe(
      `/api/refused-voices?voice=${encodeURIComponent(BOB)}&note=${encodeURIComponent(NOTE)}`,
    );
  });

  it("names no note when the refusal being taken back was blanket", async () => {
    const { asked, client } = serving(null);

    await client.allowVoice({ voice: BOB });

    expect(asked[0].url).toBe(
      `/api/refused-voices?voice=${encodeURIComponent(BOB)}`,
    );
  });

  it("lists the blanket refusals and the per-note ones together", async () => {
    const { client } = serving([refusal, { ...refusal, note: NOTE }]);

    const held = await client.refusedVoices();

    expect(held.map((one) => one.note)).toEqual([undefined, NOTE]);
  });
});

describe("the notes somebody has been answered on", () => {
  it("names the notebook each address is read in, and who answered", async () => {
    const { asked, client } = serving([
      {
        note: NOTE,
        address: "1a",
        graph: `${AVA}/00000000000000000000000000`,
        title: "A thought",
        voices: [BOB],
      },
    ]);

    const answered = await client.answeredNotes();

    expect(asked[0].url).toBe("/api/answered-notes");
    expect(answered[0].graph).toBe(`${AVA}/00000000000000000000000000`);
    expect(answered[0].voices).toEqual([BOB]);
  });
});
