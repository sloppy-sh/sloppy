// Grades every run the judge has not yet scored, blind to how the answer was produced.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isInstalledBackend, runBackend } from "../lib/backend.mjs";
import { BENCH_DIR, loadAgents, loadProviders } from "../lib/config.mjs";
import { BACKENDS, TOKEN_CLASSES } from "../lib/kinds.mjs";
import { computeCost, loadPrices } from "../lib/prices.mjs";
import { appendGrade, readGrades, readRecords } from "../lib/record.mjs";
import { RefusedError } from "../lib/backend.mjs";
import { loadPack, TASKS_DIR } from "../lib/task.mjs";
import {
  JUDGE_SYSTEM,
  judgePrompt,
  mockVerdict,
  parseVerdict,
} from "./rubric.mjs";

export const DEFAULT_JUDGE = { kind: "claude-code", model: "sonnet" };

/** Runs that finished ok and carry no judge score, at run time or in a grade record. */
export function ungraded(records, grades) {
  const judged = new Set(
    grades.filter((g) => g.grader === "judge").map((g) => g.run_id),
  );
  return records.filter(
    (r) =>
      r.status === "ok" &&
      r.grade?.judge === undefined &&
      !judged.has(r.run_id),
  );
}

function judgeFile(outDir, kind, model, date = new Date()) {
  const safe = model.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(
    outDir,
    "grades",
    `judge-${kind}-${safe}-${date.toISOString().slice(0, 10)}.jsonl`,
  );
}

/** One judge call. `ask` is handed the judge's request and nothing of the run but its task and text. */
async function askJudge(
  { kind, model, provider, agent, timeoutMs, budgetUsd, agents },
  view,
) {
  if (kind === "mock")
    return { text: mockVerdict(view), status: "ok", tokens: undefined };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sloppy-bench-judge-"));
  try {
    return await runBackend(
      kind,
      {
        cwd,
        systemPrompt: JUDGE_SYSTEM,
        prompt: judgePrompt(view),
        tools: "none",
        model,
        timeoutMs,
        budgetUsd,
        taskId: "judge",
        agent,
        provider,
      },
      { agents },
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Appends one judge grade record per ungraded run in `outDir`, until `budgetUsd` is spent.
 * @returns {Promise<{ file: string, graded: number, failed: number, skipped: number }>}
 */
export async function judgeRecords({
  outDir = path.join(BENCH_DIR, "results"),
  kind = DEFAULT_JUDGE.kind,
  model = DEFAULT_JUDGE.model,
  provider: providerId,
  budgetUsd = 5,
  timeoutMs = 300_000,
  tasksDir = TASKS_DIR,
  agents = loadAgents(),
  providers = loadProviders(),
  prices = loadPrices(path.join(BENCH_DIR, "prices.json")),
  log = (line) => process.stderr.write(`${line}\n`),
}) {
  if (!BACKENDS.includes(kind))
    throw new RefusedError(
      `There is no judge backend called "${kind}". Choose one of: ${BACKENDS.join(", ")}.`,
    );
  let agent;
  let provider;
  let priceProvider = providerId;
  if (isInstalledBackend(kind)) {
    agent = agents.installed[kind];
    priceProvider ??= agent?.provider;
  } else if (kind === "api") {
    provider = providers.find((p) => p.id === providerId);
    if (!provider)
      throw new RefusedError(
        `The api judge needs --provider naming one of: ${providers.map((p) => p.id).join(", ")}.`,
      );
    if (!process.env[provider.key_env])
      throw new RefusedError(
        `Set ${provider.key_env} in the environment to judge with ${provider.id}.`,
      );
  }

  const packs = new Map();
  const taskFor = (record) => {
    if (!packs.has(record.task.pack))
      packs.set(record.task.pack, loadPack(record.task.pack, tasksDir));
    return packs.get(record.task.pack).find((t) => t.id === record.task.id);
  };

  const todo = ungraded(readRecords(outDir), readGrades(outDir));
  const file = judgeFile(outDir, kind, model);
  let spent = 0;
  let graded = 0;
  let failed = 0;
  let skipped = 0;
  for (const record of todo) {
    if (spent >= budgetUsd) {
      skipped += 1;
      continue;
    }
    const task = taskFor(record);
    if (!task) {
      log(
        `${record.run_id}: the ${record.task.pack} pack has no task ${record.task.id}; not judged.`,
      );
      skipped += 1;
      continue;
    }
    const answer = await askJudge(
      {
        kind,
        model,
        provider,
        agent,
        timeoutMs,
        budgetUsd: budgetUsd - spent,
        agents,
      },
      { task, text: record.output.text },
    );
    const tokensUnknown = answer.tokens
      ? (answer.tokensUnknown ?? [])
      : kind === "mock"
        ? []
        : TOKEN_CLASSES;
    const tokens = answer.tokens ?? {};
    const computed = answer.unpriced
      ? undefined
      : computeCost(
          prices,
          { provider: priceProvider, model: answer.model ?? model },
          tokens,
          tokensUnknown,
        );
    const cost = computed ?? answer.costReported ?? 0;
    spent += cost;
    if (answer.status !== "ok") {
      failed += 1;
      log(
        `${record.task.id} ${record.run_id}: the judge did not answer (${answer.error ?? answer.status}).`,
      );
      continue;
    }
    let verdict;
    try {
      verdict = parseVerdict(answer.text, task.rubric);
    } catch (err) {
      failed += 1;
      log(`${record.task.id} ${record.run_id}: ${err.message}`);
      continue;
    }
    appendGrade(file, {
      run_id: record.run_id,
      timestamp: new Date().toISOString(),
      grader: "judge",
      judge: { kind, model: answer.model ?? model },
      score: verdict.score,
      items: verdict.items,
      notes: verdict.items.map((i) => `${i.score} ${i.reason}`).join("\n"),
      tokens,
      tokens_unknown: tokensUnknown,
      cost_usd: {
        reported: answer.costReported,
        computed,
        basis: computed === undefined ? "none" : "list",
      },
    });
    graded += 1;
    log(
      `${record.task.id} ${record.run_id.slice(0, 8)}: ${verdict.score.toFixed(2)}`,
    );
  }
  return { file, graded, failed, skipped };
}
