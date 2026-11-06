import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildSummary } from "../export.mjs";
import { BENCH_DIR } from "../lib/config.mjs";
import { loadPrices } from "../lib/prices.mjs";
import { privateSubjects, withoutPrivate } from "../lib/private.mjs";
import { newRecord } from "../lib/record.mjs";
import { tempDir } from "./helpers.mjs";

const prices = loadPrices(path.join(BENCH_DIR, "prices.json"));

const run = (subject, task, family, condition, rep) =>
  newRecord({
    subject: {
      name: subject,
      path: "/s",
      sha: "b".repeat(40),
      variant: "full",
    },
    backend: { kind: "claude-code", model: "claude-sonnet-5-5" },
    condition,
    task: { pack: subject, id: task, family },
    rep,
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
    grade: { objective: rep / 2, score: rep / 2 },
  });

const records = ["bare", "mcp"].flatMap((condition) =>
  [0, 1, 2].flatMap((rep) => [
    run("hush", "hush-why-energy-model", "why", condition, rep),
    run("hush", "hush-why-billing", "why", condition, rep),
    run("hush", "hush-drift-day-cutoffs", "drift", condition, rep),
    run("open", "open-why-x", "why", condition, rep),
  ]),
);

const facts = (name, sha) => ({
  label: name === "hush" ? "Hush" : "Open",
  sha,
});

const HIDDEN = new Map([["hush", "A private app"]]);

const summarise = (hidden) =>
  buildSummary({
    records,
    grades: [],
    prices,
    facts,
    hidden,
    now: new Date(0),
  });

test("a private subject keeps its numbers, and no name, task id or run id of its own", () => {
  const shown = summarise(HIDDEN);
  const text = JSON.stringify(shown);
  assert.doesNotMatch(text, /hush|energy|billing|cutoffs/i);
  const ids = records
    .filter((r) => r.subject.name === "hush")
    .map((r) => r.run_id);
  for (const id of ids)
    assert.ok(!text.includes(id), `run ${id} is in the export`);

  assert.deepEqual(Object.keys(shown.subjects).sort(), ["open", "private-1"]);
  assert.deepEqual(shown.subjects["private-1"], {
    label: "A private app",
    sha: null,
    private: true,
  });
  const tasks = shown.groups
    .find((g) => g.subject === "private-1")
    .tasks.map((t) => t.task);
  assert.deepEqual(tasks.sort(), [
    "private-1-drift-1",
    "private-1-why-1",
    "private-1-why-2",
  ]);

  const plain = summarise(new Map());
  const numbers = (s, subject) =>
    s.groups
      .filter((g) => g.subject === subject)
      .map(({ subject: _, tasks, ...g }) => ({
        ...g,
        tasks: tasks.map(({ task: _t, ...t }) => t),
      }));
  assert.deepEqual(numbers(shown, "private-1"), numbers(plain, "hush"));
  assert.deepEqual(
    shown.groups.filter((g) => g.subject === "open"),
    plain.groups.filter((g) => g.subject === "open"),
  );
  assert.ok(
    shown.curves
      .find((c) => c.subject === "open")
      .points.every((p) => p.run_id),
  );
});

test("hiding twice is hiding once, and a summary with nothing private is left as it was", () => {
  const plain = summarise(new Map());
  assert.equal(
    withoutPrivate(plain, new Map([["elsewhere", "A private app"]])),
    plain,
  );
  const once = withoutPrivate(plain, HIDDEN);
  assert.deepEqual(withoutPrivate(once, HIDDEN), once);
});

test("a subject is private only where its file says so", () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, "a.json"),
    JSON.stringify({ private: true, label: "Something" }),
  );
  fs.writeFileSync(path.join(dir, "d.json"), JSON.stringify({ private: true }));
  fs.writeFileSync(
    path.join(dir, "b.json"),
    JSON.stringify({ private: "yes" }),
  );
  fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify({}));
  assert.deepEqual([...privateSubjects(dir)].sort(), [
    ["a", "Something"],
    ["d", "A private project"],
  ]);
  assert.equal(privateSubjects().size, 0);
});
