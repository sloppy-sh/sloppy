import { describe, expect, it } from "vitest";
import { SloppyApiError } from "./errors.js";
import { SloppyClient } from "./index.js";

function answering(response: () => Response | Promise<Response>) {
  return new SloppyClient({ fetch: async () => response() });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("where this Sloppy's own identities live", () => {
  it("names the instance that hosts them", async () => {
    const client = answering(() => json({ instance_url: "https://sloppy.sh" }));

    await expect(client.ownInstance()).resolves.toBe("https://sloppy.sh");
  });

  it("answers nothing where this instance only delegates", async () => {
    const client = answering(() => json({ instance_url: null }));

    await expect(client.ownInstance()).resolves.toBeUndefined();
  });

  // Answering `undefined` here is what took the only way in off the sign-in
  // page: a server that could not say and one that said "nowhere" looked alike.
  it("refuses to call a server that could not say the same as nowhere", async () => {
    const client = answering(() =>
      json({ message: "Sloppy could not check who you are." }, 503),
    );

    await expect(client.ownInstance()).rejects.toBeInstanceOf(SloppyApiError);
  });

  it("carries the words the server wrote for a person", async () => {
    const client = answering(() =>
      json({ message: "Try again shortly." }, 503),
    );

    await expect(client.ownInstance()).rejects.toMatchObject({
      status: 503,
      detail: "Try again shortly.",
    });
  });

  // The other half of what somebody hands a reader: their DID says who, this
  // says where the branch is served.
  it("names where a peer reaches the graph this instance serves", async () => {
    const client = answering(() =>
      json({ instance_url: null, instance_origin: "https://notes.example" }),
    );

    await expect(client.instanceHome()).resolves.toEqual({
      instance_url: null,
      instance_origin: "https://notes.example",
    });
  });

  it("keeps the way in when the instance named an address nobody could type", async () => {
    const client = answering(() =>
      json({ instance_url: "https://sloppy.sh", instance_origin: "sloppy.sh" }),
    );

    await expect(client.instanceHome()).resolves.toEqual({
      instance_url: "https://sloppy.sh",
    });
    await expect(client.ownInstance()).resolves.toBe("https://sloppy.sh");
  });

  it("refuses an instance it could not reach at all", async () => {
    const client = answering(() => {
      throw new TypeError("Failed to fetch");
    });

    await expect(client.ownInstance()).rejects.toBeInstanceOf(TypeError);
  });
});
