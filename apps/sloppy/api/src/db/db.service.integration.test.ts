// The connection outliving its own access token, and outliving the server it
// was opened against — both measured rather than asserted.
//
// A root token lasts an hour, which is why nothing caught the first one: every
// test and every hand-check finished inside it. A user whose token lasts seconds
// runs the same clock fast, and a query that needs authorization is the whole
// assertion — an unrenewed session answers it with "Anonymous access not
// allowed".
//
// The second runs the server behind a socket this file can shut and reopen, so
// an outage is a real one rather than a fake connection reporting what it was
// told to. What it does not measure is length: recovery does not depend on it,
// and `db.service.test.ts` is where that is pinned.
//
// Skipped when nothing is listening, so a clone without the dev stack still runs
// `pnpm test`. `docker compose up -d` is what turns it on.

import { randomBytes } from "node:crypto";
import {
  type AddressInfo,
  type Server,
  type Socket,
  createConnection,
  createServer,
} from "node:net";
import { Surreal } from "surrealdb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { DbService } from "./db.service";

const ENDPOINT = new URL(
  process.env.SLOPPY_SURREALDB_URL ?? "ws://127.0.0.1:8010/rpc",
);
const ROOT = {
  username: process.env.SURREALDB_USER ?? "root",
  password: process.env.SURREALDB_PASS ?? "sloppy-dev-password",
};

const TOKEN_SECONDS = 5;
const NAMESPACE = "sloppy_test";
const DATABASE = `renewal_${Date.now()}`;
const OUTAGE_DATABASE = `outage_${Date.now()}`;
const USERNAME = `renewal_${Date.now().toString(36)}`;
const PASSWORD = randomBytes(24).toString("base64url");

function port(endpoint: URL): number {
  return Number(endpoint.port) || 8000;
}

function reachable(endpoint: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: endpoint.hostname,
      port: port(endpoint),
    });
    const settle = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until the answer is true, so a recovery is waited for rather than
 *  guessed at. */
async function eventually(
  answer: () => Promise<boolean>,
  within: number,
): Promise<boolean> {
  const until = Date.now() + within;
  while (Date.now() < until) {
    if (await answer()) return true;
    await sleep(500);
  }
  return false;
}

/** The port the service connects through, so a test can take the server away
 *  from underneath it and give it back. */
class Gate {
  #server: Server | undefined;
  readonly #live = new Set<Socket>();

  constructor(
    readonly port: number,
    private readonly target: URL,
  ) {}

  async open(): Promise<void> {
    const server = createServer((client) => {
      const upstream = createConnection({
        host: this.target.hostname,
        port: port(this.target),
      });
      this.#live.add(client).add(upstream);
      const drop = () => {
        client.destroy();
        upstream.destroy();
      };
      client.pipe(upstream);
      upstream.pipe(client);
      for (const socket of [client, upstream]) {
        socket.once("error", drop);
        socket.once("close", drop);
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(this.port, "127.0.0.1", resolve),
    );
    this.#server = server;
  }

  async shut(): Promise<void> {
    for (const socket of this.#live) socket.destroy();
    this.#live.clear();
    const server = this.#server;
    this.#server = undefined;
    if (server) await new Promise<void>((done) => server.close(() => done()));
  }
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const chosen = (probe.address() as AddressInfo).port;
  await new Promise<void>((done) => probe.close(() => done()));
  return chosen;
}

function serving(url: string, database: string): DbService {
  return new DbService(
    {
      surreal: { url, ...ROOT, namespace: NAMESPACE, database },
    } as AppConfigService,
    new Surreal(),
  );
}

describe("a connection older than its access token", () => {
  let listening = false;
  let admin: Surreal | undefined;
  let service: DbService | undefined;

  beforeAll(async () => {
    listening = await reachable(ENDPOINT);
    if (!listening) return;

    admin = new Surreal();
    await admin.connect(ENDPOINT.toString(), { authentication: ROOT });
    // A `DEFINE` statement takes no parameters, so both halves are literals.
    // Both are generated here, and a base64url password needs no escaping.
    await admin.query(
      `DEFINE USER OVERWRITE ${USERNAME} ON ROOT PASSWORD '${PASSWORD}' ROLES OWNER DURATION FOR TOKEN ${TOKEN_SECONDS}s;`,
    );
  }, 30_000);

  afterAll(async () => {
    await service?.onModuleDestroy();
    if (admin) {
      await admin.query(`REMOVE USER IF EXISTS ${USERNAME} ON ROOT;`);
      await admin.use({ namespace: NAMESPACE });
      await admin.query(`REMOVE DATABASE IF EXISTS ${DATABASE};`);
      await admin.close();
    }
  }, 30_000);

  it("is still authorized after the token it opened with has expired", async (ctx) => {
    ctx.skip(!listening, "the dev stack is not up");

    service = new DbService(
      {
        surreal: {
          url: ENDPOINT.toString(),
          username: USERNAME,
          password: PASSWORD,
          namespace: NAMESPACE,
          database: DATABASE,
        },
      } as AppConfigService,
      new Surreal(),
    );
    await service.onModuleInit();
    await expect(service.handle.query("RETURN true")).resolves.toBeDefined();

    await sleep((TOKEN_SECONDS + 4) * 1000);

    await expect(service.handle.query("RETURN true")).resolves.toBeDefined();
    expect(await service.reachable()).toBe(true);
  }, 60_000);
});

describe("a connection whose server goes away", () => {
  let listening = false;
  let admin: Surreal | undefined;
  let gate: Gate | undefined;
  let service: DbService | undefined;

  beforeAll(async () => {
    listening = await reachable(ENDPOINT);
  }, 30_000);

  afterAll(async () => {
    await service?.onModuleDestroy();
    await gate?.shut();
    if (!listening) return;
    admin = new Surreal();
    await admin.connect(ENDPOINT.toString(), { authentication: ROOT });
    await admin.use({ namespace: NAMESPACE });
    await admin.query(`REMOVE DATABASE IF EXISTS ${OUTAGE_DATABASE};`);
    await admin.close();
  }, 30_000);

  it("serves again once the server is back, with nothing restarted", async (ctx) => {
    ctx.skip(!listening, "the dev stack is not up");

    gate = new Gate(await freePort(), ENDPOINT);
    await gate.open();
    service = serving(`ws://127.0.0.1:${gate.port}/rpc`, OUTAGE_DATABASE);
    await service.onModuleInit();
    expect(await service.reachable()).toBe(true);

    await gate.shut();
    expect(await service.reachable()).toBe(false);
    // Work put to a store that is not there is refused rather than queued: a
    // request that never answers is worse than one that says to come back.
    const asked = Date.now();
    await expect(
      Promise.resolve().then(() => service?.handle.query("RETURN true")),
    ).rejects.toThrow();
    expect(Date.now() - asked).toBeLessThan(1000);
    // Long enough to outlast several attempts at opening another one.
    await sleep(3000);
    expect(await service.reachable()).toBe(false);

    await gate.open();
    expect(await eventually(() => service!.reachable(), 30_000)).toBe(true);
    await expect(service.handle.query("RETURN true")).resolves.toBeDefined();
  }, 120_000);
});
