// The layout service, written once against a pair of plain functions so the
// worker and the main-thread fallback run the same loop. docs/ARCHITECTURE.md
// § "Graph rendering" rules out SharedArrayBuffer and wasm threads, so this is
// ordinary single-threaded JS either way — the only difference is which thread.

import { LayoutEngine } from "./engine.js";
import type { LayoutCommand, LayoutEvent } from "./protocol.js";

export interface LayoutServiceOptions {
  /**
   * Milliseconds of ticking between yields. On the worker it only has to leave
   * room for incoming messages; on the main thread it also has to leave room
   * for the frame that draws the result.
   */
  sliceMs: number;
}

export type LayoutSink = (event: LayoutEvent, transfer: Transferable[]) => void;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** Returns the command sink; call it with everything the host sends. */
export function serveLayout(
  emit: LayoutSink,
  options: LayoutServiceOptions,
): (command: LayoutCommand) => void {
  let engine: LayoutEngine | null = null;
  let epoch = -1;
  let pumping = false;
  let atOnce = false;

  const publish = (settled: boolean): void => {
    if (!engine) return;
    const positions = new Float32Array(engine.positions());
    emit(
      { kind: "positions", epoch, positions, alpha: engine.alpha, settled },
      [positions.buffer],
    );
  };

  const pump = (): void => {
    if (!engine) {
      pumping = false;
      return;
    }
    const until = now() + options.sliceMs;
    do {
      engine.tick();
    } while (!engine.settled && now() < until);

    if (engine.settled) {
      pumping = false;
      publish(true);
      return;
    }
    publish(false);
    setTimeout(pump, 0);
  };

  const wake = (): void => {
    if (pumping || !engine) return;
    pumping = true;
    setTimeout(pump, 0);
  };

  return (command) => {
    if (command.kind === "start") {
      engine = new LayoutEngine(command);
      epoch = command.epoch;
      atOnce = command.settleAtOnce;
      if (atOnce) {
        engine.settle();
        pumping = false;
        publish(true);
        return;
      }
      publish(false);
      wake();
      return;
    }
    if (command.kind === "pin") {
      if (!engine || command.epoch !== epoch) return;
      engine.pin(command.index, command.x, command.y, command.held);
      // Reduced motion is about not watching the field travel to where a change
      // put it. A drag is not that change, so the release is what converges.
      if (atOnce && !command.held) {
        engine.settle();
        publish(true);
        return;
      }
      wake();
      return;
    }
    engine = null;
    pumping = false;
  };
}
