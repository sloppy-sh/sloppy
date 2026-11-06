// Conditions, bench/conditions.json; README.md § "Conditions" is the doc of record.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BENCH_DIR } from "./config.mjs";
import { VARIANTS } from "./record.mjs";

export const ConditionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9+-]*$/),
  variant: z.enum(VARIANTS),
  /** Lines appended to the system prompt, in order. */
  lines: z.array(z.string().min(1)),
  /** Whether the line naming the subject's `pointed` documents opens the condition's lines. */
  pointed: z.boolean(),
  /** Whether the subject's `dump` files are appended to the system prompt in full, each under a heading naming it. */
  dump: z.boolean(),
  /** Whether the sloppy MCP server is offered. */
  mcp: z.boolean(),
  /** Whether the agent may start subagents; a backend that cannot offer them records the run's `unsupported`. */
  subagents: z.boolean().default(false),
});

export const ConditionsSchema = z.object({
  /** Opens the system prompt under every condition, verbatim. */
  base_system: z.string(),
  conditions: z.array(ConditionSchema).min(1),
});

export function loadConditions(file = path.join(BENCH_DIR, "conditions.json")) {
  const parsed = ConditionsSchema.parse(
    JSON.parse(fs.readFileSync(file, "utf8")),
  );
  const ids = parsed.conditions.map((c) => c.id);
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
  if (repeated)
    throw new Error(`${file} names the condition "${repeated}" twice.`);
  return parsed;
}

/** The named conditions in the file's order, or every one where `ids` is empty. */
export function selectConditions(all, ids = []) {
  if (ids.length === 0) return all.conditions;
  return ids.map((id) => {
    const found = all.conditions.find((c) => c.id === id);
    if (!found)
      throw new Error(
        `There is no condition called "${id}". Choose from: ${all.conditions.map((c) => c.id).join(", ")}.`,
      );
    return found;
  });
}
