import { describe, expect, it, vi } from "vitest";
import { SloppyClient } from "./index.js";

/** A server that has rejected whatever credential reached it. */
function rejectingClient(token: () => string | undefined) {
  const onAuthInvalid = vi.fn();
  const client = new SloppyClient({
    token,
    fetch: async () => new Response("", { status: 401 }),
    onAuthInvalid,
  });
  return { client, onAuthInvalid };
}

/** Every call here throws; the notice is what is under test. */
const attempt = (p: Promise<unknown>): Promise<unknown> =>
  p.catch(() => undefined);

describe("onAuthInvalid", () => {
  it("collapses a burst of rejections on one credential into one notice", async () => {
    const { client, onAuthInvalid } = rejectingClient(() => "session-a");
    await Promise.all([
      attempt(client.me()),
      attempt(client.listNodes()),
      attempt(client.listPublications()),
    ]);
    expect(onAuthInvalid).toHaveBeenCalledTimes(1);
  });

  it("re-arms on a new session, so the second expiry is reported too", async () => {
    let token = "session-a";
    const { client, onAuthInvalid } = rejectingClient(() => token);
    await attempt(client.me());
    token = "session-b";
    await attempt(client.me());
    expect(onAuthInvalid).toHaveBeenCalledTimes(2);
  });

  it("counts a request carrying no bearer token as its own credential", async () => {
    const { client, onAuthInvalid } = rejectingClient(() => undefined);
    await attempt(client.me());
    await attempt(client.me());
    expect(onAuthInvalid).toHaveBeenCalledTimes(1);
  });
});
