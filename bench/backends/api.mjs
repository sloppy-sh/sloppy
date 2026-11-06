// A minimal tool-using agent against a provider in providers.json; README.md § "Backends".
import { McpClient } from "../lib/mcp-client.mjs";
import { porcelain, porcelainChanged } from "../lib/proc.mjs";
import { runTool, toolSpecs } from "../tools/local.mjs";

export const MAX_TURNS = 40;
const MAX_OUTPUT_TOKENS = 8192;
const MCP_PREFIX = "mcp__sloppy__";

const DEFAULT_BASE = {
  anthropic: "https://api.anthropic.com",
};

const bump = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Reads the key at call time; a missing one is refused by the variable's name and never echoed. */
export function keyFor(provider, env = process.env) {
  const key = env[provider.key_env];
  if (!key)
    throw new Error(
      `Set ${provider.key_env} in the environment to run ${provider.id}.`,
    );
  return key;
}

async function post(url, headers, body, signal, exchange) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    exchange?.(body, { status: res.status, text });
    throw new Error(
      `The provider answered ${res.status}: ${text.slice(0, 400)}`,
    );
  }
  const reply = JSON.parse(text);
  exchange?.(body, reply);
  return reply;
}

/** One provider kind's dialect: how a turn is asked, read, and continued with tool results. */
const DIALECTS = {
  anthropic: {
    start({ systemPrompt, prompt }) {
      return {
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      };
    },
    async ask({ provider, model, key, state, tools, signal, exchange }) {
      const base = (provider.base_url ?? DEFAULT_BASE.anthropic).replace(
        /\/+$/,
        "",
      );
      const body = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: state.messages,
      };
      if (state.system)
        body.system = [
          {
            type: "text",
            text: state.system,
            cache_control: { type: "ephemeral" },
          },
        ];
      if (tools.length)
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      const res = await post(
        `${base}/v1/messages`,
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        body,
        signal,
        exchange,
      );
      state.messages.push({ role: "assistant", content: res.content });
      const u = res.usage ?? {};
      return {
        text: res.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
        calls: res.content
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: b.input })),
        usage: {
          input: u.input_tokens ?? 0,
          cache_write: u.cache_creation_input_tokens ?? 0,
          cache_read: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          reasoning: 0,
        },
      };
    },
    answer(state, results) {
      state.messages.push({
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.text,
          is_error: r.isError,
        })),
      });
    },
  },
  "openai-compatible": {
    start({ systemPrompt, prompt }) {
      const messages = [];
      if (systemPrompt)
        messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
      return { messages };
    },
    async ask({ provider, model, key, state, tools, signal, exchange }) {
      const base = provider.base_url.replace(/\/+$/, "");
      const body = { model, messages: state.messages };
      if (tools.length)
        body.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }));
      const res = await post(
        `${base}/chat/completions`,
        { authorization: `Bearer ${key}` },
        body,
        signal,
        exchange,
      );
      const message = res.choices?.[0]?.message ?? {
        role: "assistant",
        content: "",
      };
      state.messages.push(message);
      const u = res.usage ?? {};
      const cached =
        u.prompt_tokens_details?.cached_tokens ??
        u.prompt_cache_hit_tokens ??
        0;
      const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
      return {
        text: typeof message.content === "string" ? message.content : "",
        calls: (message.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          input: parseArgs(c.function.arguments),
        })),
        usage: {
          input: Math.max(0, (u.prompt_tokens ?? 0) - cached),
          cache_write: 0,
          cache_read: cached,
          output: Math.max(0, (u.completion_tokens ?? 0) - reasoning),
          reasoning,
        },
      };
    },
    answer(state, results) {
      for (const r of results)
        state.messages.push({
          role: "tool",
          tool_call_id: r.id,
          content: r.text,
        });
    },
  },
};

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return { __unparsed: String(raw) };
  }
}

/** The sloppy server's tools under the names a model sees, and how to call each. */
async function bridgeMcp(request) {
  if (!request.mcp) return { tools: [], close: async () => {} };
  const client = await McpClient.start({ ...request.mcp, cwd: request.cwd });
  const listed = await client.listTools();
  return {
    tools: listed.map((t) => ({
      name: `${MCP_PREFIX}${t.name}`,
      description: t.description ?? t.name,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    })),
    call: (act, input) => client.callTool(act, input),
    close: () => client.close(),
  };
}

export async function runAgent(request) {
  const provider = request.provider;
  if (!provider)
    throw new Error("The api backend needs a provider from providers.json.");
  const dialect = DIALECTS[provider.kind];
  if (!dialect)
    throw new Error(`There is no provider kind called "${provider.kind}".`);
  const key = keyFor(provider);
  const model = request.model ?? provider.models[0];

  const started = performance.now();
  const since = () => Math.round(performance.now() - started);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const before = porcelain(request.cwd);
  const tokens = {
    input: 0,
    cache_write: 0,
    cache_read: 0,
    output: 0,
    reasoning: 0,
  };
  const toolCalls = {};
  const mcpCalls = {};
  const iterations = [];
  const timing = { api_ms: 0 };
  let turns = 0;
  let text = "";
  let status = "ok";
  let error;
  const events = [];
  let sentMessages = 0;
  /** One exchange per request: the body's messages since the last request, and the reply; the headers, which carry the key, are never kept. */
  const exchange = (body, response) => {
    const { messages, ...rest } = body;
    const request =
      sentMessages === 0
        ? body
        : { ...rest, messages: messages.slice(sentMessages) };
    if (sentMessages > 0) {
      delete request.system;
      delete request.tools;
    }
    sentMessages = messages.length;
    events.push({
      ms: since(),
      event: { type: "exchange", request, response },
    });
  };
  const mcp = await bridgeMcp(request);
  try {
    const tools = [...toolSpecs(request.tools), ...mcp.tools];
    const state = dialect.start(request);
    for (;;) {
      if (turns >= MAX_TURNS) {
        status = "error";
        error = `The agent had not answered after ${MAX_TURNS} turns.`;
        break;
      }
      const asked = performance.now();
      const turn = await dialect.ask({
        provider,
        model,
        key,
        state,
        tools,
        signal: controller.signal,
        exchange,
      });
      timing.api_ms += Math.round(performance.now() - asked);
      turns++;
      for (const c of Object.keys(tokens)) tokens[c] += turn.usage[c];
      iterations.push({
        at_ms: since(),
        input: turn.usage.input,
        cache_write: turn.usage.cache_write,
        cache_read: turn.usage.cache_read,
        output: turn.usage.output + turn.usage.reasoning,
      });
      if (turn.calls.length === 0) {
        text = turn.text;
        timing.answer_ms = since();
        break;
      }
      timing.first_tool_ms ??= since();
      const results = [];
      for (const call of turn.calls) {
        if (call.name.startsWith(MCP_PREFIX) && mcp.call) {
          const act = call.name.slice(MCP_PREFIX.length);
          bump(mcpCalls, act);
          try {
            results.push({ id: call.id, ...(await mcp.call(act, call.input)) });
          } catch (err) {
            results.push({
              id: call.id,
              text: String(err.message ?? err),
              isError: true,
            });
          }
        } else {
          bump(toolCalls, call.name);
          results.push({
            id: call.id,
            ...runTool(call.name, call.input, request.cwd, request.tools),
          });
        }
      }
      dialect.answer(state, results);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      status = "timeout";
      error = `The agent had not finished after ${Math.round(request.timeoutMs / 1000)} seconds.`;
    } else {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearTimeout(timer);
    await mcp.close();
  }
  return {
    text,
    status,
    timing,
    tokens,
    tokensUnknown: [],
    turns,
    toolCalls,
    mcpCalls,
    iterations,
    unsupported: request.subagents ? ["subagents"] : [],
    filesChanged: porcelainChanged(before, porcelain(request.cwd)),
    model,
    version: "bench-api",
    error,
    events,
  };
}

export default {
  tools: (request) => toolSpecs(request.tools).map((t) => t.name),
  run: runAgent,
};
