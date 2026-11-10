// The export a page is built from: results/summary.json and results/figures/*.svg; README.md § "The export".
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withAfterSloppy } from "./lib/after-sloppy.mjs";
import { loadConditions, reachesSloppy } from "./lib/condition.mjs";
import { BENCH_DIR, loadSubject } from "./lib/config.mjs";
import { loadPrices, tierFor } from "./lib/prices.mjs";
import { privateSubjects, withoutPrivate } from "./lib/private.mjs";
import {
  measured,
  readFindability,
  readGrades,
  readRecords,
  runCost,
  runTokens,
  runWallMs,
} from "./lib/record.mjs";
import { scoreOf } from "./lib/report.mjs";

const BOOTSTRAP = 2000;

/** Each condition's colour and marker as figures.py draws it, in its order; a page draws with the same. */
export function conditionStyles(
  style = JSON.parse(
    fs.readFileSync(path.join(BENCH_DIR, "figures.json"), "utf8"),
  ),
) {
  return style.conditions.map((id, i) => ({
    id,
    colour: style.palette[i % style.palette.length],
    marker: style.markers[i % style.markers.length],
  }));
}

const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (v, digits) =>
  v === null || v === undefined || Number.isNaN(v)
    ? null
    : Math.round(v * 10 ** digits) / 10 ** digits;
const defined = (xs) => xs.filter((x) => x !== undefined && x !== null);

/** A seeded generator, so the same records give the same intervals. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% percentile-bootstrap interval of the mean; nulls under two values. */
export function bootstrapCi(values, seed = 0) {
  if (values.length < 2) return [null, null];
  const random = mulberry32(seed);
  const means = Array.from({ length: BOOTSTRAP }, () => {
    let sum = 0;
    for (let i = 0; i < values.length; i++)
      sum += values[Math.floor(random() * values.length)];
    return sum / values.length;
  }).sort((a, b) => a - b);
  return [
    means[Math.floor(0.025 * (BOOTSTRAP - 1))],
    means[Math.ceil(0.975 * (BOOTSTRAP - 1))],
  ];
}

const INPUT_CLASSES = ["input", "cache_write", "cache_read"];
/** Input the model had not been given before: the whole of it less the conversation it re-read. */
const FRESH_CLASSES = ["input", "cache_write"];
const told = (r, classes) =>
  !classes.some((c) => r.tokens_unknown?.includes(c));

const sumOf = (r, classes) => classes.reduce((n, c) => n + r.tokens[c], 0);

/**
 * A run's context from its iterations; a record without them is approximated as its prompt
 * tokens over its turns, which is a mean per call, and marked `approx`.
 */
export function contextFor(r) {
  if (r.context_final !== undefined)
    return { final: r.context_final, mean: r.context_mean, approx: false };
  if (r.turns > 0 && told(r, INPUT_CLASSES)) {
    const perCall = sumOf(r, INPUT_CLASSES) / r.turns;
    return { final: perCall, mean: perCall, approx: true };
  }
  return { final: null, mean: null, approx: false };
}

const SLOPPY_PREFIX = "mcp__sloppy__";
const sloppyCalls = (r) =>
  Object.values(r.mcp_calls).reduce((a, b) => a + b, 0) +
  Object.entries(r.subagent_calls ?? {})
    .filter(([name]) => name.startsWith(SLOPPY_PREFIX))
    .reduce((n, [, c]) => n + c, 0);

/** One run as the figures and the curves read it; a handoff run's tokens, cost and time are both stages'. */
function runView(r, gradesByRun, foundByRun = new Map()) {
  const ctx = contextFor(r);
  const found = r.findability ?? foundByRun.get(r.run_id);
  return {
    record: r,
    subject: r.subject.name ?? "sloppy",
    sha: r.subject.sha,
    backend: r.backend.kind,
    model: r.backend.model,
    config: r.config ?? "shipped",
    condition: r.condition,
    task: r.task.id,
    family: r.task.family,
    rep: r.rep,
    score: scoreOf(r, gradesByRun),
    context_final: ctx.final,
    context_mean: ctx.mean,
    approx: ctx.approx,
    input_total: runTokens(r, INPUT_CLASSES),
    input_fresh: runTokens(r, FRESH_CLASSES),
    output: runTokens(r, ["output", "reasoning"]),
    wall_s: runWallMs(r) / 1000,
    answer_s:
      r.timing.answer_ms === undefined ? undefined : r.timing.answer_ms / 1000,
    per_query_s: r.turns > 0 ? r.timing.wall_ms / r.turns / 1000 : undefined,
    cost: runCost(r),
    files_opened: found?.files,
    notes_opened: found?.notes,
    opened: found?.opened,
    turns: r.turns,
    tool_calls: Object.values(r.tool_calls).reduce((a, b) => a + b, 0),
    mcp_calls: sloppyCalls(r),
    subagents: r.subagents_spawned ?? 0,
    searches_after_sloppy: r.searches_after_sloppy,
  };
}

const CURVE_KEYS = ["subject", "backend", "model", "config", "condition"];
const CELL_KEYS = [...CURVE_KEYS, "task"];

function groupBy(views, keys) {
  const groups = new Map();
  for (const v of views) {
    const key = keys.map((k) => v[k]).join("\t");
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, vs]) => vs);
}

function cellOf(vs, seed) {
  const first = vs[0];
  const scores = defined(vs.map((v) => v.score));
  const [lo, hi] = bootstrapCi(scores, seed);
  const m = (field) => mean(defined(vs.map((v) => v[field])));
  return {
    ...Object.fromEntries(CELL_KEYS.map((k) => [k, first[k]])),
    family: first.family,
    n: vs.length,
    score_mean: round(mean(scores), 4),
    score_best: scores.length ? round(Math.max(...scores), 4) : null,
    score_lo: round(lo, 4),
    score_hi: round(hi, 4),
    context_mean: round(m("context_mean"), 0),
    context_final: round(m("context_final"), 0),
    input_total_mean: round(m("input_total"), 0),
    output_mean: round(m("output"), 0),
    wall_s_mean: round(m("wall_s"), 2),
    answer_s_mean: round(m("answer_s"), 2),
    per_query_s_mean: round(m("per_query_s"), 2),
    cost_mean: round(m("cost"), 6),
    turns_mean: round(m("turns"), 2),
    tool_calls_mean: round(m("tool_calls"), 2),
    mcp_calls_mean: round(m("mcp_calls"), 2),
    subagents_mean: round(m("subagents"), 2),
    searches_after_sloppy_mean: round(m("searches_after_sloppy"), 2),
    ...findabilityOf(vs),
    approx: vs.some((v) => v.approx),
  };
}

/** Means of what the runs opened, over the runs whose findability is known, and how many those are. */
function findabilityOf(vs) {
  const known = vs.filter((v) => v.opened !== undefined);
  const m = (field) => mean(known.map((v) => v[field]));
  return {
    findability_n: known.length,
    files_opened_mean: round(m("files_opened"), 2),
    notes_opened_mean: round(m("notes_opened"), 2),
    opened_mean: round(m("opened"), 2),
  };
}

function curveOf(vs) {
  return {
    ...Object.fromEntries(CURVE_KEYS.map((k) => [k, vs[0][k]])),
    points: vs.map((v) => ({
      run_id: v.record.run_id,
      task: v.task,
      rep: v.rep,
      context_tokens: round(v.context_final, 0),
      score: round(v.score, 4),
      wall_s: round(v.wall_s, 2),
      turns: v.turns,
      cost: round(v.cost, 6),
      approx: v.approx,
    })),
  };
}

/** The two server settings a page switches between; README.md § "The export", `groups`. */
export const SETTINGS = ["default", "lean"];

/** The names a configuration served full, as shipped before lean was, has been run under. */
const DEFAULT_CONFIGS = new Set(["full", "default", "shipped", "merged"]);

/** The setting a config is filed under: lean, default, or a setting of its own name. */
export const settingOf = (config) =>
  config === "lean" ? "lean" : DEFAULT_CONFIGS.has(config) ? "default" : config;

/**
 * Each setting a run counts under: its own where the condition reaches the server; where it never
 * does, both of the page's settings for a run made under one of them, and its own for any other.
 */
const settingsOf = (view, served) => {
  const setting = settingOf(view.config);
  const also = RECOMMENDED.has(`${setting}\t${served.has(view.condition)}`)
    ? ["recommended"]
    : [];
  if (served.has(view.condition) || !SETTINGS.includes(setting))
    return [setting, ...also];
  return [...SETTINGS, ...also];
};

/**
 * The reported comparison, README.md § "The comparison that is reported": the documents as a project
 * keeps them for the conditions that do not reach the server, and the shaped documents for the one
 * that does, because the shaping is part of taking Sloppy up. A run also counts under its own
 * setting, which is what keeps the shaped documents read without the server measurable and off every
 * page. The keys are `<setting>\t<reaches the server>`.
 */
const RECOMMENDED = new Set([
  "asis\tfalse",
  "shaped\ttrue",
  "maintainer\ttrue",
  "armA\tfalse",
  "armB\ttrue",
]);

/**
 * One subject, model tier, setting and condition: its tasks' means, and the means over those tasks with a
 * 95% bootstrap interval drawn over tasks, so every task weighs the same whatever its runs.
 */
/** Tokens and time over the runs that finished, so a condition is never lean for failing early. */
function finishedMeans(ts) {
  const ok = ts.filter((v) => v.record.status === "ok");
  const m = (field) =>
    ok.length ? mean(defined(ok.map((v) => v[field]))) : null;
  return { input_ok: m("input_total"), wall_ok: m("wall_s") };
}

function groupOf(key, vs, seed) {
  const tasks = groupBy(vs, ["task"]).map((ts) => {
    const scores = defined(ts.map((v) => v.score));
    const m = (field) => mean(defined(ts.map((v) => v[field])));
    return {
      task: ts[0].task,
      family: ts[0].family,
      n: ts.length,
      scored: scores.length,
      score: mean(scores),
      input: m("input_total"),
      fresh: m("input_fresh"),
      wall: m("wall_s"),
      cost: m("cost"),
      ...finishedMeans(ts),
    };
  });
  const over = (field, s) => {
    const xs = defined(tasks.map((t) => t[field]));
    const [lo, hi] = bootstrapCi(xs, s);
    return { mean: mean(xs), lo, hi };
  };
  const score = over("score", seed);
  const input = over("input", seed + 1);
  const cost = over("cost", seed + 2);
  const fresh = over("fresh", seed + 3);
  const m = (field) => mean(defined(vs.map((v) => v[field])));
  const scored = defined(tasks.map((t) => t.score));
  return {
    ...key,
    models: [...new Set(vs.map((v) => v.model))].sort(),
    n: vs.length,
    scored: tasks.reduce((n, t) => n + t.scored, 0),
    tasks: tasks.map((t) => ({
      ...t,
      score: round(t.score, 4),
      input: round(t.input, 0),
      fresh: round(t.fresh, 0),
      wall: round(t.wall, 2),
      cost: round(t.cost, 6),
    })),
    score_mean: round(score.mean, 4),
    score_lo: round(score.lo, 4),
    score_hi: round(score.hi, 4),
    score_task_min: scored.length ? round(Math.min(...scored), 4) : null,
    score_task_max: scored.length ? round(Math.max(...scored), 4) : null,
    input_mean: round(input.mean, 0),
    input_lo: round(input.lo, 0),
    input_hi: round(input.hi, 0),
    fresh_mean: round(fresh.mean, 0),
    fresh_lo: round(fresh.lo, 0),
    fresh_hi: round(fresh.hi, 0),
    cost_mean: round(cost.mean, 6),
    cost_lo: round(cost.lo, 6),
    cost_hi: round(cost.hi, 6),
    turns_mean: round(m("turns"), 2),
    mcp_calls_mean: round(m("mcp_calls"), 2),
    subagents_mean: round(m("subagents"), 2),
    runs_with_subagents: vs.filter((v) => v.subagents > 0).length,
    searches_after_sloppy_mean: round(m("searches_after_sloppy"), 2),
    runs_counted_after_sloppy: vs.filter(
      (v) => v.searches_after_sloppy !== undefined,
    ).length,
    ...findabilityOf(vs),
    raw: tasks,
  };
}

const GROUP_KEYS = ["subject", "backend", "tier", "setting", "condition"];

/**
 * No group key carries the subject's sha, so two batches of one subject at different commits would
 * be averaged into one row without saying so. A comparison between two trees must therefore give
 * each its own config name, which `setting` keeps apart; this refuses the mistake rather than
 * reporting its mean.
 */
function refuseMixedShas(groups, views) {
  const shas = new Map();
  for (const v of views) {
    const key = GROUP_KEYS.map((k) => v[k]).join("\t");
    shas.set(key, (shas.get(key) ?? new Set()).add(v.sha));
  }
  for (const [key, held] of shas)
    if (held.size > 1) {
      const [subject, , , setting, condition] = key.split("\t");
      throw new Error(
        `${subject} ${setting} ${condition} holds runs from ${held.size} commits of the subject ` +
          `(${[...held].map((s) => s.slice(0, 10)).join(", ")}). Averaging them would hide which ` +
          `tree each answer was given. Run each tree under its own --configs name, or export one ` +
          `with --seeds.`,
      );
    }
  return groups;
}

/** Every subject, model tier, setting and condition, a run counted under each setting `settingsOf` gives it. */
export function groupsOf(views, served, weights = EQUAL_WEIGHTS) {
  const withSetting = views.flatMap((v) =>
    settingsOf(v, served).map((setting) => ({ ...v, setting })),
  );
  refuseMixedShas(null, withSetting);
  const groups = groupBy(withSetting, GROUP_KEYS).map((vs, i) => ({
    ...groupOf(
      Object.fromEntries(GROUP_KEYS.map((k) => [k, vs[0][k]])),
      vs,
      1000 + i * 3,
    ),
    served: served.has(vs[0].condition),
  }));
  const overall = overallOf(groups, weights);
  return groups.map(({ raw, ...g }, i) => ({ ...g, overall: overall[i] }));
}

/** The overall score's parts, in the order README.md § "What counts as better" names them. */
export const OVERALL_PARTS = ["quality", "handoff", "tokens", "time"];
export const EQUAL_WEIGHTS = Object.freeze(
  Object.fromEntries(OVERALL_PARTS.map((p) => [p, 1])),
);

/** `quality=1,handoff=2,…` as weights; every part named once, each a number of at least 0, not all 0. */
export function parseWeights(text) {
  if (!text) return EQUAL_WEIGHTS;
  const weights = {};
  for (const entry of text.split(",")) {
    const [part, value] = entry.split("=").map((s) => s.trim());
    const n = Number(value);
    if (!OVERALL_PARTS.includes(part) || part in weights || !(n >= 0))
      throw new Error(
        `--weights takes ${OVERALL_PARTS.map((p) => `${p}=<n>`).join(",")}; "${entry}" is not one of them.`,
      );
    weights[part] = n;
  }
  const missing = OVERALL_PARTS.filter((p) => !(p in weights));
  if (missing.length)
    throw new Error(`--weights names no weight for ${missing.join(", ")}.`);
  if (OVERALL_PARTS.every((p) => weights[p] === 0))
    throw new Error("--weights cannot all be 0.");
  return weights;
}

const isHandoff = (t) => t.family === "handoff";

/**
 * Each group's overall score: its parts, the total where every part is present, and the partial
 * total over the parts that are, with the absent ones named. `tokens` and `time` compare the
 * groups of one subject, backend, tier and setting over the tasks every one of them told.
 */
export function overallOf(groups, weights = EQUAL_WEIGHTS) {
  const peerKey = (g) => [g.subject, g.backend, g.tier, g.setting].join("\t");
  const peers = new Map();
  for (const g of groups)
    peers.set(peerKey(g), [...(peers.get(peerKey(g)) ?? []), g]);

  const relative = (g, field, label) => {
    const group = peers.get(peerKey(g));
    const toldBy = (h) =>
      new Set(h.raw.filter((t) => t[field] != null).map((t) => t.task));
    const common = group
      .map(toldBy)
      .reduce((a, b) => new Set([...a].filter((t) => b.has(t))));
    if (common.size === 0)
      return {
        value: null,
        why: `no task every condition here told ${label} for`,
      };
    const over = (h) =>
      mean(h.raw.filter((t) => common.has(t.task)).map((t) => t[field]));
    const best = Math.min(...group.map(over));
    const own = over(g);
    return {
      value: own === 0 ? 1 : best / own,
      tasks: common.size,
    };
  };

  return groups.map((g) => {
    const scoresOf = (pick) => defined(g.raw.filter(pick).map((t) => t.score));
    const quality = scoresOf((t) => !isHandoff(t));
    const handoff = scoresOf(isHandoff);
    const tokens = relative(g, "input_ok", "input tokens over finished runs");
    const time = relative(g, "wall_ok", "wall time over finished runs");
    const parts = {
      quality: quality.length ? mean(quality) : null,
      handoff: handoff.length ? mean(handoff) : null,
      tokens: tokens.value,
      time: time.value,
    };
    const why = {
      ...(parts.quality === null
        ? { quality: "no scored task but handoff" }
        : {}),
      ...(parts.handoff === null ? { handoff: "no scored handoff task" } : {}),
      ...(tokens.why ? { tokens: tokens.why } : {}),
      ...(time.why ? { time: time.why } : {}),
    };
    const present = OVERALL_PARTS.filter((p) => parts[p] !== null);
    const weightOf = (ps) => ps.reduce((n, p) => n + weights[p], 0);
    const partial =
      present.length && weightOf(present) > 0
        ? present.reduce((n, p) => n + weights[p] * parts[p], 0) /
          weightOf(present)
        : null;
    return {
      score: present.length === OVERALL_PARTS.length ? round(partial, 4) : null,
      partial: round(partial, 4),
      parts: Object.fromEntries(
        OVERALL_PARTS.map((p) => [p, round(parts[p], 4)]),
      ),
      absent: OVERALL_PARTS.filter((p) => parts[p] === null),
      why_absent: why,
      weights: { ...weights },
      weights_equal: OVERALL_PARTS.every((p) => weights[p] === weights.quality),
      tasks_compared: { tokens: tokens.tasks ?? 0, time: time.tasks ?? 0 },
      compared_with: peers
        .get(peerKey(g))
        .map((h) => h.condition)
        .sort(),
    };
  });
}

function git(repo, args, input) {
  return execFileSync("git", args, {
    cwd: repo,
    input,
    maxBuffer: 1 << 30,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Paths read per `git cat-file --batch`: a very large tree's blobs outgrow one call's buffer. */
const BLOBS_PER_BATCH = 2000;

/** Each path's blob at `sha`, read through `git cat-file --batch` a slice at a time. */
function readBlobs(repo, sha, paths) {
  const blobs = new Map();
  for (let i = 0; i < paths.length; i += BLOBS_PER_BATCH)
    for (const [p, blob] of readBlobBatch(
      repo,
      sha,
      paths.slice(i, i + BLOBS_PER_BATCH),
    ))
      blobs.set(p, blob);
  return blobs;
}

function readBlobBatch(repo, sha, paths) {
  if (paths.length === 0) return new Map();
  const out = git(
    repo,
    ["cat-file", "--batch"],
    paths.map((p) => `${sha}:${p}`).join("\n"),
  );
  const blobs = new Map();
  let at = 0;
  for (const p of paths) {
    const eol = out.indexOf(0x0a, at);
    const header = out.subarray(at, eol).toString();
    const size = Number(header.split(" ")[2]);
    blobs.set(p, out.subarray(eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
  return blobs;
}

const isText = (buf) => !buf.includes(0);
const words = (buf) => buf.toString("utf8").split(/\s+/).filter(Boolean).length;
const lines = (buf) => {
  if (buf.length === 0) return 0;
  let n = 0;
  for (const byte of buf) if (byte === 0x0a) n++;
  return buf.at(-1) === 0x0a ? n : n + 1;
};
const under = (p, roots) => roots.some((r) => p === r || p.startsWith(`${r}/`));

/**
 * What the subject is, read from its repository at `sha`: code is every tracked file outside its
 * documents, container, MCP config, research and the suite, symlinks left out.
 */
export function subjectFacts(subject, sha) {
  const repo = subject.path;
  const entries = git(repo, ["ls-tree", "-r", "-z", sha])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t");
      return { mode: meta.split(" ")[0], file };
    })
    .filter((e) => e.mode !== "120000" && e.mode !== "160000")
    .map((e) => e.file);
  const research = subject.research ?? [];
  const notCode = [
    ...subject.docs,
    subject.container,
    subject.mcp_file,
    ...research,
    "bench",
  ];
  const code = entries.filter((f) => !under(f, notCode));
  const docs = entries.filter((f) => under(f, subject.docs));
  const researchFiles = entries.filter((f) => under(f, research));
  const blobs = readBlobs(repo, sha, [...code, ...docs, ...researchFiles]);
  const total = (files, f) =>
    files.reduce((n, file) => {
      const b = blobs.get(file);
      return b && isText(b) ? n + f(b) : n;
    }, 0);
  return {
    label: subject.label ?? subject.name,
    sha: git(repo, ["rev-parse", sha]).toString().trim(),
    code_files: code.length,
    code_lines: total(code, lines),
    docs_files: docs.length,
    docs_words: total(docs, words),
    notes: entries.filter((f) => under(f, [`${subject.container}/notes`]))
      .length,
    commits: Number(git(repo, ["rev-list", "--count", sha]).toString().trim()),
    research_words: total(researchFiles, words),
  };
}

const NO_FACTS = {
  sha: null,
  code_files: null,
  code_lines: null,
  docs_files: null,
  docs_words: null,
  notes: null,
  commits: null,
  research_words: null,
};

/**
 * The summary's JSON from `records` and `grades`. `facts(name, sha)` answers a subject's facts at
 * the sha its latest run was made at; `figures` is the manifest the figure script printed; the
 * subjects named in `hidden` are exported as `withoutPrivate` leaves them.
 */
export function buildSummary({
  records,
  grades,
  prices,
  facts,
  figures = [],
  now = new Date(),
  served = new Set(
    loadConditions()
      .conditions.filter(reachesSloppy)
      .map((c) => c.id),
  ),
  found = [],
  weights = EQUAL_WEIGHTS,
  hidden = privateSubjects(),
}) {
  const gradesByRun = new Map();
  for (const g of grades)
    gradesByRun.set(g.run_id, [...(gradesByRun.get(g.run_id) ?? []), g]);
  const foundByRun = new Map(found.map((f) => [f.run_id, f]));
  const views = records
    .filter(measured)
    .map((r) => runView(r, gradesByRun, foundByRun));

  const subjects = {};
  for (const name of [...new Set(views.map((v) => v.subject))].sort()) {
    const latest = views
      .filter((v) => v.subject === name)
      .reduce((a, b) => (b.record.timestamp > a.record.timestamp ? b : a));
    subjects[name] = facts(name, latest.record.subject.sha);
  }

  const models = groupBy(views, ["backend", "model"]).map((vs) => ({
    backend: vs[0].backend,
    model: vs[0].model,
    tier: tierFor(prices, vs[0].model),
  }));

  return withoutPrivate(
    {
      generated_at: now.toISOString(),
      subjects,
      models,
      conditions: conditionStyles(),
      cells: groupBy(views, CELL_KEYS).map((vs, i) => cellOf(vs, i)),
      curves: groupBy(views, CURVE_KEYS).map(curveOf),
      overall_weights: { ...weights },
      groups: groupsOf(
        views.map((v) => ({ ...v, tier: tierFor(prices, v.model) })),
        served,
        weights,
      ),
      figures,
    },
    hidden,
  );
}

/** Facts for a subject by name, nulls with the reason logged where its repository cannot be read. */
function factsFrom(log) {
  return (name, sha) => {
    let subject;
    try {
      subject = loadSubject(name);
      return subjectFacts(subject, sha);
    } catch (err) {
      log(
        `The facts of ${name} at ${sha.slice(0, 12)} could not be read: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
      );
      return { label: subject?.label ?? name, ...NO_FACTS };
    }
  };
}

/** Draws the figures through notebook.sh's environment and returns the manifest it prints. */
function drawFigures(resultsDir, figuresDir) {
  fs.rmSync(figuresDir, { recursive: true, force: true });
  fs.mkdirSync(figuresDir, { recursive: true });
  const out = execFileSync(
    "bash",
    [path.join(BENCH_DIR, "notebook.sh"), "--figures", resultsDir, figuresDir],
    { cwd: BENCH_DIR, stdio: ["ignore", "pipe", "inherit"] },
  )
    .toString()
    .trim()
    .split("\n")
    .at(-1);
  return JSON.parse(out);
}

/**
 * Writes `<outDir>/summary.json` and, unless `figures` is false, `<outDir>/figures/*.svg`.
 * @returns {{ summary: string, figures: string[] }}
 */
export function exportResults({
  resultsDir = path.join(BENCH_DIR, "results"),
  outDir = resultsDir,
  figures = true,
  facts,
  weights = EQUAL_WEIGHTS,
  seeds,
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const figuresDir = path.join(outDir, "figures");
  const manifest = figures ? drawFigures(resultsDir, figuresDir) : [];
  const summary = buildSummary({
    records: withAfterSloppy(resultsDir, readRecords(resultsDir)).filter(
      (r) => !seeds || seeds.includes(r.seed),
    ),
    grades: readGrades(resultsDir),
    found: readFindability(resultsDir),
    weights,
    prices: loadPrices(path.join(BENCH_DIR, "prices.json")),
    facts: facts ?? factsFrom(log),
    figures: manifest,
  });
  const file = path.join(outDir, "summary.json");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    summary: file,
    figures: manifest.map((f) => path.join(outDir, f.file)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { summary, figures } = exportResults();
  process.stderr.write(`${[summary, ...figures].join("\n")}\n`);
}
