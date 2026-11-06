import fs from "node:fs";
import { z } from "zod";
import { TOKEN_CLASSES } from "./kinds.mjs";

export { TOKEN_CLASSES };

export const TIERS = ["small", "medium", "large"];

const perMillion = z.number().nonnegative().nullable();

export const PricesSchema = z.object({
  basis: z.literal("list"),
  unit: z.string(),
  providers: z.record(
    z.string(),
    z.object({
      read_on: z.string().nullable(),
      source: z.string().optional(),
      models: z.record(
        z.string(),
        z.object({
          ...Object.fromEntries(TOKEN_CLASSES.map((c) => [c, perMillion])),
          /** How large the model is among its peers, for reading a small model against a large one; absent reads as medium. */
          tier: z.enum(TIERS).optional(),
        }),
      ),
    }),
  ),
});

export function loadPrices(file) {
  return PricesSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** An installed agent may name its model with a context suffix, `claude-opus-5-5[1m]`, priced as the bare id. */
const bareModel = (model) => model.replace(/\[[^\]]*\]$/, "");

export function priceFor(prices, provider, model) {
  const models = prices.providers[provider]?.models;
  if (!models || !model) return undefined;
  return models[model] ?? models[bareModel(model)];
}

/**
 * USD for `tokens` at `backend.provider`'s list price for `backend.model`, or undefined where the
 * model is not priced, any of its prices is null, or a class in `unknown` has a price above 0.
 * Never a guess.
 */
export function computeCost(prices, backend, tokens, unknown = []) {
  const price = priceFor(prices, backend.provider, backend.model);
  if (!price || TOKEN_CLASSES.some((c) => price[c] === null)) return undefined;
  if (unknown.some((c) => price[c] > 0)) return undefined;
  const cost =
    TOKEN_CLASSES.reduce((sum, c) => sum + (tokens[c] ?? 0) * price[c], 0) /
    1e6;
  return Math.round(cost * 1e8) / 1e8;
}

const segments = (model) => bareModel(model).split("-");

/**
 * The tier of `model` from prices.json: the priced model sharing the most leading name segments
 * with it, at least two, so `claude-sonnet-5-5` reads as `claude-sonnet-5`; else one whose name holds
 * every segment of it, so an alias `haiku` reads as `claude-haiku-4-5`; medium where none does.
 */
export function tierFor(prices, model) {
  const want = segments(model);
  let best;
  let bestShared = 1;
  for (const provider of Object.values(prices.providers))
    for (const [name, entry] of Object.entries(provider.models)) {
      const have = segments(name);
      let shared = 0;
      while (
        shared < Math.min(want.length, have.length) &&
        want[shared] === have[shared]
      )
        shared++;
      if (
        shared > bestShared ||
        (shared === want.length && shared === have.length)
      ) {
        best = entry;
        bestShared = shared;
      }
    }
  best ??= Object.values(prices.providers)
    .flatMap((p) => Object.entries(p.models))
    .find(([name]) => want.every((w) => segments(name).includes(w)))?.[1];
  return best?.tier ?? "medium";
}
