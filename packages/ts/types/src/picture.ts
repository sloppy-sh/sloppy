// A picture that may be several taking turns: which ones, how long each holds,
// and how one gives way to the next. The ground under a graph and the imagery on
// a mark are both this. DESIGN.md § "A picture that takes turns" is the doc of
// record; the transition itself is drawn by each surface's own renderer.

/** How one picture gives way to the next. */
export const PICTURE_TRANSITIONS = ["fade", "slide", "zoom"] as const;
export type PictureTransition = (typeof PICTURE_TRANSITIONS)[number];

/** What a series nobody chose a transition for takes, and what one this build
 *  cannot draw settles on. */
export const QUIETEST_TRANSITION: PictureTransition = "fade";

/** Minutes a picture holds, and the words every surface offers them in. */
export const PICTURE_TURNS: readonly { value: number; label: string }[] = [
  { value: 5, label: "Every five minutes" },
  { value: 30, label: "Every half hour" },
  { value: 60, label: "Hourly" },
  { value: 360, label: "Every six hours" },
  { value: 1440, label: "Daily" },
];

/** Minutes, and a week is the longest: past that a series has stopped taking
 *  turns rather than taking them slowly. */
export const PICTURE_TURN_MIN = 1;
export const PICTURE_TURN_MAX = 10_080;
export const PICTURE_TURN_DEFAULT = 60;

/** How many pictures one series may hold. */
export const PICTURES_PER_SERIES = 8;

export interface PictureSeries {
  /** In the order they take turns. None is no picture at all; one is a still
   *  picture, which is what {@link PictureSeries.every} and
   *  {@link PictureSeries.transition} then say nothing about. */
  pictures: readonly string[];
  /** Minutes one picture holds before the next takes its turn. */
  every: number;
  transition: PictureTransition;
}

/**
 * Whose turn it is at `at`, in epoch milliseconds. Read off the clock rather
 * than off a timer, so two devices land on the same picture at the same minute
 * with nothing to sync and nothing counts down while somebody is reading.
 * Absent from an empty series.
 */
export function pictureTurn(
  series: PictureSeries,
  at: number,
): string | undefined {
  const { pictures } = series;
  if (pictures.length === 0) return undefined;
  const every = boundedTurn(series.every);
  const turn = Math.floor(at / (every * 60_000));
  return pictures[
    ((turn % pictures.length) + pictures.length) % pictures.length
  ];
}

/** The cadence a value asks for, held inside the range a series may take. What
 *  is not a cadence at all — an absent channel, a hand-edited store — lands on
 *  {@link PICTURE_TURN_DEFAULT} instead. */
export function boundedTurn(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(PICTURE_TURN_MAX, Math.max(PICTURE_TURN_MIN, Math.round(value)))
    : PICTURE_TURN_DEFAULT;
}

/** A transition this build can draw; anything else settles on the quietest. */
export function knownTransition(value: unknown): PictureTransition {
  return (
    PICTURE_TRANSITIONS.find((one) => one === value) ?? QUIETEST_TRANSITION
  );
}
