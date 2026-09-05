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

/** How broken the ring is, from whole to a ring of ticks. `LOOK_RING_BREAK` in
 *  `@sloppy/graph` is what each one is drawn as. */
export const RING_STYLES = ["solid", "open", "notched", "dashed"] as const;
export type RingStyle = (typeof RING_STYLES)[number];

/** The ends of {@link NodeAppearance.mark_scale}, and so of the whole size
 *  channel: the ladder in {@link MARK_RADIUS_SCALE} spans exactly this. */
export const MARK_SCALE_MIN = 0.78;
export const MARK_SCALE_MAX = 2.4;

/** Steps a size may also be spelt in, ascending. */
export const MARK_RADII = [
  "small",
  "regular",
  "large",
  "huge",
  "giant",
] as const;
export type MarkRadius = (typeof MARK_RADII)[number];

/** What each step is worth as a {@link NodeAppearance.mark_scale}. Frozen: a
 *  note spelt in these draws what it has always drawn. */
export const MARK_RADIUS_SCALE: Record<MarkRadius, number> = {
  small: MARK_SCALE_MIN,
  regular: 1,
  large: 1.34,
  huge: 1.8,
  giant: MARK_SCALE_MAX,
};

/** The ends of {@link NodeAppearance.preview_cover}. The top is the disc's own
 *  fill extent — past it a picture would spill outside the mark — and
 *  `scene.test.ts` in `@sloppy/graph` holds it against the disc it is cut from.
 *  DESIGN.md § "The mark" carries the ruling. */
export const PREVIEW_COVER_MIN = 0.42;
export const PREVIEW_COVER_MAX = 0.9375;

/** Steps a cover may also be spelt in, ascending. */
export const PREVIEW_SIZES = ["small", "medium", "large"] as const;
export type PreviewSize = (typeof PREVIEW_SIZES)[number];

/** What each step is worth as a {@link NodeAppearance.preview_cover}. Frozen,
 *  the way {@link MARK_RADIUS_SCALE} is. */
export const PREVIEW_SIZE_COVER: Record<PreviewSize, number> = {
  small: PREVIEW_COVER_MIN,
  medium: 0.49,
  large: 0.6,
};

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
 *
 * Nothing here refuses a value: a row is read by builds that did not write it,
 * so what THIS build offers is bounded by {@link WrittenAppearanceSchema} on the
 * way in and by {@link resolveAppearance} on the way out. A note whose look a
 * later Sloppy widened past either still opens.
 */
export const NodeAppearanceSchema = z.object({
  ring_weight: AppearanceTokenSchema.optional(),
  /** Says nothing while the weight resolves to `none`. A broken ring reads as a draft. */
  ring_style: AppearanceTokenSchema.optional(),
  /** A step of {@link MARK_RADII}. Absent is `regular`, and a note carrying a
   *  {@link NodeAppearance.mark_scale} too is drawn at that instead. */
  mark_radius: AppearanceTokenSchema.optional(),
  /** What the mark's radius is multiplied by, which is
   *  {@link NodeAppearance.mark_radius} said finely. Absent is whatever that
   *  step is worth. */
  mark_scale: z.number().optional(),
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
   * is an empty one.
   *
   * A caller must not send these without a `preview`: that is the picture the
   * series starts at, so pictures behind an absent one are ids nothing will ever
   * draw. {@link seriesChannels} is what spells a series across the two — taking
   * the first picture off promotes the next rather than dropping the rest — and
   * {@link seriesIsWhole} is what recognises the shape that lost them.
   */
  preview_more: z.array(PictureIdSchema).optional(),
  /** Minutes one picture holds before the next takes its turn. Absent is
   *  `PICTURE_TURN_DEFAULT`, and says nothing on a mark wearing one picture. */
  preview_every: z.number().optional(),
  /** How one picture gives way to the next. Absent is the quietest, and says
   *  nothing on a mark wearing one picture. */
  preview_transition: AppearanceTokenSchema.optional(),
  /** A step of {@link PREVIEW_SIZES}. Absent is `small`, and a note carrying a
   *  {@link NodeAppearance.preview_cover} too is drawn at that instead. Says
   *  nothing without a {@link NodeAppearance.preview} to size. */
  preview_size: AppearanceTokenSchema.optional(),
  /** The share of the mark's radius the picture covers, which
   *  {@link NodeAppearance.preview_size} says less finely. Absent is whatever
   *  that step is worth. */
  preview_cover: z.number().optional(),
});
export type NodeAppearance = z.infer<typeof NodeAppearanceSchema>;

/**
 * The same channels, held to the series this build offers — what every request
 * that sets a look is read through. A request carrying more than Sloppy draws
 * can be refused and asked again; a stored row carrying it cannot, which is why
 * the bound is here and not on {@link NodeAppearanceSchema}.
 */
export const WrittenAppearanceSchema = NodeAppearanceSchema.extend({
  mark_scale: z.number().min(MARK_SCALE_MIN).max(MARK_SCALE_MAX).optional(),
  preview_more: z
    .array(PictureIdSchema)
    .max(PICTURES_PER_SERIES - 1)
    .optional(),
  preview_every: z.int().min(PICTURE_TURN_MIN).max(PICTURE_TURN_MAX).optional(),
  preview_cover: z
    .number()
    .min(PREVIEW_COVER_MIN)
    .max(PREVIEW_COVER_MAX)
    .optional(),
});

/** Every channel resolved to one this build draws. */
export interface ResolvedAppearance {
  ringWeight: RingWeight;
  ringStyle: RingStyle;
  /** What the mark's radius is multiplied by. */
  markScale: number;
  /** No pictures is a mark with none: the two stored channels a series is spelt
   *  across are read once, here, and nothing downstream sees them apart. */
  preview: PictureSeries;
  /** The share of the mark's radius the picture covers. */
  previewCover: number;
}

/**
 * What a renderer reads instead of the stored row: a token this build has no
 * renderer for resolves to the unstyled value, and a number past the range it
 * draws is held to that range, so an author on a newer Sloppy loses the look on
 * this screen and keeps it in their graph.
 */
export function resolveAppearance(
  appearance: NodeAppearance | null | undefined,
): ResolvedAppearance {
  const first = appearance?.preview;
  return {
    ringWeight: known(RING_WEIGHTS, appearance?.ring_weight, "none"),
    ringStyle: known(RING_STYLES, appearance?.ring_style, "solid"),
    markScale: measured(
      appearance?.mark_scale,
      MARK_RADIUS_SCALE[known(MARK_RADII, appearance?.mark_radius, "regular")],
      MARK_SCALE_MIN,
      MARK_SCALE_MAX,
    ),
    preview: {
      pictures:
        first === undefined
          ? []
          : [first, ...(appearance?.preview_more ?? [])].slice(
              0,
              PICTURES_PER_SERIES,
            ),
      every: boundedTurn(appearance?.preview_every),
      transition: knownTransition(appearance?.preview_transition),
    },
    previewCover: measured(
      appearance?.preview_cover,
      PREVIEW_SIZE_COVER[
        known(PREVIEW_SIZES, appearance?.preview_size, "small")
      ],
      PREVIEW_COVER_MIN,
      PREVIEW_COVER_MAX,
    ),
  };
}

/** A series spelt back across the two channels that store it, in the order it
 *  takes turns. Longer than {@link PICTURES_PER_SERIES} is the caller's to
 *  avoid; {@link WrittenAppearanceSchema} refuses it. */
export function seriesChannels(
  pictures: readonly string[],
): Pick<NodeAppearance, "preview" | "preview_more"> {
  const [first, ...rest] = pictures;
  return {
    preview: first,
    preview_more: rest.length === 0 ? undefined : rest,
  };
}

/**
 * Whether a series is spelt across its two channels the way
 * {@link seriesChannels} spells one. False is pictures written behind an absent
 * first one, which stores ids that never draw and reads as a styled note.
 *
 * A rule rather than a schema check: {@link WrittenAppearanceSchema} is a plain
 * object so the surfaces that build a look may still `.omit()` and `.partial()`
 * it, and a refinement is what takes that away.
 */
export function seriesIsWhole(
  appearance: NodeAppearance | null | undefined,
): boolean {
  return (
    appearance?.preview !== undefined ||
    (appearance?.preview_more ?? []).length === 0
  );
}

/** Nothing set — what a form has left behind once every channel is taken back
 *  off, and what is stored as no appearance at all rather than as an empty one. */
export function isUnstyled(
  appearance: NodeAppearance | null | undefined,
): boolean {
  return (
    appearance == null ||
    Object.values(appearance).every(
      (value) =>
        value === undefined || (Array.isArray(value) && value.length === 0),
    )
  );
}

function known<T extends string>(
  values: readonly T[],
  token: string | undefined,
  unstyled: T,
): T {
  return values.find((value) => value === token) ?? unstyled;
}

/** The number an author set, held to the range this build draws, or what the
 *  step they set is worth where they set none. */
function measured(
  set: number | undefined,
  step: number,
  min: number,
  max: number,
): number {
  if (typeof set !== "number" || !Number.isFinite(set)) return step;
  return Math.min(max, Math.max(min, set));
}
