// Codex in its headless mode, `codex exec --json`; README.md § "Backends". Built from Codex's
// documentation and tested against a recorded stream only.
import {
  porcelain,
  porcelainChanged,
  runLines,
  versionOf,
} from "../lib/proc.mjs";

export const MCP_SERVER = "sloppy";

const SANDBOX = {
  none: "read-only",
  read: "read-only",
  write: "workspace-write",
};

/** A TOML value for a `-c key=value` override. */
const toml = (value) => JSON.stringify(value);

export function codexArgs(request) {
  const sandbox = SANDBOX[request.tools];
  if (!sandbox)
    throw new Error(`There is no tool set called "${request.tools}".`);
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    sandbox,
    "-c",
    'approval_policy="never"',
    "-c",
    "tools.web_search=false",
    "-C",
    request.cwd,
  ];
  if (request.systemPrompt)
    args.push("-c", `developer_instructions=${toml(request.systemPrompt)}`);
  if (request.model) args.push("--model", request.model);
  if (request.mcp)
    args.push(
      "-c",
      `mcp_servers.${MCP_SERVER}.command=${toml(request.mcp.command)}`,
      "-c",
      `mcp_servers.${MCP_SERVER}.args=${toml(request.mcp.args)}`,
      "-c",
      `mcp_servers.${MCP_SERVER}.cwd=${toml(request.cwd)}`,
    );
  args.push(request.prompt);
  return args;
}

const bump = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Tool names for Codex's item types; an MCP call is counted by its server and tool instead. */
const ITEM_TOOLS = {
  command_execution: "shell",
  file_change: "apply_patch",
  web_search: "web_search",
};

/** The answer read from `codex exec --json` events, `{ ms, event }` in arrival order. */
export function parseEvents(events) {
  const toolCalls = {};
  const mcpCalls = {};
  const tokens = {
    input: 0,
    cache_write: 0,
    cache_read: 0,
    output: 0,
    reasoning: 0,
  };
  let sawUsage = false;
  let turns = 0;
  let firstToolMs;
  let answerMs;
  let text = "";
  let failure;
  const counted = new Set();
  for (const { ms, event } of events) {
    if (event.type === "turn.completed") {
      turns++;
      const u = event.usage ?? {};
      if (event.usage) sawUsage = true;
      const cached = u.cached_input_tokens ?? 0;
      const reasoning = u.reasoning_output_tokens ?? 0;
      tokens.input += Math.max(0, (u.input_tokens ?? 0) - cached);
      tokens.cache_read += cached;
      tokens.output += Math.max(0, (u.output_tokens ?? 0) - reasoning);
      tokens.reasoning += reasoning;
    }
    if (event.type === "turn.failed")
      failure = event.error?.message ?? "Codex reported the turn failed.";
    if (event.type === "error")
      failure = event.message ?? "Codex reported an error.";
    if (event.type !== "item.started" && event.type !== "item.completed")
      continue;
    const item = event.item ?? {};
    if (item.id === undefined || !counted.has(item.id)) {
      if (item.type === "mcp_tool_call") {
        firstToolMs ??= ms;
        if (item.server === MCP_SERVER) bump(mcpCalls, item.tool);
        else bump(toolCalls, `mcp:${item.server}.${item.tool}`);
      } else if (ITEM_TOOLS[item.type]) {
        firstToolMs ??= ms;
        bump(toolCalls, ITEM_TOOLS[item.type]);
      }
      if (item.id !== undefined) counted.add(item.id);
    }
    if (event.type === "item.completed" && item.type === "agent_message") {
      text = item.text ?? "";
      answerMs = ms;
    }
  }
  return {
    text,
    status: failure ? "error" : "ok",
    timing: { first_tool_ms: firstToolMs, answer_ms: answerMs },
    tokens: sawUsage ? tokens : undefined,
    tokensUnknown: sawUsage ? [] : undefined,
    turns,
    toolCalls,
    mcpCalls,
    error: failure,
  };
}

export default {
  async run(request) {
    if (!SANDBOX[request.tools])
      return {
        text: "",
        status: "error",
        timing: {},
        turns: 0,
        toolCalls: {},
        mcpCalls: {},
        filesChanged: [],
        error: `Codex cannot be offered the ${request.tools} tool set: it edits files and reads history only through its shell, which a handoff stage may not have.`,
      };
    const agent = request.agent ?? { command: "codex", args: [] };
    const before = porcelain(request.cwd);
    const events = [];
    const proc = await runLines({
      command: agent.command,
      args: [...(agent.args ?? []), ...codexArgs(request)],
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      onLine: (line, ms) => {
        try {
          events.push({ ms, event: JSON.parse(line) });
        } catch {}
      },
    });
    if (proc.missing)
      return {
        text: "",
        status: "error",
        timing: {},
        turns: 0,
        toolCalls: {},
        mcpCalls: {},
        filesChanged: [],
        error: `Codex is not installed where bench/agents.json says (${agent.command}). Install it, or point "command" there at it.`,
      };
    const answer = parseEvents(events);
    answer.events = events;
    if (request.subagents) answer.unsupported = ["subagents"];
    answer.filesChanged = porcelainChanged(before, porcelain(request.cwd));
    answer.version = versionOf(agent.command);
    if (proc.timedOut) {
      answer.status = "timeout";
      answer.error = `Codex had not finished after ${Math.round(request.timeoutMs / 1000)} seconds.`;
    } else if (proc.code !== 0 && answer.status === "ok") {
      answer.status = "error";
      answer.error = `Codex exited with ${proc.code ?? proc.signal}: ${proc.stderr.trim().slice(-500) || "no output"}.`;
    }
    return answer;
  },
};
