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

/** Object URLs, so what was minted and what was freed can both be seen. */
function holdingBlobs() {
  const created = vi.fn(() => "blob:sloppy/1");
  const revoked = vi.fn();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: created,
    revokeObjectURL: revoked,
  });
  return { created, revoked };
}

describe("one of the caller's own pictures", () => {
  // The web shell's session is a token rather than a cookie, so an address
  // handed to an `<img>` would reach this route with no credential at all.
  it("is fetched with the caller's token where the API shares the origin", async () => {
    const { revoked } = holdingBlobs();
    const { asked, client } = serving();

    const picture = await client.ownPicture(UPLOAD);

    expect(asked[0].url).toBe("/api/media/uploads/did%3Asyr%3Az6Mk1/01ABCDEF");
    expect(asked[0].headers.get("authorization")).toBe("Bearer a-session");
    expect(picture.src).toBe("blob:sloppy/1");

    picture.release();
    expect(revoked).toHaveBeenCalledWith("blob:sloppy/1");
  });

  it("is fetched with the caller's token anywhere else", async () => {
    const { revoked } = holdingBlobs();
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

  it("reports a refusal rather than drawing from an error page", async () => {
    holdingBlobs();
    const fetchImpl = vi.fn(
      async () => new Response("no", { status: 401 }),
    ) as unknown as typeof fetch;
    const client = new SloppyClient({ token: "a-session", fetch: fetchImpl });

    await expect(client.ownPicture(UPLOAD)).rejects.toThrow();
  });
});

/** Answers every request with an empty listing, and records what was asked. */
function answering(status = 200) {
  const asked: { url: string; method: string }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(status === 200 ? "[]" : "", { status });
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

describe("the caller's own pictures, as a picker asks for them", () => {
  it("reads the note library unless another one is named", async () => {
    const { asked, client } = answering();

    await client.ownPictures();
    await client.ownPictures("wallpaper");

    expect(asked.map((one) => one.url)).toEqual([
      "/api/media/uploads?role=block",
      "/api/media/uploads?role=wallpaper",
    ]);
  });

  it("takes one back out by the upload it arrived on", async () => {
    const { asked, client } = answering();

    await client.removePicture(UPLOAD);

    expect(asked[0]).toEqual({
      url: "/api/media/uploads/did%3Asyr%3Az6Mk1/01ABCDEF",
      method: "DELETE",
    });
  });

  // A second tap on a picture already gone is the outcome that was asked for.
  it("takes one that is already gone as gone", async () => {
    const { client } = answering(404);

    await expect(client.removePicture(UPLOAD)).resolves.toBeUndefined();
  });
});
