import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import claudeCode, {
  claudeArgs,
  mcpConfig,
  parseStream,
} from "../backends/claude-code.mjs";
import codex, { codexArgs, parseEvents } from "../backends/codex.mjs";
import { tempDir } from "./helpers.mjs";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const FAKE = path.join(FIXTURES, "fake-agent.mjs");
const fakeAgent = { command: process.execPath, args: [FAKE] };

const readStream = (file) =>
  fs
    .readFileSync(path.join(FIXTURES, file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => ({ ms: (i + 1) * 100, event: JSON.parse(line) }));

function repo() {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  const git = (...args) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  return dir;
}

const request = (over = {}) => ({
  cwd: repo(),
  systemPrompt: "base\n\nline",
  prompt: "What is it?",
  tools: "read",
  timeoutMs: 20_000,
  budgetUsd: 2,
  taskId: "t",
  ...over,
});

const ENV_KEYS = [
  "FAKE_AGENT_LOG",
  "FAKE_AGENT_STREAM",
  "FAKE_AGENT_TOUCH",
  "FAKE_AGENT_SLEEP_MS",
];
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

test("claude-code offers only the task's tools and no MCP server the machine has configured", () => {
  const files = { systemPrompt: "/tmp/s.md", mcpConfig: "/tmp/m.json" };
  const read = claudeArgs(request({ model: "haiku" }), files);
  const at = (args, flag) => args[args.indexOf(flag) + 1];
  assert.equal(at(read, "--tools"), "Read,Grep,Glob");
  assert.equal(at(read, "--allowedTools"), "Read,Grep,Glob");
  for (const t of [
    "Task",
    "WebFetch",
    "WebSearch",
    "NotebookEdit",
    "Edit",
    "Write",
    "Bash",
  ])
    assert.ok(at(read, "--disallowedTools").split(",").includes(t), t);
  assert.ok(read.includes("--strict-mcp-config"));
  assert.equal(at(read, "--mcp-config"), "/tmp/m.json");
  assert.equal(at(read, "--append-system-prompt-file"), "/tmp/s.md");
  assert.equal(at(read, "--model"), "haiku");
  assert.deepEqual(mcpConfig(request()), { mcpServers: {} });

  const write = claudeArgs(request({ tools: "write" }), files);
  assert.equal(at(write, "--tools"), "Read,Grep,Glob,Edit,Write,Bash");
  assert.ok(!write.includes("--model"));

  const none = claudeArgs(request({ tools: "none" }), files);
  assert.equal(at(none, "--tools"), "");
  assert.ok(!none.includes("--allowedTools"));

  const mcp = request({
    mcp: { command: "node", args: ["/s/sloppy.mjs", "mcp"] },
  });
  assert.equal(
    at(claudeArgs(mcp, files), "--allowedTools"),
    "Read,Grep,Glob,mcp__sloppy",
  );
  assert.deepEqual(mcpConfig(mcp).mcpServers.sloppy, {
    type: "stdio",
    command: "node",
    args: ["/s/sloppy.mjs", "mcp"],
  });
});

test("claude-code offers its subagent tool only where the condition does, and keeps every other denial", () => {
  const files = { systemPrompt: "/tmp/s.md", mcpConfig: "/tmp/m.json" };
  const at = (args, flag) => args[args.indexOf(flag) + 1];
  const without = claudeArgs(request(), files);
  const withAgents = claudeArgs(request({ subagents: true }), files);
  assert.ok(!at(without, "--tools").split(",").includes("Task"));
  assert.ok(!at(without, "--allowedTools").split(",").includes("Task"));
  for (const t of ["Task", "Agent"])
    assert.ok(at(without, "--disallowedTools").split(",").includes(t), t);
  assert.equal(at(withAgents, "--tools"), "Read,Grep,Glob,Task");
  assert.equal(at(withAgents, "--allowedTools"), "Read,Grep,Glob,Task");
  const denied = at(withAgents, "--disallowedTools").split(",");
  assert.ok(!denied.includes("Task") && !denied.includes("Agent"));
  assert.deepEqual(
    denied,
    at(without, "--disallowedTools")
      .split(",")
      .filter((t) => t !== "Task" && t !== "Agent"),
  );
  const mcp = { command: "node", args: ["/s/sloppy.mjs", "mcp"] };
  assert.equal(
    at(claudeArgs(request({ subagents: true, mcp }), files), "--allowedTools"),
    "Read,Grep,Glob,Task,mcp__sloppy",
  );
  assert.ok(without.includes("--include-partial-messages"));
});

test("a run whose subagent finished in the background is read whole: every call, both results, the subagent's tokens", () => {
  const a = parseStream(readStream("claude-code-subagent-stream.jsonl"));
  assert.equal(a.status, "ok");
  assert.match(a.text, /^The subagent found 2/);
  assert.equal(a.subagentsSpawned, 1);
  assert.deepEqual(a.toolCalls, { Agent: 1 });
  assert.deepEqual(a.subagentCalls, { Glob: 2, Read: 2 });
  assert.equal(a.turns, 3);
  assert.deepEqual(a.tokens, {
    input: 14,
    cache_write: 5151,
    cache_read: 43368,
    output: 1228,
    reasoning: 397,
  });
  assert.equal(a.costReported, 0.00210888);
  assert.deepEqual(
    a.iterations.map(({ at_ms: _, ...it }) => it),
    [
      { input: 2, cache_write: 1220, cache_read: 7385, output: 478 },
      { input: 2, cache_write: 880, cache_read: 8605, output: 48 },
      { input: 4, cache_write: 799, cache_read: 9485, output: 241 },
    ],
  );
  assert.ok(
    a.iterations.every((it, i, all) => i === 0 || it.at_ms > all[i - 1].at_ms),
  );
});

test("claude-code's stream is read into tokens, cost, timings and calls, sloppy calls counted apart", () => {
  const a = parseStream(readStream("claude-code-stream.jsonl"));
  assert.equal(a.status, "ok");
  assert.match(a.text, /An address is optional/);
  assert.deepEqual(a.mcpCalls, { search_notes: 1 });
  assert.deepEqual(a.toolCalls, {});
  assert.deepEqual(a.tokens, {
    input: 4,
    cache_write: 28892,
    cache_read: 27467,
    output: 93,
    reasoning: 0,
  });
  assert.equal(a.costReported, 0.00609997);
  assert.equal(a.turns, 2);
  assert.equal(a.model, "claude-haiku-5-5");
  assert.equal(a.version, "2.1.311");
  assert.equal(a.timing.first_tool_ms, 200);
  assert.equal(a.timing.answer_ms, 400);
  assert.equal(a.timing.api_ms, 4250);
  assert.match(a.unpriced, /one-hour/);
  assert.equal(a.subagentsSpawned, 0);
  assert.deepEqual(a.iterations, [
    { at_ms: 200, input: 2, cache_write: 27467, cache_read: 0, output: 32 },
    { at_ms: 400, input: 2, cache_write: 1425, cache_read: 27467, output: 2 },
  ]);
});

test("claude-code splits thinking out of output, ignores a subagent's calls, and reads a failed run", () => {
  const events = [
    {
      ms: 1,
      event: { type: "system", subtype: "init", model: "m", mcp_servers: [] },
    },
    {
      ms: 2,
      event: {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_use", name: "Read" },
            { type: "tool_use", name: "Read" },
          ],
        },
      },
    },
    {
      ms: 3,
      event: {
        type: "assistant",
        parent_tool_use_id: "x",
        message: { content: [{ type: "tool_use", name: "Grep" }] },
      },
    },
    {
      ms: 4,
      event: {
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: 3,
        total_cost_usd: 0.1,
        usage: {
          input_tokens: 10,
          output_tokens: 50,
          output_tokens_details: { thinking_tokens: 20 },
        },
        modelUsage: { m: {} },
      },
    },
  ];
  const a = parseStream(events);
  assert.equal(a.status, "error");
  assert.match(a.error, /error_max_turns/);
  assert.deepEqual(a.toolCalls, { Read: 2 });
  assert.equal(a.tokens.output, 30);
  assert.equal(a.tokens.reasoning, 20);
  assert.equal(a.unpriced, undefined);
  assert.equal(parseStream([]).status, "error");
});

test("claude-code runs the configured program in the variant and reports the files it changed", async () => {
  const log = path.join(tempDir(), "log.json");
  process.env.FAKE_AGENT_LOG = log;
  process.env.FAKE_AGENT_STREAM = path.join(
    FIXTURES,
    "claude-code-stream.jsonl",
  );
  process.env.FAKE_AGENT_TOUCH = "new.txt";
  const req = request({
    agent: fakeAgent,
    mcp: { command: "node", args: ["x", "mcp"] },
  });
  const a = await claudeCode.run(req);
  assert.equal(a.status, "ok");
  assert.deepEqual(a.filesChanged, ["new.txt"]);
  assert.deepEqual(a.mcpCalls, { search_notes: 1 });
  const started = JSON.parse(fs.readFileSync(log, "utf8"));
  assert.equal(fs.realpathSync(started.cwd), fs.realpathSync(req.cwd));
  assert.equal(started.argv[started.argv.indexOf("-p") + 1], "What is it?");
});

test("claude-code answers an error where the sloppy server did not connect", async () => {
  const stream = path.join(tempDir(), "s.jsonl");
  const lines = fs
    .readFileSync(path.join(FIXTURES, "claude-code-stream.jsonl"), "utf8")
    .replace('"status": "connected"', '"status": "failed"');
  fs.writeFileSync(stream, lines);
  process.env.FAKE_AGENT_STREAM = stream;
  const a = await claudeCode.run(
    request({ agent: fakeAgent, mcp: { command: "node", args: ["x"] } }),
  );
  assert.equal(a.status, "error");
  assert.match(a.error, /sloppy server did not start/);
});

test("claude-code stops an agent at its timeout and answers timeout", async () => {
  process.env.FAKE_AGENT_SLEEP_MS = "5000";
  const started = Date.now();
  const a = await claudeCode.run(request({ agent: fakeAgent, timeoutMs: 500 }));
  assert.equal(a.status, "timeout");
  assert.ok(Date.now() - started < 4000);
});

test("an installed agent that is not there is refused in words", async () => {
  const missing = { command: "/nonexistent/claude", args: [] };
  const a = await claudeCode.run(request({ agent: missing }));
  assert.equal(a.status, "error");
  assert.match(a.error, /not installed/);
  const c = await codex.run(
    request({ agent: { command: "/nonexistent/codex", args: [] } }),
  );
  assert.equal(c.status, "error");
  assert.match(c.error, /Codex is not installed/);
});

test("codex is started headless with the sloppy server passed as config overrides", () => {
  const req = request({
    model: "gpt-5",
    mcp: { command: "/usr/bin/node", args: ["/s/sloppy.mjs", "mcp"] },
  });
  const args = codexArgs(req);
  assert.deepEqual(args.slice(0, 2), ["exec", "--json"]);
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("--model") + 1], "gpt-5");
  assert.ok(args.includes('mcp_servers.sloppy.command="/usr/bin/node"'));
  assert.ok(args.includes('mcp_servers.sloppy.args=["/s/sloppy.mjs","mcp"]'));
  assert.ok(args.includes('developer_instructions="base\\n\\nline"'));
  assert.equal(args.at(-1), "What is it?");
  assert.ok(!codexArgs(request()).some((a) => a.startsWith("mcp_servers")));
  assert.equal(
    codexArgs(request({ tools: "write" }))[
      codexArgs(request({ tools: "write" })).indexOf("--sandbox") + 1
    ],
    "workspace-write",
  );
});

test("codex's events are read into tokens, calls and the final message", async () => {
  const a = parseEvents(readStream("codex-stream.jsonl"));
  assert.equal(a.status, "ok");
  assert.equal(a.text, "NoteWriter.move in packages/ts/local/src/notes.ts.");
  assert.deepEqual(a.mcpCalls, { search_notes: 1 });
  assert.deepEqual(a.toolCalls, { shell: 2 });
  assert.deepEqual(a.tokens, {
    input: 315,
    cache_write: 0,
    cache_read: 24448,
    output: 122,
    reasoning: 0,
  });
  assert.equal(a.turns, 1);
  assert.equal(a.timing.first_tool_ms, 400);
  assert.equal(a.timing.answer_ms, 900);

  const failed = parseEvents([
    {
      ms: 1,
      event: { type: "turn.failed", error: { message: "stream disconnected" } },
    },
  ]);
  assert.equal(failed.status, "error");
  assert.equal(failed.tokens, undefined);

  process.env.FAKE_AGENT_STREAM = path.join(FIXTURES, "codex-stream.jsonl");
  const run = await codex.run(request({ agent: fakeAgent }));
  assert.equal(run.status, "ok");
  assert.deepEqual(run.mcpCalls, { search_notes: 1 });
});
