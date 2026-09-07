import { type AddressInfo, createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationTarget } from "./integration-target";

const CLOSED = new URL("ws://127.0.0.1:1/rpc");

let open: Server | undefined;

/** An endpoint something is listening at, for the life of the test. */
function opened(): Promise<URL> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    open = server;
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const at = server.address() as AddressInfo;
      resolve(new URL(`ws://127.0.0.1:${at.port}/rpc`));
    });
  });
}

function asked(value: string | undefined): void {
  vi.stubEnv("SLOPPY_INTEGRATION", value);
}

afterEach(() => {
  open?.close();
  open = undefined;
  vi.unstubAllEnvs();
});

describe("the integration gate", () => {
  it("stays shut where nobody asked, whatever is listening", async () => {
    asked(undefined);
    expect(await integrationTarget(await opened())).toBe(false);
  });

  it.each(["", "0", "false"])("reads %o as nobody asking", async (value) => {
    asked(value);
    expect(await integrationTarget(await opened())).toBe(false);
  });

  it("opens where a run asked and something answers", async () => {
    asked("1");
    expect(await integrationTarget(await opened())).toBe(true);
  });

  it("fails the run that asked and found nothing, saying what to start", async () => {
    asked("1");
    await expect(integrationTarget(CLOSED)).rejects.toThrow(
      /nothing is listening at ws:\/\/127\.0\.0\.1:1\/rpc[\s\S]*pnpm stack:up/,
    );
  });

  it("holds every endpoint a suite needs, not just the first", async () => {
    asked("1");
    await expect(integrationTarget(await opened(), CLOSED)).rejects.toThrow(
      /ws:\/\/127\.0\.0\.1:1\/rpc/,
    );
  });
});
