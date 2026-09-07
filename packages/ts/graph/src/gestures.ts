// Pen draws, touch pans. DESIGN.md § "The canvas": WKWebView drives one pointer
// type at a time, so the split falls out of the platform and there is no mode
// toggle to find. Everything here reads `pointerType` and nothing here reads a
// setting.

import type { Point, Viewport } from "./viewport.js";

/** A tap has to survive a finger that rolls; a drag has to start before this. */
const TAP_SLOP = 10;
const TAP_MS = 450;
const PRESS_MS = 480;
/** How long a pointer rests on a mark before the canvas answers for it. Long
 *  enough that crossing the field on the way somewhere else says nothing. */
const HOVER_MS = 400;
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
  /**
   * A mark a mouse has rested on, and `null` the moment it leaves one or any
   * gesture starts. A finger never raises this: a touch reader has the tap and
   * the press, and neither of them waits.
   */
  onHover(target: string | null): void;
  /** Whether a modifier-held drag over bare canvas sweeps instead of panning. */
  canSweep(): boolean;
  /** Whether one finger over bare canvas sweeps instead of panning. Absent
   *  means a finger pans. */
  canSweepByFinger?(): boolean;
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
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverTarget: string | null = null;
  let hovering = false;

  const refreshRect = (): void => {
    rect = element.getBoundingClientRect();
  };

  const dropHover = (): void => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
    hoverTarget = null;
    if (!hovering) return;
    hovering = false;
    handlers.onHover(null);
  };

  const restOn = (target: string | null): void => {
    if (target === hoverTarget) return;
    dropHover();
    if (target === null) return;
    hoverTarget = target;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      hovering = true;
      handlers.onHover(target);
    }, HOVER_MS);
  };

  const local = (event: PointerEvent): Point => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });

  /** Throws for a pointer the element never saw go down, which a synthetic event
   *  and a pointer the platform has already cancelled both are. */
  const hold = (pointerId: number): void => {
    try {
      element.setPointerCapture(pointerId);
    } catch {}
  };

  const letGo = (pointerId: number): void => {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  };

  const cancelPress = (): void => {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
  };

  /** What was drawn stands: a sweep adds to a choice, it never replaces it. */
  const endSweep = (): void => {
    const drawn = swept;
    swept = null;
    if (!drawn?.sweeping) return;
    const at = active.get(drawn.id);
    handlers.onSweep(
      boxBetween(
        drawn.from,
        at ? { x: at.screenX, y: at.screenY } : drawn.from,
      ),
      true,
    );
  };

  const touches = (): Tracked[] =>
    [...active.values()].filter((entry) => entry.type !== "pen");

  const onPointerDown = (event: PointerEvent): void => {
    refreshRect();
    dropHover();
    const at = local(event);
    const ink = event.pointerType === "pen" ? handlers.inkTarget() : undefined;
    if (ink) {
      // A stroke that wanders off the field finishes where it was drawn rather
      // than stopping at the edge and never being lifted.
      hold(event.pointerId);
      strokes.set(event.pointerId, ink);
      ink(event, viewport.toWorld(at.x, at.y));
      return;
    }
    // The right button asks for the menu, which `contextmenu` answers; letting
    // it through here would take hold of the note under it as well.
    if (event.pointerType === "mouse" && event.button !== 0) return;

    hold(event.pointerId);
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
      endSweep();
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
    if (
      event.pointerType === "touch" &&
      held.length === 1 &&
      target === null &&
      handlers.canSweepByFinger?.() === true
    ) {
      swept = { id: event.pointerId, from: at, sweeping: false };
    }
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const entry = active.get(event.pointerId);
      if (!entry || entry.moved) return;
      // Spent: the pointer leaves `active`, so the rest of this gesture neither
      // pans nor lands as a tap on the menu that has just opened over it.
      active.delete(event.pointerId);
      endSweep();
      handlers.onPress(target, {
        clientX: entry.clientX,
        clientY: entry.clientY,
      });
    }, PRESS_MS);
  };

  const onContextMenu = (event: MouseEvent): void => {
    refreshRect();
    dropHover();
    event.preventDefault();
    // macOS raises this from a plain ctrl+click, which reached `pointerdown`
    // above as an ordinary button-0 press. The menu answers that pointer, so it
    // is spent here the way the press timer spends a finger; a gesture already
    // promoted to a drag or a sweep has been answered, and the menu stays out.
    if (grabbed?.dragging || swept?.sweeping) return;
    for (const [id, entry] of active) {
      if (entry.type === "mouse") active.delete(id);
    }
    grabbed = null;
    swept = null;
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
    if (!entry) {
      // Nothing is down, so this is a pointer crossing the field rather than a
      // gesture. Only a mouse can rest on a mark; a pen is on its way to inking.
      if (event.pointerType === "mouse" && active.size === 0) {
        const over = local(event);
        restOn(handlers.hitTest(viewport.toWorld(over.x, over.y)));
      }
      return;
    }
    dropHover();

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
      letGo(event.pointerId);
      const at = local(event);
      stroke(event, viewport.toWorld(at.x, at.y));
      return;
    }
    const entry = active.get(event.pointerId);
    active.delete(event.pointerId);
    letGo(event.pointerId);
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

  // The box is read here rather than per move: a pointer resting on a mark is
  // measured against the box it entered through, and reading it on every move is
  // a layout the canvas does not otherwise ask for. The chrome above the canvas
  // can also grow under a pointer that never moves, so the box is read again
  // whenever the surface itself changes size.
  const onPointerEnter = (): void => refreshRect();
  const resized = new ResizeObserver(refreshRect);

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    dropHover();
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
  element.addEventListener("pointerenter", onPointerEnter);
  element.addEventListener("pointerleave", dropHover);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("contextmenu", onContextMenu);
  resized.observe(element);

  return () => {
    cancelPress();
    dropHover();
    strokes.clear();
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("pointerenter", onPointerEnter);
    element.removeEventListener("pointerleave", dropHover);
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("contextmenu", onContextMenu);
    resized.disconnect();
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
