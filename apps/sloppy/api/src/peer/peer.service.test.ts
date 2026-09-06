import { createServer, type Server } from "node:http";
import { createServer as createSocket } from "node:net";
import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppConfigService } from "../config/app-config.service";
import type { Delegation } from "../syr/syr.service";
import type { SyrService } from "../syr/syr.service";
import { PeerService } from "./peer.service";

const ALICE = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";

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

/** An instance that keeps names, answering for one person and nobody else. */
async function store(): Promise<{
  origin: string;
  asked: string[];
  close: () => void;
}> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const asked: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    asked.push(path);
    const answer = {
      "/.well-known/syr": {
        api: { public_profile: `${origin}/public/profile` },
      },
      "/public/profile/alice": { data: { did: ALICE, username: "alice" } },
    }[path];
    if (!answer) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return { origin, asked, close: () => server.close() };
}

/** An instance that is up and is not somewhere names are kept. */
async function silent(): Promise<{
  origin: string;
  asked: string[];
  close: () => void;
}> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const asked: string[] = [];
  const server: Server = createServer((req, res) => {
    asked.push(req.url ?? "/");
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return { origin, asked, close: () => server.close() };
}

describe("finding somebody by name", () => {
  let home: Awaited<ReturnType<typeof store>>;
  let elsewhere: Awaited<ReturnType<typeof store>>;
  let here: Awaited<ReturnType<typeof silent>>;
  let peers: PeerService;
  let reader: Delegation;

  beforeAll(async () => {
    home = await store();
    elsewhere = await store();
    here = await silent();
    peers = new PeerService(
      new AppConfigService(new ConfigService({ PUBLIC_URL: here.origin })),
      {} as SyrService,
    );
    reader = {
      did: ALICE,
      syr_instance_url: home.origin,
      delegate_public_key: "z-delegate",
      access_token: "token",
    };
  });

  afterAll(() => {
    home?.close();
    elsewhere?.close();
    here?.close();
  });

  it("asks the store the reader's own name is kept on when none is named", async () => {
    expect(await peers.identify({ name: "alice" }, reader)).toEqual({
      did: ALICE,
    });
    expect(home.asked).toContain("/public/profile/alice");
    expect(here.asked).toEqual([]);
  });

  it("asks the instance the reader named", async () => {
    expect(
      await peers.identify(
        { name: "alice", source_url: elsewhere.origin },
        {
          ...reader,
          syr_instance_url: here.origin,
        },
      ),
    ).toEqual({ did: ALICE });
    expect(elsewhere.asked).toContain("/public/profile/alice");
  });

  it("says nobody goes by a name its instance answered nothing for", async () => {
    await expect(peers.identify({ name: "nobody" }, reader)).rejects.toThrow(
      /Nobody there goes by that name/,
    );
  });

  it("does not blame the name where nothing there looks names up", async () => {
    const asking = peers.identify(
      { name: "alice" },
      {
        ...reader,
        syr_instance_url: here.origin,
      },
    );
    await expect(asking).rejects.toThrow(/could not look a name up there/);
    await expect(asking).rejects.not.toThrow(/goes by that name/);
  });
});
