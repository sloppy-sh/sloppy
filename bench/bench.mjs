#!/usr/bin/env node
// The suite's command line; README.md is its manual.
import path from "node:path";
import { parseArgs } from "node:util";
import { exportResults, parseWeights } from "./export.mjs";
import { DEFAULT_JUDGE, judgeRecords } from "./judge/judge.mjs";
import { afterSloppyFile, backfillAfterSloppy } from "./lib/after-sloppy.mjs";
import { BACKENDS, INSTALLED_BACKENDS } from "./lib/backend.mjs";
import {
  BENCH_DIR,
  loadAgents,
  loadProviders,
  loadSubject,
  parseConfig,
  subjectNames,
} from "./lib/config.mjs";
import { loadConditions } from "./lib/condition.mjs";
import { readGrades, readRecords } from "./lib/record.mjs";
import { gradeObjective } from "./lib/grade.mjs";
import { backfillFindability } from "./lib/findability.mjs";
import { writePlaceTasks } from "./lib/place.mjs";
import { backfillPrompts } from "./lib/reconstruct.mjs";
import { formatSummary, summarize } from "./lib/report.mjs";
import { formatRun, openRun } from "./lib/run.mjs";
import { RefusedError, runBatch } from "./lib/runner.mjs";
import { cleanVariants } from "./lib/subject.mjs";
import { listPacks, loadPack } from "./lib/task.mjs";

const list = (v) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

function int(name, v, fallback) {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n))
    throw new RefusedError(`--${name} takes a whole number.`);
  return n;
}

function configsArg(v) {
  return list(v).map((entry) => {
    const config = parseConfig(entry);
    if (!config)
      throw new RefusedError(
        `--configs takes <name>=<sha>[:<path to sloppy.mjs>][:--arg...], comma-separated; "${entry}" is not that.`,
      );
    return config;
  });
}

function subjectArg(v) {
  try {
    return loadSubject(v);
  } catch (err) {
    throw new RefusedError(err.message);
  }
}

const RUN_OPTIONS = {
  backend: { type: "string" },
  model: { type: "string" },
  provider: { type: "string" },
  subject: { type: "string" },
  sha: { type: "string" },
  pack: { type: "string" },
  tasks: { type: "string" },
  conditions: { type: "string" },
  reps: { type: "string" },
  seed: { type: "string" },
  "budget-usd": { type: "string" },
  "timeout-ms": { type: "string" },
  retries: { type: "string" },
  config: { type: "string" },
  configs: { type: "string" },
  out: { type: "string" },
};

async function run(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: RUN_OPTIONS,
    strict: true,
  });
  if (!v.backend)
    throw new RefusedError(
      `Choose a backend with --backend: ${BACKENDS.join(", ")}.`,
    );
  const { file, seed, records } = await runBatch({
    backend: v.backend,
    model: v.model,
    provider: v.provider,
    subjectConfig: subjectArg(v.subject),
    sha: v.sha,
    pack: v.pack,
    tasks: list(v.tasks),
    conditions: list(v.conditions),
    reps: int("reps", v.reps, 1),
    seed: int("seed", v.seed, undefined),
    budgetUsd:
      v["budget-usd"] === undefined ? undefined : Number(v["budget-usd"]),
    timeoutMs: int("timeout-ms", v["timeout-ms"], undefined),
    retries: int("retries", v.retries, 0),
    outDir: v.out ? path.resolve(v.out) : undefined,
    config: v.config,
    configs: configsArg(v.configs),
    objective: gradeObjective,
  });
  process.stderr.write(
    `${records.length} records appended to ${file} (seed ${seed}).\n`,
  );
}

function listAll() {
  const fallback = loadSubject();
  const agents = loadAgents();
  const out = ["Subjects:"];
  for (const name of subjectNames()) {
    const s = loadSubject(name);
    out.push(
      `  ${name}${name === fallback.name ? " (default)" : ""}  ${s.path}  pack ${s.default_pack}  dumps ${s.dump.length} file(s)`,
    );
  }
  out.push("", "Task packs:");
  for (const pack of listPacks())
    for (const t of loadPack(pack))
      out.push(`  ${pack}/${t.id}  ${t.family}  ${t.tools}`);
  out.push("", "Conditions:");
  for (const c of loadConditions().conditions)
    out.push(
      `  ${c.id}  variant ${c.variant}${c.mcp ? ", sloppy tools" : ""}${c.pointed ? ", names the subject's documents of record" : ""}${c.dump ? ", appends the subject's dump files" : ""}${c.lines.length ? `, ${c.lines.length} line(s)` : ""}`,
    );
  out.push("", "Backends:");
  for (const b of BACKENDS) {
    const note = INSTALLED_BACKENDS.includes(b)
      ? agents.allow_installed.includes(b)
        ? "installed agent, allowed"
        : "installed agent, not allowed in agents.json"
      : b === "api"
        ? "model through a provider key"
        : "answers from fixtures";
    out.push(`  ${b}  ${note}`);
  }
  out.push("", "Providers:");
  for (const p of loadProviders())
    out.push(
      `  ${p.id}  ${p.kind}  key in ${p.key_env}${process.env[p.key_env] ? " (set)" : " (not set)"}  models: ${p.models.join(", ")}`,
    );
  process.stdout.write(`${out.join("\n")}\n`);
}

function report(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      run: { type: "string" },
      full: { type: "boolean" },
    },
    strict: true,
  });
  const dir = v.out ? path.resolve(v.out) : path.join(BENCH_DIR, "results");
  if (v.run) {
    const aside = path.join(dir, "superseded");
    const record = [...readRecords(dir), ...readRecords(aside)].find(
      (r) => r.run_id === v.run,
    );
    if (!record)
      throw new RefusedError(`No run in ${dir} has the id ${v.run}.`);
    const grades = [...readGrades(dir), ...readGrades(aside)];
    process.stdout.write(
      `${formatRun(openRun(dir, record, grades), { full: v.full })}\n`,
    );
    return;
  }
  process.stdout.write(
    `${formatSummary(summarize(readRecords(dir), readGrades(dir)))}\n`,
  );
}

async function judge(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      "judge-backend": { type: "string" },
      "judge-model": { type: "string" },
      provider: { type: "string" },
      "budget-usd": { type: "string" },
      "timeout-ms": { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  const kind = v["judge-backend"] ?? DEFAULT_JUDGE.kind;
  const { file, graded, failed, skipped } = await judgeRecords({
    outDir: v.out ? path.resolve(v.out) : undefined,
    kind,
    model:
      v["judge-model"] ??
      (kind === DEFAULT_JUDGE.kind ? DEFAULT_JUDGE.model : "default"),
    provider: v.provider,
    budgetUsd:
      v["budget-usd"] === undefined ? undefined : Number(v["budget-usd"]),
    timeoutMs: int("timeout-ms", v["timeout-ms"], undefined),
  });
  process.stderr.write(
    `${graded} judged, ${failed} the judge could not grade, ${skipped} left for later; grades in ${file}.\n`,
  );
  if (failed) process.exitCode = 1;
}

function exportCommand(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
      to: { type: "string" },
      "no-figures": { type: "boolean" },
      weights: { type: "string" },
      seeds: { type: "string" },
    },
    strict: true,
  });
  const seeds = v.seeds
    ? v.seeds.split(",").map((s) => Number(s.trim()))
    : undefined;
  if (seeds?.some((s) => !Number.isInteger(s)))
    throw new RefusedError(
      "--seeds takes whole numbers separated by commas, like 30 or 21,22.",
    );
  let weights;
  try {
    weights = parseWeights(v.weights);
  } catch (err) {
    throw new RefusedError(err.message);
  }
  const resultsDir = v.out
    ? path.resolve(v.out)
    : path.join(BENCH_DIR, "results");
  const { summary, figures } = exportResults({
    resultsDir,
    outDir: v.to ? path.resolve(v.to) : resultsDir,
    figures: !v["no-figures"],
    weights,
    seeds,
  });
  process.stderr.write(`${[summary, ...figures].join("\n")}\n`);
}

async function backfill(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: { out: { type: "string" } },
    strict: true,
  });
  const resultsDir = v.out
    ? path.resolve(v.out)
    : path.join(BENCH_DIR, "results");
  const { written, skipped } = await backfillPrompts({
    resultsDir,
    repo: path.resolve(BENCH_DIR, ".."),
    subjectRepo: (name) => loadSubject(name).path,
  });
  process.stderr.write(
    `${written.length} prompts rebuilt in ${path.join(resultsDir, "prompts")}` +
      (skipped.length
        ? `; ${skipped.length} records are not committed yet, so there is no commit to rebuild them from.`
        : ".") +
      "\n",
  );
  const counted = backfillAfterSloppy(resultsDir, readRecords(resultsDir));
  process.stderr.write(
    `${counted.length} runs' searches after Sloppy answered counted in ${afterSloppyFile(resultsDir)}.\n`,
  );
}

function findability(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: { out: { type: "string" }, "dry-run": { type: "boolean" } },
    strict: true,
  });
  const resultsDir = v.out
    ? path.resolve(v.out)
    : path.join(BENCH_DIR, "results");
  const { rows, file, missing, untold } = backfillFindability({
    resultsDir,
    dryRun: v["dry-run"],
  });
  const mean = (k) =>
    rows.length
      ? (rows.reduce((n, r) => n + r[k], 0) / rows.length).toFixed(1)
      : "-";
  process.stderr.write(
    `${rows.length} runs read back${v["dry-run"] ? " (dry run, nothing written)" : ` into ${file}`}: ` +
      `${mean("files")} files and ${mean("notes")} notes opened on average; ` +
      `${missing} runs have no transcript, ${untold} a stream that does not say what was read.\n`,
  );
}

function place(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      subject: { type: "string" },
      sha: { type: "string" },
      count: { type: "string" },
    },
    strict: true,
  });
  if (!v.sha)
    throw new RefusedError(
      "Name the subject commit the notes are read from with --sha.",
    );
  const written = writePlaceTasks({
    subject: subjectArg(v.subject),
    sha: v.sha,
    count: int("count", v.count, 5),
    tasksDir: path.join(BENCH_DIR, "tasks"),
    fixturesDir: path.join(BENCH_DIR, "fixtures", "mock"),
  });
  process.stderr.write(`${written.join("\n")}\n`);
}

const USAGE = `Usage: node bench.mjs <command>

  run     --backend <${BACKENDS.join("|")}> --budget-usd <usd> [--model] [--provider]
          [--subject] [--sha] [--pack] [--tasks a,b] [--conditions a,b] [--reps n]
          [--seed n] [--timeout-ms n] [--retries n] [--config name]
          [--configs name=sha[:cli][:--arg...],...] [--out dir]
  list    subjects, tasks, conditions, backends and providers
  report  [--out dir] [--run id [--full]]  a quick table of what results/ holds, or one run:
          what it was sent, its timeline, its answer and grades
  backfill [--out dir]  rebuild results/prompts/ for committed runs made before prompts were kept,
          and count searches after Sloppy answered for runs made before that was counted
  findability [--out dir] [--dry-run]  read what each earlier run opened back from its transcript
  export  [--out dir] [--to dir] [--no-figures] [--weights quality=1,handoff=1,tokens=1,time=1] [--seeds 30]
          summary.json and figures/*.svg for a page
  place   [--subject] --sha <sha> [--count n]  write the subject's two place tasks from its notes
  clean   remove the prepared variants
  judge   [--judge-backend <${BACKENDS.join("|")}>] [--judge-model m] [--provider]
          [--budget-usd usd] [--out dir]  grade every run the judge has not scored`;

const COMMANDS = {
  run,
  list: listAll,
  report,
  export: exportCommand,
  backfill,
  findability,
  place,
  clean: () => {
    for (const dir of cleanVariants()) process.stderr.write(`removed ${dir}\n`);
  },
  judge,
};

const [command, ...rest] = process.argv.slice(2);
const handler = COMMANDS[command];
if (!handler) {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = command ? 2 : 0;
} else {
  try {
    await handler(rest);
  } catch (err) {
    const words = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${words}\n`);
    process.exitCode =
      err instanceof RefusedError || err?.code?.startsWith?.("ERR_PARSE_ARGS")
        ? 2
        : 1;
  }
}
