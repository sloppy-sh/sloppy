// A batch of runs; README.md § "Fairness" names what this enforces.
import fs from "node:fs";
import path from "node:path";
import { afterSloppyOf } from "./after-sloppy.mjs";
import {
  assertAllowed,
  isInstalledBackend,
  loadBackend,
  RefusedError,
  runBackend,
  sentTools,
} from "./backend.mjs";
import {
  BENCH_DIR,
  loadAgents,
  loadProviders,
  loadSubject,
} from "./config.mjs";
import { loadConditions, selectConditions } from "./condition.mjs";
import { BACKENDS, TOKEN_CLASSES } from "./kinds.mjs";
import { planRuns, randomSeed } from "./order.mjs";
import { computeCost, loadPrices } from "./prices.mjs";
import { buildPrompt } from "./prompt.mjs";
import { findabilityOf } from "./findability.mjs";
import { commitMessageOf } from "./handoff.mjs";
import {
  appendRecord,
  contextOf,
  newRecord,
  resultsFile,
  runCost,
  runTokens,
  runWallMs,
} from "./record.mjs";
import { writeTranscript } from "./transcript.mjs";
import {
  applySetup,
  changedFiles,
  commitAll,
  defaultWorkRoot,
  headOf,
  prepareVariant,
  resetVariant,
  resolveSha,
} from "./subject.mjs";
import { loadPack, TASKS_DIR } from "./task.mjs";

/** Grace past the backend's own timeout before the runner stops waiting on it. */
const TIMEOUT_GRACE_MS = 30_000;

export { RefusedError };

const refuse = (words) => {
  throw new RefusedError(words);
};

/** What a backend kind runs as: its agents.json entry and the provider it is priced under. */
function resolveBackend({
  backend,
  model,
  provider: providerId,
  agents,
  providers,
}) {
  if (!BACKENDS.includes(backend))
    refuse(
      `There is no backend called "${backend}". Choose one of: ${BACKENDS.join(", ")}.`,
    );
  assertAllowed(backend, agents);
  if (isInstalledBackend(backend)) {
    const agent = agents.installed[backend];
    if (!agent)
      refuse(
        `bench/agents.json says nothing about how to start ${backend}; add it under "installed".`,
      );
    return { agent, priceProvider: providerId ?? agent.provider };
  }
  if (backend === "api") {
    if (!providerId)
      refuse(
        `The api backend needs --provider; choose one of: ${providers.map((p) => p.id).join(", ")}.`,
      );
    const provider = providers.find((p) => p.id === providerId);
    if (!provider)
      refuse(
        `There is no provider called "${providerId}" in bench/providers.json.`,
      );
    if (!model)
      refuse(
        `The api backend needs --model; ${provider.id} lists: ${provider.models.join(", ")}.`,
      );
    if (!provider.models.includes(model))
      refuse(
        `${provider.id} does not list ${model} in bench/providers.json; add it there to run it.`,
      );
    if (!process.env[provider.key_env])
      refuse(
        `Set ${provider.key_env} in the environment to run ${provider.id}.`,
      );
    return { provider, priceProvider: provider.id };
  }
  return { priceProvider: providerId };
}

function pickTasks(pack, ids, tasksDir) {
  const all = loadPack(pack, tasksDir);
  if (ids.length === 0) return all;
  return ids.map(
    (id) =>
      all.find((t) => t.id === id) ??
      refuse(`The ${pack} pack has no task called "${id}".`),
  );
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: "timeout",
          error: `The agent had not finished after ${Math.round(ms / 1000)} seconds.`,
        }),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grades one run. The judge is handed the task and the answer text only, never the condition, the
 * variant's folder or the run's tool and MCP calls, so it cannot tell which condition it is scoring.
 */
async function gradeRun(graders, { task, dir, output }, onFail) {
  const grade = {};
  const notes = [];
  const views = {
    objective: () => ({ task, dir, output: { ...output } }),
    judge: () => ({ task, text: output.text }),
  };
  for (const [name, view] of Object.entries(views)) {
    if (!graders[name]) continue;
    try {
      const result = await graders[name](view());
      if (result === undefined) continue;
      grade[name] = result.score;
      if (result.notes) notes.push(result.notes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`The ${name} grader failed: ${message}`);
      onFail(message);
    }
  }
  const scores = [grade.objective, grade.judge].filter((s) => s !== undefined);
  if (scores.length)
    grade.score = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (notes.length) grade.notes = notes.join("\n");
  return grade;
}

/**
 * The configurations a batch runs: `configs` where given, else the one `config` label at `sha`.
 * Each comes back with its full sha and the CLI its mcp conditions are served by.
 */
function resolveConfigs(opts, subjectPath, defaultCli) {
  if (!opts.configs?.length)
    return [
      {
        name: opts.config,
        sha: resolveSha(subjectPath, opts.sha ?? "HEAD"),
        cli: defaultCli,
        args: [],
      },
    ];
  if (opts.config !== undefined || opts.sha !== undefined)
    refuse(
      "--configs names each configuration's commit; leave out --config and --sha.",
    );
  const names = opts.configs.map((c) => c.name);
  const repeated = names.find((n, i) => names.indexOf(n) !== i);
  if (repeated) refuse(`--configs names "${repeated}" twice.`);
  return opts.configs.map(({ name, sha, cli, args = [] }) => {
    if (!name || !sha)
      refuse(
        "Each of --configs takes the form <name>=<sha>[:<path to sloppy.mjs>][:--arg...].",
      );
    if (cli !== undefined && !path.isAbsolute(cli))
      refuse(
        `The CLI given for ${name} is not an absolute path: ${cli}. Give the full path to its sloppy.mjs.`,
      );
    return {
      name,
      sha: resolveSha(subjectPath, sha),
      cli: cli ?? defaultCli,
      args,
    };
  });
}

/**
 * Runs every task × condition × config × rep in the one order `seed` draws, appending one record
 * per attempt to `outDir`. Runs left when the budget is spent are recorded with status `budget` and never started.
 * After each finished run, `objective({ task, dir, output })` is called with the variant still as the agent
 * left it, and `judge({ task, text })` with the answer alone; each returns `{ score, notes? }`, or
 * undefined where it has nothing to score. `subjectConfig` is a loaded subject file, the default
 * subject where absent; `subject` replaces its path.
 * @returns {Promise<{ file: string, seed: number, records: object[] }>}
 */
export async function runBatch(opts) {
  const {
    backend,
    model,
    subject: subjectArg,
    tasks: taskIds = [],
    conditions: conditionIds = [],
    reps = 1,
    seed = randomSeed(),
    budgetUsd,
    timeoutMs = 600_000,
    retries = 0,
    outDir = path.join(BENCH_DIR, "results"),
    workRoot = defaultWorkRoot(),
    tasksDir = TASKS_DIR,
    conditionsFile,
    agents = loadAgents(),
    providers = loadProviders(),
    prices = loadPrices(path.join(BENCH_DIR, "prices.json")),
    subjectConfig = loadSubject(),
    objective,
    judge,
    log = (line) => process.stderr.write(`${line}\n`),
  } = opts;

  if (!(budgetUsd > 0))
    refuse(
      "Give the batch a budget with --budget-usd; no run starts without one.",
    );
  if (!Number.isInteger(reps) || reps < 1)
    refuse("--reps takes a whole number of at least 1.");
  if (!Number.isInteger(retries) || retries < 0)
    refuse("--retries takes a whole number of at least 0.");

  const resolved = resolveBackend({
    backend,
    model,
    provider: opts.provider,
    agents,
    providers,
  });
  const backendImpl = await loadBackend(backend);
  const subjectPath = path.resolve(subjectArg ?? subjectConfig.path);
  const pack = opts.pack ?? subjectConfig.default_pack;
  const tasks = pickTasks(pack, taskIds, tasksDir);
  const conditionSet = loadConditions(conditionsFile);
  const conditions = selectConditions(conditionSet, conditionIds);

  const configs = resolveConfigs(
    opts,
    subjectPath,
    path.resolve(subjectPath, subjectConfig.sloppy_cli),
  );
  if (!backendImpl.simulated && conditions.some((c) => c.mcp))
    for (const { cli } of configs)
      if (!fs.existsSync(cli))
        refuse(
          `The mcp conditions need the Sloppy CLI built at ${cli}; build it first (pnpm --filter @sloppy/cli build).`,
        );

  const variantKey = (variant, sha) => `${variant}\t${sha}`;
  const variants = new Map();
  for (const { sha } of configs)
    for (const v of new Set(conditions.map((c) => c.variant)))
      if (!variants.has(variantKey(v, sha)))
        variants.set(
          variantKey(v, sha),
          prepareVariant(subjectPath, v, sha, {
            workRoot,
            subject: subjectConfig,
          }),
        );

  const plan = planRuns(tasks, conditions, reps, seed, configs);
  const file = resultsFile(outDir, backend, model ?? "default");
  const records = [];
  let spent = 0;
  /** What the dearest run so far cost: a run killed at its time limit reports nothing and is charged this. */
  let dearest = 0;
  let stopped;

  const base = (item, attempt) => ({
    subject: {
      name: subjectConfig.name,
      path: subjectPath,
      sha: item.config.sha,
      variant: item.condition.variant,
    },
    backend: {
      kind: backend,
      model: model ?? "default",
      provider: resolved.priceProvider,
    },
    condition: item.condition.id,
    config: item.config.name,
    task: { pack, id: item.task.id, family: item.task.family },
    rep: item.rep,
    seed,
    attempt,
  });

  /** One agent session in `dir`: what it was sent, what it answered, and what that cost. */
  const runStage = async (item, dir, { task, tools, budgetLeft }) => {
    const head = headOf(dir);
    const { systemPrompt, prompt } = buildPrompt({
      task,
      condition: item.condition,
      baseSystem: conditionSet.base_system,
      variantDir: dir,
      dump: subjectConfig.dump,
      pointed: subjectConfig.pointed,
    });
    const request = {
      cwd: dir,
      systemPrompt,
      prompt,
      tools,
      mcp: item.condition.mcp
        ? {
            command: process.execPath,
            args: [item.config.cli, "mcp", ...item.config.args],
          }
        : undefined,
      subagents: item.condition.subagents === true,
      model,
      timeoutMs,
      budgetUsd: budgetLeft,
      taskId: task.mock_id ?? task.id,
      agent: resolved.agent,
      provider: resolved.provider,
    };
    const sent = {
      system: systemPrompt,
      prompt,
      mcp: request.mcp !== undefined,
      ...(request.mcp !== undefined && item.config.args.length > 0
        ? { mcp_args: item.config.args }
        : {}),
      tools: sentTools(backendImpl, request),
      model: model ?? "default",
    };

    const timestamp = new Date().toISOString();
    const started = performance.now();
    let answer;
    try {
      answer = await withTimeout(
        runBackend(backend, request, { agents }),
        timeoutMs + TIMEOUT_GRACE_MS,
      );
    } catch (err) {
      answer = {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const wall_ms = Math.round(performance.now() - started);

    const tokens = answer.tokens ?? {};
    const tokensUnknown = answer.tokens
      ? (answer.tokensUnknown ?? [])
      : TOKEN_CLASSES;
    const answeredModel = answer.model ?? model ?? "default";
    const computed = answer.unpriced
      ? undefined
      : computeCost(
          prices,
          { provider: resolved.priceProvider, model: answeredModel },
          tokens,
          tokensUnknown,
        );
    const findability = findabilityOf(backend, answer.events);
    return {
      timestamp,
      answer,
      answeredModel,
      fields: {
        status: answer.status,
        timing: { ...answer.timing, wall_ms },
        tokens,
        tokens_unknown: tokensUnknown,
        cost_usd: {
          reported: answer.costReported,
          computed,
          basis: computed === undefined ? "none" : "list",
        },
        turns: answer.turns ?? 0,
        tool_calls: answer.toolCalls ?? {},
        mcp_calls: answer.mcpCalls ?? {},
        subagent_calls: answer.subagentCalls ?? {},
        searches_after_sloppy: afterSloppyOf(backend, answer.events),
        subagents_spawned: answer.subagentsSpawned ?? 0,
        iterations: answer.iterations ?? [],
        sent,
        output: {
          text: answer.text ?? "",
          files_changed: answer.filesChanged?.length
            ? answer.filesChanged
            : changedFiles(dir, head),
        },
        ...(findability ? { findability } : {}),
        error: answer.error,
      },
    };
  };

  const stageCost = (fields) =>
    fields.cost_usd.computed ?? fields.cost_usd.reported ?? 0;

  /** A handoff's stage A, its tree committed with the message it gave; README.md § "Handoff tasks". */
  const runStageA = async (item, dir) => {
    const a = await runStage(item, dir, {
      task: {
        ...item.task,
        prompt: item.task.stage_a.prompt,
        mock_id: `${item.task.id}.a`,
      },
      tools: item.task.stage_a.tools,
      budgetLeft: budgetUsd - spent,
    });
    const commit_message = commitMessageOf(a.fields.output.text);
    if (a.fields.status === "ok") commitAll(dir, commit_message);
    return {
      a,
      stage_a: { ...a.fields, commit_message },
    };
  };

  const runOnce = async (item, attempt) => {
    const { dir } = variants.get(
      variantKey(item.condition.variant, item.config.sha),
    );
    resetVariant(dir);
    if (item.task.setup) applySetup(dir, item.task.setup);

    const handoff = item.task.stage_a ? await runStageA(item, dir) : undefined;
    if (handoff && handoff.stage_a.status !== "ok") {
      const record = newRecord({
        ...base(item, attempt),
        timestamp: handoff.a.timestamp,
        backend: {
          kind: backend,
          model: handoff.a.answeredModel,
          provider: resolved.priceProvider,
          version: handoff.a.answer.version,
        },
        status: handoff.stage_a.status,
        timing: { wall_ms: 0 },
        stage_a: handoff.stage_a,
        error: `Stage A did not finish, so stage B never started: ${handoff.stage_a.error ?? handoff.stage_a.status}`,
      });
      if (handoff.a.answer.events?.length)
        writeTranscript(outDir, `${record.run_id}.a`, handoff.a.answer.events);
      return appendRecord(file, record);
    }

    const b = await runStage(item, dir, {
      task: item.task,
      tools: item.task.tools,
      budgetLeft:
        budgetUsd - spent - (handoff ? stageCost(handoff.stage_a) : 0),
    });
    const record = newRecord({
      ...base(item, attempt),
      timestamp: handoff?.a.timestamp ?? b.timestamp,
      backend: {
        kind: backend,
        model: b.answeredModel,
        provider: resolved.priceProvider,
        version: b.answer.version,
      },
      ...b.fields,
      unsupported: b.answer.unsupported ?? [],
      ...contextOf(b.answer.iterations),
      ...(handoff ? { stage_a: handoff.stage_a } : {}),
    });
    if (record.status === "ok" && (objective || judge))
      record.grade = await gradeRun(
        { objective, judge },
        { task: item.task, dir, output: record.output },
        (message) => log(`grading ${item.task.id} failed: ${message}`),
      );
    if (b.answer.events?.length)
      writeTranscript(outDir, record.run_id, b.answer.events);
    if (handoff?.a.answer.events?.length)
      writeTranscript(outDir, `${record.run_id}.a`, handoff.a.answer.events);
    return appendRecord(file, record);
  };

  for (const [i, item] of plan.entries()) {
    const label = `[${i + 1}/${plan.length}] ${item.config.name ? `${item.config.name} ` : ""}${item.condition.id} ${item.task.id} rep ${item.rep}`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!stopped && spent >= budgetUsd)
        stopped = `The budget of $${budgetUsd} was spent before this run could start.`;
      if (stopped) {
        records.push(
          appendRecord(
            file,
            newRecord({
              ...base(item, attempt),
              status: "budget",
              timing: { wall_ms: 0 },
              error: stopped,
            }),
          ),
        );
        log(`${label}: not started, budget`);
        break;
      }
      const record = await runOnce(item, attempt);
      records.push(record);
      const cost = runCost(record);
      if (cost !== undefined) {
        spent += cost;
        dearest = Math.max(dearest, cost);
      } else if (record.status === "timeout") spent += dearest;
      else if (record.status !== "error" || record.turns > 0)
        stopped =
          "The cost of a finished run could not be told, so the budget cannot be held; price the model in bench/prices.json.";
      log(
        `${label}: ${record.status} ${(runWallMs(record) / 1000).toFixed(1)}s ` +
          `${cost === undefined ? "cost unknown" : `$${cost.toFixed(4)}`} ` +
          `${runTokens(record, ["input", "cache_write", "cache_read"]) ?? "?"}+${runTokens(record, ["output"]) ?? "?"} tok` +
          (record.error ? ` (${record.error})` : ""),
      );
      if (record.status === "ok") break;
    }
  }
  return { file, seed, records };
}
