// The harness's runner: a window composed for one ask put in front of a model,
// and Sloppy's own acts applied for it turn after turn — note 1e12b.

import {
  advertisedChatTools,
  type AdvertisedTool,
  CHAT_TOOLS,
  type ChatSpend,
  ChatToolCallSchema,
  type HarnessAct,
  type HarnessBudget,
  type HarnessRun,
  type HarnessStop,
  type HarnessTurn,
  type KeySourceKind,
  type Window,
  type WindowAsk,
  type WindowComposer,
} from "@sloppy/types";
import { performChatCall, type ActServed } from "./acts.js";
import type { Files } from "./files.js";

export const PROVIDER_KINDS = ["anthropic", "openai-compatible"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** US dollars per million tokens, for each class a turn's spend counts. */
export type ModelPrice = Record<keyof Omit<ChatSpend, "cost">, number>;

export interface HarnessProvider {
  kind: ProviderKind;
  /** The environment variable the key is read from. */
  keyEnv: string;
  /** Absent is the kind's own; an `openai-compatible` provider has none. */
  baseUrl?: string;
  /** The model a run takes when none is named; absent, one must be. */
  model?: string;
  /** By the model's name as the provider spells it. **A model absent here
   *  is one this run cannot price**, so a spend limit cannot hold it. */
  prices?: Readonly<Record<string, ModelPrice>>;
}

/** The providers a kind is reached at without naming one. Prices are list
 *  prices read on 2026-06-24. */
export const DEFAULT_PROVIDERS: Partial<Record<ProviderKind, HarnessProvider>> =
  {
    anthropic: {
      kind: "anthropic",
      keyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-5",
      prices: {
        "claude-opus-5-5": price(4, 20, 0.2, 5),
        "claude-opus-5": price(5, 25, 0.5, 6.25),
        "claude-sonnet-5": price(2, 10, 0.2, 2.5),
        "claude-haiku-4-5": price(1, 5, 0.1, 1.25),
      },
    },
  };

function price(
  sent: number,
  answered: number,
  recalled: number,
  kept: number,
): ModelPrice {
  return { sent, answered, recalled, kept, thought: answered };
}

/** Why a run could not start, in words a person can act on. */
export class HarnessRefused extends Error {
  override name = "HarnessRefused";
}

/** The provider's key, read from where `source` says. Never from a file in
 *  the project, and never written anywhere by this module. */
export function providerKey(
  provider: HarnessProvider,
  source: KeySourceKind,
  env: Readonly<Record<string, string | undefined>>,
): string {
  switch (source) {
    case "environment": {
      const key = env[provider.keyEnv];
      if (!key) {
        throw new HarnessRefused(
          `Set ${provider.keyEnv} in the environment to run with this provider.`,
        );
      }
      return key;
    }
    case "keychain":
      throw new HarnessRefused(
        `Reading the key from this computer's keychain is not here yet. Set ${provider.keyEnv} in the environment instead.`,
      );
  }
}

const MAX_OUTPUT_TOKENS = 8192;

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface Reply {
  text: string;
  calls: ToolCall[];
  spent: ChatSpend;
}

interface Exchange {
  messages: unknown[];
}

interface Answered {
  id: string;
  said: string;
  /** The act came to nothing, and the model reads why. */
  trouble: boolean;
}

interface Reach {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

interface Dialect {
  defaultBase?: string;
  start(first: string): Exchange;
  ask(
    at: string,
    key: string,
    model: string,
    exchange: Exchange,
    tools: readonly AdvertisedTool[],
    reach: Reach,
  ): Promise<Reply>;
  answer(exchange: Exchange, answers: Answered[]): void;
}

const DIALECTS: Record<ProviderKind, Dialect> = {
  anthropic: {
    defaultBase: "https://api.anthropic.com",
    start: (first) => ({ messages: [{ role: "user", content: first }] }),
    async ask(at, key, model, exchange, tools, reach) {
      const res = (await post(
        reach,
        `${at}/v1/messages`,
        { "x-api-key": key, "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: exchange.messages,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.arguments,
          })),
        },
      )) as AnthropicReply;
      const content = res.content ?? [];
      exchange.messages.push({ role: "assistant", content });
      const used = res.usage ?? {};
      return {
        text: content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n"),
        calls: content
          .filter((block) => block.type === "tool_use")
          .map((block) => ({
            id: block.id ?? "",
            name: block.name ?? "",
            input: objectOf(block.input),
          })),
        spent: spendOf({
          sent: used.input_tokens,
          answered: used.output_tokens,
          recalled: used.cache_read_input_tokens,
          kept: used.cache_creation_input_tokens,
        }),
      };
    },
    answer(exchange, answers) {
      exchange.messages.push({
        role: "user",
        content: answers.map((one) => ({
          type: "tool_result",
          tool_use_id: one.id,
          content: one.said,
          ...(one.trouble ? { is_error: true } : {}),
        })),
      });
    },
  },
  "openai-compatible": {
    start: (first) => ({ messages: [{ role: "user", content: first }] }),
    async ask(at, key, model, exchange, tools, reach) {
      const res = (await post(
        reach,
        `${at}/chat/completions`,
        { authorization: `Bearer ${key}` },
        {
          model,
          messages: exchange.messages,
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.arguments,
            },
          })),
        },
      )) as OpenAiReply;
      const message = res.choices?.[0]?.message ?? {
        role: "assistant",
        content: "",
      };
      exchange.messages.push(message);
      const used = res.usage ?? {};
      const recalled =
        used.prompt_tokens_details?.cached_tokens ??
        used.prompt_cache_hit_tokens;
      const thought = used.completion_tokens_details?.reasoning_tokens;
      return {
        text: typeof message.content === "string" ? message.content : "",
        calls: (message.tool_calls ?? []).map((call) => ({
          id: call.id ?? "",
          name: call.function?.name ?? "",
          input: argumentsOf(call.function?.arguments),
        })),
        spent: spendOf({
          sent: (used.prompt_tokens ?? 0) - (recalled ?? 0),
          answered: (used.completion_tokens ?? 0) - (thought ?? 0),
          recalled,
          thought,
        }),
      };
    },
    answer(exchange, answers) {
      for (const one of answers) {
        exchange.messages.push({
          role: "tool",
          tool_call_id: one.id,
          content: one.said,
        });
      }
    },
  },
};

interface AnthropicReply {
  content?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface OpenAiReply {
  choices?: {
    message?: {
      role: string;
      content?: unknown;
      tool_calls?: {
        id?: string;
        function?: { name?: string; arguments?: unknown };
      }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** A class the provider did not report stays absent; `sent` and `answered`
 *  are always counted. */
function spendOf(
  counts: Partial<Record<keyof ModelPrice, number | undefined>>,
): ChatSpend {
  const whole = (n: number | undefined) =>
    n === undefined ? undefined : Math.max(0, Math.round(n));
  const spent: ChatSpend = {
    sent: whole(counts.sent) ?? 0,
    answered: whole(counts.answered) ?? 0,
  };
  for (const kind of ["recalled", "kept", "thought"] as const) {
    const n = whole(counts[kind]);
    if (n !== undefined) spent[kind] = n;
  }
  return spent;
}

function objectOf(held: unknown): Record<string, unknown> {
  return held !== null && typeof held === "object" && !Array.isArray(held)
    ? (held as Record<string, unknown>)
    : {};
}

function argumentsOf(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return objectOf(raw);
  try {
    return objectOf(JSON.parse(raw || "{}"));
  } catch {
    return {};
  }
}

/** A provider that turned a request down, in its own words where it gave
 *  some. */
class ProviderTurnedDown extends Error {}

async function post(
  { fetch, signal }: Reach,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderTurnedDown(
      `The model's provider turned the request down (${res.status})${providerSays(text)}`,
    );
  }
  return JSON.parse(text);
}

function providerSays(text: string): string {
  try {
    const said = (JSON.parse(text) as { error?: { message?: unknown } }).error
      ?.message;
    return typeof said === "string" && said !== "" ? `: ${said}` : ".";
  } catch {
    return ".";
  }
}

/** The window as the model reads it: its parts, in order. */
export function windowText(window: Window): string {
  return window.parts.map((part) => part.text).join("\n\n");
}

/** What the model reads first: the ask, then the window gathered for it. */
export function firstContent(ask: WindowAsk, window: Window): string {
  return `${ask.ask}\n\n${windowText(window)}`;
}

const RUN_TIMEOUT_MS = 600_000;

export interface HarnessRequest {
  /** The project whose notes the acts are applied to. */
  files: Files;
  ask: WindowAsk;
  compose: WindowComposer;
  provider: HarnessProvider;
  model: string;
  key: string;
  budget: HarnessBudget;
  /** How the acts answer; absent is {@link performChatCall}'s own. */
  served?: ActServed;
  /** Absent is the platform's own. */
  fetch?: typeof globalThis.fetch;
  /** The longest the whole run may take, in milliseconds; absent is ten
   *  minutes. */
  timeoutMs?: number;
  /** Called with each turn as it is recorded. */
  onTurn?: (turn: HarnessTurn) => void;
}

/** Runs one ask to a stop, and never throws: a run that could not go on ends
 *  in `error` with the words to say. */
export async function runHarness(request: HarnessRequest): Promise<HarnessRun> {
  const { ask, model, budget, provider, key } = request;
  const turns: HarnessTurn[] = [];
  const ran = (stop: HarnessStop, error?: string): HarnessRun =>
    stop === "error"
      ? { ask, model, budget, turns, stop, error: error ?? "" }
      : { ask, model, budget, turns, stop };
  const priced = provider.prices?.[model];
  if (budget.spend !== undefined && priced === undefined) {
    return ran(
      "error",
      `There is no price here for ${model}, so a spend limit cannot be held to. Give a turn limit instead.`,
    );
  }
  const dialect = DIALECTS[provider.kind];
  const base = (provider.baseUrl ?? dialect.defaultBase)?.replace(/\/+$/, "");
  if (base === undefined) {
    return ran("error", "Say where this provider is reached.");
  }
  const fetch = request.fetch ?? globalThis.fetch.bind(globalThis);
  const tools = advertisedChatTools("answer-first", true);
  let window: Window;
  try {
    window = await request.compose(ask);
  } catch {
    return ran(
      "error",
      "The notes could not be gathered for that ask. Check the project's notes read, and try again.",
    );
  }
  const timeoutMs = request.timeoutMs ?? RUN_TIMEOUT_MS;
  const reach: Reach = { fetch, signal: AbortSignal.timeout(timeoutMs) };
  try {
    let sent = firstContent(ask, window);
    const exchange = dialect.start(sent);
    let cost: number | undefined = priced === undefined ? undefined : 0;
    for (;;) {
      const reply = await dialect.ask(base, key, model, exchange, tools, reach);
      if (cost !== undefined && priced !== undefined) {
        cost += costOf(reply.spent, priced);
      }
      const acts: HarnessAct[] = [];
      const answers: Answered[] = [];
      let refused = false;
      for (const call of reply.calls) {
        const { act, trouble } = await applied(request, call);
        acts.push(act);
        if (act.outcome === "refused") {
          refused = true;
          break;
        }
        answers.push({ id: call.id, said: act.answer, trouble });
      }
      const turn: HarnessTurn = {
        sent,
        reply: reply.text,
        acts,
        spent: cost === undefined ? reply.spent : { ...reply.spent, cost },
      };
      turns.push(turn);
      request.onTurn?.(turn);
      if (acts.length === 0) return ran("answered");
      if (refused) return ran("act_refused");
      if (budget.spend !== undefined && (cost ?? 0) >= budget.spend) {
        return ran("spend_spent");
      }
      if (budget.turns !== undefined && turns.length >= budget.turns) {
        return ran("turns_spent");
      }
      dialect.answer(exchange, answers);
      sent = answers.map((one) => one.said).join("\n\n");
    }
  } catch (thrown) {
    return ran("error", withoutKey(whyStopped(thrown, timeoutMs), key));
  }
}

function costOf(spent: ChatSpend, priced: ModelPrice): number {
  const kinds = ["sent", "answered", "recalled", "kept", "thought"] as const;
  return (
    kinds.reduce((sum, kind) => sum + (spent[kind] ?? 0) * priced[kind], 0) /
    1e6
  );
}

/** A `trouble` answer is still an answer: the model reads it and goes on.
 *  Only an act Sloppy does not have, or arguments it does not take, is
 *  refused. */
async function applied(
  request: HarnessRequest,
  call: ToolCall,
): Promise<{ act: HarnessAct; trouble: boolean }> {
  const asked = { act: call.name, input: call.input };
  const parsed = ChatToolCallSchema.safeParse({
    call: call.id || "call",
    act: call.name,
    arguments: call.input,
  });
  if (!parsed.success) {
    return {
      act: {
        ...asked,
        outcome: "refused",
        reason: notAnAct(call.name, parsed.error.issues[0]?.message),
      },
      trouble: false,
    };
  }
  const done = await performChatCall(
    request.files,
    parsed.data,
    false,
    request.served,
  );
  return {
    act: { ...asked, outcome: "answered", answer: done.said },
    trouble: done.trouble === true,
  };
}

function notAnAct(name: string, issue: string | undefined): string {
  if (!CHAT_TOOLS.some((act) => act === name))
    return `There is no act called ${name}.`;
  return `The model asked for ${name} in a shape it does not take${issue ? `: ${issue}` : "."}`;
}

function whyStopped(thrown: unknown, timeoutMs: number): string {
  if (thrown instanceof ProviderTurnedDown) return thrown.message;
  if (thrown instanceof HarnessRefused) return thrown.message;
  if (thrown instanceof Error && thrown.name === "TimeoutError") {
    return `The model had not finished after ${Math.round(timeoutMs / 1000)} seconds. Give it longer, or a smaller ask.`;
  }
  return "The run stopped before it was done. Check the connection to the model's provider and try again.";
}

function withoutKey(said: string, key: string): string {
  return key === "" ? said : said.split(key).join("…");
}
