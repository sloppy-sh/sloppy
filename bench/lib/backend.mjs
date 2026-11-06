// The backend interface and its registry; README.md § "Backends" is the doc of record.
import { loadAgents } from "./config.mjs";
import { BACKENDS, INSTALLED_BACKENDS, isInstalledBackend } from "./kinds.mjs";

export { BACKENDS, INSTALLED_BACKENDS, isInstalledBackend };

/**
 * @typedef {object} BackendRequest
 * @property {string} cwd Variant root the agent works in.
 * @property {string} systemPrompt From the one prompt builder; may be empty.
 * @property {string} prompt The task text, identical across conditions.
 * @property {'read' | 'write' | 'none'} tools `read` lets the agent read and search files; `write` adds editing files and running commands; `none` offers no tool at all, for a judge.
 * @property {{ command: string, args: string[] }} [mcp] The sloppy MCP server to offer, started in `cwd`; absent means none.
 * @property {boolean} [subagents] Whether the agent may start subagents; a backend that cannot offer them answers `unsupported: ['subagents']`.
 * @property {string} [model] Model id; absent lets an installed agent use its own default.
 * @property {number} timeoutMs The backend stops the agent at this many milliseconds and answers `timeout`.
 * @property {number} budgetUsd USD left in the batch; a backend that can cap spend caps at this.
 * @property {string} taskId Task id; only the mock reads it.
 * @property {{ command: string, args: string[], provider?: string }} [agent] agents.json entry, for an installed backend.
 * @property {import('./config.mjs').ProviderSchema['_output']} [provider] providers.json entry, for `api`.
 */

/**
 * @typedef {object} BackendAnswer
 * @property {string} text The agent's final answer.
 * @property {'ok' | 'error' | 'timeout'} status
 * @property {{ api_ms?: number, first_token_ms?: number, first_tool_ms?: number, answer_ms?: number }} timing The runner measures wall_ms itself.
 * @property {{ input: number, cache_write: number, cache_read: number, output: number, reasoning: number }} [tokens] Absent where the backend can tell none of them, which the runner records as every class unknown.
 * @property {Array<'input' | 'cache_write' | 'cache_read' | 'output' | 'reasoning'>} [tokensUnknown] Classes the backend could not tell; their 0 in `tokens` is not a count.
 * @property {number} [costReported] USD the backend reported, where it reports one.
 * @property {number} turns
 * @property {Record<string, number>} toolCalls By tool name.
 * @property {Record<string, number>} mcpCalls By sloppy act name.
 * @property {Record<string, number>} [subagentCalls] Calls the run's subagents made, by tool name.
 * @property {number} [subagentsSpawned]
 * @property {string[]} [unsupported] What the request offered that this backend could not.
 * @property {Array<{ at_ms: number, input: number, cache_write: number, cache_read: number, output: number }>} [iterations] The agent's own model calls, in order; absent where it cannot tell.
 * @property {string[]} filesChanged Relative to `cwd`; the runner fills this from git where a backend leaves it empty.
 * @property {string} [model] The model that actually answered, where the backend can tell.
 * @property {string} [version] Agent or harness version, where it can tell.
 * @property {string} [unpriced] Why list prices cannot price this run although its tokens are known; the runner then computes no cost.
 * @property {string} [error] What went wrong, where status is not `ok`.
 * @property {Array<{ ms: number, event: unknown }>} [events] The raw stream, in arrival order, `ms` from the start; kept as the run's transcript and never graded.
 */

/**
 * @typedef {object} Backend
 * @property {(request: BackendRequest) => Promise<BackendAnswer>} run
 * @property {(request: Pick<BackendRequest, 'tools' | 'subagents'>) => string[]} [tools] The tools a request is offered, by the backend's own names.
 * @property {boolean} [simulated] True where the answers come from fixtures rather than a model.
 */

/** The record's `sent.tools`: the backend's names for what it offers, the tool set's name where it names none. */
export const sentTools = (backend, request) =>
  backend.tools?.(request) ?? [request.tools];

const REGISTRY = {
  "claude-code": () => import("../backends/claude-code.mjs"),
  codex: () => import("../backends/codex.mjs"),
  api: () => import("../backends/api.mjs"),
  mock: () => import("../backends/mock.mjs"),
};

/** A run the suite will not start, with the words saying what to do instead. */
export class RefusedError extends Error {}

export class NotAllowedError extends RefusedError {}

export function refusalFor(kind) {
  return `${kind} is an agent installed on this device, and bench/agents.json does not allow the benchmark to run it. Add "${kind}" to "allow_installed" there to allow it.`;
}

/** Throws a NotAllowedError, in words, for an installed backend agents.json does not allow. */
export function assertAllowed(kind, agents) {
  if (isInstalledBackend(kind) && !agents.allow_installed.includes(kind))
    throw new NotAllowedError(refusalFor(kind));
}

/** @returns {Promise<Backend>} */
export async function loadBackend(kind) {
  const load = REGISTRY[kind];
  if (!load)
    throw new Error(
      `There is no backend called "${kind}". Choose one of: ${BACKENDS.join(", ")}.`,
    );
  return (await load()).default;
}

/**
 * Runs one request, refusing an installed backend that `agents` (agents.json by default) does not allow.
 * @returns {Promise<BackendAnswer>}
 */
export async function runBackend(
  kind,
  request,
  { agents = loadAgents() } = {},
) {
  assertAllowed(kind, agents);
  return (await loadBackend(kind)).run(request);
}
