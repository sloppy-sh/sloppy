import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import { loadBackend } from "../lib/backend.mjs";
import { BENCH_DIR } from "../lib/config.mjs";
import { loadConditions } from "../lib/condition.mjs";
import { buildPrompt } from "../lib/prompt.mjs";
import {
  backfillPrompts,
  gitTree,
  modelOfFile,
  readSent,
  reconstructSent,
} from "../lib/reconstruct.mjs";
import { newRecord, readRecords, RecordSchema } from "../lib/record.mjs";
import { formatRun, openRun, transcriptCalls } from "../lib/run.mjs";
import { runBatch } from "../lib/runner.mjs";
import {
  readTranscript,
  REDACTED,
  redact,
  transcriptFile,
  writeTranscript,
} from "../lib/transcript.mjs";
import {
  gitIn,
  makeSubject,
  NO_AGENTS,
  SUBJECT_CONFIG,
  tempDir,
  testSubject,
  write,
} from "./helpers.mjs";

const quiet = () => {};
const SECRET = "sk-ant-api03-thisIsNotARealKeyButLooksLikeOne";

const mockBatch = (overrides = {}) =>
  runBatch({
    backend: "mock",
    subject: makeSubject(),
    subjectConfig: testSubject(),
    pack: "example",
    conditions: ["bare", "pointed", "dump", "mcp", "agents"],
    reps: 1,
    seed: 3,
    budgetUsd: 100,
    outDir: tempDir(),
    workRoot: tempDir(),
    agents: NO_AGENTS,
    log: quiet,
    ...overrides,
  });

const baseRecord = {
  subject: { name: "sloppy", path: "/x", sha: "abcdef1", variant: "full" },
  backend: { kind: "mock", model: "default" },
  condition: "bare",
  task: { pack: "example", id: "example", family: "why" },
  rep: 0,
  seed: 1,
  status: "ok",
  timing: { wall_ms: 10 },
};

test("a record without `sent` still parses, and one with it keeps it whole", () => {
  assert.equal(newRecord(baseRecord).sent, undefined);
  const sent = {
    system: "s",
    prompt: "p",
    mcp: false,
    tools: ["Read"],
    model: "sonnet",
  };
  assert.deepEqual(newRecord({ ...baseRecord, sent }).sent, sent);
  assert.throws(() =>
    RecordSchema.parse(
      newRecord({ ...baseRecord, sent: { ...sent, system: undefined } }),
    ),
  );
});

test("every started run records exactly what it was sent, and keeps its transcript", async () => {
  const { file, records } = await mockBatch();
  const dir = path.dirname(file);
  const conditionSet = loadConditions();
  const [task] = (await import("../lib/task.mjs")).loadPack("example");
  for (const r of readRecords(dir)) {
    const condition = conditionSet.conditions.find((c) => c.id === r.condition);
    assert.equal(r.sent.prompt, task.prompt);
    assert.equal(r.sent.mcp, condition.mcp);
    assert.equal(r.sent.model, "default");
    assert.deepEqual(r.sent.tools, ["read"]);
    assert.ok(r.sent.system.startsWith(conditionSet.base_system));
    if (r.condition === "dump")
      assert.match(r.sent.system, /# AI\.md\n\n# Rules/);
    const events = readTranscript(dir, r.run_id);
    assert.deepEqual(
      events.map((e) => e.event.type),
      ["fixture", "answer"],
    );
    assert.equal(events[1].event.text, r.output.text);
  }
  assert.equal(records.length, 5);
});

test("a run the budget stopped records nothing sent and keeps no transcript", async () => {
  const { file, records } = await mockBatch({ budgetUsd: 0.25 });
  const stopped = records.filter((r) => r.status === "budget");
  assert.ok(stopped.length > 0);
  for (const r of stopped) {
    assert.equal(r.sent, undefined);
    assert.equal(
      fs.existsSync(transcriptFile(path.dirname(file), r.run_id)),
      false,
    );
  }
});

test("Claude Code and the api backend name the tools they offer", async () => {
  const cc = await loadBackend("claude-code");
  assert.deepEqual(cc.tools({ tools: "read" }), ["Read", "Grep", "Glob"]);
  assert.deepEqual(cc.tools({ tools: "read", subagents: true }), [
    "Read",
    "Grep",
    "Glob",
    "Task",
  ]);
  const api = await loadBackend("api");
  assert.deepEqual(api.tools({ tools: "read" }), ["read", "grep", "glob"]);
});

test("a transcript holds no secret value from the environment and no credential-shaped string", () => {
  const dir = tempDir();
  const env = {
    MY_PROVIDER_API_KEY: SECRET,
    GITHUB_TOKEN: 'ghp_quoted"value\\with-escapes1234',
    HOME: "/Users/someone",
    SHORT_KEY: "abc",
  };
  const events = [
    { ms: 0, event: { type: "system", note: `key ${SECRET} in a line` } },
    { ms: 5, event: { text: `token ${env.GITHUB_TOKEN}` } },
    {
      ms: 9,
      event: {
        text: "an unnamed ghp_abcdefghijklmnopqrstuvwxyz0123 and sk-ant-zzzzzzzzzzzz",
      },
    },
    { ms: 12, event: { cwd: env.HOME, short: env.SHORT_KEY } },
  ];
  const file = writeTranscript(dir, "run-1", events, { env });
  const raw = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  assert.doesNotMatch(raw, /sk-ant-/);
  assert.doesNotMatch(raw, /ghp_/);
  assert.ok(!raw.includes("quoted"));
  const read = readTranscript(dir, "run-1");
  assert.equal(read.length, 4);
  assert.equal(read[0].event.note, `key ${REDACTED} in a line`);
  assert.equal(read[3].event.cwd, "/Users/someone");
  assert.equal(read[3].event.short, "abc");
  assert.equal(redact("nothing here", []), "nothing here");
  assert.equal(readTranscript(dir, "no-such-run"), undefined);
});

test("the runner's transcript is redacted against the environment it ran in", async () => {
  const fixtures = tempDir();
  fs.writeFileSync(
    path.join(fixtures, "example.json"),
    JSON.stringify({
      text: `the key is ${SECRET}`,
      tokens: { input: 1, output: 1 },
    }),
  );
  const before = process.env.SLOPPY_BENCH_MOCK_FIXTURES;
  process.env.SLOPPY_BENCH_MOCK_FIXTURES = fixtures;
  process.env.SLOPPY_BENCH_TEST_API_KEY = SECRET;
  try {
    const { file, records } = await mockBatch({ conditions: ["bare"] });
    const raw = zlib
      .gunzipSync(
        fs.readFileSync(transcriptFile(path.dirname(file), records[0].run_id)),
      )
      .toString("utf8");
    assert.ok(!raw.includes(SECRET));
    assert.ok(raw.includes(REDACTED));
  } finally {
    delete process.env.SLOPPY_BENCH_TEST_API_KEY;
    if (before === undefined) delete process.env.SLOPPY_BENCH_MOCK_FIXTURES;
    else process.env.SLOPPY_BENCH_MOCK_FIXTURES = before;
  }
});

test("a run's prompt rebuilt from the bench and the variant is the prompt it was sent", async () => {
  const subject = makeSubject();
  const workRoot = tempDir();
  const { file } = await mockBatch({
    subject,
    workRoot,
    conditions: loadConditions().conditions.map((c) => c.id),
  });
  const mock = await loadBackend("mock");
  for (const r of readRecords(path.dirname(file))) {
    const variant = path.join(
      workRoot,
      fs
        .readdirSync(workRoot)
        .find((d) => d.includes(`-${r.subject.variant}-`)),
    );
    const rebuilt = reconstructSent({
      record: { ...r, sent: undefined },
      readBench: (rel) => {
        if (rel === `subjects/${r.subject.name}.json`)
          return JSON.stringify(SUBJECT_CONFIG);
        const f = path.join(BENCH_DIR, rel);
        return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined;
      },
      readSubject: (rel) => {
        const f = path.join(variant, rel);
        return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined;
      },
      backend: mock,
      model: "default",
    });
    assert.deepEqual(rebuilt, r.sent, r.condition);
  }
});

test("a conditions file from before subjects were named rebuilds the same prompt as today's", () => {
  const now = loadConditions();
  const sloppy = SUBJECT_CONFIG;
  const then = {
    base_system: now.base_system,
    conditions: now.conditions.map((c) => ({
      ...c,
      pointed: undefined,
      lines: c.pointed
        ? [
            `AI.md and docs/ARCHITECTURE.md are this project's documents of record; read what you need from them.`,
            ...c.lines,
          ]
        : c.lines,
      dump: c.dump ? sloppy.dump : [],
    })),
  };
  const files = {
    "AI.md": "a",
    "docs/ARCHITECTURE.md": "b",
    "DESIGN.md": "c",
    "PRODUCT.md": "d",
  };
  const task = { id: "t", prompt: "Do it.", tools: "read" };
  const tools = { tools: (r) => [r.tools] };
  for (const c of now.conditions) {
    const record = {
      ...baseRecord,
      condition: c.id,
      task: { pack: "p", id: "t" },
    };
    const bench = (conditions, subject) => (rel) =>
      rel === "conditions.json"
        ? JSON.stringify(conditions)
        : rel === "tasks/p/t.json"
          ? JSON.stringify(task)
          : rel === "subjects/sloppy.json" && subject
            ? JSON.stringify(subject)
            : undefined;
    const args = {
      record,
      readSubject: (rel) => files[rel],
      backend: tools,
      model: "m",
    };
    assert.deepEqual(
      reconstructSent({ ...args, readBench: bench(then) }),
      reconstructSent({ ...args, readBench: bench(now, sloppy) }),
      c.id,
    );
  }
});

/** A repository holding a bench with one committed results file, and a subject repository with a symlinked document. */
function backfillFixture() {
  const repo = tempDir("sloppy-bench-repo-");
  const git = gitIn(repo);
  const conditions = loadConditions();
  write(repo, "bench/conditions.json", JSON.stringify(conditions));
  write(
    repo,
    "bench/subjects/sloppy.json",
    JSON.stringify({ pointed: ["AI.md"], dump: ["CLAUDE.md", "docs/a.md"] }),
  );
  write(
    repo,
    "bench/tasks/example/example.json",
    JSON.stringify({ id: "example", prompt: "First wording.", tools: "read" }),
  );
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "bench");

  const subject = tempDir("sloppy-bench-subj-");
  write(subject, "AI.md", "# The rules\n");
  write(subject, "docs/a.md", "# A\n");
  fs.symlinkSync("AI.md", path.join(subject, "CLAUDE.md"));
  const sgit = gitIn(subject);
  sgit("init", "-q", "-b", "main");
  sgit("add", "-A");
  sgit("commit", "-q", "-m", "subject");
  const sha = sgit("rev-parse", "HEAD").toString().trim();

  const line = (condition) =>
    JSON.stringify(
      newRecord({
        ...baseRecord,
        backend: { kind: "claude-code", model: "claude-sonnet-5-5" },
        subject: { ...baseRecord.subject, sha },
        condition,
      }),
    );
  write(
    repo,
    "bench/results/claude-code-sonnet-2026-10-29.jsonl",
    `${["bare", "dump", "mcp+pointed"].map(line).join("\n")}\n`,
  );
  write(
    repo,
    "bench/tasks/example/example.json",
    JSON.stringify({ id: "example", prompt: "Second wording.", tools: "read" }),
  );
  write(
    repo,
    "bench/results/superseded/claude-code-sonnet-2026-10-28-v1.jsonl",
    `${line("bare")}\n`,
  );
  git("add", "-A");
  git(
    "commit",
    "-q",
    "-m",
    "record, and fix the wording the superseded batch ran under",
  );
  write(
    repo,
    "bench/results/claude-code-sonnet-2026-10-30.jsonl",
    `${line("bare")}\n`,
  );
  return { repo, subject };
}

const snapshot = (dir) =>
  Object.fromEntries(
    fs
      .readdirSync(dir, { recursive: true })
      .filter((f) => fs.statSync(path.join(dir, f)).isFile())
      .sort()
      .map((f) => [f, fs.readFileSync(path.join(dir, f)).toString("base64")]),
  );

test("the backfill rebuilds every committed record the same way twice, from the commits that made it", async () => {
  const { repo, subject } = backfillFixture();
  const resultsDir = path.join(repo, "bench", "results");
  const opts = { resultsDir, repo, subjectRepo: () => subject };
  const first = await backfillPrompts(opts);
  assert.equal(first.written.length, 4);
  assert.equal(first.skipped.length, 1);
  const once = snapshot(path.join(resultsDir, "prompts"));
  fs.rmSync(path.join(resultsDir, "prompts"), { recursive: true });
  await backfillPrompts(opts);
  assert.deepEqual(snapshot(path.join(resultsDir, "prompts")), once);

  const aside = path.join(resultsDir, "superseded");
  const byFile = (dir) => readRecords(dir).map((r) => readSent(resultsDir, r));
  const [bare, dump, mcpPointed] = byFile(resultsDir).slice(0, 3);
  for (const s of [bare, dump, mcpPointed]) {
    assert.equal(s.reconstructed, true);
    assert.equal(s.prompt, "Second wording.");
    assert.equal(s.model, "sonnet");
  }
  assert.deepEqual(bare.tools, ["Read", "Grep", "Glob"]);
  assert.equal(
    dump.system,
    `${loadConditions().base_system}\n\n# CLAUDE.md\n\n# The rules\n\n\n# docs/a.md\n\n# A\n`,
  );
  assert.equal(
    mcpPointed.system,
    buildPrompt({
      task: { prompt: "" },
      condition: loadConditions().conditions.find(
        (c) => c.id === "mcp+pointed",
      ),
      baseSystem: loadConditions().base_system,
      pointed: ["AI.md"],
      dump: [],
      read: () => undefined,
    }).systemPrompt,
  );
  assert.equal(mcpPointed.mcp, true);
  const [superseded] = byFile(aside);
  assert.equal(superseded.prompt, "First wording.");
  const uncommitted = readRecords(resultsDir).at(-1);
  assert.equal(readSent(resultsDir, uncommitted), undefined);
});

test("a tree reader follows a symlink and refuses a folder", () => {
  const { subject } = backfillFixture();
  const read = gitTree(subject, "HEAD");
  assert.equal(read("CLAUDE.md"), "# The rules\n");
  assert.equal(read("docs"), undefined);
  assert.equal(read("missing.md"), undefined);
});

test("the model a results file was asked for is read from its name", () => {
  assert.equal(
    modelOfFile("x/claude-code-sonnet-2026-10-29.jsonl", "claude-code"),
    "sonnet",
  );
  assert.equal(
    modelOfFile(
      "claude-code-sonnet-2026-10-29-seed1-task-wording-v1.jsonl",
      "claude-code",
    ),
    "sonnet",
  );
  assert.equal(modelOfFile("api-gpt-5.1-2026-11-02.jsonl", "api"), "gpt-5.1");
});

test("a run opens by its id as a timeline of its calls, its answer and its grades", async () => {
  const { file } = await mockBatch({ conditions: ["mcp"] });
  const dir = path.dirname(file);
  const [record] = readRecords(dir);
  const opened = openRun(dir, record, [
    { run_id: record.run_id, grader: "judge", score: 0.5, notes: "half" },
  ]);
  const text = formatRun(opened);
  assert.match(text, new RegExp(record.run_id));
  assert.match(text, /model call 1/);
  assert.match(text, /Task:\n/);
  assert.match(text, /judge: 0\.5, half/);
  assert.match(text, /Transcript: 2 events/);
  assert.deepEqual(
    transcriptCalls([
      {
        ms: 3,
        event: {
          message: { content: [{ type: "tool_use", id: "a", name: "Read" }] },
        },
      },
      {
        ms: 1,
        event: {
          event: { content_block: { type: "tool_use", id: "a", name: "Read" } },
        },
      },
      {
        ms: 7,
        event: {
          response: {
            choices: [
              {
                message: {
                  tool_calls: [
                    { id: "b", type: "function", function: { name: "grep" } },
                  ],
                },
              },
            ],
          },
        },
      },
    ]),
    [
      { ms: 1, name: "Read" },
      { ms: 7, name: "grep" },
    ],
  );
});
