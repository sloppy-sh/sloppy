// The gate every integration suite in this package opens on. Both halves are
// required: `SLOPPY_INTEGRATION` says the run is meant to exercise a real
// server, and the socket says one is there. Asking for the suites and finding
// nothing is a failed run rather than a skipped one, so a pass can never mean
// that none of them executed — and the variable is hashed by turbo, so a run
// with the stack up cannot be answered from the cache of one without it.

import { createConnection } from "node:net";

const OFF = new Set(["", "0", "false"]);

/** A TCP probe and nothing more, so the only thing that can skip a suite is an
 *  absent server. Everything past the socket is under test. A client cannot
 *  answer this itself: `connect()` to a refused port never settles. */
function listening(endpoint: URL): Promise<boolean> {
  const secure = endpoint.protocol === "wss:" || endpoint.protocol === "https:";
  return new Promise((resolve) => {
    const socket = createConnection({
      host: endpoint.hostname,
      port: Number(endpoint.port) || (secure ? 443 : 80),
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

/** Whether the suites needing every one of `endpoints` are to run. Throws where
 *  they were asked for and one of them answers nothing. */
export async function integrationTarget(...endpoints: URL[]): Promise<boolean> {
  const asked = process.env.SLOPPY_INTEGRATION;
  if (asked === undefined || OFF.has(asked)) return false;
  for (const endpoint of endpoints) {
    if (await listening(endpoint)) continue;
    throw new Error(
      `SLOPPY_INTEGRATION asked for the integration suites, and nothing is listening at ${endpoint.href}. Start the dev stack with \`pnpm stack:up\`, or unset it to skip them.`,
    );
  }
  return true;
}
