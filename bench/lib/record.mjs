// One record per run, normalised across backends; README.md § "The record" is the doc of record.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BACKENDS, TOKEN_CLASSES } from "./kinds.mjs";

export const RUN_STATUSES = ["ok", "error", "timeout", "budget"];
export const TASK_FAMILIES = [
  "why",
  "locate",
  "drift",
  "change",
  "brief",
  "place",
  "handoff",
];
export const VARIANTS = ["full", "nodocs", "notes-only"];

const count = z.number().int().nonnegative();
const ms = z.number().nonnegative();
const usd = z.number().nonnegative();

/** Token counts by class; a class the backend cannot tell is 0 here and named in the record's `tokens_unknown`. */
export const TokensSchema = z.object({
  /** Input tokens billed at the full input rate. */
  input: count.default(0),
  /** Input tokens written to a prompt cache. */
  cache_write: count.default(0),
  /** Input tokens served from a prompt cache. */
  cache_read: count.default(0),
  /** Visible output tokens. */
  output: count.default(0),
  /** Reasoning tokens a provider counts apart from output; 0, and known, where it folds them into output. */
  reasoning: count.default(0),
});

export const TokensUnknownSchema = z.array(z.enum(TOKEN_CLASSES));

export const TimingSchema = z.object({
  /** Milliseconds from the runner starting the backend to the backend returning, measured by the runner. */
  wall_ms: ms,
  /** Milliseconds spent waiting on the model's API, as the backend reports it; absent where it cannot tell. */
  api_ms: ms.optional(),
  /** Milliseconds from start to the first streamed token; absent where the backend does not stream or cannot tell. */
  first_token_ms: ms.optional(),
  /** Milliseconds from start to the first tool call; absent where no tool was called. */
  first_tool_ms: ms.optional(),
  /** Milliseconds from start to the final answer's first token; absent where the backend cannot tell. */
  answer_ms: ms.optional(),
});

export const CostSchema = z.object({
  /** USD the backend itself reported for the run; absent where it reports none. */
  reported: usd.optional(),
  /** USD computed from `tokens` and prices.json; absent where the model has no price there or a priced class is in `tokens_unknown`. */
  computed: usd.optional(),
  /** What `computed` was priced at: `list` prices, or `none` where nothing was computed. */
  basis: z.enum(["list", "none"]),
});

export const GradeSchema = z.object({
  /** Objective grader's score in [0, 1]; absent where the task has no objective grader. */
  objective: z.number().min(0).max(1).optional(),
  /** Blind judge's score in [0, 1]; absent where the run has not been judged. */
  judge: z.number().min(0).max(1).optional(),
  /** The score a report uses, in [0, 1]; absent where neither grader has scored. */
  score: z.number().min(0).max(1).optional(),
  /** Grader's words, for a person reading the run. */
  notes: z.string().optional(),
});

/** One model call of the agent's own thread, in order; a subagent's calls are in `tokens` and not here. */
export const IterationSchema = z.object({
  /** Milliseconds from the run's start to the call arriving; 0 where the backend cannot tell. */
  at_ms: ms,
  /** The call's prompt by class: full-rate input, written to the cache, read from it. */
  input: count,
  cache_write: count,
  cache_read: count,
  /** Tokens the call generated, reasoning included. */
  output: count,
});

/** Tokens the prompt of one call held: everything the model was given to read. */
export const promptSize = (it) => it.input + it.cache_write + it.cache_read;

/**
 * `context_final` and `context_mean` from a run's iterations; both absent where there are none,
 * which a reader approximates from the run's totals (README.md § "The record").
 */
export function contextOf(iterations = []) {
  if (iterations.length === 0) return {};
  const sizes = iterations.map(promptSize);
  return {
    context_final: sizes.at(-1),
    context_mean: sizes.reduce((a, b) => a + b, 0) / sizes.length,
  };
}

/** What the runner handed the backend for one run, verbatim. */
export const SentSchema = z.object({
  /** The system prompt from lib/prompt.mjs; an installed agent appends it to its own. */
  system: z.string(),
  /** The task text, the user prompt. */
  prompt: z.string(),
  /** Whether the sloppy server was offered. */
  mcp: z.boolean(),
  /** What the server was started with after `mcp`, such as `--profile=lean`; absent is nothing, or no server. */
  mcp_args: z.array(z.string()).optional(),
  /** How Sloppy's own runner served the acts where it composed the window and drove the model; absent where it did not. */
  harness: z.object({ profile: z.enum(["full"]) }).optional(),
  /** The tools the backend was told to offer, by its own names; the tool set's name where a backend names none. */
  tools: z.array(z.string()),
  /** The model asked for; `default` where none was named and an installed agent chose its own. */
  model: z.string().min(1),
});

/** Distinct files and notes a run opened before answering; README.md § "Metrics". */
export const FindabilitySchema = z.object({
  files: count,
  notes: count,
  /** `files + notes`. */
  opened: count,
});

const OutputSchema = z
  .object({
    /** The agent's final answer, verbatim. */
    text: z.string().default(""),
    /** Paths relative to the variant root that the run left changed. */
    files_changed: z.array(z.string()).default(() => []),
  })
  .prefault({});

/** A handoff run's first stage, whose tree the record's own run started from; README.md § "Handoff tasks". */
export const StageSchema = z.object({
  status: z.enum(["ok", "error", "timeout"]),
  timing: TimingSchema,
  tokens: TokensSchema.prefault({}),
  tokens_unknown: TokensUnknownSchema.default(() => []),
  cost_usd: CostSchema.default(() => ({ basis: "none" })),
  turns: count.default(0),
  tool_calls: z.record(z.string(), count).default(() => ({})),
  mcp_calls: z.record(z.string(), count).default(() => ({})),
  subagent_calls: z.record(z.string(), count).default(() => ({})),
  searches_after_sloppy: count.optional(),
  subagents_spawned: count.default(0),
  iterations: z.array(IterationSchema).default(() => []),
  sent: SentSchema,
  output: OutputSchema,
  /** The message the runner committed the stage's tree with: the one the agent gave, else `Change`. */
  commit_message: z.string().min(1),
  findability: FindabilitySchema.optional(),
  error: z.string().optional(),
});

export const RecordSchema = z.object({
  /** Shape version of this record; a reader refuses a version it does not know. */
  schema: z.literal(1).default(1),
  /** Unique id of this run attempt. */
  run_id: z.string().min(1),
  /** ISO 8601 time the run started. */
  timestamp: z.string().datetime(),
  subject: z.object({
    /** subjects/ file the run was made under; absent on records made before subjects were named, every one of which is `sloppy`. */
    name: z.string().min(1).optional(),
    /** Absolute path of the subject project the variant was made from. */
    path: z.string().min(1),
    /** Full commit sha of the subject the variant was made from. */
    sha: z.string().regex(/^[0-9a-f]{7,64}$/),
    variant: z.enum(VARIANTS),
  }),
  backend: z.object({
    kind: z.enum(BACKENDS),
    /** Model id as the backend named it; `default` where an installed agent chose its own and did not say. */
    model: z.string().min(1),
    /** providers.json id the run was priced and, for `api`, reached through; absent where no provider applies. */
    provider: z.string().optional(),
    /** Version string of the installed agent or harness; absent where it cannot tell. */
    version: z.string().optional(),
  }),
  /** conditions.json id. */
  condition: z.string().min(1),
  /** Named Sloppy configuration the subject was run under; absent means as shipped. */
  config: z.string().min(1).optional(),
  task: z.object({
    pack: z.string().min(1),
    id: z.string().min(1),
    family: z.enum(TASK_FAMILIES),
  }),
  /** Repetition index within the batch, from 0. */
  rep: count,
  /** Seed the batch's run order was drawn from. */
  seed: count,
  /** Attempt index of this run, from 0; a retry is a new record with a higher attempt, and the failed one stays. */
  attempt: count.default(0),
  /** `budget` marks a run the budget stop prevented from starting; it carries no tokens, cost or output. */
  status: z.enum(RUN_STATUSES),
  timing: TimingSchema,
  tokens: TokensSchema.prefault({}),
  /** Token classes the backend could not tell; their 0 in `tokens` is not a count, and no cost is computed over them. */
  tokens_unknown: TokensUnknownSchema.default(() => []),
  cost_usd: CostSchema.default(() => ({ basis: "none" })),
  /** Model turns the run took; 0 where the run never reached the model. */
  turns: count.default(0),
  /** Tool calls by the backend's tool name, sloppy MCP calls excluded; empty where none were made or the backend cannot tell. */
  tool_calls: z.record(z.string(), count).default(() => ({})),
  /** Sloppy MCP calls by bare act name (`search_notes`), counted here and not in tool_calls; empty where none were made. */
  mcp_calls: z.record(z.string(), count).default(() => ({})),
  /** Calls the run's subagents made, by the backend's tool name, sloppy acts under their full `mcp__sloppy__<act>` name; empty where none. */
  subagent_calls: z.record(z.string(), count).default(() => ({})),
  /**
   * Grep, Glob and shell searches the agent made once a Sloppy answer had already named the file the
   * search was pointed at or the agent read next (lib/after-sloppy.mjs); absent where the run made no
   * Sloppy call or its transcript is not one that is counted, and on a record made before it was, whose
   * count is in results/derived/after-sloppy.jsonl.
   */
  searches_after_sloppy: count.optional(),
  /** Subagents the run started; 0 where the condition offered none or the backend could not offer them. */
  subagents_spawned: count.default(0),
  /** What the condition offered that this backend cannot, so the run went without it (`subagents`); empty where nothing was. */
  unsupported: z.array(z.string()).default(() => []),
  /** The agent's own model calls, in order; empty on a record made before they were kept, or where the backend cannot tell. */
  iterations: z.array(IterationSchema).default(() => []),
  /** Prompt size of the last call (input + cache_write + cache_read): how full the context was when the answer was produced. Absent where `iterations` is empty. */
  context_final: count.optional(),
  /** Mean prompt size across the calls; absent where `iterations` is empty. */
  context_mean: z.number().nonnegative().optional(),
  /**
   * What the run was sent; absent on a run the budget never started, and on a record made before it
   * was kept, whose reconstruction is in results/prompts/<run_id>.json (README.md § "The record").
   */
  sent: SentSchema.optional(),
  output: OutputSchema,
  /** Absent on a record made before it was kept, where the transcript cannot tell, and where the run never started. */
  findability: FindabilitySchema.optional(),
  /** A handoff run's first stage; absent on every other family. Where it did not finish `ok`, this run never started and has no `sent`. */
  stage_a: StageSchema.optional(),
  /** Grades written at run time; later grades live in grade records keyed by run_id. */
  grade: GradeSchema.optional(),
  /** What went wrong, in words, where status is not `ok`. */
  error: z.string().optional(),
});

/** A grade written after the run, appended beside the run records rather than into them. */
export const GradeRecordSchema = z.object({
  schema: z.literal(1).default(1),
  run_id: z.string().min(1),
  timestamp: z.string().datetime(),
  grader: z.enum(["objective", "judge"]),
  /** Judge backend and model; absent for an objective grader. */
  judge: z.object({ kind: z.enum(BACKENDS), model: z.string() }).optional(),
  /** Score in [0, 1]. */
  score: z.number().min(0).max(1),
  notes: z.string().optional(),
  /** The judge's score and one-line reason per rubric item; absent for an objective grader. */
  items: z
    .array(
      z.object({
        criterion: z.string(),
        score: z.number().min(0).max(1),
        reason: z.string(),
      }),
    )
    .optional(),
  /** What grading this run spent, where a model graded it; absent for an objective grader. */
  tokens: TokensSchema.optional(),
  tokens_unknown: TokensUnknownSchema.optional(),
  cost_usd: CostSchema.optional(),
});

/** The stages of a run that started: a handoff's stage A, then the run itself. */
const startedStages = (r) => [r.stage_a, r].filter((s) => s?.sent);

const costOfStage = (s) => s.cost_usd.computed ?? s.cost_usd.reported;

/** USD the run spent over every stage it started; undefined where any of them has no cost, or none started. */
export function runCost(r) {
  const stages = startedStages(r);
  if (stages.length === 0) return costOfStage(r);
  const costs = stages.map(costOfStage);
  return costs.includes(undefined)
    ? undefined
    : costs.reduce((a, b) => a + b, 0);
}

/** Tokens of `classes` over every stage; undefined where any stage could not tell one of them. */
export function runTokens(r, classes) {
  const stages = startedStages(r);
  const all = stages.length ? stages : [r];
  if (all.some((s) => classes.some((c) => s.tokens_unknown?.includes(c))))
    return undefined;
  return all.reduce(
    (n, s) => n + classes.reduce((m, c) => m + s.tokens[c], 0),
    0,
  );
}

/** Wall milliseconds over every stage. */
/**
 * A failure that is the provider's, never the run's: a rate limit, an overload, a quota, or the API
 * unreachable. Only the failure is read, never the answer. The runner runs such a run again without
 * spending its retries, and no score or mean counts it: its time is backoff and its answer absent.
 */
export const providerFailed = (r) =>
  r.status !== "ok" &&
  /rate limit|rate-limit|\b429\b|overloaded|too many requests|quota|usage limit|limit reached|can'?t reach the api|api server|unreachable|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    r.error ?? "",
  );

export const runWallMs = (r) =>
  r.timing.wall_ms + (r.stage_a?.timing.wall_ms ?? 0);

export function newRecord(partial) {
  return RecordSchema.parse({
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...partial,
  });
}

/** Appends one validated record as a JSONL line; the file is only ever appended to. */
export function appendRecord(file, record) {
  const valid = RecordSchema.parse(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(valid)}\n`);
  return valid;
}

export function appendGrade(file, grade) {
  const valid = GradeRecordSchema.parse(grade);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(valid)}\n`);
  return valid;
}

function readJsonl(file, schema) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const parsed = schema.safeParse(JSON.parse(line));
      if (!parsed.success)
        throw new Error(
          `${file}:${i + 1} is not a valid record: ${parsed.error.message}`,
        );
      return parsed.data;
    });
}

function jsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Every run record in `dir`'s `*.jsonl` files, file by file in name order. */
export function readRecords(dir) {
  return jsonlFiles(dir).flatMap((f) => readJsonl(f, RecordSchema));
}

/** Findability read back from a kept transcript, for a record made before it was recorded; keyed by run_id. */
export const FindabilityRecordSchema = z.object({
  schema: z.literal(1).default(1),
  run_id: z.string().min(1),
  timestamp: z.string().datetime(),
  files: count,
  notes: count,
  opened: count,
});

export function appendFindability(file, row) {
  const valid = FindabilityRecordSchema.parse(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(valid)}\n`);
  return valid;
}

/** Every findability record in `dir/findability/*.jsonl`. */
export function readFindability(dir) {
  return jsonlFiles(path.join(dir, "findability")).flatMap((f) =>
    readJsonl(f, FindabilityRecordSchema),
  );
}

/** Every grade record in `dir/grades/*.jsonl`. */
export function readGrades(dir) {
  return jsonlFiles(path.join(dir, "grades")).flatMap((f) =>
    readJsonl(f, GradeRecordSchema),
  );
}

/** `results/<backend>-<model>-<YYYY-MM-DD>.jsonl`, with the model made safe for a file name. */
export function resultsFile(dir, backendKind, model, date = new Date()) {
  const safeModel = model.replace(/[^A-Za-z0-9._-]/g, "_");
  const day = date.toISOString().slice(0, 10);
  return path.join(dir, `${backendKind}-${safeModel}-${day}.jsonl`);
}
