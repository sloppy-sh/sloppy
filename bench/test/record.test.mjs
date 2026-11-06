import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  appendRecord,
  contextOf,
  newRecord,
  readRecords,
  RecordSchema,
  resultsFile,
} from "../lib/record.mjs";
import { tempDir } from "./helpers.mjs";

const minimal = () => ({
  subject: {
    path: "/s",
    sha: "ef215b51ebfaa2ae88bdd3299eec093fd465d946",
    variant: "full",
  },
  backend: { kind: "mock", model: "default" },
  condition: "bare",
  task: { pack: "example", id: "example", family: "why" },
  rep: 0,
  seed: 1,
  status: "ok",
  timing: { wall_ms: 10 },
});

test("a minimal record is filled with zeroes and empties, never guesses", () => {
  const r = newRecord(minimal());
  assert.equal(r.schema, 1);
  assert.match(r.run_id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(r.timestamp)));
  assert.equal(r.attempt, 0);
  assert.deepEqual(r.tokens, {
    input: 0,
    cache_write: 0,
    cache_read: 0,
    output: 0,
    reasoning: 0,
  });
  assert.deepEqual(r.cost_usd, { basis: "none" });
  assert.equal(r.turns, 0);
  assert.deepEqual(r.tool_calls, {});
  assert.deepEqual(r.mcp_calls, {});
  assert.deepEqual(r.output, { text: "", files_changed: [] });
  assert.equal(r.grade, undefined);
  assert.equal(r.timing.api_ms, undefined);
});

test("defaults are fresh for every record", () => {
  const a = newRecord(minimal());
  const b = newRecord(minimal());
  a.tool_calls.Read = 1;
  a.output.files_changed.push("x");
  assert.deepEqual(b.tool_calls, {});
  assert.deepEqual(b.output.files_changed, []);
});

test("a record outside the shape is refused", () => {
  assert.throws(() => newRecord({ ...minimal(), status: "skipped" }));
  assert.throws(() =>
    newRecord({ ...minimal(), backend: { kind: "gpt", model: "x" } }),
  );
  assert.throws(() => newRecord({ ...minimal(), tokens: { input: -1 } }));
  assert.throws(() => newRecord({ ...minimal(), grade: { score: 1.5 } }));
  assert.throws(() =>
    newRecord({ ...minimal(), cost_usd: { computed: 1, basis: "guess" } }),
  );
  assert.throws(() => newRecord({ ...minimal(), timing: {} }));
});

test("records append as JSONL and read back; earlier lines are never touched", () => {
  const dir = tempDir();
  const file = resultsFile(
    dir,
    "mock",
    "claude-opus-5-5[1m]",
    new Date("2026-10-29T12:00:00Z"),
  );
  assert.equal(
    path.basename(file),
    "mock-claude-opus-5-5_1m_-2026-10-29.jsonl",
  );
  const first = appendRecord(file, newRecord(minimal()));
  const before = fs.readFileSync(file, "utf8");
  appendRecord(
    file,
    newRecord({ ...minimal(), status: "error", error: "it broke" }),
  );
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.startsWith(before));
  const back = readRecords(dir);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], first);
  assert.equal(back[1].status, "error");
  for (const r of back) RecordSchema.parse(r);
});

test("the context is the last call's prompt, and its mean across calls; absent with no calls", () => {
  const calls = [
    { at_ms: 1, input: 10, cache_write: 100, cache_read: 0, output: 5 },
    { at_ms: 2, input: 2, cache_write: 20, cache_read: 110, output: 7 },
  ];
  assert.deepEqual(contextOf(calls), { context_final: 132, context_mean: 121 });
  assert.deepEqual(contextOf([]), {});
  const old = newRecord(minimal());
  assert.deepEqual(old.iterations, []);
  assert.equal(old.context_final, undefined);
  assert.equal(old.subagents_spawned, 0);
  assert.deepEqual(old.unsupported, []);
  const r = newRecord({ ...minimal(), iterations: calls, ...contextOf(calls) });
  assert.equal(RecordSchema.parse(r).context_final, 132);
});
