// Relaying against real sockets on both ends, because what this guards only
// exists there: a far end that keeps sending, and a reader whose response has
// already begun. A stubbed `res` has no head that is already out.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { HttpException, Logger } from "@nestjs/common";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relayPicture, type RelayOptions } from "./picture-relay";

const PNG = "image/png";
const CAP = 64 * 1024;
const CHUNK = Buffer.alloc(16 * 1024, 0x41);

const servers: Server[] = [];
const crashes: unknown[] = [];
const record = (error: unknown) => crashes.push(error);
const complaints = vi.spyOn(Logger.prototype, "warn");

async function listening(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Answers with `image/png` until the reader goes away. Nothing declares a
 *  length, which is the case the cap has to survive on its own. */
async function endless(headers: Record<string, string> = {}): Promise<string> {
  return listening((_req, res) => {
    res.writeHead(200, { "content-type": PNG, ...headers });
    const push = () => {
      while (!res.destroyed && !res.writableEnded) {
        if (!res.write(CHUNK)) {
          res.once("drain", push);
          return;
        }
      }
    };
    push();
  });
}

/** Express, because that is the `Response` the routes hand `relayPicture`, and
 *  the `catch` stands in for Nest's exception filter. */
async function relaying(
  target: string,
  options?: Partial<RelayOptions>,
): Promise<string> {
  const app = express();
  app.get("/", async (_req, res) => {
    try {
      await relayPicture(res, target, {
        policy: { allowPrivate: true },
        maxBytes: CAP,
        mimeTypes: [PNG],
        cacheControl: "no-store",
        ...options,
      });
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      if (!res.headersSent) res.status(status).end();
    }
  });
  return listening(app);
}

beforeEach(() => {
  crashes.length = 0;
  complaints.mockReset().mockImplementation(() => undefined);
  process.on("uncaughtException", record);
});

afterEach(async () => {
  process.off("uncaughtException", record);
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((closed) => server.close(closed))),
  );
});

/** One byte under the cap, whole, from a server that declares its length. */
async function pixel(): Promise<{ relay: string; bytes: Buffer }> {
  const bytes = Buffer.alloc(CAP - 1, 0x42);
  const origin = await listening((_req, res) => {
    res.writeHead(200, { "content-type": PNG }).end(bytes);
  });
  return { relay: await relaying(origin), bytes };
}

describe("a picture bigger than the relay will carry", () => {
  it("drops the transfer rather than the process", async () => {
    const small = await pixel();
    const relay = await relaying(await endless());

    const answer = await fetch(relay);
    const carried = await answer.arrayBuffer().catch(() => null);
    await new Promise((settle) => setTimeout(settle, 50));

    // A far end holding somebody's avatar must not be able to end this
    // process by answering with more bytes than were asked for.
    expect(crashes).toEqual([]);
    // Nor to have part of a file handed to a reader as the whole of one: the
    // head is already out, so the only answer left is a broken transfer.
    expect(carried).toBeNull();
    expect(complaints).toHaveBeenCalled();
    expect((await fetch(small.relay)).status).toBe(200);
  });

  it("refuses one that says how big it is, before a byte of it", async () => {
    const relay = await relaying(
      await endless({ "content-length": String(CAP * 4) }),
    );

    expect((await fetch(relay)).status).toBe(413);
    expect(crashes).toEqual([]);
  });
});

describe("a reader who leaves mid-picture", () => {
  it("stops the fetch, and is not reported as a failure", async () => {
    const relay = await relaying(await endless(), {
      maxBytes: 64 * 1024 * 1024,
    });

    const leaving = new AbortController();
    const answer = await fetch(relay, { signal: leaving.signal });
    const reading = answer.body!.getReader();
    await reading.read();
    leaving.abort();
    await new Promise((settle) => setTimeout(settle, 50));

    expect(crashes).toEqual([]);
    expect(complaints).not.toHaveBeenCalled();
  });
});

describe("a picture the relay will carry", () => {
  it("arrives whole", async () => {
    const { relay, bytes } = await pixel();

    const answer = await fetch(relay);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toBe(PNG);
    expect(Buffer.from(await answer.arrayBuffer()).equals(bytes)).toBe(true);
    expect(crashes).toEqual([]);
  });
});
