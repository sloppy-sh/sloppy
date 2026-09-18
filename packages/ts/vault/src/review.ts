// What the code has left behind, derived from the notes and the tree —
// docs/ARCHITECTURE.md § "Tooling and the review". Nothing here is stored, and
// this is the one place it is worked out, so the app and the CLI cannot
// disagree about what a person is shown.

import {
  anchorsOf,
  type BlockDocument,
  COMPASS_DIRECTIONS,
  type Compass,
  type CompassDirection,
  compassOf,
  type OwnedRef,
} from "@sloppy/types";

/** The four things the review can say. */
export const REVIEW_SIGNALS = [
  "anchor-changed",
  "code-without-note",
  "compass-gap",
  "no-instead-of",
] as const;
export type ReviewSignalKind = (typeof REVIEW_SIGNALS)[number];

/**
 * One thing worth a person's attention. **An absent `note` is a signal about
 * the project** rather than about anything somebody wrote; **an absent `path`
 * is a signal about a note** rather than about a place in the code.
 */
export interface ReviewSignal {
  kind: ReviewSignalKind;
  note?: OwnedRef;
  path?: string;
  direction?: CompassDirection;
}

/** What the review reads off a note. A `VaultNote` and the shape a store holds
 *  one in both fit this, so neither side converts to reach it. */
export interface ReviewedNote {
  ref: OwnedRef;
  /** The commit its reasoning was last read against. Absent is a note nobody
   *  has confirmed, which is unread and never out of date. */
  checked?: string;
  sections: readonly { content: BlockDocument }[];
}

export interface ReviewInput {
  notes: readonly ReviewedNote[];
  /** The project's top-level folders and the packages it declares, as paths
   *  from the project root. A path no anchor names is code nobody has written
   *  about. */
  projectTop: readonly string[];
  /**
   * Which of `paths` the code has moved under since `checked` — a subset, in
   * the order it was given them. `History.changedSince` in `@sloppy/local` is
   * what answers this against a repository; a caller with no history answers
   * none.
   */
  changed: (checked: string, paths: readonly string[]) => Promise<string[]>;
}

/**
 * The signals the notes and the tree carry, each note's in the order the notes
 * were given and the project's after them. A note with no `checked` yields no
 * changed anchor at all: unread is not stale.
 */
export async function review(input: ReviewInput): Promise<ReviewSignal[]> {
  const anchored = new Set<string>();
  const read = input.notes.map((note) => {
    const paths = new Set<string>();
    for (const section of note.sections) {
      for (const anchor of anchorsOf(section.content)) paths.add(anchor.path);
    }
    for (const path of paths) anchored.add(path);
    return { note, paths: [...paths], compass: compassIn(note) };
  });

  const moved = await Promise.all(
    read.map(({ note, paths }) =>
      note.checked === undefined || paths.length === 0
        ? Promise.resolve<string[]>([])
        : input.changed(note.checked, paths),
    ),
  );

  const signals: ReviewSignal[] = [];
  for (const [at, { note, compass }] of read.entries()) {
    for (const path of moved[at]) {
      signals.push({ kind: "anchor-changed", note: note.ref, path });
    }
    if (compass === undefined) continue;
    for (const direction of COMPASS_DIRECTIONS) {
      if (compass[direction].length === 0) {
        signals.push({ kind: "compass-gap", note: note.ref, direction });
      }
    }
    // A decision is a note holding a compass, so the one with nothing to the
    // west is one whose author has not said what they did instead.
    if (compass.west.length === 0) {
      signals.push({ kind: "no-instead-of", note: note.ref });
    }
  }
  for (const top of input.projectTop) {
    if (!anchorNames(anchored, top)) {
      signals.push({ kind: "code-without-note", path: top });
    }
  }
  return signals;
}

function compassIn(note: ReviewedNote): Compass | undefined {
  for (const section of note.sections) {
    const held = compassOf(section.content);
    if (held) return held;
  }
  return undefined;
}

/** Whether any anchor lands at `top` or under it. */
function anchorNames(anchored: ReadonlySet<string>, top: string): boolean {
  for (const path of anchored) {
    if (path === top || path.startsWith(`${top}/`)) return true;
  }
  return false;
}
