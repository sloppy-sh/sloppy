// Answers from bench/fixtures/mock/<task>.json, so the runner can be exercised end to end without a model.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BENCH_DIR } from "../lib/config.mjs";
import { TokensSchema, TokensUnknownSchema } from "../lib/record.mjs";

export const FIXTURES_DIR = path.join(BENCH_DIR, "fixtures", "mock");

const fixturesDir = () =>
  process.env.SLOPPY_BENCH_MOCK_FIXTURES ?? FIXTURES_DIR;

const FixtureSchema = z.object({
  text: z.string(),
  status: z.enum(["ok", "error", "timeout"]).default("ok"),
  timing: z
    .object({
      api_ms: z.number().nonnegative().optional(),
      first_token_ms: z.number().nonnegative().optional(),
      first_tool_ms: z.number().nonnegative().optional(),
      answer_ms: z.number().nonnegative().optional(),
    })
    .prefault({}),
  /** Absent answers with no token counts at all, as a backend that can tell none of them does. */
  tokens: TokensSchema.optional(),
  tokens_unknown: TokensUnknownSchema.optional(),
  cost_reported: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().default(1),
  tool_calls: z
    .record(z.string(), z.number().int().nonnegative())
    .default(() => ({})),
  /** Added to the answer only where the request offers the sloppy MCP server. */
  mcp_calls: z
    .record(z.string(), z.number().int().nonnegative())
    .default(() => ({})),
  /** Answered only where the request offers subagents. */
  subagents_spawned: z.number().int().nonnegative().default(1),
  error: z.string().optional(),
  /** Files the answer writes into the variant, by variant-relative path. */
  writes: z.record(z.string(), z.string()).default(() => ({})),
  /** Calls the answer made, kept in its transcript for findability; sloppy acts only where the request offers the server. */
  calls: z
    .array(
      z.object({
        name: z.string().min(1),
        input: z.record(z.string(), z.unknown()).default(() => ({})),
        result: z.string().optional(),
        is_error: z.boolean().optional(),
      }),
    )
    .default(() => []),
});

/** Splits `total` into integer shares weighted `weights`, the remainder on the last share. */
function shares(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/** Calls whose prompts grow by one share each, summing to the fixture's tokens, spaced evenly up to the answer. */
export function mockIterations(tokens, turns, endMs) {
  if (!tokens || turns < 1) return [];
  const growing = Array.from({ length: turns }, (_, i) => i + 1);
  const even = growing.map(() => 1);
  const input = shares(tokens.input, growing);
  const cacheWrite = shares(tokens.cache_write, growing);
  const cacheRead = shares(tokens.cache_read, growing);
  const output = shares(tokens.output + tokens.reasoning, even);
  return growing.map((n, i) => ({
    at_ms: Math.round((endMs * n) / turns),
    input: input[i],
    cache_write: cacheWrite[i],
    cache_read: cacheRead[i],
    output: output[i],
  }));
}

export default {
  simulated: true,
  async run(request) {
    const file = path.join(fixturesDir(), `${request.taskId}.json`);
    if (!fs.existsSync(file))
      return answer(
        {
          text: "",
          status: "error",
          turns: 0,
          error: `The mock has no answer for task "${request.taskId}"; add ${path.relative(BENCH_DIR, file)}.`,
        },
        request,
      );
    return answer(
      FixtureSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))),
      request,
    );
  },
};

function answer(fixture, request) {
  const f = FixtureSchema.parse(fixture);
  for (const [rel, content] of Object.entries(f.writes)) {
    const to = path.join(request.cwd, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
  }
  return {
    text: f.text,
    status: f.status,
    timing: f.timing,
    tokens: f.tokens,
    tokensUnknown: f.tokens_unknown,
    costReported: f.cost_reported,
    turns: f.turns,
    toolCalls: f.tool_calls,
    mcpCalls: request.mcp ? f.mcp_calls : {},
    subagentsSpawned: request.subagents ? f.subagents_spawned : 0,
    iterations: mockIterations(
      f.tokens,
      f.turns,
      f.timing.answer_ms ?? f.timing.api_ms ?? 1000 * f.turns,
    ),
    filesChanged: [],
    model: request.model,
    version: "fixture",
    error: f.error,
    events: [
      { ms: 0, event: { type: "fixture", task: request.taskId } },
      ...f.calls
        .filter((c) => request.mcp || !c.name.startsWith("mcp__sloppy__"))
        .map((c) => ({ ms: 0, event: { type: "tool", ...c } })),
      { ms: f.timing.answer_ms ?? 0, event: { type: "answer", text: f.text } },
    ],
  };
}
