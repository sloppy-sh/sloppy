// Ink: what an Apple Pencil leaves behind, kept as strokes rather than pixels
// so it can be re-rendered at any zoom. This is one ink element's attributes
// inside a block's document, which stores them without reading them —
// docs/ARCHITECTURE.md § "Blocks and ink".

import { z } from "zod";

/**
 * One sampled point, in the capture surface's coordinates (see
 * `InkElementDataSchema`). `t` is milliseconds since the stroke began, so a
 * stroke replays at its original speed on a machine that never saw it drawn.
 */
export const InkPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  /**
   * `0`–`1`, as Pointer Events reports it. A device with no pressure sensor
   * reports `0.5` for a held contact, which is why that is the default rather
   * than a value meaning "unknown".
   */
  pressure: z.number().min(0).max(1).default(0.5),
  /** Degrees, `-90`–`90`. Absent where the device reports no tilt. */
  tilt_x: z.number().min(-90).max(90).optional(),
  tilt_y: z.number().min(-90).max(90).optional(),
  t: z.number().nonnegative(),
});
export type InkPoint = z.infer<typeof InkPointSchema>;

export const InkStrokeSchema = z.object({
  points: z.array(InkPointSchema).min(1),
  /** Nib width in capture-surface units, before pressure scales it. */
  width: z.number().positive().default(2),
});
export type InkStroke = z.infer<typeof InkStrokeSchema>;

export const InkElementDataSchema = z.object({
  strokes: z.array(InkStrokeSchema).default([]),
  /**
   * The surface the points were captured on. A drawing made on a tablet is read
   * on a phone, so a reader scales into its own width rather than assuming the
   * author's.
   */
  width: z.number().positive(),
  height: z.number().positive(),
  /**
   * A syr upload holding a raster of these strokes, so a reader that cannot
   * re-render them still sees the drawing. Absent — or `null`, which is how an
   * editor attribute with nothing in it is written down — until the raster
   * lands, which it may never do: the strokes are the record.
   */
  raster_upload_id: z.string().min(1).nullish(),
});
export type InkElementData = z.infer<typeof InkElementDataSchema>;

/** Whether an element's attributes are a drawing this build can draw. */
export function readsAsInk(attrs: unknown): boolean {
  return InkElementDataSchema.safeParse(attrs).success;
}
