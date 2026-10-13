// Building the code out of the notes: the roles Sloppy runs, the plan a reading
// session answers with, the hand-off that is the whole of what passes between
// sessions, and the build a device keeps —
// docs/ARCHITECTURE.md § "Building from the notes".

import { z } from "zod";
import {
  type AdvertisedTool,
  advertisedAs,
  CHAT_TOOL_SPECS,
  CHAT_TOOLS,
  type ChatToolName,
  type ChatToolSpec,
  chatToolWrites,
} from "./chat.js";
import { ProjectPathSchema } from "./code-anchor.js";
import { OwnedRefSchema, TimestampSchema, UlidSchema } from "./common.js";
import { DRAFT_COMMIT_MAX, DRAFT_PATH_MAX } from "./draft.js";

/**
 * What a session is FOR. It decides which of Sloppy's acts the session is
 * served ({@link toolsForRole}) and which tools of the agent's own it is
 * allowed and barred — that second table is the shell's, beside the program it
 * starts, because those names are one program's dialect.
 */
export const BUILD_ROLES = [
  "planner",
  "implementer",
  "reviewer",
  "merger",
] as const;
export type BuildRole = (typeof BUILD_ROLES)[number];

/** How many tasks are built at once. */
export const BUILD_TASKS_AT_ONCE = 2;

/** How many times a review may send one task back before it is contested and
 *  the person decides. */
export const BUILD_ROUNDS_MOST = 2;

/** Long enough for what a person calls a build, on one line. */
export const BUILD_NAME_MAX = 120;

/** {@link BUILD_LINE_PREFIX} and a name, with room to spare. */
export const BUILD_LINE_MAX = 128;

/** Long enough for the one line a task is read by. */
export const BUILD_TITLE_MAX = 200;

/** Long enough for the paragraph a task's effect is stated in, and short
 *  enough that it stays a paragraph. */
export const BUILD_EFFECT_MAX = 2048;

/** Long enough for a question somebody answers by writing a note. */
export const BUILD_QUESTION_MAX = 1024;

/** Long enough for why that question has to be answered first. */
export const BUILD_WHY_MAX = 1024;

/** Long enough for what two notes, or a note and the code, disagree about. */
export const BUILD_DISPUTE_MAX = 2048;

/** Longer than a command a project runs. */
export const BUILD_COMMAND_MAX = 512;

/** What a check's own words may run to on their way onto the card. Past this
 *  the person reads it where they run it. */
export const BUILD_SAID_MAX = 8192;

/** Long enough for what one session says it built. */
export const BUILD_SUMMARY_MAX = 8192;

/** Long enough for what it left undone. */
export const BUILD_UNDONE_MAX = 4096;

/** Long enough for one finding and for the reason it is one. */
export const BUILD_FINDING_MAX = 2048;

/** More tasks than one feature is split into. Past this the plan is a project
 *  rather than a build. */
export const MOST_TASKS = 16;

/** More questions than a person answers before they would rather write the
 *  notes themselves. */
export const MOST_NEEDS = 32;

/** More disagreements than one plan reports. */
export const MOST_DISPUTES = 32;

/** More commands than a project runs to tell whether it still works. */
export const MOST_CHECKS = 16;

/** More places than one task writes. */
export const MOST_PATHS_PER_TASK = 64;

/** More notes than one session is given whole. Every one of them is put in
 *  front of it, so this is what keeps a brief small. */
export const MOST_NOTES_PER_TASK = 32;

/** More files than one hand-off names. */
export const MOST_FILES_WRITTEN = 200;

/** More findings than one review is read as. */
export const MOST_FINDINGS = 64;

/** More hand-offs than one task's sessions leave behind. Past this the task is
 *  not handing on, it is looping. */
export const MOST_HANDOFFS = 16;

/** An id a session names so that something else can point at it: a task named
 *  in another's `after`, a need an answer is written against. */
export const BUILD_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const SLUG_SAID =
  "An id is lowercase letters, digits and hyphens, up to 64 characters.";

export const BuildSlugSchema = z.string().regex(BUILD_SLUG, SLUG_SAID);
export type BuildSlug = z.infer<typeof BuildSlugSchema>;

/**
 * What git calls the line a build writes on, before the name. **It is shown**:
 * the line stands in the history picture like any other and the person works on
 * it, takes it in and renames it there.
 */
export const BUILD_LINE_PREFIX = "build/";

/** The line a build called `name` writes on. */
export function buildLine(name: string): string {
  return `${BUILD_LINE_PREFIX}${name}`;
}

/**
 * What git calls the branch one task works on. **It is never shown**: a person
 * reads a task, so nothing offers to work on one, take one in or delete one —
 * the history leaves these out of the lines it lists exactly as it leaves out a
 * draft's.
 */
export const BUILD_TASK_BRANCH_PREFIX = "sloppy/build/";

/** The branch the task `task` of the build `id` works on. */
export function buildTaskBranch(id: string, task: string): string {
  return `${BUILD_TASK_BRANCH_PREFIX}${id}/${task}`;
}

/** The build and task a branch is one of, and nothing for a branch that is a
 *  person's own — which is every branch this app did not make. */
export function buildTaskIn(
  branch: string,
): { id: string; task: string } | undefined {
  if (!branch.startsWith(BUILD_TASK_BRANCH_PREFIX)) return undefined;
  const parts = branch.slice(BUILD_TASK_BRANCH_PREFIX.length).split("/");
  if (parts.length !== 2) return undefined;
  const id = UlidSchema.safeParse(parts[0]);
  const task = BuildSlugSchema.safeParse(parts[1]);
  return id.success && task.success
    ? { id: id.data, task: task.data }
    : undefined;
}

/**
 * One piece of the work, as a plan names it. `paths` is the task's territory,
 * from the project root; `notes` are the notes the session is handed WHOLE, so
 * a task naming more than it needs is a context it has to read past.
 *
 * **Absent `after` is a task that waits for none**, which is what runs first.
 */
export const BuildTaskSchema = z.object({
  id: BuildSlugSchema.describe(
    "A short name for this task, like 'reader'. Another task names it in `after`.",
  ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(BUILD_TITLE_MAX, `A title is at most ${BUILD_TITLE_MAX} characters.`)
    .describe("The one line this task is read by."),
  effect: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_EFFECT_MAX,
      `An effect is one paragraph, at most ${BUILD_EFFECT_MAX} characters.`,
    )
    .describe(
      "One paragraph saying what the project does differently once this is built. What was written is read against this, so say the effect and not the steps.",
    ),
  paths: z
    .array(ProjectPathSchema)
    .min(1)
    .max(
      MOST_PATHS_PER_TASK,
      `A task writes at most ${MOST_PATHS_PER_TASK} places.`,
    )
    .describe(
      "The files and folders this task writes, from the project root and spelled with /. No two tasks name the same place.",
    ),
  notes: z
    .array(OwnedRefSchema)
    .min(1)
    .max(
      MOST_NOTES_PER_TASK,
      `A task is built from at most ${MOST_NOTES_PER_TASK} notes.`,
    )
    .describe(
      "The notes this task is built from, as a listing of them gives them. Every one is put in front of the session whole, so name the ones it needs and no others.",
    ),
  after: z
    .array(BuildSlugSchema)
    .max(MOST_TASKS, `A task waits for at most ${MOST_TASKS} others.`)
    .optional()
    .describe(
      "The tasks this one waits for, by their ids. Leave it out where it waits for none.",
    ),
});
export type BuildTask = z.infer<typeof BuildTaskSchema>;

/**
 * Something the notes do not say that the build cannot be right without. It is
 * answered by the person writing a note, so it asks for what belongs in one.
 *
 * `id` is unique within one build: a need arriving under an id the build
 * already holds is kept under another, so one answer can never reach two
 * questions. **Absent `about` is a question about the feature as a whole**
 * rather than about one note.
 */
export const BuildNeedSchema = z.object({
  id: BuildSlugSchema.describe("A short name for this question, like 'units'."),
  about: OwnedRefSchema.optional().describe(
    "The note this question is about, as a listing of them gives it. Leave it out where it is about the feature as a whole.",
  ),
  question: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_QUESTION_MAX,
      `A question is at most ${BUILD_QUESTION_MAX} characters.`,
    )
    .describe(
      "What to ask, as one question in the person's own terms. It is answered by a note they write, so ask for what the notes should say rather than for a preference.",
    ),
  why: z
    .string()
    .trim()
    .min(1)
    .max(BUILD_WHY_MAX, `A reason is at most ${BUILD_WHY_MAX} characters.`)
    .describe("What cannot be built right until it is answered."),
});
export type BuildNeed = z.infer<typeof BuildNeedSchema>;

/**
 * Where the account of the project disagrees with itself. **Absent `path` is
 * notes that disagree with each other**; a path is a note that disagrees with
 * the code there.
 */
export const BuildDisputeSchema = z.object({
  notes: z
    .array(OwnedRefSchema)
    .min(1)
    .max(
      MOST_NOTES_PER_TASK,
      `A disagreement names at most ${MOST_NOTES_PER_TASK} notes.`,
    )
    .describe("The notes that disagree, as a listing of them gives them."),
  path: ProjectPathSchema.optional().describe(
    "The place in the code a note disagrees with, from the project root. Leave it out where the notes disagree with each other.",
  ),
  what: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_DISPUTE_MAX,
      `A disagreement is at most ${BUILD_DISPUTE_MAX} characters.`,
    )
    .describe("What each side says, and which the build would have to pick."),
});
export type BuildDispute = z.infer<typeof BuildDisputeSchema>;

/**
 * What a reading session answers with, and the whole of its answer: nothing it
 * writes in prose is read.
 *
 * An EMPTY `needs` is a plan with nothing to ask, where Go is the first thing
 * offered; an EMPTY `disputes` is an account that agrees with itself. An EMPTY
 * `checks` is a project that names no command, and nothing is run.
 */
export const BuildPlanSchema = z.object({
  tasks: z
    .array(BuildTaskSchema)
    .min(1)
    .max(MOST_TASKS, `A plan holds at most ${MOST_TASKS} tasks.`)
    .describe("The pieces the work splits into, each with its own territory."),
  needs: z
    .array(BuildNeedSchema)
    .max(MOST_NEEDS, `A plan asks at most ${MOST_NEEDS} questions.`)
    .describe(
      "What the notes do not say that the build cannot be right without. Empty where they say everything.",
    ),
  disputes: z
    .array(BuildDisputeSchema)
    .max(MOST_DISPUTES, `A plan names at most ${MOST_DISPUTES} disagreements.`)
    .describe(
      "Where two notes, or a note and the code, disagree. Empty where nothing does.",
    ),
  checks: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(
          BUILD_COMMAND_MAX,
          `A command is at most ${BUILD_COMMAND_MAX} characters.`,
        ),
    )
    .max(MOST_CHECKS, `A plan names at most ${MOST_CHECKS} commands.`)
    .describe(
      "The commands this project runs to tell whether it still works, read off the repository — its package scripts, a Makefile, a CI file. Empty where it names none.",
    ),
});
export type BuildPlan = z.infer<typeof BuildPlanSchema>;

/** One command that was run and what came of it. `said` is its own words, cut
 *  to the bound — EMPTY is a command that said nothing, which a passing one
 *  often does. */
export const BuildCheckSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_COMMAND_MAX,
      `A command is at most ${BUILD_COMMAND_MAX} characters.`,
    )
    .describe("The command, as it was run."),
  passed: z.boolean().describe("Whether it came to nothing to fix."),
  said: z
    .string()
    .max(
      BUILD_SAID_MAX,
      `What a check said is cut to ${BUILD_SAID_MAX} characters.`,
    )
    .describe("What it wrote, or as much of it as matters."),
});
export type BuildCheck = z.infer<typeof BuildCheckSchema>;

/**
 * What one session hands on, and the ONLY thing that passes to the next: no
 * transcript travels, so what is not here is lost.
 *
 * An EMPTY `undone` is a session that left nothing; an EMPTY `notes` is one
 * that wrote none. **`finished` false is a session handing on part-way** —
 * because it was asked to before its window filled, or because it was stopped —
 * and a fresh one goes on from this.
 */
export const BuildHandoffSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_SUMMARY_MAX,
      `A summary is at most ${BUILD_SUMMARY_MAX} characters.`,
    )
    .describe("What you built, and what somebody reading the result needs."),
  files: z
    .array(ProjectPathSchema)
    .max(
      MOST_FILES_WRITTEN,
      `A hand-off names at most ${MOST_FILES_WRITTEN} files.`,
    )
    .describe(
      "The files you wrote or changed, from the project root and spelled with /.",
    ),
  checks: z
    .array(BuildCheckSchema)
    .max(MOST_CHECKS, `A hand-off names at most ${MOST_CHECKS} checks.`)
    .describe("Every check you ran and what it said."),
  notes: z
    .array(OwnedRefSchema)
    .max(
      MOST_NOTES_PER_TASK,
      `A hand-off names at most ${MOST_NOTES_PER_TASK} notes.`,
    )
    .describe(
      "The notes you wrote, as the act that wrote them gave them back.",
    ),
  undone: z
    .string()
    .max(
      BUILD_UNDONE_MAX,
      `What is undone is at most ${BUILD_UNDONE_MAX} characters.`,
    )
    .describe(
      "What you left undone, and what the next session would have to pick up. Empty where nothing is left.",
    ),
  finished: z
    .boolean()
    .describe(
      "True where the task is built. False where you are handing on part-way, so a fresh session goes on from this.",
    ),
});
export type BuildHandoff = z.infer<typeof BuildHandoffSchema>;

/** Whether a finding stops the task or is said and left. */
export const BUILD_SEVERITIES = ["blocking", "advisory"] as const;
export type BuildSeverity = (typeof BUILD_SEVERITIES)[number];

/** One thing a review found. **Absent `line` is a finding about the file**
 *  rather than about a place in it. */
export const BuildFindingSchema = z.object({
  file: ProjectPathSchema.describe(
    "The file, from the project root and spelled with /.",
  ),
  line: z
    .int()
    .min(1)
    .optional()
    .describe(
      "The line it is at, counting from 1. Leave it out where it is about the file.",
    ),
  severity: z
    .enum(BUILD_SEVERITIES)
    .describe(
      "'blocking' where the work is not right until it is fixed, 'advisory' where it is worth saying and worth nobody's round-trip.",
    ),
  what: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_FINDING_MAX,
      `A finding is at most ${BUILD_FINDING_MAX} characters.`,
    )
    .describe("What is wrong, in one or two sentences."),
  why: z
    .string()
    .trim()
    .min(1)
    .max(
      BUILD_FINDING_MAX,
      `A reason is at most ${BUILD_FINDING_MAX} characters.`,
    )
    .describe("What it costs, or what it would do that nobody asked for."),
});
export type BuildFinding = z.infer<typeof BuildFindingSchema>;

/**
 * What a reading session answers about one task. **`clean` is the answer** and
 * the findings are the reasons: `clean` false is what sends the task back, and
 * the blocking findings are what the fresh session is told to fix. An EMPTY
 * list with `clean` true is the right answer for work that is right.
 */
export const BuildReviewSchema = z.object({
  clean: z
    .boolean()
    .describe(
      "Whether the work does what the task was for, with nothing to fix.",
    ),
  findings: z
    .array(BuildFindingSchema)
    .max(MOST_FINDINGS, `A review holds at most ${MOST_FINDINGS} findings.`)
    .describe(
      "What you found, one entry per thing. Empty where you found nothing — do not invent one to look thorough.",
    ),
});
export type BuildReview = z.infer<typeof BuildReviewSchema>;

/**
 * The acts a build hands a session, beside the chat's own. A new one is a value
 * here, an entry in {@link BUILD_TOOL_SPECS}, and the role or roles that may
 * call it in {@link toolsForRole}.
 */
export const BUILD_TOOLS = [
  "plan_build",
  "need",
  "done",
  "review_build",
] as const;
export type BuildToolName = (typeof BUILD_TOOLS)[number];

/** `writes` is false on all four: they answer Sloppy, and a build's writing is
 *  the chat's own acts and the code in the task's own checkout. */
export const BUILD_TOOL_SPECS: Record<BuildToolName, ChatToolSpec> = {
  plan_build: {
    description:
      "Answer with the plan for this build: the tasks the work splits into, what each is for, the places each writes and the exact notes each is built from; the questions the notes do not answer; where two notes, or a note and the code, disagree; and the commands this project runs. Read the notes and the code first. This call is the whole of your answer — nothing you write in prose is read.",
    label: "Planning the build",
    arguments: BuildPlanSchema,
    writes: false,
  },
  need: {
    description:
      "Ask the person something the notes do not say and the build cannot be right without. It goes on the build's card and is answered by a note they write, so ask for what belongs in a note rather than for a preference, and ask rather than guessing. Asking pauses what you are doing.",
    label: "Asking what the notes do not say",
    arguments: BuildNeedSchema,
    writes: false,
  },
  done: {
    description:
      "End with what you built: one summary, the files you wrote, every check you ran and what it said, the notes you wrote, and what you left undone. The next session is given this and nothing else of yours, so what is not here is lost.",
    label: "Handing on what it built",
    arguments: BuildHandoffSchema,
    writes: false,
  },
  review_build: {
    description:
      "Answer with what you found reading the task against what it was for: whether it is clean, and a finding per thing that is wrong, each with its place and whether it blocks. Run the checks first. Nothing clean with no findings is the right answer for work that is right.",
    label: "Reading what was built",
    arguments: BuildReviewSchema,
    writes: false,
  },
};

const ROLE_ACTS: Record<BuildRole, readonly BuildToolName[]> = {
  planner: ["plan_build", "need"],
  implementer: ["need", "done"],
  reviewer: ["review_build"],
  merger: ["done"],
};

const SPECS: Record<ChatToolName | BuildToolName, ChatToolSpec> = {
  ...CHAT_TOOL_SPECS,
  ...BUILD_TOOL_SPECS,
};

/**
 * Which acts a role is handed: the chat's reading acts for every one of them,
 * the chat's writing acts for an implementer alone — a build's notes are
 * written where the task works — and the build's own by role.
 *
 * One function, so what a session is advertised and what its calls are held to
 * cannot be two different things.
 */
export function toolsForRole(
  role: BuildRole,
): readonly (ChatToolName | BuildToolName)[] {
  const reading = CHAT_TOOLS.filter((act) => !chatToolWrites(act));
  const writing =
    role === "implementer"
      ? CHAT_TOOLS.filter((act) => chatToolWrites(act))
      : [];
  return [...reading, ...writing, ...ROLE_ACTS[role]];
}

/** The acts a role gets, as the endpoint serving them advertises them —
 *  {@link advertisedChatTools} is the chat's, this is a build's. */
export function advertisedBuildTools(
  role: BuildRole,
): AdvertisedTool<ChatToolName | BuildToolName>[] {
  return toolsForRole(role).map((name) => advertisedAs(name, SPECS[name]));
}

/**
 * Where a build has got to. `reading` is the session making the plan,
 * `answering` the person in front of the card, `building` and `reviewing` the
 * sessions per task, `merging` the tasks going into the line, and `built` the
 * line standing with its checks run.
 *
 * `stopped` is one the person stopped, which keeps what landed and offers to go
 * on; `contested` is one whose task a review could not settle, which is theirs
 * to decide; `discarded` is one whose line and checkouts are gone.
 */
export const BUILD_STATES = [
  "reading",
  "answering",
  "building",
  "reviewing",
  "merging",
  "built",
  "stopped",
  "contested",
  "discarded",
] as const;
export type BuildState = (typeof BUILD_STATES)[number];

/**
 * Where one task has got to. `waiting` is one that has not started — behind
 * {@link BUILD_TASKS_AT_ONCE}, or behind a task in its `after`; `built` is one
 * a review came back clean on, which is waiting to go into the line; `merged`
 * is one that is in it; `contested` is one still blocked after
 * {@link BUILD_ROUNDS_MOST} rounds.
 */
export const BUILD_TASK_STATES = [
  "waiting",
  "building",
  "reviewing",
  "built",
  "contested",
  "merged",
] as const;
export type BuildTaskState = (typeof BUILD_TASK_STATES)[number];

/**
 * How one need was answered. **One of the two is always there**: `note` is the
 * note the person wrote, and `dropped` is a question they set aside. A need
 * with no entry at all has not been answered yet, and a row carrying neither
 * reads the same way.
 */
export const BuildAnswerSchema = z.object({
  note: OwnedRefSchema.optional(),
  dropped: z.literal(true).optional(),
});
export type BuildAnswer = z.infer<typeof BuildAnswerSchema>;

/**
 * What a task's sessions came to. `handoffs` is every one they left, oldest
 * first, and the last is what a fresh session is given. `rounds` is how many
 * times a review sent it back.
 *
 * **Absent `review` is a task no review has answered about yet**, which is
 * every task that has not finished building.
 */
export const BuildTaskRunSchema = z.object({
  state: z.enum(BUILD_TASK_STATES),
  handoffs: z
    .array(BuildHandoffSchema)
    .max(MOST_HANDOFFS, `A task holds at most ${MOST_HANDOFFS} hand-offs.`),
  review: BuildReviewSchema.optional(),
  rounds: z.int().min(0).max(BUILD_ROUNDS_MOST),
});
export type BuildTaskRun = z.infer<typeof BuildTaskRunSchema>;

/** One task gone into the line. `settled` false with an EMPTY `conflicts` is a
 *  merge nothing has run yet; paths are from the root of what the history
 *  keeps, as a merge of git's spells them. */
export const BuildMergeSchema = z.object({
  task: BuildSlugSchema,
  settled: z.boolean(),
  conflicts: z
    .array(z.string().max(DRAFT_PATH_MAX))
    .max(
      MOST_FILES_WRITTEN,
      `A merge names at most ${MOST_FILES_WRITTEN} files.`,
    ),
});
export type BuildMerge = z.infer<typeof BuildMergeSchema>;

/**
 * One build, kept on this device until somebody discards it. `graph` and
 * `project` are what it is a build IN, exactly as a thread carries them, and
 * `about` the notes it was asked for. `line` is the line it writes on, as the
 * history spells one, and `from` the version that line forked at.
 *
 * **Absent `plan` is a build whose reading session has not answered yet.**
 * `answers` is keyed by a need's id and holds only the ones the person has
 * acted on; `tasks` is keyed by a task's id and holds one entry per task in the
 * plan. **Absent `checked` is a line whose checks have not been run**, which is
 * not the same as a line whose checks found nothing.
 */
export const BuildSchema = z.object({
  id: UlidSchema,
  graph: OwnedRefSchema,
  project: z.string().min(1).max(DRAFT_PATH_MAX),
  about: z
    .array(OwnedRefSchema)
    .min(1)
    .max(
      MOST_NOTES_PER_TASK,
      `A build is asked for at most ${MOST_NOTES_PER_TASK} notes.`,
    ),
  name: z.string().min(1).max(BUILD_NAME_MAX),
  line: z.string().min(1).max(BUILD_LINE_MAX),
  from: z.string().min(1).max(DRAFT_COMMIT_MAX),
  state: z.enum(BUILD_STATES),
  plan: BuildPlanSchema.optional(),
  answers: z.record(BuildSlugSchema, BuildAnswerSchema),
  tasks: z.record(BuildSlugSchema, BuildTaskRunSchema),
  merges: z
    .array(BuildMergeSchema)
    .max(MOST_TASKS, `A build holds at most ${MOST_TASKS} merges.`),
  checked: z
    .array(BuildCheckSchema)
    .max(MOST_CHECKS, `A line holds at most ${MOST_CHECKS} checks.`)
    .optional(),
  created: TimestampSchema,
});
export type Build = z.infer<typeof BuildSchema>;

/**
 * A build standing in a repository, as the platform reads one back out of it.
 * `line` is the line, `path` the checkout it is worked on in, and `tasks` the
 * checkouts that are still there — an EMPTY list is a build with none, which is
 * one nothing has started building or one whose tasks have all been finished
 * with.
 *
 * **There is no "when"**, for the reason `StandingDraft` has none: the
 * repository records when a version was kept, and nothing a person decides
 * about a build turns on its age.
 */
export const BuildStandingSchema = z.object({
  id: UlidSchema,
  line: z.string().min(1).max(BUILD_LINE_MAX),
  path: z.string().min(1).max(DRAFT_PATH_MAX),
  from: z.string().min(1).max(DRAFT_COMMIT_MAX),
  tasks: z
    .array(
      z.object({
        task: BuildSlugSchema,
        path: z.string().min(1).max(DRAFT_PATH_MAX),
      }),
    )
    .max(MOST_TASKS, `A build holds at most ${MOST_TASKS} tasks.`),
});
export type BuildStanding = z.infer<typeof BuildStandingSchema>;
