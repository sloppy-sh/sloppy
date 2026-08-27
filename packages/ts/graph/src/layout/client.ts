// The main thread's half of the layout. Prefers a worker and falls back to
// running the same service inline, because a canvas that cannot start a worker
// should settle more roughly, not refuse to draw — the rule DESIGN.md § "The
// canvas" states for ink, applied to layout.

import type { LayoutCommand, LayoutEvent, LayoutStart } from "./protocol.js";
import { serveLayout } from "./serve.js";

export type LayoutMode = "worker" | "inline";

export interface LayoutClientOptions {
  /**
   * Build the layout worker. Vite's own `?worker` import is the shortest one
   * that survives both dev and a production build:
   * `import Layout from '@sloppy/graph/layout-worker?worker'`.
   */
  createWorker?: () => Worker;
  onPositions: (event: LayoutEvent) => void;
}

/** The main thread's slice: small enough to leave the frame its time. */
const INLINE_SLICE_MS = 3;

export class LayoutClient {
  private worker: Worker | null = null;
  private inline: ((command: LayoutCommand) => void) | null = null;
  private latest: LayoutStart | null = null;
  private dead = false;

  constructor(private readonly options: LayoutClientOptions) {
    const worker = options.createWorker ? tryStart(options.createWorker) : null;
    if (!worker) {
      this.startInline();
      return;
    }
    worker.onmessage = (message: MessageEvent<LayoutEvent>) => {
      if (!this.dead) options.onPositions(message.data);
    };
    // A worker that fails after construction — a blocked module fetch, a policy
    // that only bites on load — would otherwise leave the region unsettled with
    // no way back, so the fallback is taken from here too, replaying the model
    // the worker never got to.
    worker.onerror = () => {
      worker.terminate();
      this.worker = null;
      if (this.dead) return;
      this.startInline();
      if (this.latest) this.send(this.latest);
    };
    this.worker = worker;
  }

  get mode(): LayoutMode {
    return this.worker ? "worker" : "inline";
  }

  send(command: LayoutCommand): void {
    if (this.dead) return;
    if (command.kind === "start") this.latest = command;
    if (this.worker) {
      this.worker.postMessage(command);
      return;
    }
    this.inline?.(command);
  }

  destroy(): void {
    this.send({ kind: "stop" });
    this.dead = true;
    this.worker?.terminate();
    this.worker = null;
    this.inline = null;
  }

  private startInline(): void {
    this.inline = serveLayout(
      (event) => {
        // The worker's replies are always a turn away; the inline service's are
        // not, and a caller that gets positions back inside its own `send` has
        // to be re-entrant for no reason.
        queueMicrotask(() => {
          if (!this.dead) this.options.onPositions(event);
        });
      },
      { sliceMs: INLINE_SLICE_MS },
    );
  }
}

function tryStart(create: () => Worker): Worker | null {
  try {
    return create();
  } catch {
    return null;
  }
}
