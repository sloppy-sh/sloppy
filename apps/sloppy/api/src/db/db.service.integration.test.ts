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
// Runs where `SLOPPY_INTEGRATION` asks for it and the dev stack answers —
// `src/testing/integration-target.ts` is the gate.

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
import { dropDatabase } from "../testing/drop-database";
import { integrationTarget } from "../testing/integration-target";
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
const REBUILT_DATABASE = `rebuilt_${Date.now()}`;
const PROBE_TABLE = "resilience_probe";
const USERNAME = `renewal_${Date.now().toString(36)}`;
const PASSWORD = randomBytes(24).toString("base64url");

function port(endpoint: URL): number {
  return Number(endpoint.port) || 8000;
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

/** What the store says it has — asked of the store, not of this process. */
async function defines(service: DbService, table: string): Promise<boolean> {
  const [info] =
    await service.handle.query<[{ tables: Record<string, string> }]>(
      "INFO FOR DB",
    );
  return table in info.tables;
}

async function wipe(database: string): Promise<void> {
  const admin = new Surreal();
  await admin.connect(ENDPOINT.toString(), { authentication: ROOT });
  await admin.use({ namespace: NAMESPACE });
  await dropDatabase(admin, database);
  await admin.close();
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
  let runs = false;
  let admin: Surreal | undefined;
  let service: DbService | undefined;

  beforeAll(async () => {
    runs = await integrationTarget(ENDPOINT);
    if (!runs) return;

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
      await dropDatabase(admin, DATABASE);
      await admin.close();
    }
  }, 30_000);

  it("is still authorized after the token it opened with has expired", async (ctx) => {
    ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");

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
    service.onModuleInit();
    await service.whenOpen();
    await expect(service.handle.query("RETURN true")).resolves.toBeDefined();

    await sleep((TOKEN_SECONDS + 4) * 1000);

    await expect(service.handle.query("RETURN true")).resolves.toBeDefined();
    expect(await service.reachable()).toBe(true);
  }, 60_000);
});

describe("a connection whose server goes away", () => {
  let runs = false;
  let gate: Gate | undefined;
  let service: DbService | undefined;

  beforeAll(async () => {
    runs = await integrationTarget(ENDPOINT);
  }, 30_000);

  afterAll(async () => {
    await service?.onModuleDestroy();
    await gate?.shut();
    if (runs) await wipe(OUTAGE_DATABASE);
  }, 30_000);

  it("serves again once the server is back, with nothing restarted", async (ctx) => {
    ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");

    gate = new Gate(await freePort(), ENDPOINT);
    await gate.open();
    service = serving(`ws://127.0.0.1:${gate.port}/rpc`, OUTAGE_DATABASE);
    service.onModuleInit();
    await service.whenOpen();
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

describe("a store rebuilt while the connection was away", () => {
  let runs = false;
  let gate: Gate | undefined;
  let service: DbService | undefined;

  beforeAll(async () => {
    runs = await integrationTarget(ENDPOINT);
  }, 30_000);

  afterAll(async () => {
    await service?.onModuleDestroy();
    await gate?.shut();
    if (runs) await wipe(REBUILT_DATABASE);
  }, 30_000);

  // Every table a module registers is defined by whoever opens the connection,
  // or a store that came back empty is connected to and never filled in: the
  // API reports itself healthy and answers every route with a table that does
  // not exist, until somebody restarts it by hand.
  it("has the schema put back on it, with nothing restarted", async (ctx) => {
    ctx.skip(!runs, "SLOPPY_INTEGRATION is unset");

    gate = new Gate(await freePort(), ENDPOINT);
    await gate.open();
    service = serving(`ws://127.0.0.1:${gate.port}/rpc`, REBUILT_DATABASE);
    service.defineOnOpen((db) =>
      db.query(`DEFINE TABLE IF NOT EXISTS ${PROBE_TABLE} SCHEMALESS;`),
    );
    service.onModuleInit();
    await service.whenOpen();
    expect(await defines(service, PROBE_TABLE)).toBe(true);

    await gate.shut();
    await wipe(REBUILT_DATABASE);
    await gate.open();

    expect(await eventually(() => service!.reachable(), 30_000)).toBe(true);
    expect(await defines(service, PROBE_TABLE)).toBe(true);
  }, 120_000);
});
