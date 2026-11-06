import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { claudeArgs, mcpConfig } from "../backends/claude-code.mjs";
import codex from "../backends/codex.mjs";
import { gradeObjective } from "../lib/grade.mjs";
import {
  commitMessageOf,
  FALLBACK_COMMIT_MESSAGE,
  HANDOFF_CLOSING,
} from "../lib/handoff.mjs";
import { McpClient } from "../lib/mcp-client.mjs";
import { readTranscript } from "../lib/transcript.mjs";
import {
  readRecords,
  RecordSchema,
  runCost,
  runTokens,
  runWallMs,
} from "../lib/record.mjs";
import { runBatch } from "../lib/runner.mjs";
import { loadPack } from "../lib/task.mjs";
import { runHistory } from "../tools/history.mjs";
import { toolSpecs } from "../tools/local.mjs";
import {
  gitIn,
  makeSubject,
  NO_AGENTS,
  tempDir,
  testSubject,
  write,
} from "./helpers.mjs";

const TASK = {
  id: "t-handoff",
  family: "handoff",
  prompt_a:
    "Lower the retry cap in src/a.js to 3. The reason: the upstream gateway bans a client after its fourth retry in a minute.",
  prompt_b:
    "Somebody wants to raise the retry cap in src/a.js to 10. Should they, and why?",
  reason:
    "The upstream gateway bans a client after its fourth retry in a minute.",
  key: "No: the gateway bans a client after a fourth retry within a minute, so the cap stays at 3.",
  grader: {
    kind: "facts",
    required: [
      {
        pattern: "\\b(ban|block|lock)",
        source: { doc: "prompt_a", quote: "bans a client" },
      },
    ],
  },
  rubric: [
    { criterion: "Says the gateway bans past three retries", points: 1 },
  ],
};

const fixture = (text, extra = {}) =>
  JSON.stringify({
    text,
    tokens: {
      input: 100,
      cache_write: 0,
      cache_read: 50,
      output: 10,
      reasoning: 0,
    },
    cost_reported: 0.1,
    turns: 2,
    ...extra,
  });

function packWith(task, fixtures) {
  const tasksDir = tempDir();
  write(tasksDir, `crafted/${task.id}.json`, JSON.stringify(task));
  const dir = tempDir();
  for (const [name, body] of Object.entries(fixtures)) write(dir, name, body);
  return { tasksDir, fixtures: dir };
}

async function withFixtures(fixtures, fn) {
  const before = process.env.SLOPPY_BENCH_MOCK_FIXTURES;
  process.env.SLOPPY_BENCH_MOCK_FIXTURES = fixtures;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.SLOPPY_BENCH_MOCK_FIXTURES;
    else process.env.SLOPPY_BENCH_MOCK_FIXTURES = before;
  }
}

test("a handoff task loads with stage B as its prompt and stage A closed by the same paragraph every time", () => {
  const { tasksDir } = packWith(TASK, {});
  const [task] = loadPack("crafted", tasksDir);
  assert.equal(task.prompt, TASK.prompt_b);
  assert.equal(task.tools, "history");
  assert.equal(task.stage_a.tools, "edit");
  assert.equal(task.stage_a.prompt, `${TASK.prompt_a}\n\n${HANDOFF_CLOSING}`);
  assert.ok(!task.prompt.includes("gateway"));
});

test("a handoff task without a stage, or with a prompt of its own, is refused", () => {
  for (const broken of [
    { ...TASK, prompt_b: undefined },
    { ...TASK, prompt_a: undefined },
    { ...TASK, family: "why" },
  ]) {
    const { tasksDir } = packWith(broken, {});
    assert.throws(() => loadPack("crafted", tasksDir), /not a valid task/);
  }
});

test("the commit message is what follows the last Commit message line, else the fallback", () => {
  assert.equal(
    commitMessageOf(
      "Done.\n\nCommit message:\nCap retries at 3\n\nThe gateway bans.",
    ),
    "Cap retries at 3\n\nThe gateway bans.",
  );
  assert.equal(
    commitMessageOf("**Commit message:** Cap retries at 3"),
    "Cap retries at 3",
  );
  assert.equal(
    commitMessageOf("Commit message:\n```\nCap retries\n```"),
    "Cap retries",
  );
  assert.equal(commitMessageOf("I changed it."), FALLBACK_COMMIT_MESSAGE);
  assert.equal(commitMessageOf("Commit message:"), FALLBACK_COMMIT_MESSAGE);
});

test("no handoff stage is offered a shell on any backend", async () => {
  for (const tools of ["edit", "history"]) {
    const args = claudeArgs(
      { tools, prompt: "p", cwd: "/x" },
      { systemPrompt: "s", mcpConfig: "m" },
    );
    const offered = args[args.indexOf("--tools") + 1].split(",");
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    const allowed = args[args.indexOf("--allowedTools") + 1].split(",");
    assert.ok(
      !offered.includes("Bash") && !allowed.some((t) => t.startsWith("Bash")),
    );
    assert.ok(denied.includes("Bash"));
    const subagents = claudeArgs(
      { tools, prompt: "p", cwd: "/x", subagents: true },
      { systemPrompt: "s", mcpConfig: "m" },
    );
    assert.ok(
      subagents[subagents.indexOf("--disallowedTools") + 1]
        .split(",")
        .includes("Bash"),
    );
    assert.ok(!toolSpecs(tools).some((t) => t.name === "bash"));
  }
  assert.deepEqual(
    Object.keys(mcpConfig({ tools: "history", cwd: "/x" }).mcpServers),
    ["history"],
  );
  assert.deepEqual(
    Object.keys(mcpConfig({ tools: "edit", cwd: "/x" }).mcpServers),
    [],
  );
  const answer = await codex.run({ tools: "edit", cwd: "/x", prompt: "p" });
  assert.equal(answer.status, "error");
  assert.match(answer.error, /shell/);
});

function historyRepo() {
  const dir = tempDir();
  write(dir, "src/a.js", "export const cap = 5;\n");
  const git = gitIn(dir);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Snapshot");
  write(dir, "src/a.js", "export const cap = 3;\n");
  git(
    "commit",
    "-q",
    "-am",
    "Cap retries at 3\n\nThe gateway bans a client after its fourth retry.",
  );
  return dir;
}

test("the history tools read the log, a commit and a blame, and refuse what is not history", () => {
  const dir = historyRepo();
  const log = runHistory("git_log", { path: "src/a.js" }, dir);
  assert.equal(log.isError, false);
  assert.match(log.text, /gateway bans a client/);
  assert.match(runHistory("git_show", { commit: "HEAD" }, dir).text, /cap = 3/);
  assert.match(
    runHistory("git_blame", { path: "src/a.js" }, dir).text,
    /cap = 3/,
  );
  assert.equal(
    runHistory("git_show", { commit: "--output=/tmp/x" }, dir).isError,
    true,
  );
  assert.equal(runHistory("git_log", { path: "../.." }, dir).isError, true);
  assert.equal(runHistory("bash", {}, dir).isError, true);
});

test("the history MCP server offers the three reads and answers them", async () => {
  const dir = historyRepo();
  const client = await McpClient.start({
    command: process.execPath,
    args: [path.resolve(import.meta.dirname, "../tools/history-mcp.mjs"), dir],
    cwd: dir,
  });
  try {
    const names = (await client.listTools()).map((t) => t.name).sort();
    assert.deepEqual(names, ["git_blame", "git_log", "git_show"]);
    const { text } = await client.callTool("git_log", {});
    assert.match(text, /fourth retry/);
  } finally {
    await client.close();
  }
});

test("a handoff run commits stage A's tree with its message, runs B on it, and records both stages", async () => {
  const { tasksDir, fixtures } = packWith(TASK, {
    "t-handoff.a.json": fixture(
      "Lowered it.\n\nCommit message:\nCap retries at 3 because the gateway bans a fourth",
      {
        writes: {
          "src/a.js":
            "// The gateway bans a client after its fourth retry in a minute.\nexport const cap = 3;\n",
        },
        calls: [
          {
            name: "Read",
            input: { file_path: "src/a.js" },
            result: "1\texport const a = 1;",
          },
        ],
      },
    ),
    "t-handoff.json": fixture("No: the gateway would ban us.", {
      calls: [
        { name: "Read", input: { file_path: "src/a.js" }, result: "..." },
        { name: "Read", input: { file_path: "README.md" }, result: "..." },
        { name: "mcp__history__git_log", input: {}, result: "..." },
      ],
    }),
  });
  const outDir = tempDir();
  const seen = [];
  const { records } = await withFixtures(fixtures, () =>
    runBatch({
      backend: "mock",
      subject: makeSubject(),
      subjectConfig: testSubject(),
      pack: "crafted",
      tasksDir,
      conditions: ["bare"],
      seed: 1,
      budgetUsd: 10,
      outDir,
      workRoot: tempDir(),
      agents: NO_AGENTS,
      log: () => {},
      objective: (run) => {
        seen.push({
          log: execFileSync("git", ["log", "--format=%B"], {
            cwd: run.dir,
          }).toString(),
          file: execFileSync("git", ["show", "HEAD:src/a.js"], {
            cwd: run.dir,
          }).toString(),
        });
        return gradeObjective(run);
      },
    }),
  );
  assert.equal(records.length, 1);
  const r = RecordSchema.parse(readRecords(outDir)[0]);
  assert.equal(r.status, "ok");
  assert.equal(r.task.family, "handoff");
  assert.equal(r.output.text, "No: the gateway would ban us.");
  assert.equal(r.sent.prompt, TASK.prompt_b);
  assert.equal(r.stage_a.sent.prompt, `${TASK.prompt_a}\n\n${HANDOFF_CLOSING}`);
  assert.equal(
    r.stage_a.commit_message,
    "Cap retries at 3 because the gateway bans a fourth",
  );
  assert.deepEqual(r.stage_a.output.files_changed, ["src/a.js"]);
  assert.deepEqual(r.output.files_changed, []);
  assert.match(
    seen[0].log,
    /^Cap retries at 3 because the gateway bans a fourth/,
  );
  assert.match(seen[0].file, /fourth retry/);
  assert.equal(r.grade.objective, 1);
  assert.ok(Math.abs(runCost(r) - 0.2) < 1e-9);
  assert.equal(runTokens(r, ["input"]), 200);
  assert.equal(runWallMs(r), r.timing.wall_ms + r.stage_a.timing.wall_ms);
  assert.deepEqual(r.findability, { files: 3, notes: 0, opened: 3 });
  assert.deepEqual(r.stage_a.findability, { files: 1, notes: 0, opened: 1 });
  assert.ok(readTranscript(outDir, r.run_id));
  assert.ok(readTranscript(outDir, `${r.run_id}.a`));
});

test("a stage A that fails never starts B, scores nothing, and still counts what it spent", async () => {
  const { tasksDir, fixtures } = packWith(TASK, {
    "t-handoff.a.json": fixture("", { status: "error", error: "it broke" }),
    "t-handoff.json": fixture("never asked"),
  });
  const outDir = tempDir();
  const { records } = await withFixtures(fixtures, () =>
    runBatch({
      backend: "mock",
      subject: makeSubject(),
      subjectConfig: testSubject(),
      pack: "crafted",
      tasksDir,
      conditions: ["bare"],
      seed: 1,
      budgetUsd: 10,
      outDir,
      workRoot: tempDir(),
      agents: NO_AGENTS,
      log: () => {},
      objective: gradeObjective,
    }),
  );
  const r = records[0];
  assert.equal(r.status, "error");
  assert.equal(r.sent, undefined);
  assert.equal(r.output.text, "");
  assert.equal(r.grade, undefined);
  assert.equal(r.stage_a.status, "error");
  assert.match(r.error, /Stage A/);
  assert.equal(runCost(r), 0.1);
});
