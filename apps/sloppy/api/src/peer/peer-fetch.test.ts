import { createServer, type Server } from "node:http";
import { createServer as createSocket } from "node:net";
import { MAX_PUBLISHED_PAGE_BYTES } from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPeerJson } from "./peer-fetch";

/** A development machine's policy: two instances on one host are a real test. */
const HERE = { allowPrivate: true };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createSocket();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const found = probe.address();
      probe.close(() =>
        typeof found === "object" && found
          ? resolve(found.port)
          : reject(new Error("no free port")),
      );
    });
  });
}

describe("reading a peer's public endpoint", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/gone") {
        res.writeHead(404).end();
        return;
      }
      if (path === "/refused") {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ message: "Our own words for our own reader" }));
        return;
      }
      if (path === "/endless") {
        res.writeHead(200, { "content-type": "application/json" });
        const chunk = "x".repeat(1024 * 1024);
        const keepGoing = () => {
          if (res.writableEnded || res.destroyed) return;
          if (res.write(chunk)) setImmediate(keepGoing);
          else res.once("drain", keepGoing);
        };
        res.on("error", () => undefined);
        keepGoing();
        return;
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ answered: true }));
    });
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
  });

  afterAll(() => server?.close());

  it("reads an answer", async () => {
    expect(await readPeerJson(`${origin}/here`, HERE)).toEqual({
      answered: true,
    });
  });

  it("answers nothing where the instance has nothing there", async () => {
    expect(await readPeerJson(`${origin}/gone`, HERE)).toBeNull();
  });

  it("does not pass a peer's words on to a reader", async () => {
    await expect(readPeerJson(`${origin}/refused`, HERE)).rejects.toThrow(
      /could not reach that instance/,
    );
  });

  it("gives up on an answer that never ends", async () => {
    await expect(readPeerJson(`${origin}/endless`, HERE)).rejects.toThrow(
      /could not reach that instance/,
    );
    expect(MAX_PUBLISHED_PAGE_BYTES).toBeGreaterThan(0);
  }, 30_000);

  it("will not reach a private address where a deployment says not to", async () => {
    await expect(
      readPeerJson(`${origin}/here`, { allowPrivate: false }),
    ).rejects.toThrow(/could not reach that instance/);
  });
});
