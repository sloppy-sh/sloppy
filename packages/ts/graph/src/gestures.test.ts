import { describe, expect, it } from "vitest";
import {
  attachGestures,
  type GestureHandlers,
  type InkPointer,
} from "./gestures.js";
import { type Point, Viewport } from "./viewport.js";

type Listener = (event: Event) => void;

/**
 * Enough of an element to attach to. The gesture layer only ever reads a
 * bounding box and captures pointers, so a real DOM would only be slower.
 */
function fakeElement() {
  const listeners = new Map<string, Set<Listener>>();
  const captured = new Set<number>();
  return {
    element: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: (id: number) => captured.add(id),
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => captured.delete(id),
      addEventListener: (type: string, listener: Listener) => {
        const set = listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.get(type)?.delete(listener);
      },
    } as unknown as HTMLElement,
    send(type: string, event: Partial<PointerEvent>): void {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as Event);
      }
    },
  };
}

/** A surface whose host can hand the pen somewhere to draw, or take it away. */
function surface() {
  const element = fakeElement();
  const viewport = new Viewport();
  const inked: Point[] = [];
  let onInk: InkPointer | undefined = (_event, world) => inked.push(world);
  const handlers: GestureHandlers = {
    hitTest: () => null,
    onTap: () => {},
    onPress: () => {},
    onDragStart: () => {},
    onDragMove: () => {},
    onDragEnd: () => {},
    onViewportChange: () => {},
    inkTarget: () => onInk,
  };
  attachGestures(element.element, viewport, handlers);

  const send = (
    type: string,
    pointerType: string,
    pointerId: number,
    x: number,
    y: number,
  ): void =>
    element.send(type, {
      pointerId,
      pointerType,
      clientX: x,
      clientY: y,
    } as Partial<PointerEvent>);

  return {
    inked,
    viewport,
    inkInto(handler: InkPointer | undefined): void {
      onInk = handler;
    },
    pen: (type: string, x: number, y: number) => send(type, "pen", 1, x, y),
    finger: (type: string, id: number, x: number, y: number) =>
      send(type, "touch", id, x, y),
  };
}

describe("attachGestures", () => {
  it("inks a pen stroke and leaves the viewport alone", () => {
    const graph = surface();
    graph.pen("pointerdown", 10, 10);
    graph.pen("pointermove", 40, 30);
    graph.pen("pointerup", 40, 30);

    expect(graph.inked).toEqual([
      { x: 10, y: 10 },
      { x: 40, y: 30 },
      { x: 40, y: 30 },
    ]);
    expect(graph.viewport.x).toBe(0);
  });

  // DESIGN.md § "The canvas": a stylus with nowhere to ink pans rather than
  // doing nothing at all.
  it("pans a pen when there is nothing to ink into", () => {
    const graph = surface();
    graph.inkInto(undefined);
    graph.pen("pointerdown", 10, 10);
    graph.pen("pointermove", 40, 10);
    graph.pen("pointerup", 40, 10);

    expect(graph.inked).toEqual([]);
    expect(graph.viewport.x).toBe(30);
  });

  // The editor's ink layer comes and goes under a graph that stays mounted, so
  // which of the two a pen does is the host's to change between strokes.
  it("follows a handler that arrives and departs after mounting", () => {
    const graph = surface();
    const strokes: Point[] = [];
    graph.inkInto(undefined);

    graph.pen("pointerdown", 10, 10);
    graph.pen("pointerup", 10, 10);
    expect(strokes).toEqual([]);
    expect(graph.viewport.x).toBe(0);

    graph.inkInto((_event, world) => strokes.push(world));
    graph.pen("pointerdown", 20, 20);
    graph.pen("pointerup", 20, 20);
    expect(strokes).toHaveLength(2);

    graph.inkInto(undefined);
    graph.pen("pointerdown", 30, 30);
    graph.pen("pointermove", 60, 30);
    graph.pen("pointerup", 60, 30);
    expect(strokes).toHaveLength(2);
    expect(graph.viewport.x).toBe(30);
  });

  it("finishes a stroke through the handler that began it", () => {
    const graph = surface();
    graph.pen("pointerdown", 10, 10);
    graph.inkInto(undefined);
    graph.pen("pointermove", 40, 10);
    graph.pen("pointerup", 40, 10);

    expect(graph.inked).toHaveLength(3);
    expect(graph.viewport.x).toBe(0);

    graph.pen("pointerdown", 10, 10);
    graph.pen("pointermove", 40, 10);
    expect(graph.inked).toHaveLength(3);
    expect(graph.viewport.x).toBe(30);
  });

  it("pans a finger while a pen is inking", () => {
    const graph = surface();
    graph.pen("pointerdown", 0, 0);
    graph.finger("pointerdown", 2, 100, 100);
    graph.finger("pointermove", 2, 120, 100);

    expect(graph.inked).toHaveLength(1);
    expect(graph.viewport.x).toBe(20);
  });
});
