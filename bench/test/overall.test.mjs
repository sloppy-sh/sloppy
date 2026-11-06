import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  buildSummary,
  EQUAL_WEIGHTS,
  OVERALL_PARTS,
  parseWeights,
} from "../export.mjs";
import { BENCH_DIR } from "../lib/config.mjs";
import { backfillFindability } from "../lib/findability.mjs";
import { loadPrices } from "../lib/prices.mjs";
import {
  appendRecord,
  newRecord,
  readFindability,
  readRecords,
} from "../lib/record.mjs";
import { writeTranscript } from "../lib/transcript.mjs";
import { tempDir } from "./helpers.mjs";

const prices = loadPrices(path.join(BENCH_DIR, "prices.json"));
const SHA = "b".repeat(40);
const SENT = {
  system: "s",
  prompt: "p",
  mcp: false,
  tools: ["Read"],
  model: "m",
};

const run = ({
  condition,
  task,
  family = "why",
  score,
  input,
  wall,
  ...over
}) =>
  newRecord({
    subject: { name: "sloppy", path: "/s", sha: SHA, variant: "full" },
    backend: { kind: "claude-code", model: "claude-sonnet-5-5" },
    condition,
    task: { pack: "sloppy", id: task, family },
    rep: 0,
    seed: 1,
    status: "ok",
    timing: { wall_ms: wall },
    tokens: { input, cache_write: 0, cache_read: 0, output: 1, reasoning: 0 },
    cost_usd: { reported: 0.01, basis: "none" },
    turns: 1,
    sent: SENT,
    grade: { objective: score, score },
    ...over,
  });

const summarize = (records, extra = {}) =>
  buildSummary({
    records,
    grades: [],
    prices,
    facts: (name, sha) => ({ label: name, sha }),
    served: new Set(["mcp"]),
    ...extra,
  });

const groupOf = (s, condition) =>
  s.groups.find((g) => g.condition === condition && g.setting === "default");

const stageA = (input, wall) => ({
  status: "ok",
  timing: { wall_ms: wall },
  tokens: { input, cache_write: 0, cache_read: 0, output: 1, reasoning: 0 },
  cost_usd: { reported: 0.02, basis: "none" },
  sent: SENT,
  output: { text: "done" },
  commit_message: "Change",
});

test("the overall score is the equal mean of quality, handoff, tokens and time, with the parts beside it", () => {
  const records = [
    run({
      condition: "bare",
      task: "why-a",
      score: 1,
      input: 100,
      wall: 10_000,
    }),
    run({
      condition: "bare",
      task: "why-b",
      score: 0.5,
      input: 300,
      wall: 30_000,
    }),
    run({
      condition: "bare",
      task: "handoff-a",
      family: "handoff",
      score: 0.5,
      input: 100,
      wall: 10_000,
      stage_a: stageA(100, 10_000),
    }),
    run({ condition: "mcp", task: "why-a", score: 1, input: 200, wall: 5_000 }),
    run({ condition: "mcp", task: "why-b", score: 1, input: 200, wall: 5_000 }),
    run({
      condition: "mcp",
      task: "handoff-a",
      family: "handoff",
      score: 1,
      input: 400,
      wall: 10_000,
      stage_a: stageA(200, 10_000),
    }),
  ];
  const s = summarize(records);
  assert.deepEqual(s.overall_weights, EQUAL_WEIGHTS);
  const bare = groupOf(s, "bare").overall;
  const mcp = groupOf(s, "mcp").overall;
  // Means over the three tasks, a handoff's two stages summed: bare 200 tokens and 20s, mcp 1000/3 and 10s.
  assert.deepEqual(bare.parts, {
    quality: 0.75,
    handoff: 0.5,
    tokens: 1,
    time: 0.5,
  });
  assert.deepEqual(mcp.parts, { quality: 1, handoff: 1, tokens: 0.6, time: 1 });
  assert.equal(bare.score, 0.6875);
  assert.equal(mcp.score, 0.9);
  assert.deepEqual(bare.absent, []);
  assert.deepEqual(mcp.compared_with, ["bare", "mcp"]);
  assert.deepEqual(mcp.tasks_compared, { tokens: 3, time: 3 });
  assert.equal(bare.weights_equal, true);
  for (const g of s.groups)
    assert.deepEqual(Object.keys(g.overall.parts), OVERALL_PARTS);
});

test("a part that cannot be computed is named, and the total is null with a partial beside it", () => {
  const s = summarize([
    run({
      condition: "bare",
      task: "why-a",
      score: 1,
      input: 100,
      wall: 10_000,
    }),
    run({
      condition: "mcp",
      task: "why-a",
      score: 0.5,
      input: 200,
      wall: 10_000,
    }),
  ]);
  const mcp = groupOf(s, "mcp").overall;
  assert.equal(mcp.score, null);
  assert.deepEqual(mcp.absent, ["handoff"]);
  assert.match(mcp.why_absent.handoff, /handoff/);
  assert.equal(mcp.parts.handoff, null);
  assert.equal(mcp.partial, Math.round(((0.5 + 0.5 + 1) / 3) * 1e4) / 1e4);
});

test("tokens and time compare conditions only over the tasks they all ran", () => {
  const s = summarize([
    run({ condition: "bare", task: "why-a", score: 1, input: 100, wall: 1000 }),
    run({
      condition: "bare",
      task: "why-hard",
      score: 1,
      input: 10_000,
      wall: 100_000,
    }),
    run({ condition: "mcp", task: "why-a", score: 1, input: 100, wall: 1000 }),
  ]);
  assert.equal(groupOf(s, "bare").overall.parts.tokens, 1);
  assert.equal(groupOf(s, "bare").overall.parts.time, 1);
  assert.equal(groupOf(s, "bare").overall.tasks_compared.tokens, 1);
});

test("no part reads whether a condition reaches the sloppy server", () => {
  const records = [
    run({
      condition: "bare",
      task: "why-a",
      score: 0.8,
      input: 100,
      wall: 1000,
    }),
    run({
      condition: "mcp",
      task: "why-a",
      score: 0.6,
      input: 150,
      wall: 2000,
    }),
  ];
  const served = summarize(records, { served: new Set(["mcp"]) });
  const swapped = summarize(records, { served: new Set(["bare"]) });
  for (const c of ["bare", "mcp"])
    assert.deepEqual(
      groupOf(swapped, c).overall.parts,
      groupOf(served, c).overall.parts,
    );
  assert.deepEqual(groupOf(served, "mcp").overall.parts, {
    quality: 0.6,
    handoff: null,
    tokens: 0.6667,
    time: 0.5,
  });
});

test("weights are equal unless named, every part once, and a total under other weights says so", () => {
  assert.deepEqual(parseWeights(undefined), EQUAL_WEIGHTS);
  const w = parseWeights("quality=2,handoff=1,tokens=1,time=0");
  assert.deepEqual(w, { quality: 2, handoff: 1, tokens: 1, time: 0 });
  assert.throws(() => parseWeights("quality=1,handoff=1,tokens=1"), /time/);
  assert.throws(() => parseWeights("quality=1,quality=1,tokens=1,time=1"));
  assert.throws(() => parseWeights("speed=1"));
  assert.throws(() => parseWeights("quality=0,handoff=0,tokens=0,time=0"));
  const s = summarize(
    [
      run({
        condition: "bare",
        task: "why-a",
        score: 0.5,
        input: 1,
        wall: 1,
        family: "why",
      }),
    ],
    { weights: w },
  );
  const o = groupOf(s, "bare").overall;
  assert.equal(o.weights_equal, false);
  assert.deepEqual(o.weights, w);
});

test("findability is read back from transcripts into its own file, and the export reads it beside the records", () => {
  const dir = tempDir();
  const file = path.join(dir, "claude-code-x-2026-11-01.jsonl");
  const r = appendRecord(
    file,
    run({ condition: "mcp", task: "why-a", score: 1, input: 10, wall: 10 }),
  );
  const noTranscript = appendRecord(
    file,
    run({ condition: "bare", task: "why-a", score: 1, input: 10, wall: 10 }),
  );
  writeTranscript(dir, r.run_id, [
    { ms: 0, event: { type: "system", subtype: "init", cwd: "/w" } },
    {
      ms: 1,
      event: {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "1",
              name: "Read",
              input: { file_path: "/w/src/a.js" },
            },
            {
              type: "tool_use",
              id: "2",
              name: "mcp__sloppy__read_note",
              input: { note: "did:x/01A" },
            },
            {
              type: "tool_use",
              id: "3",
              name: "Grep",
              input: { pattern: "x", output_mode: "files_with_matches" },
            },
          ],
        },
      },
    },
    {
      ms: 2,
      event: {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "1", content: "1\tx" },
            {
              type: "tool_result",
              tool_use_id: "2",
              content: [
                { type: "text", text: '{"note":"did:x/01A","title":"t"}' },
              ],
            },
            { type: "tool_result", tool_use_id: "3", content: "src/b.js" },
          ],
        },
      },
    },
  ]);
  const dry = backfillFindability({ resultsDir: dir, dryRun: true });
  assert.equal(dry.rows.length, 1);
  assert.equal(dry.missing, 1);
  assert.deepEqual(readFindability(dir), []);
  const before = readRecords(dir);
  const wet = backfillFindability({ resultsDir: dir });
  assert.deepEqual(
    readFindability(dir).map(({ run_id, files, notes, opened }) => ({
      run_id,
      files,
      notes,
      opened,
    })),
    [{ run_id: r.run_id, files: 1, notes: 1, opened: 2 }],
  );
  assert.deepEqual(readRecords(dir), before);
  assert.equal(backfillFindability({ resultsDir: dir }).rows.length, 0);
  const s = summarize(readRecords(dir), { found: readFindability(dir) });
  assert.equal(groupOf(s, "mcp").opened_mean, 2);
  assert.equal(groupOf(s, "mcp").findability_n, 1);
  assert.equal(groupOf(s, "bare").opened_mean, null);
  assert.ok(wet.file.includes(path.join(dir, "findability")));
  assert.ok(noTranscript);
});

test("a condition that fails early is never the leanest or the fastest", () => {
  const s = summarize([
    run({
      condition: "bare",
      task: "why-a",
      score: 1,
      input: 1000,
      wall: 10_000,
    }),
    run({
      condition: "mcp",
      task: "why-a",
      score: 0,
      input: 5,
      wall: 0,
      status: "error",
    }),
    run({
      condition: "mcp",
      task: "why-a",
      score: 1,
      input: 2000,
      wall: 20_000,
    }),
  ]);
  assert.equal(groupOf(s, "bare").overall.parts.tokens, 1);
  assert.equal(groupOf(s, "mcp").overall.parts.tokens, 0.5);
  assert.equal(groupOf(s, "mcp").overall.parts.time, 0.5);
});
