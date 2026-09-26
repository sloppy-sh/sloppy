// What somebody asks for when they want a project's notes written, what a
// survey proposes back, and what a run is doing while it writes —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { z } from "zod";
import { WRITE_DONE } from "./authority.js";
import { insideProject } from "./code-anchor.js";
import { OwnedRefSchema } from "./common.js";

/** The tools that can be asked to do the writing. */
export const DOCUMENTING_TOOLS = ["claude_code"] as const;
export type DocumentingTool = (typeof DOCUMENTING_TOOLS)[number];

const TOOL_NAMES: Record<DocumentingTool, string> = {
  claude_code: "Claude Code",
};

/** What a tool is called where somebody reads it. */
export function documentingToolName(tool: DocumentingTool): string {
  return TOOL_NAMES[tool];
}

/** Long enough to say what a project is for and what matters in it. */
export const DOCUMENTING_INTENT_MAX = 2048;

/** What somebody asked for, in their own words: the survey is made against it
 *  and the run is held to it. */
export const DocumentingIntentSchema = z.object({
  /** What they want written about, and why. Empty is somebody who asked for
   *  nothing in particular, which is an ordinary ask. */
  said: z
    .string()
    .trim()
    .max(
      DOCUMENTING_INTENT_MAX,
      `Say what you want in ${DOCUMENTING_INTENT_MAX} characters or fewer.`,
    ),
  /** Which tool is to do it. **Absent is whichever one this device has**,
   *  which is the whole answer while it has one. */
  tool: z.enum(DOCUMENTING_TOOLS).optional(),
});
export type DocumentingIntent = z.infer<typeof DocumentingIntentSchema>;

/** Long enough to say why a place is worth writing about, short enough to read
 *  beside it in a list. */
export const PLACE_REASON_MAX = 280;

/** Longer than any path a project holds, and short enough that a place is one
 *  line wherever it is shown. */
export const PROJECT_PATH_MAX = 1024;

/**
 * Somewhere in the project, as every shape here spells one. A path arrives
 * from a tool reading somebody's repository rather than from a person typing,
 * so what one may hold is settled where both ends of the seam parse it: inside
 * the project, nothing that reads as an option to a program, nothing invisible
 * ({@link insideProject}), and bounded.
 */
const ProjectPathSchema = z
  .string()
  .max(
    PROJECT_PATH_MAX,
    `A place's path is at most ${PROJECT_PATH_MAX} characters.`,
  )
  .refine(insideProject, "That place is outside this project.");

/**
 * One place a survey proposes writing about — a folder, or a file — and why.
 * The survey proposes; the person decides, and what they settle is the plan.
 */
export const ProposedPlaceSchema = z.object({
  /** From the project root, spelled with `/`, the way an anchor's path is. */
  path: ProjectPathSchema,
  /** Why it is worth a note. **Absent is a place somebody added themselves**
   *  rather than one that was proposed to them. */
  reason: z
    .string()
    .trim()
    .max(
      PLACE_REASON_MAX,
      `A reason is at most ${PLACE_REASON_MAX} characters.`,
    )
    .optional(),
  /** The note already about this place. **Absent is a place with none**, so
   *  the run writes one; present is a note the run changes, which stands as an
   *  offer wherever somebody has written in it. */
  note: OwnedRefSchema.optional(),
});
export type ProposedPlace = z.infer<typeof ProposedPlaceSchema>;

/**
 * More places than one run should be asked for. A plan longer than this is a
 * survey nobody read, and the run behind it costs somebody real time and real
 * money. A survey answers at most this many for the same reason, which is
 * `DocumentingAccess.survey`'s to hold since no shape bounds its answer.
 */
export const MAX_PLACES_PER_RUN = 100;

/** What the run is to do, as the person settled it: their words, and the
 *  places they kept or added, in the order those will be written. */
export const DocumentingPlanSchema = z.object({
  intent: DocumentingIntentSchema,
  places: z
    .array(ProposedPlaceSchema)
    .max(
      MAX_PLACES_PER_RUN,
      `Sloppy writes about ${MAX_PLACES_PER_RUN} places at a time. Choose fewer.`,
    ),
});
export type DocumentingPlan = z.infer<typeof DocumentingPlanSchema>;

/**
 * What a run is doing, and the one way it ends early. `reading` is a run that
 * has picked up no place yet; `writing` is one that is on a place, from the
 * moment it picks that place up rather than from its first write — which is
 * what makes {@link DocumentingProgressSchema}'s `at` present for the whole of
 * the time a run is on somewhere. `done` reached the end of its plan, and
 * `stopped` did not.
 */
export const DOCUMENTING_STAGES = [
  "reading",
  "writing",
  "done",
  "stopped",
] as const;
export type DocumentingStage = (typeof DOCUMENTING_STAGES)[number];

/** The note a run left at a place, and which of the two ways it left it. */
export const NoteLeftSchema = z.object({
  ref: OwnedRefSchema,
  /** `offered` is a note somebody has written in: a run writes as its own
   *  identity rather than as the person, so a note they have written in takes
   *  an offer, standing until they take it in or turn it down. */
  done: z.enum(WRITE_DONE),
});
export type NoteLeft = z.infer<typeof NoteLeftSchema>;

/** One place the run has finished with. */
export const PlaceDoneSchema = z.object({
  path: ProjectPathSchema,
  /** **Absent is a place the run had nothing to say about** — an answer, and
   *  not a failure. */
  note: NoteLeftSchema.optional(),
});
export type PlaceDone = z.infer<typeof PlaceDoneSchema>;

/** Long enough for what a run that could not go on has to say; a shell holding
 *  more of it sends the first of it. */
export const RUN_TROUBLE_MAX = 2048;

/** Where a run has got to. */
export const DocumentingProgressSchema = z.object({
  stage: z.enum(DOCUMENTING_STAGES),
  /** The place it is on now. **Absent is a run that is on none** — one still
   *  reading, and one that is over. */
  at: ProjectPathSchema.optional(),
  /** What it has finished with, in the order those came back. */
  places: z.array(PlaceDoneSchema),
  /** Why it could not go on, in words for the person. **Absent on `stopped`
   *  is a run the person stopped**, which needs none. */
  trouble: z.string().max(RUN_TROUBLE_MAX).optional(),
});
export type DocumentingProgress = z.infer<typeof DocumentingProgressSchema>;

/** Whether what a progress carries fits the stage it names: a place only while
 *  a run is writing, words about trouble only where it stopped. The shape
 *  cannot say it — a refinement here would take `.omit()` and `.partial()`
 *  with it — so both ends of the seam are held to this instead. */
export function progressFits(progress: DocumentingProgress): boolean {
  return (
    (progress.at === undefined || progress.stage === "writing") &&
    (progress.trouble === undefined || progress.stage === "stopped")
  );
}
