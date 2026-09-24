import { RecordId } from "surrealdb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbService } from "../db/db.service";
import {
  SESSION_TABLE,
  type SessionRow,
  SessionStore,
  delegationOf,
  viewerOf,
} from "./session.store";

/** A store on the far end of a socket that has not noticed it went: the call is
 *  written, and nothing ever comes back. */
function silent(): SessionStore {
  const never = () => new Promise(() => {});
  return new SessionStore({
    defineOnOpen: () => undefined,
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

const ROW = {
  id: new RecordId(SESSION_TABLE, "a-digest"),
  created_by: "did:syr:z6MkSomebody",
  expires_at: "2099-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} satisfies SessionRow;

const DELEGATED = {
  ...ROW,
  syr_instance_url: "https://syr.is",
  delegate_public_key: "z6MkDelegate",
  access_token: "a-token",
} satisfies SessionRow;

describe("what a session is the public half of", () => {
  it("names where the identity lives, on one that was delegated", () => {
    expect(viewerOf(DELEGATED)).toEqual({
      did: DELEGATED.created_by,
      syr_instance_url: "https://syr.is",
      delegate_public_key: "z6MkDelegate",
    });
    expect(delegationOf(DELEGATED)).toMatchObject({ access_token: "a-token" });
  });

  // Signed in by signature: there is no store to name and no key Sloppy holds,
  // so a route that acts on one has nothing to act with.
  it("names nothing beside the identity, on one that was signed for", () => {
    expect(
      viewerOf({ ...ROW, created_by: "mailto:alice@example.com" }),
    ).toEqual({
      did: "mailto:alice@example.com",
    });
    expect(delegationOf(ROW)).toBeUndefined();
  });

  // Half a delegation acts as none: a row that lost a column is not one to
  // spend a credential against.
  it("names nothing where only part of a delegation is there", () => {
    const { access_token: _spent, ...half } = DELEGATED;

    expect(delegationOf(half)).toBeUndefined();
    expect(viewerOf(half)).toEqual({ did: DELEGATED.created_by });
  });
});
