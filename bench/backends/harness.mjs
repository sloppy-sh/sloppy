// Sloppy's own runner as a backend: `sloppy run` composes the window and drives
// the model through a provider in providers.json — note 1e12d; README.md § "Backends".
import path from "node:path";
import { pathToFileURL } from "node:url";
import { porcelain, porcelainChanged } from "../lib/proc.mjs";
import { MAX_TURNS } from "./api.mjs";

/** The provider kinds `sloppy run` reaches without being told where, by the variable it reads each one's key from. */
const KEY_ENVS = { anthropic: "ANTHROPIC_API_KEY" };
export const PROVIDER_KINDS = Object.keys(KEY_ENVS);

/** What `sloppy run` serves, whatever a config asks of the mcp server: every act, in full. */
export const SERVES = { profile: "full" };

/** The longest a run is given before `sloppy run` stops it itself. */
export const CEILING_MS = 600_000;

/** Each way a run stops short, in the words the record carries. */
const STOPPED = {
  turns_spent: `The agent had not answered after ${MAX_TURNS} turns.`,
  spend_spent: "The agent spent what it was given without answering.",
  act_refused: "The agent asked for something that could not be done.",
};

/** Whether `sloppy run` can reach a providers.json entry: one of its kinds, at that kind's own address. */
export const reachable = (provider) =>
  PROVIDER_KINDS.includes(provider.kind) && provider.base_url === undefined;

const SLOPPY_PREFIX = "mcp__sloppy__";

/** The CLI's own module beside the `sloppy.mjs` the config names, so a config's tree is the one run. */
export const runnerOf = (cli) =>
  import(pathToFileURL(path.join(path.dirname(cli), "index.mjs")).href);

const bump = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * The fetch the runner is handed: every request carries the bench's system prompt, stops when
 * `signal` does, and is kept with its reply as an `exchange` event, its messages only those new
 * since the last.
 */
function recordingFetch({ fetch, systemPrompt, signal, events, since }) {
  let sentMessages = 0;
  return async (url, init = {}) => {
    const body = JSON.parse(init.body ?? "{}");
    if (systemPrompt) body.system = systemPrompt;
    const res = await fetch(url, {
      ...init,
      body: JSON.stringify(body),
      signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal,
    });
    const text = await res.clone().text();
    let response;
    try {
      response = JSON.parse(text);
    } catch {
      response = { status: res.status, text };
    }
    const { messages = [], ...rest } = body;
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
    return res;
  };
}

/** The asked of `sloppy run --json`, as its own parser would have read it. */
const askedOf = (prompt, kind, model) => ({
  command: "run",
  paths: [prompt],
  options: new Map([
    ["provider", kind],
    ["model", model],
    ["turns", String(MAX_TURNS)],
  ]),
});

/** The record's answer from the run `sloppy run --json` printed. */
export function answerOf(
  run,
  { model, before, cwd, events, since, unsupported },
) {
  const tokens = {
    input: 0,
    cache_write: 0,
    cache_read: 0,
    output: 0,
    reasoning: 0,
  };
  const mcpCalls = {};
  const iterations = [];
  const asked = events.filter((e) => e.event.type === "exchange");
  const ordered = [];
  for (const [at, turn] of (run.turns ?? []).entries()) {
    const exchange = asked[at];
    if (exchange) ordered.push(exchange);
    const s = turn.spent;
    const used = {
      input: s.sent,
      cache_write: s.kept ?? 0,
      cache_read: s.recalled ?? 0,
      output: s.answered,
      reasoning: s.thought ?? 0,
    };
    for (const c of Object.keys(tokens)) tokens[c] += used[c];
    iterations.push({
      at_ms: exchange?.ms ?? since(),
      input: used.input,
      cache_write: used.cache_write,
      cache_read: used.cache_read,
      output: used.output + used.reasoning,
    });
    for (const act of turn.acts) {
      bump(mcpCalls, act.act);
      ordered.push({
        ms: exchange?.ms ?? since(),
        event: {
          type: "tool",
          name: `${SLOPPY_PREFIX}${act.act}`,
          input: act.input,
          result: act.outcome === "refused" ? act.reason : act.answer,
          is_error: act.outcome === "refused",
        },
      });
    }
  }
  ordered.push(...asked.slice(run.turns?.length ?? 0));
  const answered = run.stop === "answered";
  return {
    text: answered ? (run.turns.at(-1)?.reply ?? "").trim() : "",
    status: answered ? "ok" : "error",
    timing: answered ? { answer_ms: since() } : {},
    tokens,
    tokensUnknown: [],
    turns: run.turns?.length ?? 0,
    toolCalls: {},
    mcpCalls,
    iterations,
    unsupported,
    filesChanged: porcelainChanged(before, porcelain(cwd)),
    model,
    version: "sloppy-run",
    error: answered
      ? undefined
      : (run.error ??
        run.said ??
        STOPPED[run.stop] ??
        "The agent stopped without answering."),
    events: ordered,
  };
}

export async function runHarnessBackend(
  request,
  { fetch = globalThis.fetch.bind(globalThis), env = process.env } = {},
) {
  if (!request.harness)
    throw new Error(
      "The harness backend runs only a condition that asks for it.",
    );
  const provider = request.provider;
  if (!provider || !reachable(provider))
    throw new Error(
      `The harness backend reaches a provider of kind ${PROVIDER_KINDS.join(" or ")} at its own address; choose one in providers.json.`,
    );
  const model = request.model ?? provider.models[0];
  const { running } = await runnerOf(request.harness.cli);

  const started = performance.now();
  const since = () => Math.round(performance.now() - started);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  const before = porcelain(request.cwd);
  const events = [];
  const out = [];
  const unsupported = [
    ...(request.tools === "none" ? [] : [request.tools]),
    ...(request.subagents ? ["subagents"] : []),
  ];
  try {
    await running(
      askedOf(request.prompt, provider.kind, model),
      {
        cwd: request.cwd,
        told: { out: (line) => out.push(line), err: (line) => out.push(line) },
      },
      true,
      {
        env: { ...env, [KEY_ENVS[provider.kind]]: env[provider.key_env] },
        fetch: recordingFetch({
          fetch,
          systemPrompt: request.systemPrompt,
          signal: controller.signal,
          events,
          since,
        }),
      },
    );
  } finally {
    clearTimeout(timer);
  }
  const answer = answerOf(lastJson(out), {
    model,
    before,
    cwd: request.cwd,
    events,
    since,
    unsupported,
  });
  if (controller.signal.aborted)
    return {
      ...answer,
      status: "timeout",
      error: `The run had not finished after ${Math.round(request.timeoutMs / 1000)} seconds.`,
    };
  return answer;
}

function lastJson(lines) {
  for (const line of [...lines].reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  return {
    stop: "error",
    turns: [],
    error: lines.join("\n") || "It printed nothing.",
  };
}

export default {
  tools: () => [],
  run: runHarnessBackend,
};
