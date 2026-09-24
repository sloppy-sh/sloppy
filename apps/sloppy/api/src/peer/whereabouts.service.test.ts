import { type Server, createServer } from "node:http";
import { createServer as createSocket } from "node:net";
import {
  type DeclaredWhereabouts,
  type PeerOrigin,
  type Principal,
  WHEREABOUTS_DOCUMENT,
} from "@sloppy/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import type { WhereaboutsRepository } from "./whereabouts.repository";
import { WhereaboutsService } from "./whereabouts.service";

const ALICE = "did:syr:z6MktAaaaaaaaaaaaaaaaaaaaaaaa" as Principal;
const BOB = "did:syr:z6MktBbbbbbbbbbbbbbbbbbbbbbbb" as Principal;

/** Where a cloud instance keeps its own credentials: refused whatever a
 *  deployment says about private addresses. */
const METADATA = "http://169.254.169.254";

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

function holding(rows: Record<string, DeclaredWhereabouts>) {
  return {
    find: (principal: Principal) => Promise.resolve(rows[principal] ?? null),
  } as unknown as WhereaboutsRepository;
}

function serving(config: Partial<AppConfigService>) {
  return {
    isProduction: false,
    publicUrl: "https://sloppy.example",
    ...config,
  } as AppConfigService;
}

describe("asking an instance where somebody's graph is", () => {
  let server: Server;
  let origin: PeerOrigin;

  beforeAll(async () => {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}` as PeerOrigin;
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const said = (body: unknown) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(body));
      const at = decodeURIComponent(
        path.slice(path.lastIndexOf("/") + 1),
      ) as Principal;

      if (path.startsWith("/.well-known/sloppy-whereabouts/")) {
        if (at === ALICE) {
          return said({
            type: WHEREABOUTS_DOCUMENT,
            principal: ALICE,
            instance: "https://home.example",
          });
        }
        if (at === BOB) {
          return said({
            type: WHEREABOUTS_DOCUMENT,
            principal: ALICE,
            instance: "https://elsewhere.example",
          });
        }
        res.writeHead(404).end();
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
  });

  afterAll(() => server?.close());

  const reading = () =>
    new WhereaboutsService(
      serving({ publicUrl: "https://sloppy.example" }),
      holding({}),
    );

  it("takes a declaration about the person who was asked about", async () => {
    expect(await reading().whereIs(ALICE, origin)).toEqual({
      answer: "said",
      whereabouts: { principal: ALICE, instance: "https://home.example" },
    });
  });

  it("holds one about somebody else to be nothing, so a server cannot send a reader where it likes", async () => {
    expect(await reading().whereIs(BOB, origin)).toEqual({ answer: "none" });
  });

  it("says nobody there says where they are when nothing is served", async () => {
    const nobody = "did:syr:z6MktCcccccccccccccccccccccc" as Principal;
    expect(await reading().whereIs(nobody, origin)).toEqual({
      answer: "none",
    });
  });

  it("reads its own row rather than asking itself", async () => {
    const here = new WhereaboutsService(
      serving({ publicUrl: origin }),
      holding({
        [ALICE]: {
          created_by: ALICE,
          instance: "https://home.example",
        } as DeclaredWhereabouts,
      }),
    );
    expect(await here.whereIs(ALICE, origin)).toEqual({
      answer: "said",
      whereabouts: { principal: ALICE, instance: "https://home.example" },
    });
  });

  it("reads its own row where the reader named no instance at all", async () => {
    const here = new WhereaboutsService(
      serving({}),
      holding({
        [ALICE]: {
          created_by: ALICE,
          instance: "https://home.example",
        } as DeclaredWhereabouts,
      }),
    );
    expect(await here.instanceFor(ALICE)).toBe("https://home.example");
  });
});

describe("an address a declaration leads to", () => {
  const reading = new WhereaboutsService(
    serving({ publicUrl: "https://sloppy.example" }),
    holding({}),
  );

  it("is refused where it is one no deployment connects to", async () => {
    expect(await reading.whereIs(ALICE, METADATA as PeerOrigin)).toEqual({
      answer: "unreachable",
    });
  });

  it("is refused where a redirect chose it", async () => {
    const port = await freePort();
    const server = createServer((_req, res) =>
      res.writeHead(302, { location: `${METADATA}/latest/meta-data` }).end(),
    );
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
    try {
      expect(
        await reading.whereIs(ALICE, `http://127.0.0.1:${port}` as PeerOrigin),
      ).toEqual({ answer: "unreachable" });
    } finally {
      server.close();
    }
  });

  it("is refused where a deployment will not reach a private address", async () => {
    const port = await freePort();
    const closed = new WhereaboutsService(
      serving({ isProduction: true }),
      holding({}),
    );
    expect(
      await closed.whereIs(ALICE, `http://127.0.0.1:${port}` as PeerOrigin),
    ).toEqual({ answer: "unreachable" });
  });

  it("gives up on an answer that never ends", async () => {
    const port = await freePort();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = "x".repeat(64 * 1024);
      const keepGoing = () => {
        if (res.writableEnded || res.destroyed) return;
        if (res.write(chunk)) setImmediate(keepGoing);
        else res.once("drain", keepGoing);
      };
      res.on("error", () => undefined);
      keepGoing();
    });
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
    try {
      expect(
        await reading.whereIs(ALICE, `http://127.0.0.1:${port}` as PeerOrigin),
      ).toEqual({ answer: "unreachable" });
    } finally {
      server.close();
    }
  }, 30_000);

  it("reads nothing but a declaration out of what came back", async () => {
    const port = await freePort();
    const server = createServer((_req, res) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ instance: "https://elsewhere.example" })),
    );
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
    try {
      expect(
        await reading.whereIs(ALICE, `http://127.0.0.1:${port}` as PeerOrigin),
      ).toEqual({ answer: "none" });
    } finally {
      server.close();
    }
  });
});

describe("which instance a read is made on", () => {
  it("is the one named where no declaration answers", async () => {
    const reading = new WhereaboutsService(
      serving({ publicUrl: "https://sloppy.example" }),
      holding({}),
    );
    const named = `${METADATA}` as PeerOrigin;
    expect(await reading.instanceFor(ALICE, named)).toBe(named);
  });

  it("is this one where nothing is named and nothing is said", async () => {
    const reading = new WhereaboutsService(
      serving({ publicUrl: "https://sloppy.example" }),
      holding({}),
    );
    expect(await reading.instanceFor(ALICE)).toBe("https://sloppy.example");
  });
});
