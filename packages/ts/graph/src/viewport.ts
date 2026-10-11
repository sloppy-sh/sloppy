// The one transform between the canvas and the field it looks at. DESIGN.md
// § "The canvas": pan and zoom belong to the surface, and the canvas is never
// wrapped in something that scrolls, so this is the only scroll position there
// is.

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 3;

export class Viewport {
  x = 0;
  y = 0;

  /**
   * Raised after the zoom changes, however it changed — a pinch, a wheel, a
   * frame, a place read back off an earlier visit. Anything measured against
   * the zoom rather than scaled with it answers here, so no path can leave it
   * behind. The pan is already where it belongs when this is raised.
   */
  onScale: (() => void) | null = null;

  #scale = 1;

  get scale(): number {
    return this.#scale;
  }

  set scale(to: number) {
    if (to === this.#scale) return;
    this.#scale = to;
    this.onScale?.();
  }

  toWorld(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.x) / this.scale,
      y: (screenY - this.y) / this.scale,
    };
  }

  toScreen(worldX: number, worldY: number): Point {
    return { x: worldX * this.scale + this.x, y: worldY * this.scale + this.y };
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /** Put the field at a pan and zoom read back off this one earlier. The scale
   *  is held to the bounds a pinch is held to, so a stale number cannot take
   *  the canvas somewhere a finger could not. */
  lookAt(at: { x: number; y: number; scale: number }): void {
    this.x = at.x;
    this.y = at.y;
    this.scale = clampScale(at.scale);
  }

  /** Zoom about a screen point, which stays under the finger. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const next = clampScale(this.scale * factor);
    if (next === this.scale) return;
    const world = this.toWorld(screenX, screenY);
    this.x = screenX - world.x * next;
    this.y = screenY - world.y * next;
    this.scale = next;
  }

  /** Frame `bounds` inside a viewport of this size, leaving `padding` around. */
  fit(bounds: Bounds, width: number, height: number, padding = 48): void {
    const spanX = Math.max(bounds.maxX - bounds.minX, 1);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1);
    const room = Math.max(width - padding * 2, 1);
    const tall = Math.max(height - padding * 2, 1);
    const to = clampScale(Math.min(room / spanX, tall / spanY));
    this.x = width / 2 - ((bounds.minX + bounds.maxX) / 2) * to;
    this.y = height / 2 - ((bounds.minY + bounds.maxY) / 2) * to;
    this.scale = to;
  }

  centreOn(world: Point, width: number, height: number): void {
    this.x = width / 2 - world.x * this.scale;
    this.y = height / 2 - world.y * this.scale;
  }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The world rectangle currently on screen, grown by `margin` world units. */
export function visibleBounds(
  viewport: Viewport,
  width: number,
  height: number,
  margin = 0,
): Bounds {
  const topLeft = viewport.toWorld(0, 0);
  const bottomRight = viewport.toWorld(width, height);
  return {
    minX: topLeft.x - margin,
    minY: topLeft.y - margin,
    maxX: bottomRight.x + margin,
    maxY: bottomRight.y + margin,
  };
}
