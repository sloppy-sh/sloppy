// How one picture gives way to the next. Both surfaces that hold a series read
// this — the ground under the field and the imagery on a mark — so one screen
// never changes a picture at two speeds. DESIGN.md § "A picture that takes
// turns" is the doc of record, and `picture.ts` in `@sloppy/types` is the model.

import type { PictureTransition } from "@sloppy/types";

/** DESIGN.md § Motion's band, and one figure for both surfaces. */
export const TURN_MS = 250;

/** Where a zoom starts, above full size and settling down to it. */
const ZOOM_FROM = 0.06;

/** Which end of the change a layer is at. */
export type PictureRole = "arriving" | "leaving";

export interface PictureStep {
  /** Multiplied into whatever the layer is already drawn at, so a picture
   *  somebody has quietened never pops to full strength half way through. */
  opacity: number;
  /** Signed, across whatever travel the surface gives a slide: the layer's own
   *  width where it is clipped, and the room a mark leaves where it is not. */
  shift: number;
  /** Never below 1, so a picture cropped to fill cannot reveal its edges. */
  scale: number;
}

/**
 * The easing both ends take, as CSS names it — for the surface that hands the
 * change to the browser rather than driving it a frame at a time. The leaving
 * layer takes the mirror of the arriving one's curve, so the two are one change
 * read from either end and the ground never shows between them.
 */
export const TURN_EASING: Record<PictureRole, string> = {
  arriving: "cubic-bezier(0.215, 0.61, 0.355, 1)",
  leaving: "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
};

/** How much of a layer is showing `progress` of the way through its change,
 *  0–1. {@link TURN_EASING} is the same curve for the surface that lets CSS
 *  interpolate. */
export function shownAt(role: PictureRole, progress: number): number {
  const held = Math.min(1, Math.max(0, progress));
  return easeOut(role === "arriving" ? held : 1 - held);
}

/** Where a layer showing `shown` of itself is drawn. A transition this build
 *  cannot draw crossfades, which is what an absent one does too. */
export function pictureStep(
  transition: PictureTransition,
  role: PictureRole,
  shown: number,
): PictureStep {
  const away = 1 - shown;
  return {
    opacity: shown,
    shift: transition === "slide" ? away * (role === "arriving" ? 1 : -1) : 0,
    scale: transition === "zoom" ? 1 + away * ZOOM_FROM : 1,
  };
}

function easeOut(at: number): number {
  const from = at - 1;
  return from * from * from + 1;
}
