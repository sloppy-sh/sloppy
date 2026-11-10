import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  bootstrapCi,
  buildSummary,
  settingOf,
  subjectFacts,
} from "../export.mjs";
import { BENCH_DIR } from "../lib/config.mjs";
import { loadPrices } from "../lib/prices.mjs";
import { contextOf, newRecord, readRecords } from "../lib/record.mjs";
import { runBatch } from "../lib/runner.mjs";
import { makeSubject, NO_AGENTS, tempDir, testSubject } from "./helpers.mjs";

const prices = loadPrices(path.join(BENCH_DIR, "prices.json"));
const SHA = "a".repeat(40);

const run = (over) =>
  newRecord({
    subject: { name: "sloppy", path: "/s", sha: SHA, variant: "full" },
    backend: { kind: "claude-code", model: "claude-sonnet-5-5" },
    condition: "bare",
    task: { pack: "sloppy", id: "why-x", family: "why" },
    rep: 0,
    seed: 1,
    status: "ok",
    timing: { wall_ms: 6000, answer_ms: 5000 },
    tokens: {
      input: 10,
      cache_write: 200,
      cache_read: 390,
      output: 50,
      reasoning: 0,
    },
    cost_usd: { reported: 0.01, basis: "none" },
    turns: 3,
    grade: { objective: 1, score: 1 },
    ...over,
  });

const CELL_FIELDS = [
  "subject",
  "backend",
  "model",
  "config",
  "condition",
  "task",
  "family",
  "n",
  "score_mean",
  "score_best",
  "score_lo",
  "score_hi",
  "context_mean",
  "context_final",
  "input_total_mean",
  "output_mean",
  "wall_s_mean",
  "answer_s_mean",
  "per_query_s_mean",
  "cost_mean",
  "turns_mean",
  "tool_calls_mean",
  "mcp_calls_mean",
  "subagents_mean",
  "searches_after_sloppy_mean",
  "findability_n",
  "files_opened_mean",
  "notes_opened_mean",
  "opened_mean",
  "approx",
];

test("the summary holds the contract's fields, and a record without its calls is approximated and marked", () => {
  const calls = [
    { at_ms: 1, input: 5, cache_write: 100, cache_read: 0, output: 20 },
    { at_ms: 2, input: 5, cache_write: 100, cache_read: 390, output: 30 },
  ];
  const old = run({ rep: 0 });
  const fresh = run({ rep: 1, iterations: calls, ...contextOf(calls) });
  const halfScore = run({
    rep: 2,
    iterations: calls,
    ...contextOf(calls),
    grade: { objective: 0.5, score: 0.5 },
    mcp_calls: { search_notes: 2 },
    subagent_calls: { mcp__sloppy__read_note: 1, Read: 4 },
    subagents_spawned: 1,
    condition: "mcp+agents",
  });
  const stopped = run({ rep: 3, status: "budget", turns: 0 });
  const neverBegan = run({
    rep: 4,
    status: "error",
    turns: 0,
    error: "Claude Code exited with 0: no output.",
  });
  const facts = (name, sha) => ({ label: name, sha, notes: 3 });
  const s = buildSummary({
    records: [old, fresh, halfScore, stopped, neverBegan],
    grades: [],
    prices,
    facts,
    now: new Date("2026-10-31T00:00:00Z"),
  });
  assert.deepEqual(Object.keys(s), [
    "generated_at",
    "subjects",
    "models",
    "conditions",
    "cells",
    "curves",
    "overall_weights",
    "groups",
    "figures",
  ]);
  assert.equal(s.generated_at, "2026-10-31T00:00:00.000Z");
  assert.deepEqual(s.subjects, {
    sloppy: { label: "sloppy", sha: SHA, notes: 3 },
  });
  assert.deepEqual(s.models, [
    { backend: "claude-code", model: "claude-sonnet-5-5", tier: "medium" },
  ]);
  const bare = s.cells.find((c) => c.condition === "bare");
  assert.deepEqual(Object.keys(bare), CELL_FIELDS);
  assert.equal(bare.n, 2);
  assert.equal(bare.approx, true);
  assert.equal(bare.context_final, Math.round((200 + 495) / 2));
  assert.equal(bare.per_query_s_mean, 2);
  assert.equal(bare.config, "shipped");
  const agents = s.cells.find((c) => c.condition === "mcp+agents");
  assert.equal(agents.approx, false);
  assert.equal(agents.context_final, 495);
  assert.equal(agents.context_mean, 300);
  assert.equal(agents.mcp_calls_mean, 3);
  assert.equal(agents.subagents_mean, 1);
  assert.equal(agents.score_lo, null);
  const curve = s.curves.find((c) => c.condition === "bare");
  assert.deepEqual(
    curve.points.map((p) => [p.rep, p.context_tokens, p.approx]),
    [
      [0, 200, true],
      [1, 495, false],
    ],
  );
});

test("the score interval is drawn from a seed, so the same runs give the same bounds", () => {
  const values = [0, 0.5, 1, 1, 0.75];
  assert.deepEqual(bootstrapCi(values), bootstrapCi(values));
  const [lo, hi] = bootstrapCi(values);
  assert.ok(lo < 0.65 && hi > 0.65 && lo >= 0 && hi <= 1);
  assert.deepEqual(bootstrapCi([1]), [null, null]);
});

test("a group weighs every task the same, and a run off the server counts under both settings", () => {
  const taskA = { pack: "sloppy", id: "a", family: "why" };
  const records = [
    run({ task: taskA, rep: 0 }),
    run({ task: taskA, rep: 1 }),
    run({ task: taskA, rep: 2 }),
    run({
      task: { pack: "sloppy", id: "b", family: "why" },
      grade: { objective: 0, score: 0 },
      config: "lean",
    }),
    run({
      condition: "mcp",
      config: "lean",
      cost_usd: { reported: 0.02, basis: "none" },
    }),
    run({ condition: "mcp", config: "merged", rep: 1 }),
  ];
  const s = buildSummary({ records, grades: [], prices, facts: () => ({}) });
  const group = (setting, condition) =>
    s.groups.find((g) => g.setting === setting && g.condition === condition);
  for (const setting of ["default", "lean"]) {
    const bare = group(setting, "bare");
    assert.equal(bare.n, 4);
    assert.equal(bare.tier, "medium");
    assert.deepEqual(bare.models, ["claude-sonnet-5-5"]);
    assert.equal(bare.score_mean, 0.5);
    assert.deepEqual(
      bare.tasks.map((t) => [t.task, t.n, t.score]),
      [
        ["a", 3, 1],
        ["b", 1, 0],
      ],
    );
    assert.equal(bare.score_task_min, 0);
    assert.equal(bare.score_task_max, 1);
    assert.equal(bare.served, false);
  }
  assert.equal(group("lean", "mcp").n, 1);
  assert.equal(group("lean", "mcp").served, true);
  assert.equal(group("lean", "mcp").cost_mean, 0.02);
  assert.equal(group("default", "mcp").n, 1);
  assert.equal(group("default", "mcp").cost_mean, 0.01);
});

test("a config is filed under lean, under default, or under a setting of its own name", () => {
  assert.equal(settingOf("lean"), "lean");
  for (const config of ["full", "default", "shipped", "merged"])
    assert.equal(settingOf(config), "default");
  assert.equal(settingOf("norelate"), "norelate");
  const s = buildSummary({
    records: [
      run({ condition: "mcp", config: "norelate" }),
      run({ condition: "bare", config: "norelate" }),
      run({ condition: "bare", config: "lean" }),
    ],
    grades: [],
    prices,
    facts: () => ({}),
  });
  const filed = s.groups.map((g) => `${g.setting} ${g.condition} ${g.n}`);
  assert.deepEqual(filed.sort(), [
    "default bare 1",
    "lean bare 1",
    "norelate bare 1",
    "norelate mcp 1",
  ]);
});

test("Sloppy's own runner lands in the reported comparison as a fourth row, at a commit of its own", () => {
  const s = buildSummary({
    records: [
      run({ condition: "bare", config: "asis" }),
      run({ condition: "agents", config: "asis" }),
      run({
        condition: "mcp",
        config: "maintained",
        subject: {
          name: "sloppy",
          path: "/s",
          sha: "b".repeat(40),
          variant: "full",
        },
      }),
      run({
        condition: "harness",
        config: "maintained",
        backend: { kind: "harness", model: "claude-sonnet-5" },
        subject: {
          name: "sloppy",
          path: "/s",
          sha: "c".repeat(40),
          variant: "full",
        },
      }),
    ],
    grades: [],
    prices,
    facts: () => ({}),
  });
  const reported = s.groups.filter((g) => g.setting === "recommended");
  assert.deepEqual(
    reported.map((g) => [g.condition, g.backend, g.served]).sort(),
    [
      ["agents", "claude-code", false],
      ["bare", "claude-code", false],
      ["harness", "harness", true],
      ["mcp", "claude-code", true],
    ],
  );
});

test("searches after Sloppy answered are a mean over the runs that counted them", () => {
  const s = buildSummary({
    records: [
      run({ condition: "mcp", config: "lean", searches_after_sloppy: 2 }),
      run({
        condition: "mcp",
        config: "lean",
        searches_after_sloppy: 0,
        rep: 1,
      }),
      run({ condition: "mcp", config: "lean", rep: 2 }),
    ],
    grades: [],
    prices,
    facts: () => ({}),
  });
  const group = s.groups.find((g) => g.condition === "mcp");
  assert.equal(group.searches_after_sloppy_mean, 1);
  assert.equal(group.runs_counted_after_sloppy, 2);
  assert.equal(s.cells[0].searches_after_sloppy_mean, 1);
});

test("a model's tier is read by name from prices.json, medium where nothing matches", () => {
  const tiers = (model) =>
    buildSummary({
      records: [run({ backend: { kind: "claude-code", model } })],
      grades: [],
      prices,
      facts: () => ({}),
    }).models[0].tier;
  assert.equal(tiers("claude-haiku-5-5"), "small");
  assert.equal(tiers("claude-opus-5-5[1m]"), "large");
  assert.equal(tiers("sonnet"), "medium");
  assert.equal(tiers("haiku"), "small");
  assert.equal(tiers("someone-elses-model"), "medium");
});

test("a subject's facts are counted from its repository at the sha", () => {
  const root = makeSubject();
  const subject = {
    ...testSubject(),
    name: "t",
    label: "t",
    path: root,
    research: ["README.md"],
  };
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })
    .toString()
    .trim();
  const facts = subjectFacts(subject, head);
  assert.deepEqual(facts, {
    label: "t",
    sha: head,
    code_files: 2,
    code_lines: 2,
    docs_files: 5,
    docs_words: 15,
    notes: 0,
    commits: 2,
    research_words: 2,
  });
  const first = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root })
    .toString()
    .trim();
  assert.equal(subjectFacts(subject, first).code_files, 1);
});

test("the export command writes a summary over a mock batch of every condition", async () => {
  const out = tempDir();
  await runBatch({
    backend: "mock",
    subject: makeSubject(),
    subjectConfig: testSubject(),
    pack: "example",
    reps: 1,
    seed: 3,
    budgetUsd: 100,
    outDir: out,
    workRoot: tempDir(),
    agents: NO_AGENTS,
    log: () => {},
  });
  execFileSync(
    process.execPath,
    [path.join(BENCH_DIR, "bench.mjs"), "export", "--out", out, "--no-figures"],
    { stdio: "pipe" },
  );
  const s = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
  assert.equal(s.cells.length, 10);
  assert.equal(s.curves.length, 10);
  assert.ok(s.cells.every((c) => c.approx === false && c.context_final > 0));
  assert.deepEqual(Object.keys(s.subjects), ["subject"]);
  const style = JSON.parse(
    fs.readFileSync(path.join(BENCH_DIR, "figures.json"), "utf8"),
  );
  assert.deepEqual(
    s.conditions.map((c) => [c.id, c.colour, c.marker]),
    style.conditions.map((id, i) => [id, style.palette[i], style.markers[i]]),
  );
  const runIds = readRecords(out)
    .map((r) => r.run_id)
    .sort();
  assert.deepEqual(
    s.curves.flatMap((c) => c.points.map((p) => p.run_id)).sort(),
    runIds,
  );
});
