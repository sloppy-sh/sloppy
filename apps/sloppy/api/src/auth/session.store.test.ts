import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbService } from "../db/db.service";
import { SessionStore } from "./session.store";

/** A store that has gone away: the driver queues the call for a reconnection
 *  rather than failing it, so nothing ever comes back. */
function silent(): SessionStore {
  const never = () => new Promise(() => {});
  return new SessionStore({
    handle: { select: never, delete: never, query: never },
  } as unknown as DbService);
}

async function raced(work: Promise<unknown>): Promise<unknown> {
  const settled = work.catch((err: unknown) => err);
  await vi.advanceTimersByTimeAsync(5000);
  return settled;
}

describe("a session store that does not answer", () => {
  afterEach(() => vi.useRealTimers());

  // The guard runs before every route, so a lookup that never settles is not one
  // slow request — it is the API answering nothing at all, sign-in included.
  it("gives up on a lookup rather than waiting forever", async () => {
    vi.useFakeTimers();

    expect(await raced(silent().find("a-credential"))).toBeInstanceOf(Error);
  });

  it("gives up on ending a session, so signing out still finishes", async () => {
    vi.useFakeTimers();

    expect(await raced(silent().end("a-credential"))).toBeInstanceOf(Error);
  });
});
