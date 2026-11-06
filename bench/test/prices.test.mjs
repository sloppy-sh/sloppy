import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { BENCH_DIR, loadProviders } from "../lib/config.mjs";
import { computeCost, loadPrices, TOKEN_CLASSES } from "../lib/prices.mjs";

const prices = loadPrices(path.join(BENCH_DIR, "prices.json"));
const tokens = {
  input: 1_000_000,
  cache_write: 1_000_000,
  cache_read: 1_000_000,
  output: 1_000_000,
  reasoning: 0,
};

test("a priced model costs its list price per million tokens, class by class", () => {
  assert.equal(
    computeCost(
      prices,
      { provider: "anthropic", model: "claude-opus-5" },
      tokens,
    ),
    5 + 6.25 + 0.5 + 25,
  );
  assert.equal(
    computeCost(
      prices,
      { provider: "anthropic", model: "claude-sonnet-5" },
      { input: 1000, output: 500 },
    ),
    (1000 * 2 + 500 * 10) / 1e6,
  );
});

test("a context suffix on the model id is priced as the bare model", () => {
  assert.equal(
    computeCost(
      prices,
      { provider: "anthropic", model: "claude-opus-5-5[1m]" },
      tokens,
    ),
    computeCost(
      prices,
      { provider: "anthropic", model: "claude-opus-5-5" },
      tokens,
    ),
  );
});

test("an unknown model, provider or a null price computes nothing", () => {
  assert.equal(
    computeCost(
      prices,
      { provider: "anthropic", model: "claude-unknown" },
      tokens,
    ),
    undefined,
  );
  assert.equal(
    computeCost(prices, { provider: "nobody", model: "claude-opus-5" }, tokens),
    undefined,
  );
  assert.equal(
    computeCost(prices, { model: "claude-opus-5" }, tokens),
    undefined,
  );
  assert.equal(
    computeCost(
      prices,
      { provider: "deepseek", model: "deepseek-chat" },
      tokens,
    ),
    undefined,
  );
});

test("every provider's models appear in prices.json, priced or explicitly null", () => {
  for (const p of loadProviders())
    for (const m of p.models)
      assert.ok(
        prices.providers[p.id]?.models[m],
        `${p.id}/${m} has no prices.json entry`,
      );
});

test("a token class the backend could not tell is never priced as zero", () => {
  const sonnet = { provider: "anthropic", model: "claude-sonnet-5" };
  assert.equal(computeCost(prices, sonnet, {}, TOKEN_CLASSES), undefined);
  assert.equal(
    computeCost(prices, sonnet, { input: 1000 }, ["cache_write"]),
    undefined,
  );
  assert.equal(computeCost(prices, sonnet, { input: 1000 }, []), 0.002);
});
