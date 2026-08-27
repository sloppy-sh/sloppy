// The layout worker's entry. Kept at the package root so a consumer can reach
// it as `@sloppy/graph/layout-worker` — see the README beside this file for the
// two ways to hand one to `mountGraph`.

import type { LayoutCommand, LayoutEvent } from "./layout/protocol.js";
import { serveLayout } from "./layout/serve.js";

// Spelled out rather than pulled in from the WebWorker lib: this package
// compiles against DOM for everything else, and the two libs declare the same
// globals with different types.
interface WorkerScope {
  postMessage(event: LayoutEvent, transfer: Transferable[]): void;
  onmessage: ((message: MessageEvent<LayoutCommand>) => void) | null;
}

const scope = self as unknown as WorkerScope;

const accept = serveLayout(
  (event, transfer) => {
    scope.postMessage(event, transfer);
  },
  { sliceMs: 6 },
);

scope.onmessage = (message: MessageEvent<LayoutCommand>) => {
  accept(message.data);
};
