import type { Surreal } from "surrealdb";
import { describe, expect, it, vi } from "vitest";
import type { AppConfigService } from "../config/app-config.service";
import { DbService } from "./db.service";

const SURREAL = {
  url: "ws://127.0.0.1:8010/rpc",
  username: "root",
  password: "a-root-password",
  namespace: "sloppy",
  database: "sloppy",
};

function connection() {
  return {
    connect: vi.fn(async () => true as const),
    signin: vi.fn(async () => ({ access: "a-token" })),
    use: vi.fn(async () => {}),
    query: vi.fn(async () => []),
    subscribe: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  };
}

async function opened(): Promise<ReturnType<typeof connection>> {
  const db = connection();
  const service = new DbService(
    { surreal: SURREAL } as AppConfigService,
    db as unknown as Surreal,
  );
  await service.onModuleInit();
  return db;
}

// The driver renews an expired session on its own, but only for credentials it
// was given at `connect()` and only while nothing else has authenticated the
// session by hand. Both halves have to hold; `db.service.integration.test.ts`
// measures the result.
describe("opening the one connection", () => {
  it("hands the driver the credentials to reuse", async () => {
    const db = await opened();

    expect(db.connect).toHaveBeenCalledWith(SURREAL.url, {
      authentication: {
        username: SURREAL.username,
        password: SURREAL.password,
      },
    });
  });

  it("spends them nowhere else, which would opt the session out of renewal", async () => {
    const db = await opened();

    expect(db.signin).not.toHaveBeenCalled();
  });

  // Named to `connect` instead, the driver selects them before it authenticates,
  // and an anonymous select creates nothing — a first boot against an empty
  // store then fails on the schema it was about to apply.
  it("selects the namespace and database after the credentials, not with them", async () => {
    const db = await opened();

    expect(db.use).toHaveBeenCalledWith({
      namespace: SURREAL.namespace,
      database: SURREAL.database,
    });
  });
});
