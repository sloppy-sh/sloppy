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

export interface GestureHandlers {
  /** What is under this world point, if anything. */
  hitTest(world: Point): string | null;
  onTap(target: string | null, world: Point): void;
  /** A held finger on a node — the collapse gesture, never a drag. */
  onPress(target: string): void;
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
  startedAt: number;
  target: string | null;
  moved: boolean;
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
  let dragging: { id: number; target: string } | null = null;
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
      startedAt: performance.now(),
      target,
      moved: false,
    });

    const held = touches();
    if (held.length === 2) {
      cancelPress();
      pinchSpan = span(held);
      return;
    }
    if (target === null) return;

    if (event.pointerType === "mouse") {
      dragging = { id: event.pointerId, target };
      handlers.onDragStart(target, viewport.toWorld(at.x, at.y));
      return;
    }
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const entry = active.get(event.pointerId);
      if (entry && !entry.moved) handlers.onPress(target);
    }, PRESS_MS);
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

    if (dragging && dragging.id === event.pointerId) {
      handlers.onDragMove(dragging.target, viewport.toWorld(at.x, at.y));
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

    if (dragging && dragging.id === event.pointerId) {
      handlers.onDragEnd(dragging.target);
      dragging = null;
      if (entry.moved) return;
    }

    const quick = performance.now() - entry.startedAt < TAP_MS;
    if (!entry.moved && quick) {
      handlers.onTap(
        entry.target,
        viewport.toWorld(entry.screenX, entry.screenY),
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

  return () => {
    cancelPress();
    strokes.clear();
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("wheel", onWheel);
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
