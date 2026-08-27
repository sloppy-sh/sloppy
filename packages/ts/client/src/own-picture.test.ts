import { afterEach, describe, expect, it, vi } from "vitest";
import { setHost } from "./host.js";
import { SloppyClient } from "./index.js";

const UPLOAD = "did:syr:z6Mk1/01ABCDEF";

afterEach(() => {
  setHost("");
  vi.unstubAllGlobals();
});

/** Answers every request with a one-pixel PNG, and records what was asked. */
function serving() {
  const asked: { url: string; headers: Headers }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      return new Response(new Blob([new Uint8Array([1])]), {
        status: 200,
        headers: { "content-type": "image/png" },
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

describe("one of the caller's own pictures", () => {
  // Same-origin the session cookie rides the request, so the address itself is
  // what an `<img>` needs and nothing is held in memory to free.
  it("is an address where the API shares the page's origin", async () => {
    const { asked, client } = serving();

    const picture = await client.ownPicture(UPLOAD);

    expect(picture.src).toBe("/api/media/uploads/did%3Asyr%3Az6Mk1/01ABCDEF");
    expect(asked).toHaveLength(0);
    picture.release();
  });

  // An `<img>` carries no credential across origins, and this route needs one.
  it("is fetched with the caller's token anywhere else", async () => {
    const created = vi.fn(() => "blob:sloppy/1");
    const revoked = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: created,
      revokeObjectURL: revoked,
    });
    setHost("https://sloppy.example");
    const { asked, client } = serving();

    const picture = await client.ownPicture(UPLOAD);

    expect(asked[0].url).toBe(
      "https://sloppy.example/api/media/uploads/did%3Asyr%3Az6Mk1/01ABCDEF",
    );
    expect(asked[0].headers.get("authorization")).toBe("Bearer a-session");
    expect(picture.src).toBe("blob:sloppy/1");

    picture.release();
    expect(revoked).toHaveBeenCalledWith("blob:sloppy/1");
  });
});
