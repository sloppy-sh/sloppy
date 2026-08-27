// The two remote reads, against a real server rather than a stubbed `fetch`:
// what these guard is where a redirect goes and how much a body may weigh, and
// neither is visible to a fake that answers the first request and stops.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { ForbiddenException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { readRemotePicture } from "./remote-fetch";
import { fetchReachable, isReachableRemoteHost } from "./remote-host";

const PNG = "image/png";
const open = { allowPrivate: true };
const closed = { allowPrivate: false };

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const servers: Server[] = [];

/** One server, and the origin it answers on. Handlers are keyed by path. */
async function serving(routes: Record<string, Handler>): Promise<string> {
  const server = createServer((req, res) => {
    const route = routes[new URL(req.url ?? "/", "http://x").pathname];
    if (route) route(req, res);
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function head(status: number, headers: Record<string, string>): Handler {
  return (_req, res) => res.writeHead(status, headers).end();
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((done) => server.close(done))),
  );
});

const METADATA = "http://169.254.169.254/latest/meta-data/";

/** Resolves to loopback on every machine that has a hosts file, and is not
 *  spelled the way the name check knows to refuse — so what settles it is the
 *  address it resolves to, which is the whole claim below. */
const NAMED_LOOPBACK = "localhost.";

describe("the address behind a name", () => {
  async function named(): Promise<string> {
    const origin = await serving({
      "/x": head(200, { "content-type": PNG }),
    });
    return `http://${NAMED_LOOPBACK}:${new URL(origin).port}/x`;
  }

  it("refuses a name that resolves where the policy will not go", async () => {
    const target = await named();
    expect(isReachableRemoteHost(NAMED_LOOPBACK, closed)).toBe(true);

    await expect(fetchReachable(target, closed, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("reaches one whose address the policy allows", async () => {
    const answer = await fetchReachable(await named(), open, {});
    expect(answer.status).toBe(200);
  });
});

describe("following a redirect", () => {
  it("checks the address it is sent to, not only the one it was given", async () => {
    const origin = await serving({
      "/start": head(302, { location: METADATA }),
    });

    await expect(
      fetchReachable(`${origin}/start`, open, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // The first address is this test's own loopback, so the policy must be the
  // permissive one to reach it at all; what has to be refused is the SECOND
  // address, which the far end chose.
  it("refuses a hop the policy would have refused on its own", async () => {
    const origin = await serving({
      "/start": head(302, { location: "http://0.0.0.0/x" }),
    });

    await expect(
      fetchReachable(`${origin}/start`, open, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not let this instance's own exemption travel to the next hop", async () => {
    const origin = await serving({
      "/start": head(302, { location: "http://10.0.0.1/x" }),
    });

    await expect(
      fetchReachable(`${origin}/start`, { ...closed, ownOrigin: origin }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("follows a hop that is allowed", async () => {
    const origin = await serving({
      "/start": head(302, { location: "/there" }),
      "/there": head(200, { "content-type": PNG }),
    });

    const answer = await fetchReachable(`${origin}/start`, open, {});
    expect(answer.status).toBe(200);
    expect(new URL(answer.url).pathname).toBe("/there");
  });

  it("gives up on a loop rather than following it", async () => {
    const origin = await serving({
      "/round": head(302, { location: "/round" }),
    });

    await expect(
      fetchReachable(`${origin}/round`, open, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("taking a copy of a remote picture", () => {
  const policy = {
    allowPrivate: true,
    publicUrl: "http://localhost:8030",
    maxBytes: 64 * 1024,
    mimeTypes: [PNG],
  };

  it("reads a picture within the limit", async () => {
    const origin = await serving({
      "/small": (_req, res) => {
        res.writeHead(200, { "content-type": PNG });
        res.end(Buffer.alloc(1024));
      },
    });

    const picture = await readRemotePicture(`${origin}/small`, policy);
    expect(picture.mimeType).toBe(PNG);
    expect(picture.bytes.byteLength).toBe(1024);
  });

  // A body with no declared length sets the ceiling otherwise: the cap has to
  // bite on what arrives, and it has to bite before all of it has.
  it("stops reading past the limit instead of holding the whole answer", async () => {
    const ATTEMPTED = 32 * 1024 * 1024;
    let sent = 0;
    const origin = await serving({
      "/endless": (_req, res) => {
        res.writeHead(200, { "content-type": PNG });
        const chunk = Buffer.alloc(64 * 1024);
        const push = (): void => {
          while (sent < ATTEMPTED && !res.writableEnded) {
            sent += chunk.length;
            if (!res.write(chunk)) {
              res.once("drain", push);
              return;
            }
          }
          res.end();
        };
        push();
      },
    });

    await expect(
      readRemotePicture(`${origin}/endless`, policy),
    ).rejects.toThrow(/too big/i);
    // Well under what the far end was willing to send, and within a socket
    // buffer of the limit itself: refused as it arrives, not once it has.
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(ATTEMPTED / 8);
  });

  it("refuses a declared length past the limit", async () => {
    const origin = await serving({
      "/big": head(200, {
        "content-type": PNG,
        "content-length": String(policy.maxBytes + 1),
      }),
    });

    await expect(readRemotePicture(`${origin}/big`, policy)).rejects.toThrow(
      /too big/i,
    );
  });

  it("refuses a file type it cannot use", async () => {
    const origin = await serving({
      "/doc": head(200, { "content-type": "application/pdf" }),
    });

    await expect(readRemotePicture(`${origin}/doc`, policy)).rejects.toThrow(
      /file type/i,
    );
  });

  it("refuses an address a redirect chose, the same as one it was handed", async () => {
    const origin = await serving({
      "/start": head(302, { location: METADATA }),
    });

    await expect(
      readRemotePicture(`${origin}/start`, policy),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
