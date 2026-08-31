import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachGestures,
  type GestureHandlers,
  type InkPointer,
  type ScreenBox,
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

interface Pressed {
  target: string | null;
  clientX: number;
  clientY: number;
}

/** A surface whose host can hand the pen somewhere to draw, or take it away. */
function surface() {
  const element = fakeElement();
  const viewport = new Viewport();
  const inked: Point[] = [];
  const tapped: { target: string | null; withModifier: boolean }[] = [];
  const pressed: Pressed[] = [];
  const swept: { box: ScreenBox; done: boolean }[] = [];
  const rested: (string | null)[] = [];
  let onInk: InkPointer | undefined = (_event, world) => inked.push(world);
  let under: string | null = null;
  let sweepable = true;
  const handlers: GestureHandlers = {
    hitTest: () => under,
    onTap: (target, _world, withModifier) =>
      tapped.push({ target, withModifier }),
    onPress: (target, at) => pressed.push({ target, ...at }),
    onHover: (target) => rested.push(target),
    canSweep: () => sweepable,
    onSweep: (box, done) => swept.push({ box, done }),
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
    modifiers: Partial<PointerEvent> = {},
  ): void =>
    element.send(type, {
      pointerId,
      pointerType,
      button: 0,
      clientX: x,
      clientY: y,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...modifiers,
    } as Partial<PointerEvent>);

  return {
    inked,
    tapped,
    pressed,
    swept,
    rested,
    viewport,
    inkInto(handler: InkPointer | undefined): void {
      onInk = handler;
    },
    over(target: string | null): void {
      under = target;
    },
    sweepsInto(allowed: boolean): void {
      sweepable = allowed;
    },
    pen: (type: string, x: number, y: number) => send(type, "pen", 1, x, y),
    finger: (type: string, id: number, x: number, y: number) =>
      send(type, "touch", id, x, y),
    mouse: (
      type: string,
      x: number,
      y: number,
      modifiers: Partial<PointerEvent> = {},
    ) => send(type, "mouse", 3, x, y, modifiers),
    wheel: (x: number, y: number) =>
      element.send("wheel", {
        clientX: x,
        clientY: y,
        deltaY: -100,
        preventDefault: () => {},
      } as unknown as Partial<PointerEvent>),
    contextMenu: (x: number, y: number) => {
      let prevented = false;
      element.send("contextmenu", {
        clientX: x,
        clientY: y,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as Partial<PointerEvent>);
      return prevented;
    },
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

describe("asking for the menu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("raises it where a finger was held, on the note under it", () => {
    const graph = surface();
    graph.over("1a");
    graph.finger("pointerdown", 1, 40, 60);
    vi.advanceTimersByTime(600);

    expect(graph.pressed).toEqual([{ target: "1a", clientX: 40, clientY: 60 }]);
  });

  // Bare canvas is where the acts on what is already chosen live, so the hold
  // has to be answered there too.
  it("raises it on bare canvas", () => {
    const graph = surface();
    graph.finger("pointerdown", 1, 10, 10);
    vi.advanceTimersByTime(600);

    expect(graph.pressed).toEqual([{ target: null, clientX: 10, clientY: 10 }]);
  });

  // A hold that becomes a pan is a pan: the promotion past TAP_SLOP is the same
  // one a drag is promoted by.
  it("leaves a hold that moves off as a pan", () => {
    const graph = surface();
    graph.over("1a");
    graph.finger("pointerdown", 1, 40, 60);
    graph.finger("pointermove", 1, 90, 60);
    vi.advanceTimersByTime(600);

    expect(graph.pressed).toEqual([]);
    expect(graph.viewport.x).toBe(50);
  });

  // The finger that opened the menu is spent: panning on through it would drag
  // the field out from under the menu it just raised.
  it("takes the rest of that gesture away from the canvas", () => {
    const graph = surface();
    graph.finger("pointerdown", 1, 40, 60);
    vi.advanceTimersByTime(600);
    graph.finger("pointermove", 1, 140, 60);
    graph.finger("pointerup", 1, 140, 60);

    expect(graph.viewport.x).toBe(0);
    expect(graph.tapped).toEqual([]);
  });

  it("answers the right button, and never lets the browser's menu through", () => {
    const graph = surface();
    graph.over("2");
    expect(graph.contextMenu(120, 30)).toBe(true);
    expect(graph.pressed).toEqual([{ target: "2", clientX: 120, clientY: 30 }]);
  });

  it("leaves the note under a right button alone", () => {
    const graph = surface();
    graph.over("2");
    graph.mouse("pointerdown", 10, 10, { button: 2 });
    graph.mouse("pointermove", 60, 10, { button: -1 });

    expect(graph.viewport.x).toBe(0);
  });

  // macOS asks for the menu with ctrl and the left button, so the same click
  // arrives as a modifier-held press on the note under it. One click, one
  // answer: the menu takes it, and the note is not also taken hold of.
  it("leaves the note under a ctrl+click to the menu alone", () => {
    const graph = surface();
    graph.over("1a");
    graph.mouse("pointerdown", 10, 10, { ctrlKey: true });
    graph.contextMenu(10, 10);
    graph.mouse("pointerup", 10, 10, { ctrlKey: true });

    expect(graph.pressed).toEqual([{ target: "1a", clientX: 10, clientY: 10 }]);
    expect(graph.tapped).toEqual([]);
  });

  it("holds the field still under a ctrl+drag that opened the menu", () => {
    const graph = surface();
    graph.mouse("pointerdown", 20, 20, { ctrlKey: true });
    graph.contextMenu(20, 20);
    graph.mouse("pointermove", 80, 100, { ctrlKey: true });
    graph.mouse("pointerup", 80, 100, { ctrlKey: true });

    expect(graph.swept).toEqual([]);
    expect(graph.viewport.x).toBe(0);
    expect(graph.pressed).toEqual([{ target: null, clientX: 20, clientY: 20 }]);
  });

  // A sweep already under way has been answered. The menu that arrives on top
  // of it neither opens nor takes the box away from the reader drawing it.
  it("stays out of a sweep already under way", () => {
    const graph = surface();
    graph.mouse("pointerdown", 20, 20, { shiftKey: true });
    graph.mouse("pointermove", 80, 100, { shiftKey: true });
    graph.contextMenu(80, 100);
    graph.mouse("pointerup", 80, 100, { shiftKey: true });

    expect(graph.pressed).toEqual([]);
    expect(graph.swept.at(-1)).toEqual({
      box: { x: 20, y: 20, width: 60, height: 80 },
      done: true,
    });
  });
});

describe("choosing several", () => {
  it("says which taps were asking to add rather than to open", () => {
    const graph = surface();
    graph.over("1a");
    graph.mouse("pointerdown", 10, 10);
    graph.mouse("pointerup", 10, 10);
    graph.mouse("pointerdown", 10, 10, { metaKey: true });
    graph.mouse("pointerup", 10, 10, { metaKey: true });

    expect(graph.tapped).toEqual([
      { target: "1a", withModifier: false },
      { target: "1a", withModifier: true },
    ]);
  });

  it("sweeps a box over bare canvas with a modifier held", () => {
    const graph = surface();
    graph.mouse("pointerdown", 20, 20, { shiftKey: true });
    graph.mouse("pointermove", 80, 100);
    graph.mouse("pointerup", 80, 100);

    expect(graph.swept).toEqual([
      { box: { x: 20, y: 20, width: 60, height: 80 }, done: false },
      { box: { x: 20, y: 20, width: 60, height: 80 }, done: true },
    ]);
    expect(graph.viewport.x).toBe(0);
  });

  // The one thing a marquee must never cost. A bare drag is still the pan it
  // has always been, and so is a modifier drag on a surface with no set to add to.
  it("leaves a drag over bare canvas panning", () => {
    const graph = surface();
    graph.mouse("pointerdown", 20, 20);
    graph.mouse("pointermove", 80, 20);

    expect(graph.swept).toEqual([]);
    expect(graph.viewport.x).toBe(60);

    graph.sweepsInto(false);
    graph.mouse("pointerdown", 20, 20, { shiftKey: true });
    graph.mouse("pointermove", 80, 20);

    expect(graph.swept).toEqual([]);
    expect(graph.viewport.x).toBe(120);
  });

  it("stays a click where the sweep never left the tap", () => {
    const graph = surface();
    graph.mouse("pointerdown", 20, 20, { shiftKey: true });
    graph.mouse("pointerup", 22, 21, { shiftKey: true });

    expect(graph.swept).toEqual([]);
    expect(graph.tapped).toEqual([{ target: null, withModifier: true }]);
  });
});

// DESIGN.md § "The canvas": a preview is an addition for a pointer, so a finger
// never raises one and no gesture leaves one standing.
describe("resting a pointer on a mark", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("answers after a moment, and lets go where the pointer does", () => {
    const graph = surface();
    graph.over("1a");
    graph.mouse("pointermove", 40, 60);
    expect(graph.rested).toEqual([]);

    vi.advanceTimersByTime(500);
    expect(graph.rested).toEqual(["1a"]);

    graph.over(null);
    graph.mouse("pointermove", 300, 60);
    expect(graph.rested).toEqual(["1a", null]);
  });

  it("says nothing for a mark crossed on the way somewhere else", () => {
    const graph = surface();
    graph.over("1a");
    graph.mouse("pointermove", 40, 60);
    vi.advanceTimersByTime(200);
    graph.over("1b");
    graph.mouse("pointermove", 90, 60);
    vi.advanceTimersByTime(200);
    expect(graph.rested).toEqual([]);

    vi.advanceTimersByTime(300);
    expect(graph.rested).toEqual(["1b"]);
  });

  it("holds through a jog that stays on the same mark", () => {
    const graph = surface();
    graph.over("1a");
    graph.mouse("pointermove", 40, 60);
    vi.advanceTimersByTime(500);
    graph.mouse("pointermove", 42, 61);

    expect(graph.rested).toEqual(["1a"]);
  });

  it("never answers a finger, whatever it rests on", () => {
    const graph = surface();
    graph.over("1a");
    graph.finger("pointermove", 1, 40, 60);
    vi.advanceTimersByTime(1_000);

    expect(graph.rested).toEqual([]);
  });

  it("lets go the moment a pan, a zoom or the menu begins", () => {
    for (const begin of [
      (graph: ReturnType<typeof surface>) => graph.mouse("pointerdown", 41, 61),
      (graph: ReturnType<typeof surface>) => graph.contextMenu(41, 61),
      (graph: ReturnType<typeof surface>) => graph.wheel(41, 61),
    ]) {
      const graph = surface();
      graph.over("1a");
      graph.mouse("pointermove", 41, 61);
      vi.advanceTimersByTime(500);
      expect(graph.rested).toEqual(["1a"]);

      begin(graph);
      expect(graph.rested).toEqual(["1a", null]);
    }
  });

  it("stays quiet while a gesture is under way", () => {
    const graph = surface();
    graph.over("1a");
    graph.mouse("pointerdown", 40, 60);
    graph.mouse("pointermove", 120, 60);
    vi.advanceTimersByTime(1_000);

    expect(graph.rested).toEqual([]);
  });
});
