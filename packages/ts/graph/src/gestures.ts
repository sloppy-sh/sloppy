// Pen draws, touch pans. DESIGN.md § "The canvas": WKWebView drives one pointer
// type at a time, so the split falls out of the platform and there is no mode
// toggle to find. Everything here reads `pointerType` and nothing here reads a
// setting.

import type { Point, Viewport } from "./viewport.js";

/** A tap has to survive a finger that rolls; a drag has to start before this. */
const TAP_SLOP = 10;
const TAP_MS = 450;
const PRESS_MS = 480;
const WHEEL_ZOOM = 0.0016;
const PINCH_ZOOM = 0.008;

export type InkPointer = (event: PointerEvent, world: Point) => void;

/** In element coordinates, which is what a layer over the canvas draws in. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GestureHandlers {
  /** What is under this world point, if anything. */
  hitTest(world: Point): string | null;
  /** `withModifier` is shift, control or command held as the tap landed. */
  onTap(target: string | null, world: Point, withModifier: boolean): void;
  /**
   * A right-click, or a press held still long enough to be one. `null` is bare
   * canvas. The point is the viewport's, so a menu can be placed against it.
   *
   * The pointer that raised this is spent: it will not go on to pan or to tap,
   * because a finger that has already been answered must not answer twice.
   */
  onPress(
    target: string | null,
    at: { clientX: number; clientY: number },
  ): void;
  /** Whether a modifier-held drag over bare canvas sweeps instead of panning. */
  canSweep(): boolean;
  /** The box such a drag has swept so far, and whether it has let go. */
  onSweep(box: ScreenBox, done: boolean): void;
  /** A mouse carrying a node, sent once the pointer has moved off the tap. */
  onDragStart(target: string, world: Point): void;
  onDragMove(target: string, world: Point): void;
  onDragEnd(target: string): void;
  onViewportChange(): void;
  /**
   * Where a pen stroke goes, asked as the pen goes down so a stroke finishes
   * through the handler that took its first event. `undefined` is a surface
   * with nothing to ink into, and a stylus falls back to panning rather than
   * doing nothing at all.
   */
  inkTarget(): InkPointer | undefined;
}

interface Tracked {
  type: string;
  screenX: number;
  screenY: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  startedAt: number;
  target: string | null;
  moved: boolean;
  withModifier: boolean;
}

const withModifier = (event: PointerEvent | MouseEvent): boolean =>
  event.shiftKey || event.ctrlKey || event.metaKey;

function boxBetween(a: Point, b: Point): ScreenBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function attachGestures(
  element: HTMLElement,
  viewport: Viewport,
  handlers: GestureHandlers,
): () => void {
  const active = new Map<number, Tracked>();
  const strokes = new Map<number, InkPointer>();
  let rect = element.getBoundingClientRect();
  let pinchSpan = 0;
  let grabbed: { id: number; target: string; dragging: boolean } | null = null;
  let swept: { id: number; from: Point; sweeping: boolean } | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshRect = (): void => {
    rect = element.getBoundingClientRect();
  };

  const local = (event: PointerEvent): Point => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });

  const cancelPress = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };

  const touches = (): Tracked[] =>
    [...active.values()].filter((entry) => entry.type !== "pen");

  const onPointerDown = (event: PointerEvent): void => {
    refreshRect();
    const at = local(event);
    const ink = event.pointerType === "pen" ? handlers.inkTarget() : undefined;
    if (ink) {
      strokes.set(event.pointerId, ink);
      ink(event, viewport.toWorld(at.x, at.y));
      return;
    }
    // The right button asks for the menu, which `contextmenu` answers; letting
    // it through here would take hold of the note under it as well.
    if (event.pointerType === "mouse" && event.button !== 0) return;

    // Throws for a pointer the element never saw go down, which a synthetic
    // event and a pointer the platform has already cancelled both are.
    try {
      element.setPointerCapture(event.pointerId);
    } catch {}
    const target = handlers.hitTest(viewport.toWorld(at.x, at.y));
    active.set(event.pointerId, {
      type: event.pointerType,
      screenX: at.x,
      screenY: at.y,
      startX: at.x,
      startY: at.y,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: performance.now(),
      target,
      moved: false,
      withModifier: withModifier(event),
    });

    const held = touches();
    if (held.length === 2) {
      cancelPress();
      pinchSpan = span(held);
      return;
    }

    if (event.pointerType === "mouse") {
      if (target !== null) {
        grabbed = { id: event.pointerId, target, dragging: false };
      } else if (withModifier(event) && handlers.canSweep()) {
        swept = { id: event.pointerId, from: at, sweeping: false };
      }
      return;
    }
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const entry = active.get(event.pointerId);
      if (!entry || entry.moved) return;
      // Spent: the pointer leaves `active`, so the rest of this gesture neither
      // pans nor lands as a tap on the menu that has just opened over it.
      active.delete(event.pointerId);
      handlers.onPress(target, {
        clientX: entry.clientX,
        clientY: entry.clientY,
      });
    }, PRESS_MS);
  };

  const onContextMenu = (event: MouseEvent): void => {
    refreshRect();
    event.preventDefault();
    const world = viewport.toWorld(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    handlers.onPress(handlers.hitTest(world), {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  const onPointerMove = (event: PointerEvent): void => {
    const stroke = strokes.get(event.pointerId);
    if (stroke) {
      const at = local(event);
      stroke(event, viewport.toWorld(at.x, at.y));
      return;
    }
    const entry = active.get(event.pointerId);
    if (!entry) return;

    const at = local(event);
    const dx = at.x - entry.screenX;
    const dy = at.y - entry.screenY;
    entry.screenX = at.x;
    entry.screenY = at.y;
    if (Math.hypot(at.x - entry.startX, at.y - entry.startY) > TAP_SLOP) {
      entry.moved = true;
      cancelPress();
    }

    if (swept && swept.id === event.pointerId) {
      if (swept.sweeping || entry.moved) {
        swept.sweeping = true;
        handlers.onSweep(boxBetween(swept.from, at), false);
      }
      return;
    }

    // A drag starts on the move, never on the button: taking hold of a note
    // stops the canvas framing itself and holds the rest of the field still,
    // and a click that never moves has asked for neither.
    if (grabbed && grabbed.id === event.pointerId) {
      const world = viewport.toWorld(at.x, at.y);
      if (grabbed.dragging) handlers.onDragMove(grabbed.target, world);
      else if (entry.moved) {
        grabbed.dragging = true;
        handlers.onDragStart(grabbed.target, world);
      }
      return;
    }

    const held = touches();
    if (held.length >= 2) {
      const [first, second] = held;
      const centre = {
        x: (first.screenX + second.screenX) / 2,
        y: (first.screenY + second.screenY) / 2,
      };
      const next = span(held);
      if (pinchSpan > 0 && next > 0) {
        viewport.zoomAt(centre.x, centre.y, next / pinchSpan);
      }
      pinchSpan = next;
      viewport.panBy(dx / 2, dy / 2);
      handlers.onViewportChange();
      return;
    }

    viewport.panBy(dx, dy);
    handlers.onViewportChange();
  };

  const onPointerUp = (event: PointerEvent): void => {
    const stroke = strokes.get(event.pointerId);
    if (stroke) {
      strokes.delete(event.pointerId);
      const at = local(event);
      stroke(event, viewport.toWorld(at.x, at.y));
      return;
    }
    const entry = active.get(event.pointerId);
    active.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    cancelPress();
    pinchSpan = touches().length === 2 ? span(touches()) : 0;
    if (!entry) return;

    if (swept && swept.id === event.pointerId) {
      const sweeping = swept.sweeping;
      const from = swept.from;
      swept = null;
      if (sweeping) {
        handlers.onSweep(boxBetween(from, local(event)), true);
        return;
      }
    }

    if (grabbed && grabbed.id === event.pointerId) {
      if (grabbed.dragging) handlers.onDragEnd(grabbed.target);
      grabbed = null;
      if (entry.moved) return;
    }

    const quick = performance.now() - entry.startedAt < TAP_MS;
    if (!entry.moved && quick) {
      handlers.onTap(
        entry.target,
        viewport.toWorld(entry.screenX, entry.screenY),
        entry.withModifier,
      );
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    refreshRect();
    const rate = event.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM;
    viewport.zoomAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      Math.exp(-event.deltaY * rate),
    );
    handlers.onViewportChange();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("contextmenu", onContextMenu);

  return () => {
    cancelPress();
    strokes.clear();
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("contextmenu", onContextMenu);
  };
}

function span(held: readonly Tracked[]): number {
  const [first, second] = held;
  if (!first || !second) return 0;
  return Math.hypot(
    first.screenX - second.screenX,
    first.screenY - second.screenY,
  );
}
