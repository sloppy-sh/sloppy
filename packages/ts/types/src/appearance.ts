// How a note's author asked their mark to be drawn. Shape and imagery only —
// DESIGN.md § "The mark" carries the ruling that keeps colour out of it, and the
// table that says which channel on the mark means what.

import { z } from "zod";

/**
 * One channel's value, bounded by shape rather than by vocabulary: a look this
 * build has no renderer for is stored and handed back untouched instead of
 * being refused, and adding a look is a value here rather than a column.
 *
 * The four channels below are closed and their values are open. A fifth channel
 * would be a new meaning on a mark that already carries several, so it belongs
 * in DESIGN.md's table before it belongs in a row.
 */
export const AppearanceTokenSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    "That is not a look Sloppy can save. Pick one from the list.",
  );
export type AppearanceToken = z.infer<typeof AppearanceTokenSchema>;

/** `none` is a mark with no ring of its own, which is how an unstyled note reads. */
export const RING_WEIGHTS = ["none", "hairline", "regular", "heavy"] as const;
export type RingWeight = (typeof RING_WEIGHTS)[number];

export const RING_STYLES = ["solid", "dashed"] as const;
export type RingStyle = (typeof RING_STYLES)[number];

export const MARK_RADII = ["small", "regular", "large"] as const;
export type MarkRadius = (typeof MARK_RADII)[number];

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
 * No channel here carries colour, at any level. Hue on the canvas answers the
 * reader's tag selection, and a note able to spend it would make that answer
 * unreadable on somebody else's graph.
 */
export const NodeAppearanceSchema = z.object({
  ring_weight: AppearanceTokenSchema.optional(),
  /** Says nothing while the weight resolves to `none`. Dashed is how a draft reads. */
  ring_style: AppearanceTokenSchema.optional(),
  mark_radius: AppearanceTokenSchema.optional(),
  /**
   * An upload in the author's own store — the `upload_id` a completed upload
   * answers with, never an address. `ownPicture` in `@sloppy/client` is the only
   * way one of these draws, because a note is private until its subtree is
   * published and so is its picture.
   *
   * The id outlives the bytes: a picture deleted from the store leaves this
   * standing, and a mark that cannot load one draws exactly as a mark with no
   * picture rather than showing a gap.
   */
  preview: z.string().min(1).max(512).optional(),
});
export type NodeAppearance = z.infer<typeof NodeAppearanceSchema>;

/** Every channel resolved to one this build draws. */
export interface ResolvedAppearance {
  ringWeight: RingWeight;
  ringStyle: RingStyle;
  markRadius: MarkRadius;
  preview: string | undefined;
}

/**
 * What a renderer reads instead of the stored row: a token this build has no
 * renderer for resolves to the unstyled value, so an author on a newer Sloppy
 * loses the look on this screen and keeps it in their graph.
 */
export function resolveAppearance(
  appearance: NodeAppearance | null | undefined,
): ResolvedAppearance {
  return {
    ringWeight: known(RING_WEIGHTS, appearance?.ring_weight, "none"),
    ringStyle: known(RING_STYLES, appearance?.ring_style, "solid"),
    markRadius: known(MARK_RADII, appearance?.mark_radius, "regular"),
    preview: appearance?.preview,
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
