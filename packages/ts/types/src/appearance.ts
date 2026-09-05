// How a note's author asked their mark to be drawn. Shape and imagery only —
// DESIGN.md § "The mark" carries the ruling that keeps colour out of it, and the
// table that says which channel on the mark means what.

import { z } from "zod";
import {
  boundedTurn,
  knownTransition,
  PICTURE_TURN_MAX,
  PICTURE_TURN_MIN,
  PICTURES_PER_SERIES,
  type PictureSeries,
} from "./picture.js";

/**
 * One channel's value, bounded by shape rather than by vocabulary: a look this
 * build has no renderer for is stored and handed back untouched instead of
 * being refused. The channels are closed and their values are open.
 */
export const AppearanceTokenSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    "Sloppy could not save that look. Choose it again.",
  );
export type AppearanceToken = z.infer<typeof AppearanceTokenSchema>;

/** `none` is a mark with no ring of its own, which is how an unstyled note reads. */
export const RING_WEIGHTS = ["none", "hairline", "regular", "heavy"] as const;
export type RingWeight = (typeof RING_WEIGHTS)[number];

export const RING_STYLES = ["solid", "dashed"] as const;
export type RingStyle = (typeof RING_STYLES)[number];

/** Ascending. DESIGN.md § "The mark" carries what each step is worth and the
 *  ruling that lets an author past the size a fold alone reaches. */
export const MARK_RADII = [
  "small",
  "regular",
  "large",
  "huge",
  "giant",
] as const;
export type MarkRadius = (typeof MARK_RADII)[number];

/** How much of the mark a picture covers; `small` is what a note whose author
 *  has not said draws. DESIGN.md § "The mark" carries the shares and the bound
 *  on the largest. */
export const PREVIEW_SIZES = ["small", "medium", "large"] as const;
export type PreviewSize = (typeof PREVIEW_SIZES)[number];

/** An upload in the author's own store — the `upload_id` a completed upload
 *  answers with, never an address. */
const PictureIdSchema = z.string().min(1).max(512);

/**
 * A note's look, as its author set it.
 *
 * ABSENT is a note nobody styled, and that is not itself a look: the mark draws
 * as the graph's own language alone says it should — the depth ramp or a
 * selected tag's hue, its provenance on its edge, and nothing else. An absent
 * channel inside a present appearance means the same for that channel by
 * itself. There is therefore never a reason to store an appearance whose every
 * channel is absent; {@link isUnstyled} is what recognises one.
 */
export const NodeAppearanceSchema = z.object({
  ring_weight: AppearanceTokenSchema.optional(),
  /** Says nothing while the weight resolves to `none`. Dashed is how a draft reads. */
  ring_style: AppearanceTokenSchema.optional(),
  mark_radius: AppearanceTokenSchema.optional(),
  /**
   * The picture the mark wears, and the first of however many take turns on it.
   * `ownPicture` in `@sloppy/client` is the only way one of these draws, because
   * a note is private until its subtree is published and so is its picture.
   *
   * The id outlives the bytes: a picture deleted from the store leaves this
   * standing, and a mark that cannot load one draws exactly as a mark with no
   * picture rather than showing a gap.
   */
  preview: PictureIdSchema.optional(),
  /**
   * The rest of the series, after {@link NodeAppearance.preview} and in the
   * order they take turns. Absent is a mark whose picture never changes, and so
   * is an empty one. Says nothing without a `preview`, because that is the
   * picture the series starts at.
   */
  preview_more: z
    .array(PictureIdSchema)
    .max(PICTURES_PER_SERIES - 1)
    .optional(),
  /** Minutes one picture holds before the next takes its turn. Absent is
   *  `PICTURE_TURN_DEFAULT`, and says nothing on a mark wearing one picture. */
  preview_every: z.int().min(PICTURE_TURN_MIN).max(PICTURE_TURN_MAX).optional(),
  /** How one picture gives way to the next. Absent is the quietest, and says
   *  nothing on a mark wearing one picture. */
  preview_transition: AppearanceTokenSchema.optional(),
  /** Says nothing without a {@link NodeAppearance.preview} to size. */
  preview_size: AppearanceTokenSchema.optional(),
});
export type NodeAppearance = z.infer<typeof NodeAppearanceSchema>;

/** Every channel resolved to one this build draws. */
export interface ResolvedAppearance {
  ringWeight: RingWeight;
  ringStyle: RingStyle;
  markRadius: MarkRadius;
  /** No pictures is a mark with none: the two stored channels a series is spelt
   *  across are read once, here, and nothing downstream sees them apart. */
  preview: PictureSeries;
  previewSize: PreviewSize;
}

/**
 * What a renderer reads instead of the stored row: a token this build has no
 * renderer for resolves to the unstyled value, so an author on a newer Sloppy
 * loses the look on this screen and keeps it in their graph.
 */
export function resolveAppearance(
  appearance: NodeAppearance | null | undefined,
): ResolvedAppearance {
  const first = appearance?.preview;
  return {
    ringWeight: known(RING_WEIGHTS, appearance?.ring_weight, "none"),
    ringStyle: known(RING_STYLES, appearance?.ring_style, "solid"),
    markRadius: known(MARK_RADII, appearance?.mark_radius, "regular"),
    preview: {
      pictures:
        first === undefined ? [] : [first, ...(appearance?.preview_more ?? [])],
      every: boundedTurn(appearance?.preview_every),
      transition: knownTransition(appearance?.preview_transition),
    },
    previewSize: known(PREVIEW_SIZES, appearance?.preview_size, "small"),
  };
}

/** Nothing set — what a form has left behind once every channel is taken back
 *  off, and what is stored as no appearance at all rather than as an empty one. */
export function isUnstyled(
  appearance: NodeAppearance | null | undefined,
): boolean {
  return (
    appearance == null ||
    Object.values(appearance).every((v) => v === undefined)
  );
}

function known<T extends string>(
  values: readonly T[],
  token: string | undefined,
  unstyled: T,
): T {
  return values.find((value) => value === token) ?? unstyled;
}
