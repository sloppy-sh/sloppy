import { createServer, type Server } from "node:http";
import { createServer as createSocket } from "node:net";
import type { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppConfigService } from "../config/app-config.service";
import { type Delegation, SyrService } from "../syr/syr.service";
import { PeerService } from "./peer.service";

const ALICE = "did:syr:z6MkpTHR8VNsBxYAAWHut2Geadd9jSLuFvdmsZ2mFmZjMxYZ";
const OTHER = "did:syr:z6MkrZhTRQ3ndyEtMSqBB8pf2M4LuncUofaPNnnzHrrxEtPe";
const STRANGER = "mailto:ada@mailbox.example";
const EXTORTION = "Pay me 5 BTC to see this profile.";

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

type Said = { status: number; body?: unknown };

/** One instance on a port of its own, answering by path. Records what it was
 *  asked. */
async function listening(
  answering: (path: string, origin: string) => Said,
): Promise<{ origin: string; asked: string[]; close: () => void }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const asked: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    asked.push(path);
    const said = answering(path, origin);
    if (said.body === undefined) {
      res.writeHead(said.status).end();
      return;
    }
    res
      .writeHead(said.status, { "content-type": "application/json" })
      .end(JSON.stringify(said.body));
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  return { origin, asked, close: () => server.close() };
}

const keepsNames = (origin: string): Said => ({
  status: 200,
  body: {
    name: "syr",
    public_url: origin,
    identity_manifest_template: `${origin}/.well-known/syr/{did}`,
    api: { public_profile: `${origin}/public/profile` },
  },
});

/** An instance that keeps names, answering for one person and nobody else. */
const store = () =>
  listening((path, origin) => {
    if (path === "/.well-known/syr") return keepsNames(origin);
    if (path === "/public/profile/alice") {
      return { status: 200, body: { data: { did: ALICE, username: "alice" } } };
    }
    return { status: 404 };
  });

/** An instance that keeps a follow list, and records every follow written to
 *  it. */
const keepsAFollowList = () =>
  listening((path, origin) => {
    if (path === "/.well-known/syr") {
      return {
        status: 200,
        body: {
          name: "syr",
          public_url: origin,
          identity_manifest_template: `${origin}/.well-known/syr/{did}`,
          platform: {
            consent: `${origin}/api/platform/consent`,
            token: `${origin}/api/platform/token`,
            sign: `${origin}/api/platform/sign`,
            challenge: `${origin}/api/platform/challenge`,
            delegations: `${origin}/api/platform/delegations`,
            revoke: `${origin}/api/platform/revoke`,
          },
        },
      };
    }
    if (path.startsWith("/.well-known/syr/")) {
      return {
        status: 200,
        body: {
          version: 1,
          did: ALICE,
          provider: origin,
          endpoints: {
            profile: `${origin}/public/profile`,
            uploads: `${origin}/api/uploads`,
            did_document: `${origin}/.well-known/did.json`,
            public_following: `${origin}/public/following`,
          },
          web_profile: `${origin}/alice`,
        },
      };
    }
    if (path === "/api/follows") return { status: 204 };
    return { status: 404 };
  });

/** An instance that is up and is not somewhere names are kept. */
const silent = () => listening(() => ({ status: 404 }));

/** An instance that keeps names and refuses to look one up, in words of its
 *  own. */
const demanding = () =>
  listening((path, origin) =>
    path === "/.well-known/syr"
      ? keepsNames(origin)
      : {
          status: 403,
          body: { message: EXTORTION, code: "PAY_UP" },
        },
  );

describe("finding somebody by name", () => {
  let home: Awaited<ReturnType<typeof store>>;
  let elsewhere: Awaited<ReturnType<typeof store>>;
  let here: Awaited<ReturnType<typeof silent>>;
  let extortionate: Awaited<ReturnType<typeof demanding>>;
  let peers: PeerService;
  let reader: Delegation;

  beforeAll(async () => {
    home = await store();
    elsewhere = await store();
    here = await silent();
    extortionate = await demanding();
    peers = new PeerService(
      new AppConfigService(new ConfigService({ PUBLIC_URL: here.origin })),
      new SyrService(),
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
    extortionate?.close();
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

  it("never repeats what an instance said about a name it refused", async () => {
    const refused = await peers
      .identify(
        { name: "alice", source_url: extortionate.origin },
        { ...reader, syr_instance_url: here.origin },
      )
      .catch((error: unknown) => error);

    const said = JSON.stringify((refused as HttpException).getResponse());
    expect(said).not.toContain(EXTORTION);
    expect(said).not.toContain("PAY_UP");
    expect(said).toContain("Sloppy could not look that name up");
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

describe("following somebody", () => {
  let home: Awaited<ReturnType<typeof keepsAFollowList>>;
  let peers: PeerService;
  let reader: Delegation;

  beforeAll(async () => {
    home = await keepsAFollowList();
    peers = new PeerService(
      new AppConfigService(new ConfigService({ PUBLIC_URL: home.origin })),
      new SyrService(),
    );
    reader = {
      did: ALICE,
      syr_instance_url: home.origin,
      delegate_public_key: "z-delegate",
      access_token: "token",
    };
  });

  afterAll(() => home?.close());

  it("writes a syr identity to the reader's own store, as it always did", async () => {
    await peers.follow(reader, OTHER);
    expect(home.asked).toContain("/api/follows");
  });

  // The routes take a principal so that a follow can be undone; what a store
  // will write down is narrower, and somebody hears that here rather than
  // meeting the store's own refusal.
  it("says a follow list cannot hold an email address, and asks no store", async () => {
    const written = home.asked.filter((path) => path === "/api/follows").length;
    await expect(peers.follow(reader, STRANGER)).rejects.toThrow(
      /follow list cannot hold/,
    );
    expect(home.asked.filter((path) => path === "/api/follows").length).toBe(
      written,
    );
  });
});
