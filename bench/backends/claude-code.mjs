// Claude Code in print mode; README.md § "Backends" says what it reports and what it cannot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BENCH_DIR } from "../lib/config.mjs";
import {
  porcelain,
  porcelainChanged,
  runLines,
  versionOf,
} from "../lib/proc.mjs";

const TOOL_SETS = {
  none: [],
  read: ["Read", "Grep", "Glob"],
  write: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
  edit: ["Read", "Grep", "Glob", "Edit", "Write"],
  history: ["Read", "Grep", "Glob"],
};

/** The `history` set's git reads, which Claude Code takes only as an MCP server. */
export const HISTORY_SERVER = "history";
const HISTORY_SCRIPT = path.join(BENCH_DIR, "tools", "history-mcp.mjs");
const offersHistory = (request) => request.tools === "history";

/** Every built-in tool a run could reach; whatever its set leaves out is denied by name. */
const BUILT_IN = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
];

/** Claude Code 2.1.311 offers its subagent tool as `Task` and names each call to it `Agent`. */
const SUBAGENT_TOOL = "Task";
const SUBAGENT_NAMES = ["Task", "Agent"];

export const MCP_SERVER = "sloppy";
const MCP_PREFIX = `mcp__${MCP_SERVER}__`;

/** The built-in tools a run is offered: its set, and the subagent tool where the condition allows it. */
export function offeredTools(request) {
  const base = TOOL_SETS[request.tools];
  if (!base) throw new Error(`There is no tool set called "${request.tools}".`);
  return request.subagents ? [...base, SUBAGENT_TOOL] : base;
}

/** What the record's `sent.tools` names: the built-in tools, and the history server where offered. */
export const sentToolNames = (request) => [
  ...offeredTools(request),
  ...(offersHistory(request) ? [`mcp__${HISTORY_SERVER}`] : []),
];

/** The arguments `claude` runs with; `files` are the temporary prompt and MCP config paths. */
export function claudeArgs(request, files) {
  const set = offeredTools(request);
  const denied = BUILT_IN.filter(
    (t) =>
      !set.includes(t) && !(request.subagents && SUBAGENT_NAMES.includes(t)),
  );
  const allowed = [
    ...set,
    ...(request.mcp ? [`mcp__${MCP_SERVER}`] : []),
    ...(offersHistory(request) ? [`mcp__${HISTORY_SERVER}`] : []),
  ];
  const args = [
    "-p",
    request.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--append-system-prompt-file",
    files.systemPrompt,
    "--tools",
    set.join(","),
    "--disallowedTools",
    denied.join(","),
    "--mcp-config",
    files.mcpConfig,
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--setting-sources",
    "project,local",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
  if (allowed.length) args.push("--allowedTools", allowed.join(","));
  if (request.model) args.push("--model", request.model);
  if (request.budgetUsd > 0)
    args.push("--max-budget-usd", String(request.budgetUsd));
  return args;
}

export function mcpConfig(request) {
  const servers = {};
  if (request.mcp)
    servers[MCP_SERVER] = {
      type: "stdio",
      command: request.mcp.command,
      args: request.mcp.args,
    };
  if (offersHistory(request))
    servers[HISTORY_SERVER] = {
      type: "stdio",
      command: process.execPath,
      args: [HISTORY_SCRIPT, request.cwd],
    };
  return { mcpServers: servers };
}

const bump = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * The answer read from Claude Code's stream: `events` are `{ ms, event }` in arrival order, `ms`
 * counted from the spawn.
 */
const iterationOf = (ms, usage = {}) => ({
  at_ms: Math.round(ms),
  input: usage.input_tokens ?? 0,
  cache_write: usage.cache_creation_input_tokens ?? 0,
  cache_read: usage.cache_read_input_tokens ?? 0,
  output: usage.output_tokens ?? 0,
});

/**
 * The run's tokens. `modelUsage` is the whole session's, subagents included; a result's `usage`
 * covers only its own stretch of the agent's own calls, and a run whose subagent finished in the
 * background ends in two results.
 */
function tokensOf(results) {
  const perModel = Object.values(results.at(-1)?.modelUsage ?? {}).filter(
    (m) => typeof m.inputTokens === "number",
  );
  const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) ?? 0), 0);
  if (perModel.length) {
    const thinking = sum(perModel, (m) => m.thinkingTokens);
    return {
      input: sum(perModel, (m) => m.inputTokens),
      cache_write: sum(perModel, (m) => m.cacheCreationInputTokens),
      cache_read: sum(perModel, (m) => m.cacheReadInputTokens),
      output: Math.max(0, sum(perModel, (m) => m.outputTokens) - thinking),
      reasoning: thinking,
    };
  }
  const usages = results.map((r) => r.usage ?? {});
  const thinking = sum(usages, (u) => u.output_tokens_details?.thinking_tokens);
  return {
    input: sum(usages, (u) => u.input_tokens),
    cache_write: sum(usages, (u) => u.cache_creation_input_tokens),
    cache_read: sum(usages, (u) => u.cache_read_input_tokens),
    output: Math.max(0, sum(usages, (u) => u.output_tokens) - thinking),
    reasoning: thinking,
  };
}

export function parseStream(events) {
  const toolCalls = {};
  const mcpCalls = {};
  const subagentCalls = {};
  const iterations = [];
  const seenMessages = new Set();
  const results = [];
  let init;
  let streaming;
  let firstToolMs;
  let answerMs;
  let lastText = "";
  for (const { ms, event } of events) {
    if (event.type === "system" && event.subtype === "init") init ??= event;
    if (event.type === "result") results.push(event);
    if (event.type === "stream_event" && !event.parent_tool_use_id) {
      const e = event.event ?? {};
      if (e.type === "message_start") {
        streaming = iterationOf(ms, e.message?.usage);
        iterations.push(streaming);
        seenMessages.add(e.message?.id);
      } else if (e.type === "message_delta" && streaming)
        streaming.output = e.usage?.output_tokens ?? streaming.output;
      continue;
    }
    if (event.type !== "assistant") continue;
    if (event.parent_tool_use_id) {
      for (const block of event.message?.content ?? [])
        if (block.type === "tool_use") bump(subagentCalls, block.name);
      continue;
    }
    const id = event.message?.id;
    if (id && !seenMessages.has(id)) {
      seenMessages.add(id);
      iterations.push(iterationOf(ms, event.message.usage));
    }
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use") {
        firstToolMs ??= ms;
        if (block.name.startsWith(MCP_PREFIX))
          bump(mcpCalls, block.name.slice(MCP_PREFIX.length));
        else bump(toolCalls, block.name);
      }
      if (block.type === "text" && block.text.trim()) {
        answerMs = ms;
        lastText = block.text;
      }
    }
  }

  const result = results.at(-1);
  const tokens = tokensOf(results);
  const models = Object.keys(result?.modelUsage ?? {});
  const longCacheWrites = Object.values(result?.modelUsage ?? {}).reduce(
    (sum, m) => sum + (m.cacheCreationEphemeral1hInputTokens ?? 0),
    0,
  );
  const unpriced =
    models.length > 1
      ? `Claude Code answered with more than one model (${models.join(", ")}), so one model's list price does not cover the run.`
      : longCacheWrites > 0
        ? "Claude Code wrote the prompt cache at the one-hour rate, which prices.json does not hold; the reported cost is the run's cost."
        : undefined;

  const statusOf = (name) =>
    init?.mcp_servers?.find((s) => s.name === name)?.status;
  const status = !result ? "error" : result.is_error ? "error" : "ok";
  return {
    text: result?.result ?? lastText,
    status,
    timing: {
      api_ms: result?.duration_api_ms,
      first_token_ms: results[0]?.ttft_ms,
      first_tool_ms: firstToolMs,
      answer_ms: answerMs,
    },
    tokens: result ? tokens : undefined,
    tokensUnknown: [],
    unpriced,
    costReported: result?.total_cost_usd,
    turns: results.reduce((n, r) => n + (r.num_turns ?? 0), 0),
    toolCalls,
    mcpCalls,
    subagentCalls,
    subagentsSpawned: Math.max(
      0,
      ...results.map((r) => r.subagent_stats?.spawned ?? 0),
    ),
    iterations,
    model: init?.model,
    version: init?.claude_code_version,
    mcpStatus: statusOf(MCP_SERVER),
    historyStatus: statusOf(HISTORY_SERVER),
    error:
      status === "ok"
        ? undefined
        : result
          ? `Claude Code stopped with ${result.subtype}${result.result ? `: ${String(result.result).slice(0, 300)}` : ""}.`
          : undefined,
  };
}

export default {
  tools: sentToolNames,
  async run(request) {
    const agent = request.agent ?? { command: "claude", args: [] };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sloppy-bench-cc-"));
    try {
      const files = {
        systemPrompt: path.join(tmp, "system.md"),
        mcpConfig: path.join(tmp, "mcp.json"),
      };
      fs.writeFileSync(files.systemPrompt, request.systemPrompt);
      fs.writeFileSync(files.mcpConfig, JSON.stringify(mcpConfig(request)));
      const before = porcelain(request.cwd);
      const events = [];
      const proc = await runLines({
        command: agent.command,
        args: [...(agent.args ?? []), ...claudeArgs(request, files)],
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        onLine: (line, ms) => {
          try {
            events.push({ ms, event: JSON.parse(line) });
          } catch {}
        },
      });
      if (proc.missing)
        return refusal(
          `Claude Code is not installed where bench/agents.json says (${agent.command}).`,
        );
      const answer = parseStream(events);
      answer.events = events;
      answer.filesChanged = porcelainChanged(before, porcelain(request.cwd));
      answer.version ??= versionOf(agent.command);
      if (request.mcp && answer.mcpStatus !== "connected") {
        answer.status = "error";
        answer.error = `The sloppy server did not start for Claude Code (${answer.mcpStatus ?? "not listed"}).`;
      }
      if (offersHistory(request) && answer.historyStatus !== "connected") {
        answer.status = "error";
        answer.error = `The history server did not start for Claude Code (${answer.historyStatus ?? "not listed"}).`;
      }
      if (proc.timedOut) {
        answer.status = "timeout";
        answer.error = `Claude Code had not finished after ${Math.round(request.timeoutMs / 1000)} seconds.`;
      } else if (answer.status === "error" && !answer.error)
        answer.error = `Claude Code exited with ${proc.code ?? proc.signal}: ${proc.stderr.trim().slice(-500) || "no output"}.`;
      delete answer.mcpStatus;
      delete answer.historyStatus;
      return answer;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};

function refusal(error) {
  return {
    text: "",
    status: "error",
    timing: {},
    turns: 0,
    toolCalls: {},
    mcpCalls: {},
    filesChanged: [],
    error,
  };
}
