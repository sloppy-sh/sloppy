// What somebody asks for when they want a project's notes written, what a
// survey proposes back, and what a run is doing while it writes —
// docs/ARCHITECTURE.md § "Asking a tool to write the notes".

import { z } from "zod";
import { WRITE_DONE } from "./authority.js";
import { insideProject } from "./code-anchor.js";
import { OwnedRefSchema } from "./common.js";

/**
 * The tools that can be asked to do the writing. A second one is a value here
 * and a way for the shell to reach it, never a field anywhere and never a
 * branch: every shape below carries whichever of these was asked for.
 */
export const DOCUMENTING_TOOLS = ["claude_code"] as const;
export type DocumentingTool = (typeof DOCUMENTING_TOOLS)[number];

const TOOL_NAMES: Record<DocumentingTool, string> = {
  claude_code: "Claude Code",
};

/** What a tool is called where somebody reads it. It sits beside the tokens so
 *  the shell and the surface say one name. */
export function documentingToolName(tool: DocumentingTool): string {
  return TOOL_NAMES[tool];
}

/** Long enough to say what a project is for and what matters in it. */
export const DOCUMENTING_INTENT_MAX = 2048;

/**
 * What somebody asked for, in their own words. The survey is made against it
 * and the run is held to it, so it travels with the plan rather than being
 * asked for twice.
 *
 * How much detail they want is part of what they SAID — a tool that reads the
 * code decides what a place warrants, and there is no depth field for a
 * surface to set on their behalf.
 */
export const DocumentingIntentSchema = z.object({
  /** What they want written about, and why. Empty is somebody who asked for
   *  nothing in particular, which is an ordinary ask. */
  said: z.string().trim().max(DOCUMENTING_INTENT_MAX),
  /** Which tool is to do it. **Absent is whichever one this device has**,
   *  which is the whole answer while it has one. */
  tool: z.enum(DOCUMENTING_TOOLS).optional(),
});
export type DocumentingIntent = z.infer<typeof DocumentingIntentSchema>;

/** Long enough to say why a place is worth writing about, short enough to read
 *  beside it in a list. */
export const PLACE_REASON_MAX = 280;

const ProjectPathSchema = z
  .string()
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
  reason: z.string().trim().max(PLACE_REASON_MAX).optional(),
  /** The note already about this place. **Absent is a place with none**, so
   *  the run writes one; present is a note the run changes, which stands as an
   *  offer wherever somebody has written in it. */
  note: OwnedRefSchema.optional(),
});
export type ProposedPlace = z.infer<typeof ProposedPlaceSchema>;

/**
 * More places than one run should be asked for. A plan longer than this is a
 * survey nobody read, and the run behind it costs somebody real time and real
 * money.
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
 * has written nothing yet, `writing` one that has, `done` one that reached the
 * end of its plan, and `stopped` one that did not.
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
  /** `offered` is a note somebody has written in: a run never writes over one,
   *  and the offer stands until its author takes it in or turns it down. */
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

/**
 * Where a run has got to. It says what has happened and never guesses at what
 * is left: the places behind it are known, the place it is on is known, and
 * how much of the rest is still coming is not.
 */
export const DocumentingProgressSchema = z.object({
  stage: z.enum(DOCUMENTING_STAGES),
  /** The place it is on now. **Absent is a run that is on none** — one still
   *  reading, and one that is over. */
  at: ProjectPathSchema.optional(),
  /** What it has finished with, in the order those came back. */
  places: z.array(PlaceDoneSchema),
  /** Why it stopped, in words for the person. **Absent on `stopped` is a run
   *  the person stopped**, which needs none, and it is absent on every other
   *  stage. */
  said: z.string().optional(),
});
export type DocumentingProgress = z.infer<typeof DocumentingProgressSchema>;
