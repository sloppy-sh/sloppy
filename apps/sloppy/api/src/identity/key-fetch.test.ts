import { createServer, type Server } from "node:http";
import { createServer as createSocket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readKeyThrough } from "./key-fetch";

/** A development machine's policy: a server on this host is a real test. */
const HERE = { allowPrivate: true };

/** Never a real host under any policy, and the address an SSRF is aimed at. */
const METADATA = "http://169.254.169.254/latest/meta-data/";

const BLOCK = "a key block, as far as this is concerned";

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

describe("reading a key from an address an email domain decides", () => {
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
      if (path === "/empty") {
        res.writeHead(200).end();
        return;
      }
      if (path === "/broken") {
        res.writeHead(500).end();
        return;
      }
      if (path === "/onwards") {
        res.writeHead(302, { location: METADATA }).end();
        return;
      }
      if (path === "/endless") {
        res.writeHead(200);
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
      res.writeHead(200, { "content-type": "application/pgp-keys" }).end(BLOCK);
    });
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
  });

  afterAll(() => server?.close());

  it("holds what the address served", async () => {
    const said = await readKeyThrough(HERE)(`${origin}/hu/whoever`);
    expect(said.answer).toBe("held");
    expect(said.answer === "held" && new TextDecoder().decode(said.block)).toBe(
      BLOCK,
    );
  });

  it("answers that there is no key where the address says so", async () => {
    expect(await readKeyThrough(HERE)(`${origin}/gone`)).toEqual({
      answer: "none",
    });
    expect(await readKeyThrough(HERE)(`${origin}/empty`)).toEqual({
      answer: "none",
    });
  });

  it("learns nothing from an address having a bad afternoon", async () => {
    expect(await readKeyThrough(HERE)(`${origin}/broken`)).toEqual({
      answer: "unreachable",
    });
  });

  it("will not reach a private address where a deployment says not to", async () => {
    expect(
      await readKeyThrough({ allowPrivate: false })(`${origin}/hu/whoever`),
    ).toEqual({ answer: "unreachable" });
  });

  it("will not reach an address no policy allows", async () => {
    expect(await readKeyThrough(HERE)(METADATA)).toEqual({
      answer: "unreachable",
    });
  });

  it("will not follow an address onto one it would not have reached", async () => {
    expect(await readKeyThrough(HERE)(`${origin}/onwards`)).toEqual({
      answer: "unreachable",
    });
  });

  it("gives up on an answer that never ends", async () => {
    expect(await readKeyThrough(HERE)(`${origin}/endless`)).toEqual({
      answer: "unreachable",
    });
  }, 30_000);
});
