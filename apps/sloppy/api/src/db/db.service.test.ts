import { ConnectionUnavailableError, type Surreal } from "surrealdb";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const heard = new Map<string, Set<() => void>>();
  return {
    status: "connected" as string,
    connect: vi.fn(async () => true as const),
    signin: vi.fn(async () => ({ access: "a-token" })),
    use: vi.fn(async () => {}),
    query: vi.fn(async () => []),
    subscribe: vi.fn((event: string, listener: () => void) => {
      const listeners = heard.get(event) ?? new Set<() => void>();
      listeners.add(listener);
      heard.set(event, listeners);
      return () => listeners.delete(listener);
    }),
    close: vi.fn(async () => {}),
    /** What the driver publishes when it has stopped holding a connection. */
    publish(event: string) {
      for (const listener of [...(heard.get(event) ?? [])]) listener();
    },
  };
}

const running: DbService[] = [];

function serving(db: ReturnType<typeof connection>): DbService {
  const service = new DbService(
    { surreal: SURREAL } as AppConfigService,
    db as unknown as Surreal,
  );
  running.push(service);
  return service;
}

async function opened(): Promise<{
  db: ReturnType<typeof connection>;
  service: DbService;
}> {
  const db = connection();
  const service = serving(db);
  service.onModuleInit();
  await service.whenOpen();
  return { db, service };
}

// Left running, a service goes on retrying on real timers that hold this
// process open — which is the point of them, and would hang the suite.
afterEach(async () => {
  for (const service of running.splice(0)) await service.onModuleDestroy();
  vi.useRealTimers();
});

// The driver renews an expired session on its own, but only for credentials it
// was given at `connect()` and only while nothing else has authenticated the
// session by hand. Both halves have to hold; `db.service.integration.test.ts`
// measures the result.
describe("opening the one connection", () => {
  it("hands the driver the credentials to reuse", async () => {
    const { db } = await opened();

    expect(db.connect).toHaveBeenCalledWith(SURREAL.url, {
      authentication: {
        username: SURREAL.username,
        password: SURREAL.password,
      },
      reconnect: false,
    });
  });

  it("spends them nowhere else, which would opt the session out of renewal", async () => {
    const { db } = await opened();

    expect(db.signin).not.toHaveBeenCalled();
  });

  // Named to `connect` instead, the driver selects them before it authenticates,
  // and an anonymous select creates nothing — a first boot against an empty
  // store then fails on the schema it was about to apply.
  it("selects the namespace and database after the credentials, not with them", async () => {
    const { db } = await opened();

    expect(db.use).toHaveBeenCalledWith({
      namespace: SURREAL.namespace,
      database: SURREAL.database,
    });
  });
});

describe("a store that is not there when the API starts", () => {
  // The API is the only way into the product, so a boot that waits for the
  // store is one where an outage leaves nothing listening at all — no sign-in,
  // no health, and no word of why.
  it("does not hold up the rest of the boot", async () => {
    const db = connection();
    db.connect.mockRejectedValue(new Error("connection refused"));
    const service = serving(db);

    service.onModuleInit();
    await vi.waitFor(() => expect(db.connect).toHaveBeenCalled());

    expect(() => service.handle).toThrow(ConnectionUnavailableError);
    expect(await service.reachable()).toBe(false);
  });

  it("is waited for by a caller with nothing else to do", async () => {
    const db = connection();
    let refuse = true;
    db.connect.mockImplementation(async () => {
      if (refuse) throw new Error("connection refused");
      return true as const;
    });
    const service = serving(db);
    service.onModuleInit();

    let open = false;
    void service.whenOpen().then(() => {
      open = true;
    });
    await vi.waitFor(() => expect(db.connect).toHaveBeenCalled());
    expect(open).toBe(false);

    refuse = false;
    await service.whenOpen();
    expect(open).toBe(true);
  });
});

describe("a connection that is gone", () => {
  it("is replaced without anybody restarting anything", async () => {
    const { db } = await opened();

    db.publish("disconnected");
    await vi.waitFor(() => expect(db.connect).toHaveBeenCalledTimes(2));
  });

  // A store can be rebuilt while the API is not looking — the dev stack's own
  // reset does exactly that — and it comes back with nothing defined on it.
  it("applies the schema to whatever it opens, not only to the first one", async () => {
    const { db } = await opened();
    const applied = db.query.mock.calls.length;

    db.publish("disconnected");
    await vi.waitFor(() =>
      expect(db.query.mock.calls.length).toBeGreaterThan(applied),
    );
  });

  // The session table and the identity tables are registered by their own
  // modules, and a reopen that leaves them behind is an API that answers every
  // route with a table that does not exist.
  it("applies the schema every module registered, not only the core one", async () => {
    const db = connection();
    const service = serving(db);
    const mine = vi.fn(async () => {});
    service.defineOnOpen(mine);

    service.onModuleInit();
    await service.whenOpen();
    expect(mine).toHaveBeenCalledTimes(1);

    db.publish("disconnected");
    await vi.waitFor(() => expect(mine).toHaveBeenCalledTimes(2));
  });

  it("is refused work until the schema is on the store it just opened", async () => {
    const db = connection();
    const service = serving(db);
    let define!: () => void;
    const held = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          define = resolve;
        }),
    );
    service.defineOnOpen(held);

    service.onModuleInit();
    await vi.waitFor(() => expect(held).toHaveBeenCalled());
    expect(() => service.handle).toThrow(ConnectionUnavailableError);

    define();
    await service.whenOpen();
    expect(() => service.handle).not.toThrow();
  });

  // The driver's own loop stops after five tries, and an outage of a minute is
  // an ordinary one: rebuilding the dev stack takes several.
  it("keeps trying for as long as the server is away", async () => {
    vi.useFakeTimers();
    const { db } = await opened();

    let refusals = 20;
    db.connect.mockImplementation(async () => {
      if (refusals-- > 0) throw new Error("connection refused");
      return true as const;
    });
    db.publish("disconnected");
    for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += 20_000) {
      await vi.advanceTimersByTimeAsync(20_000);
    }

    expect(db.connect.mock.calls.length).toBeGreaterThan(21);
    expect(db.use).toHaveBeenCalledTimes(2);
  });

  // Every operation the driver is asked for while it has no connection waits on
  // one, and a connection that failed to open never arrives — so the call is
  // neither sent nor failed, and whoever is waiting on the request is not
  // answered at all.
  it("is refused work rather than given a connection that is not there", async () => {
    const { db, service } = await opened();
    db.status = "connecting";

    expect(() => service.handle).toThrow();
  });

  it("is left alone once the process is stopping", async () => {
    const { db, service } = await opened();
    await service.onModuleDestroy();

    db.publish("disconnected");
    await Promise.resolve();

    expect(db.connect).toHaveBeenCalledTimes(1);
  });
});
