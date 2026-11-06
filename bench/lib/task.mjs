// Task packs, bench/tasks/<pack>/<task>.json; README.md § "Tasks" is the doc of record.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BENCH_DIR } from "./config.mjs";
import { stageAPrompt } from "./handoff.mjs";
import { TASK_FAMILIES } from "./record.mjs";

export const TASKS_DIR = path.join(BENCH_DIR, "tasks");

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

/** Where a key, a fact or a rubric item comes from: a document of the subject and the sentence in it. */
const SourceSchema = z.object({
  /** Subject-relative path of the document. */
  doc: z.string().min(1),
  /** The sentence, or the heading and sentence, quoted from it. */
  quote: z.string().min(1),
});

const pattern = z.string().refine((p) => {
  try {
    new RegExp(p, "i");
    return true;
  } catch {
    return false;
  }
}, "not a valid regular expression");

/** A fact an answer states, as a case-insensitive regular expression, with where the fact comes from. */
const FactSchema = z.object({ pattern, source: SourceSchema });

/** Names an answer gives: any one of `any` appearing verbatim counts. */
const NameSchema = z.object({
  any: z.array(z.string().min(1)).min(1),
  source: z.string().min(1).optional(),
});

/** An objective check, run by the grader after the agent finishes; the agent never sees it. */
export const GraderSchema = z.discriminatedUnion("kind", [
  z.object({
    /** Case-insensitive substrings looked for in the answer text; the score is the fraction found. */
    kind: z.literal("contains"),
    all: z.array(z.string().min(1)).default(() => []),
    /** At least one of these must appear, counted as one more check. */
    any: z.array(z.string().min(1)).default(() => []),
    /** None of these may appear, each counted as one more check. */
    none: z.array(z.string().min(1)).default(() => []),
  }),
  z.object({
    /** The fraction of `required` the answer states, less one share for each `forbidden` it states, floored at 0. */
    kind: z.literal("facts"),
    required: z.array(FactSchema).min(1),
    forbidden: z.array(FactSchema).default(() => []),
  }),
  z.object({
    /** The fraction of `names` (paths, exported symbols) the answer gives, matched case-sensitively. */
    kind: z.literal("files"),
    names: z.array(NameSchema).min(1),
  }),
  z.object({
    /** A command run in the variant after the agent; exit 0 scores 1, anything else 0. `node` runs as the runner's own node. */
    kind: z.literal("command"),
    command: z.array(z.string().min(1)).min(1),
    /** Variant-relative path → bench-relative source, copied in just before the command, so the agent never saw them. */
    hidden: z.record(z.string(), z.string()).default(() => ({})),
    timeout_ms: z.number().int().positive().default(120000),
  }),
  z.object({
    /** Where each note a place task took out was written back, read from the container after the run. */
    kind: z.literal("placement"),
    container: z.string().min(1),
    notes: z
      .array(
        z.object({
          ulid: z.string().min(1),
          title: z.string().min(1),
          /** The ULID of the note it sprang out of. */
          parent: z.string().min(1),
          parent_title: z.string(),
          /** The parent's own parent; null where the parent has none. */
          grandparent: z.string().min(1).nullable(),
          /** ULIDs of the notes it named, its parent and any note taken out with it left out. */
          links: z.array(z.string().min(1)),
        }),
      )
      .min(1),
  }),
  z.object({
    /** No objective check fits; the judge alone scores the task. */
    kind: z.literal("none"),
  }),
]);

const SetupSchema = z.union([
  z.object({
    /** A unified diff applied and committed in the variant, so the planted change reads as history rather than as a pending edit. */
    patch: z.string().min(1),
    /** Commit message for the planted change. */
    message: z.string().min(1).default("Update"),
  }),
  z.object({
    /** A bench-relative file holding the diff; loadPack reads it into `patch`. */
    patch_file: z.string().min(1),
    message: z.string().min(1).default("Update"),
  }),
  z.object({
    /** Notes taken out of the container, their children hung from each one's parent, with no trace in the variant's history. */
    remove_notes: z.object({
      container: z.string().min(1),
      notes: z.array(z.string().min(1)).min(1),
    }),
  }),
]);

const SINGLE_FAMILIES = TASK_FAMILIES.filter((f) => f !== "handoff");

const SingleTaskSchema = z.object({
  /** Equal to the file's base name. */
  id,
  family: z.enum(SINGLE_FAMILIES),
  /** The task text the agent receives, verbatim, under every condition. */
  prompt: z.string().min(1),
  /** `read` for a question; `write` for a task that edits files. */
  tools: z.enum(["read", "write"]),
  /** What a right answer holds, in words, for the judge; never shown to the agent. */
  key: z.string().min(1),
  /** The sentences of the subject's documents the key is written from; absent in a pack that cites none. */
  sources: z.array(SourceSchema).min(1).optional(),
  /** Absent where no objective check fits the task; the judge alone then scores it. */
  grader: GraderSchema.optional(),
  /** Criteria the blind judge scores against; each scores 0 to its points. */
  rubric: z
    .array(
      z.object({ criterion: z.string().min(1), points: z.number().positive() }),
    )
    .min(1),
  /** Prepared in the variant before the agent starts; absent means the variant as it is. */
  setup: SetupSchema.optional(),
  /** How a place task's notes were chosen: the subject commit, the rule in words, and its arguments. */
  selection: z
    .object({
      sha: z.string().min(1),
      kind: z.enum(["thoughts", "root"]),
      count: z.number().int().positive(),
      rule: z.string().min(1),
    })
    .optional(),
});

/** Two stages in one condition: A changes the code for a reason only its prompt holds, B is asked what turns on it. */
const HandoffTaskSchema = z.object({
  id,
  family: z.literal("handoff"),
  /** Stage A's change and its reason; lib/handoff.mjs adds the closing every stage A is sent. */
  prompt_a: z.string().min(1),
  /** Stage B's question or decision; never states the reason. */
  prompt_b: z.string().min(1),
  /** The new fact stage A is given, for a reader of the task; sent to neither B nor the judge. */
  reason: z.string().min(1),
  /** What B's right answer holds. */
  key: z.string().min(1),
  sources: z.array(SourceSchema).min(1).optional(),
  grader: GraderSchema.optional(),
  rubric: z
    .array(
      z.object({ criterion: z.string().min(1), points: z.number().positive() }),
    )
    .min(1),
});

export const TaskSchema = z.union([SingleTaskSchema, HandoffTaskSchema]);

/**
 * A handoff task as the runner and the judge read it: `prompt` and `tools` are stage B's, and
 * `stage_a` what stage A is sent.
 */
function readHandoff(task) {
  if (task.family !== "handoff") return task;
  return {
    ...task,
    prompt: task.prompt_b,
    tools: "history",
    stage_a: { prompt: stageAPrompt(task), tools: "edit" },
  };
}

function readSetup(setup, file) {
  if (!setup?.patch_file) return setup;
  const patchFile = path.resolve(BENCH_DIR, setup.patch_file);
  if (!fs.existsSync(patchFile))
    throw new Error(
      `${file} names a patch at ${setup.patch_file}, and there is none.`,
    );
  return { patch: fs.readFileSync(patchFile, "utf8"), message: setup.message };
}

export function loadPack(pack, dir = TASKS_DIR) {
  const packDir = path.join(dir, pack);
  if (!fs.existsSync(packDir))
    throw new Error(`There is no task pack called "${pack}" in ${dir}.`);
  return fs
    .readdirSync(packDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = path.join(packDir, f);
      const parsed = TaskSchema.safeParse(
        JSON.parse(fs.readFileSync(file, "utf8")),
      );
      if (!parsed.success)
        throw new Error(`${file} is not a valid task: ${parsed.error.message}`);
      if (parsed.data.id !== path.basename(f, ".json"))
        throw new Error(
          `${file} names its task "${parsed.data.id}"; a task's id is its file name.`,
        );
      const task = readHandoff(parsed.data);
      const setup = readSetup(task.setup, file);
      return setup ? { ...task, setup } : task;
    });
}

export function listPacks(dir = TASKS_DIR) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}
