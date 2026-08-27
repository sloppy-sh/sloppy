// The connection outliving its own access token, measured rather than asserted.
//
// A root token lasts an hour, which is why nothing caught this: every test and
// every hand-check finished inside it. A user whose token lasts seconds runs the
// same clock fast, and a query that needs authorization is the whole assertion —
// an unrenewed session answers it with "Anonymous access not allowed".
//
// What this cannot cover: SurrealDB going away and coming back. The driver takes
// the same path for a reconnect as for an expiry, and `db.service.test.ts` pins
// the credentials that path needs, but the socket dropping is a container
// restart and no test here does that.
//
// Skipped when nothing is listening, so a clone without the dev stack still runs
// `pnpm test`. `docker compose up -d` is what turns it on.

import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
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
const USERNAME = `renewal_${Date.now().toString(36)}`;
const PASSWORD = randomBytes(24).toString("base64url");

function reachable(endpoint: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: endpoint.hostname,
      port: Number(endpoint.port) || 8000,
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
