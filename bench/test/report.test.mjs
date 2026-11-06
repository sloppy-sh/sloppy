import assert from "node:assert/strict";
import { test } from "node:test";
import { newRecord } from "../lib/record.mjs";
import { formatSummary, summarize } from "../lib/report.mjs";

const run = (pack, sha, cost) =>
  newRecord({
    subject: { path: "/s", sha, variant: "full" },
    backend: { kind: "mock", model: "default" },
    condition: "bare",
    task: { pack, id: "t", family: "why" },
    rep: 0,
    seed: 1,
    status: "ok",
    timing: { wall_ms: 1000 },
    cost_usd: { reported: cost, basis: "none" },
  });

test("runs from different packs or subject commits are never averaged together", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const rows = summarize([
    run("ours", a, 1),
    run("ours", a, 3),
    run("theirs", a, 10),
    run("ours", b, 100),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.sha, r.pack, r.runs, r.cost_usd]),
    [
      [a, "ours", 2, 2],
      [a, "theirs", 1, 10],
      [b, "ours", 1, 100],
    ],
  );
  const table = formatSummary(rows);
  assert.match(table, /sloppy {3}aaaaaaaaaaaa {2}ours/);
  assert.match(table, /aaaaaaaaaaaa {2}theirs/);
});

test("runs under different configs are never averaged together, and the table names each", () => {
  const sha = "f".repeat(40);
  const under = (config, cost) => ({ ...run("ours", sha, cost), config });
  const rows = summarize([
    under("default", 1),
    under("default", 3),
    under("lean", 10),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.config, r.runs, r.cost_usd]),
    [
      ["default", 2, 2],
      ["lean", 1, 10],
    ],
  );
  const table = formatSummary(rows);
  assert.match(table, /^subject {2}commit {8}config {3}pack/);
  assert.match(table, /ffffffffffff {2}default {2}ours/);
  assert.match(table, /ffffffffffff {2}lean {5}ours/);
});

test("a run whose tokens could not be told is in no token mean, and the table says so", () => {
  const sha = "c".repeat(40);
  const told = newRecord({
    ...run("ours", sha, 1),
    tokens: {
      input: 100,
      cache_write: 0,
      cache_read: 0,
      output: 10,
      reasoning: 0,
    },
  });
  const blind = newRecord({
    ...run("ours", sha, 1),
    tokens_unknown: [
      "input",
      "cache_write",
      "cache_read",
      "output",
      "reasoning",
    ],
  });
  const halfBlind = newRecord({
    ...run("ours", sha, 1),
    tokens: {
      input: 300,
      cache_write: 0,
      cache_read: 0,
      output: 0,
      reasoning: 0,
    },
    tokens_unknown: ["output"],
  });
  const [mixed] = summarize([told, blind, halfBlind]);
  assert.equal(mixed.input_told, 2);
  assert.equal(mixed.input_tokens, 200);
  assert.equal(mixed.output_told, 1);
  assert.equal(mixed.output_tokens, 10);
  assert.match(formatSummary([mixed]), /200 \(2 told\) +10 \(1 told\)/);

  const [none] = summarize([blind, blind]);
  assert.equal(none.input_tokens, undefined);
  assert.equal(none.output_tokens, undefined);
  const row = formatSummary([none]).split("\n")[2];
  assert.match(row, /2\/2 +2 +1\.0000 +- +- +- +1\.0/);
});

test("a started run that did not finish ok scores 0 and counts as graded", () => {
  const sha = "d".repeat(40);
  const good = newRecord({ ...run("ours", sha, 1), grade: { score: 1 } });
  const failed = newRecord({ ...run("ours", sha, 1), status: "error" });
  const [row] = summarize([good, failed]);
  assert.equal(row.graded, 2);
  assert.equal(row.score, 0.5);
});

test("a grade appended after the run replaces the run-time grade for its grader only", () => {
  const sha = "e".repeat(40);
  const rec = newRecord({
    ...run("ours", sha, 1),
    grade: { objective: 1, judge: 0.2, score: 0.6 },
  });
  const [row] = summarize(
    [rec],
    [{ run_id: rec.run_id, grader: "judge", score: 0.8 }],
  );
  assert.equal(row.score, 0.9);
});

test("runs on different subjects are never averaged together, and a record with no subject name is Sloppy's", () => {
  const sha = "a".repeat(40);
  const on = (name, cost) => {
    const r = run("ours", sha, cost);
    return { ...r, subject: { ...r.subject, name } };
  };
  const rows = summarize([on(undefined, 1), on("sloppy", 3), on("gitlab", 10)]);
  assert.deepEqual(
    rows.map((r) => [r.subject, r.runs, r.cost_usd]),
    [
      ["gitlab", 1, 10],
      ["sloppy", 2, 2],
    ],
  );
  assert.match(formatSummary(rows), /\ngitlab {3}aaaaaaaaaaaa/);
});
