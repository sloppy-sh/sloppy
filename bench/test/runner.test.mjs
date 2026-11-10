import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NotAllowedError, runBackend } from "../lib/backend.mjs";
import { scoreOf } from "../lib/report.mjs";
import { planRuns, shuffle } from "../lib/order.mjs";
import { readRecords, RecordSchema } from "../lib/record.mjs";
import {
  pickConditions,
  pickTasks,
  RefusedError,
  runBatch,
} from "../lib/runner.mjs";
import { loadConditions } from "../lib/condition.mjs";
import { loadPack } from "../lib/task.mjs";
import { loadSubject, parseConfig, subjectNames } from "../lib/config.mjs";
import {
  makeSubject,
  makeDocSiteSubject,
  NO_AGENTS,
  DOC_SITE_CONFIG,
  tempDir,
  testSubject,
} from "./helpers.mjs";

const quiet = () => {};
const SUBJECT = testSubject();

function batch(overrides = {}) {
  return runBatch({
    backend: "mock",
    subject: overrides.subject ?? makeSubject(),
    subjectConfig: SUBJECT,
    pack: "example",
    reps: 2,
    seed: 7,
    budgetUsd: 100,
    outDir: tempDir(),
    workRoot: tempDir(),
    agents: NO_AGENTS,
    log: quiet,
    ...overrides,
  });
}

test("the same seed draws the same order, and another seed a different one", () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(shuffle(items, 1), shuffle(items, 1));
  assert.notDeepEqual(shuffle(items, 1), shuffle(items, 2));
  assert.deepEqual(
    [...shuffle(items, 1)].sort((a, b) => a - b),
    items,
  );
  const plan = planRuns(
    [{ id: "a" }, { id: "b" }],
    [{ id: "x" }, { id: "y" }],
    3,
    5,
  );
  assert.equal(plan.length, 12);
  assert.equal(
    new Set(plan.map((p) => `${p.task.id}${p.condition.id}${p.rep}`)).size,
    12,
  );
});

test("a mock batch over all ten conditions writes one valid record per run, in seeded order", async () => {
  const subject = makeSubject();
  const a = await batch({ subject });
  const b = await batch({ subject });
  assert.equal(a.records.length, 20);
  for (const r of readRecords(path.dirname(a.file))) RecordSchema.parse(r);
  const order = (res) => res.records.map((r) => `${r.condition}/${r.rep}`);
  assert.deepEqual(order(a), order(b));
  assert.notDeepEqual(order(a), [...order(a)].sort());
  for (const r of a.records) {
    assert.equal(r.status, "ok");
    assert.equal(r.seed, 7);
    assert.equal(r.cost_usd.reported, 0.25);
    assert.equal(r.cost_usd.basis, "none");
    assert.equal(
      r.subject.variant,
      r.condition === "nodocs"
        ? "nodocs"
        : r.condition === "notes-only"
          ? "notes-only"
          : "full",
    );
    assert.deepEqual(r.output.files_changed, []);
    assert.deepEqual(
      Object.keys(r.mcp_calls).length > 0,
      ["notes-only", "mcp", "mcp+pointed", "mcp+agents", "harness"].includes(
        r.condition,
      ),
    );
    assert.deepEqual(
      r.sent.harness,
      r.condition === "harness" ? { profile: "full" } : undefined,
    );
    assert.equal(
      r.subagents_spawned,
      ["agents", "mcp+agents"].includes(r.condition) ? 1 : 0,
    );
    assert.ok(r.iterations.length > 0);
    assert.equal(
      r.context_final,
      r.iterations.at(-1).input +
        r.iterations.at(-1).cache_write +
        r.iterations.at(-1).cache_read,
    );
    assert.equal(
      r.iterations.reduce((n, it) => n + it.cache_read, 0),
      r.tokens.cache_read,
    );
  }
  assert.equal(path.basename(a.file).startsWith("mock-default-"), true);
});

test("the budget stop records the runs it did not start", async () => {
  const res = await batch({
    budgetUsd: 0.6,
    conditions: ["bare", "mcp", "pointed"],
  });
  const statuses = res.records.map((r) => r.status);
  assert.deepEqual(statuses, ["ok", "ok", "ok", "budget", "budget", "budget"]);
  for (const r of res.records.filter((x) => x.status === "budget")) {
    assert.equal(r.timing.wall_ms, 0);
    assert.equal(r.turns, 0);
    assert.match(r.error, /budget/);
  }
});

test("no batch starts without a budget", async () => {
  await assert.rejects(batch({ budgetUsd: undefined }), RefusedError);
});

test("a failed run is retried only when asked, and every attempt keeps its record", async () => {
  const tasksDir = tempDir();
  fs.mkdirSync(path.join(tasksDir, "t"));
  fs.writeFileSync(
    path.join(tasksDir, "t", "unanswered.json"),
    JSON.stringify({
      id: "unanswered",
      family: "why",
      prompt: "?",
      tools: "read",
      key: "k",
      rubric: [{ criterion: "c", points: 1 }],
    }),
  );
  const once = await batch({
    tasksDir,
    pack: "t",
    reps: 1,
    conditions: ["bare"],
  });
  assert.deepEqual(
    once.records.map((r) => [r.status, r.attempt]),
    [["error", 0]],
  );
  const thrice = await batch({
    tasksDir,
    pack: "t",
    reps: 1,
    conditions: ["bare"],
    retries: 2,
  });
  assert.deepEqual(
    thrice.records.map((r) => [r.status, r.attempt, r.rep]),
    [
      ["error", 0, 0],
      ["error", 1, 0],
      ["error", 2, 0],
    ],
  );
});

test("an installed agent the person has not allowed is refused in words, before anything runs", async () => {
  const outDir = tempDir();
  await assert.rejects(batch({ backend: "claude-code", outDir }), (err) => {
    assert.ok(err instanceof NotAllowedError);
    assert.match(err.message, /does not allow/);
    assert.match(err.message, /allow_installed/);
    return true;
  });
  assert.deepEqual(fs.readdirSync(outDir), []);
  await assert.rejects(
    runBackend("codex", {}, { agents: NO_AGENTS }),
    NotAllowedError,
  );
});

test("an allowed installed agent runs, and one that cannot start is recorded as an error rather than hidden", async () => {
  const res = await batch({
    backend: "claude-code",
    reps: 1,
    conditions: ["bare"],
    agents: {
      allow_installed: ["claude-code"],
      installed: {
        "claude-code": {
          command: "/nonexistent/claude",
          args: [],
          provider: "anthropic",
        },
      },
    },
  });
  assert.equal(res.records.length, 1);
  assert.equal(res.records[0].status, "error");
  assert.match(res.records[0].error, /not installed/);
  assert.equal(res.records[0].backend.provider, "anthropic");
});

test("the api backend refuses a provider whose key is not in the environment", async () => {
  delete process.env.BENCH_TEST_KEY;
  await assert.rejects(
    batch({
      backend: "api",
      provider: "p",
      model: "m",
      providers: [
        {
          id: "p",
          kind: "openai-compatible",
          key_env: "BENCH_TEST_KEY",
          models: ["m"],
        },
      ],
    }),
    /Set BENCH_TEST_KEY/,
  );
});

test("the harness condition runs only under the harness backend, and the harness backend only it", async () => {
  process.env.BENCH_TEST_KEY = "k";
  const provider = (kind) => ({
    provider: "p",
    model: "m",
    providers: [{ id: "p", kind, key_env: "BENCH_TEST_KEY", models: ["m"] }],
  });
  try {
    await assert.rejects(
      batch({
        backend: "api",
        ...provider("anthropic"),
        conditions: ["harness"],
      }),
      /run it in a batch of its own with --backend harness/,
    );
    await assert.rejects(
      batch({
        backend: "harness",
        ...provider("anthropic"),
        conditions: ["bare"],
      }),
      /only a condition that asks for it, and bare does not/,
    );
    await assert.rejects(
      batch({
        backend: "harness",
        ...provider("openai-compatible"),
        conditions: ["harness"],
      }),
      /p is not one/,
    );
    await assert.rejects(
      batch({
        backend: "harness",
        ...provider("anthropic"),
        conditions: ["harness"],
        configs: [{ name: "lean", sha: "HEAD", args: ["--profile=lean"] }],
      }),
      /takes no server settings; leave --profile=lean out of lean/,
    );
    await assert.rejects(
      batch({
        backend: "harness",
        ...provider("anthropic"),
        conditions: ["harness"],
        timeoutMs: 600_001,
      }),
      /no more than 600000/,
    );
  } finally {
    delete process.env.BENCH_TEST_KEY;
  }
});

test("the objective grader sees the variant as the agent left it, and the judge sees only the answer", async () => {
  const seenObjective = [];
  const seenJudge = [];
  const res = await batch({
    reps: 1,
    conditions: ["bare", "nodocs", "mcp"],
    objective: async (view) => {
      seenObjective.push(view);
      return {
        score: fs.existsSync(path.join(view.dir, "AI.md")) ? 1 : 0,
      };
    },
    judge: async (view) => {
      seenJudge.push(view);
      return { score: 0.5, notes: "fair" };
    },
  });
  for (const view of [...seenObjective, ...seenJudge]) {
    for (const leak of ["condition", "subject", "record", "variant"])
      assert.equal(view[leak], undefined, leak);
    assert.equal(view.task.condition, undefined);
  }
  for (const view of seenObjective)
    assert.deepEqual(Object.keys(view).sort(), ["dir", "output", "task"]);
  for (const view of seenJudge) {
    assert.deepEqual(Object.keys(view).sort(), ["task", "text"]);
    assert.equal(typeof view.text, "string");
  }
  const byCondition = Object.fromEntries(
    res.records.map((r) => [r.condition, r.grade]),
  );
  assert.deepEqual(byCondition.bare, {
    objective: 1,
    judge: 0.5,
    score: 0.75,
    notes: "fair",
  });
  assert.deepEqual(byCondition.nodocs, {
    objective: 0,
    judge: 0.5,
    score: 0.25,
    notes: "fair",
  });
});

test("a grader that throws keeps the run's record, the other grader's score and the rest of the batch", async () => {
  const res = await batch({
    reps: 1,
    conditions: ["bare", "pointed"],
    objective: async () => {
      throw new Error("hidden test would not start");
    },
    judge: async () => ({ score: 1 }),
  });
  assert.equal(res.records.length, 2);
  const stored = readRecords(path.dirname(res.file));
  assert.equal(stored.length, 2);
  for (const r of stored) {
    assert.equal(r.status, "ok");
    assert.equal(r.grade.objective, undefined);
    assert.equal(r.grade.judge, 1);
    assert.equal(r.grade.score, 1);
    assert.match(
      r.grade.notes,
      /objective grader failed: hidden test would not start/,
    );
  }
});

function unmeteredPack(fixture) {
  const tasksDir = tempDir();
  fs.mkdirSync(path.join(tasksDir, "u"));
  fs.writeFileSync(
    path.join(tasksDir, "u", "unmetered.json"),
    JSON.stringify({
      id: "unmetered",
      family: "why",
      prompt: "?",
      tools: "read",
      key: "k",
      rubric: [{ criterion: "c", points: 1 }],
    }),
  );
  const fixtures = tempDir();
  fs.writeFileSync(
    path.join(fixtures, "unmetered.json"),
    JSON.stringify({ text: "an answer", turns: 2, ...fixture }),
  );
  return { tasksDir, fixtures };
}

async function withFixtures(fixtures, run) {
  process.env.SLOPPY_BENCH_MOCK_FIXTURES = fixtures;
  try {
    return await run();
  } finally {
    delete process.env.SLOPPY_BENCH_MOCK_FIXTURES;
  }
}

test("a priced run that told no tokens has no computed cost, and stops the batch", async () => {
  const { tasksDir, fixtures } = unmeteredPack({});
  const res = await withFixtures(fixtures, () =>
    batch({
      tasksDir,
      pack: "u",
      reps: 3,
      conditions: ["bare"],
      provider: "anthropic",
      model: "claude-sonnet-5",
    }),
  );
  const [first, ...rest] = res.records;
  assert.equal(first.status, "ok");
  assert.deepEqual(first.tokens_unknown, [
    "input",
    "cache_write",
    "cache_read",
    "output",
    "reasoning",
  ]);
  assert.equal(first.cost_usd.computed, undefined);
  assert.equal(first.cost_usd.basis, "none");
  assert.deepEqual(
    rest.map((r) => r.status),
    ["budget", "budget"],
  );
});

test("where tokens cannot be told, a reported cost is the one the budget holds to", async () => {
  const { tasksDir, fixtures } = unmeteredPack({
    tokens: { input: 1000 },
    tokens_unknown: ["cache_write", "cache_read"],
    cost_reported: 0.3,
  });
  const res = await withFixtures(fixtures, () =>
    batch({
      tasksDir,
      pack: "u",
      reps: 3,
      conditions: ["bare"],
      budgetUsd: 0.5,
      provider: "anthropic",
      model: "claude-sonnet-5",
    }),
  );
  assert.deepEqual(
    res.records.map((r) => [
      r.status,
      r.cost_usd.reported,
      r.cost_usd.computed,
    ]),
    [
      ["ok", 0.3, undefined],
      ["ok", 0.3, undefined],
      ["budget", undefined, undefined],
    ],
  );
});

test("several configs draw one deterministic order holding every config", () => {
  const tasks = [{ id: "a" }, { id: "b" }];
  const conditions = [{ id: "x" }, { id: "y" }];
  const configs = [{ name: "one" }, { name: "two" }];
  const plan = planRuns(tasks, conditions, 2, 9, configs);
  assert.equal(plan.length, 16);
  assert.deepEqual(plan, planRuns(tasks, conditions, 2, 9, configs));
  assert.equal(
    new Set(
      plan.map((p) => `${p.task.id}${p.condition.id}${p.config.name}${p.rep}`),
    ).size,
    16,
  );
  const names = plan.map((p) => p.config.name);
  assert.notDeepEqual(names, [...names].sort());
  const drop = (p) =>
    p.map(({ task, condition, rep }) => [task, condition, rep]);
  assert.deepEqual(
    drop(planRuns(tasks, conditions, 2, 9)),
    drop(planRuns(tasks, conditions, 2, 9, [{ name: "only" }])),
  );
});

const revParse = (dir, rev) =>
  execFileSync("git", ["rev-parse", rev], {
    cwd: dir,
    encoding: "utf8",
  }).trim();

test("a batch over two configs records each run's config and the commit it ran on, interleaved", async () => {
  const subject = makeSubject();
  const shas = { a: revParse(subject, "HEAD"), b: revParse(subject, "HEAD~1") };
  const res = await batch({
    subject,
    conditions: ["bare", "mcp"],
    configs: [
      { name: "a", sha: "HEAD" },
      { name: "b", sha: "HEAD~1" },
    ],
  });
  assert.equal(res.records.length, 8);
  for (const r of readRecords(path.dirname(res.file))) {
    assert.equal(r.status, "ok");
    assert.equal(r.subject.sha, shas[r.config]);
  }
  const names = res.records.map((r) => r.config);
  assert.deepEqual([...new Set(names)].sort(), ["a", "b"]);
  assert.notDeepEqual(names, [...names].sort());
});

test("--configs refuses a second way of naming the commit, a repeated name and a relative CLI", async () => {
  const configs = [{ name: "a", sha: "HEAD" }];
  await assert.rejects(batch({ configs, sha: "HEAD" }), RefusedError);
  await assert.rejects(batch({ configs, config: "lean" }), RefusedError);
  await assert.rejects(
    batch({ configs: [...configs, { name: "a", sha: "HEAD~1" }] }),
    /names "a" twice/,
  );
  await assert.rejects(
    batch({ configs: [{ name: "a", sha: "HEAD", cli: "dist/sloppy.mjs" }] }),
    /not an absolute path/,
  );
});

test("each config's mcp runs are served by that config's CLI", async () => {
  const dir = tempDir();
  const seen = path.join(dir, "seen.jsonl");
  const fakeAgent = path.join(dir, "agent.mjs");
  fs.writeFileSync(
    fakeAgent,
    `import fs from "node:fs";
const args = process.argv.slice(2);
const config = fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8");
fs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify(JSON.parse(config)) + "\\n");
`,
  );
  const cli = { a: path.join(dir, "a.mjs"), b: path.join(dir, "b.mjs") };
  for (const file of Object.values(cli)) fs.writeFileSync(file, "");
  const res = await batch({
    backend: "claude-code",
    conditions: ["mcp"],
    configs: [
      { name: "a", sha: "HEAD", cli: cli.a },
      { name: "b", sha: "HEAD", cli: cli.b },
    ],
    agents: {
      allow_installed: ["claude-code"],
      installed: {
        "claude-code": { command: process.execPath, args: [fakeAgent] },
      },
    },
  });
  const served = fs
    .readFileSync(seen, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).mcpServers.sloppy.args);
  assert.equal(served.length, 4);
  assert.deepEqual(
    served,
    res.records.map((r) => [cli[r.config], "mcp"]),
  );
});

test("a config's entry may carry the arguments its server starts with, after a CLI or in place of one", () => {
  assert.deepEqual(parseConfig("default=f420d155"), {
    name: "default",
    sha: "f420d155",
  });
  assert.deepEqual(parseConfig("lean=cafb15e0:/abs/c:d/sloppy.mjs"), {
    name: "lean",
    sha: "cafb15e0",
    cli: "/abs/c:d/sloppy.mjs",
  });
  assert.deepEqual(
    parseConfig("lean=cafb15e0:/abs/sloppy.mjs:--profile=lean"),
    {
      name: "lean",
      sha: "cafb15e0",
      cli: "/abs/sloppy.mjs",
      args: ["--profile=lean"],
    },
  );
  assert.deepEqual(
    parseConfig("terse=cafb15e0::--answers=terse:--land-on-code"),
    {
      name: "terse",
      sha: "cafb15e0",
      args: ["--answers=terse", "--land-on-code"],
    },
  );
  assert.equal(parseConfig("lean"), undefined);
});

test("each config's server is started with that config's arguments, and the record says which", async () => {
  const dir = tempDir();
  const seen = path.join(dir, "seen.jsonl");
  const fakeAgent = path.join(dir, "agent.mjs");
  fs.writeFileSync(
    fakeAgent,
    `import fs from "node:fs";
const args = process.argv.slice(2);
const config = fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8");
fs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify(JSON.parse(config)) + "\\n");
`,
  );
  const cli = path.join(dir, "sloppy.mjs");
  fs.writeFileSync(cli, "");
  const res = await batch({
    backend: "claude-code",
    conditions: ["mcp"],
    configs: [
      { name: "default", sha: "HEAD", cli },
      { name: "lean", sha: "HEAD", cli, args: ["--profile=lean"] },
    ],
    agents: {
      allow_installed: ["claude-code"],
      installed: {
        "claude-code": { command: process.execPath, args: [fakeAgent] },
      },
    },
  });
  const served = fs
    .readFileSync(seen, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).mcpServers.sloppy.args);
  assert.deepEqual(
    served,
    res.records.map((r) =>
      r.config === "lean" ? [cli, "mcp", "--profile=lean"] : [cli, "mcp"],
    ),
  );
  for (const r of res.records) {
    RecordSchema.parse(r);
    assert.deepEqual(
      r.sent.mcp_args,
      r.config === "lean" ? ["--profile=lean"] : undefined,
    );
  }
});

test("a batch records the subject it ran on, and a second subject gets folders of its own", async () => {
  const workRoot = tempDir();
  const first = await batch({ workRoot, conditions: ["bare"], reps: 1 });
  const site = await batch({
    workRoot,
    subject: makeDocSiteSubject(),
    subjectConfig: testSubject(DOC_SITE_CONFIG, "doc-site"),
    conditions: ["notes-only", "nodocs"],
    reps: 1,
  });
  assert.deepEqual(
    first.records.map((r) => r.subject.name),
    ["subject"],
  );
  assert.deepEqual(
    site.records.map((r) => r.subject.name),
    ["doc-site", "doc-site"],
  );
  for (const r of site.records) RecordSchema.parse(r);
  assert.deepEqual(
    fs
      .readdirSync(workRoot)
      .map((d) => d.split("-").slice(0, -1).join("-"))
      .sort(),
    ["doc-site-nodocs", "doc-site-notes-only", "subject-full"],
  );
});

test("a run killed at its time limit is charged the dearest run so far, and the batch goes on", async () => {
  const tasksDir = tempDir();
  const fixtures = tempDir();
  fs.mkdirSync(path.join(tasksDir, "t"));
  for (const id of ["slow", "quick"]) {
    fs.writeFileSync(
      path.join(tasksDir, "t", `${id}.json`),
      JSON.stringify({
        id,
        family: "why",
        prompt: "?",
        tools: "read",
        key: "k",
        rubric: [{ criterion: "c", points: 1 }],
      }),
    );
  }
  fs.writeFileSync(
    path.join(fixtures, "slow.json"),
    JSON.stringify({ text: "", status: "timeout", error: "too long" }),
  );
  fs.writeFileSync(
    path.join(fixtures, "quick.json"),
    JSON.stringify({ text: "k", cost_reported: 0.1 }),
  );
  const before = process.env.SLOPPY_BENCH_MOCK_FIXTURES;
  process.env.SLOPPY_BENCH_MOCK_FIXTURES = fixtures;
  try {
    const res = await batch({
      tasksDir,
      pack: "t",
      reps: 3,
      conditions: ["bare"],
      budgetUsd: 100,
    });
    const statuses = res.records.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === "timeout").length, 3);
    assert.equal(statuses.filter((s) => s === "ok").length, 3);
    assert.ok(!statuses.includes("budget"));
  } finally {
    if (before === undefined) delete process.env.SLOPPY_BENCH_MOCK_FIXTURES;
    else process.env.SLOPPY_BENCH_MOCK_FIXTURES = before;
  }
});

test("lanes run a batch at once, each in its own copy, and every run is still recorded", async () => {
  const workRoot = tempDir();
  const lanes = 3;
  const { records } = await batch({ lanes, reps: 2, workRoot });
  const serial = await batch({ lanes: 1, reps: 2, workRoot: tempDir() });

  assert.equal(records.length, serial.records.length);
  assert.deepEqual(
    records.map((r) => `${r.condition}\t${r.task.id}\t${r.rep}`).sort(),
    serial.records.map((r) => `${r.condition}\t${r.task.id}\t${r.rep}`).sort(),
    "the lanes work through the same plan a single lane does",
  );
  assert.ok(
    records.every((r) => r.status === "ok"),
    "no run is lost to two lanes sharing a folder",
  );

  const copies = fs
    .readdirSync(workRoot)
    .filter((name) => name.includes("-lane"))
    .map((name) => name.slice(name.indexOf("-lane")))
    .sort();
  assert.deepEqual(
    [...new Set(copies)],
    ["-lane1", "-lane2"],
    "lane 0 keeps the name one lane has always used; the rest get their own",
  );
});

test("a limit is read from the failure, never from an answer that talks about rate limits", async () => {
  const { records } = await batch({ reps: 1, lanes: 2 });
  assert.ok(records.length > 0);
  assert.ok(
    records.every((r) => r.attempt === 0),
    "a run that finished is never run again for what its answer happens to say",
  );
});

test("a run that never began answering is unscored, where one that answered badly scores zero", () => {
  const grades = new Map();
  assert.equal(
    scoreOf({ run_id: "a", status: "error", turns: 0 }, grades),
    undefined,
    "it never answered, so it is not an answer worth zero",
  );
  assert.equal(
    scoreOf({ run_id: "b", status: "error", turns: 4, grade: {} }, grades),
    0,
    "it answered and delivered nothing",
  );
  assert.equal(
    scoreOf(
      {
        run_id: "c",
        status: "error",
        turns: 4,
        error:
          "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND).",
      },
      grades,
    ),
    undefined,
    "the provider failed it mid-answer, so it is no answer of the condition's",
  );
});

test("a batch that names no conditions runs the ones its backend runs", () => {
  const all = loadConditions();
  const ids = (backend, simulated = false) =>
    pickConditions(all, [], backend, simulated).map((c) => c.id);
  assert.deepEqual(
    ids("api"),
    all.conditions.filter((c) => c.id !== "harness").map((c) => c.id),
  );
  assert.deepEqual(ids("claude-code"), ids("api"));
  assert.deepEqual(ids("harness"), ["harness"]);
  assert.equal(ids("mock", true).length, all.conditions.length);
});

test("the harness backend leaves handoff tasks out, and refuses one it is named", () => {
  const pack = subjectNames()
    .map((name) => loadSubject(name).default_pack)
    .find((p) => loadPack(p).some((t) => t.stage_a));
  assert.ok(pack, "some subject's pack carries a handoff task");
  const every = pickTasks(pack, [], undefined, "api");
  const handoff = every.find((t) => t.stage_a);
  const carried = pickTasks(pack, [], undefined, "harness");
  assert.deepEqual(
    carried.map((t) => t.id),
    every.filter((t) => !t.stage_a).map((t) => t.id),
  );
  assert.throws(
    () => pickTasks(pack, [handoff.id], undefined, "harness"),
    /cannot run the handoff task/,
  );
});
