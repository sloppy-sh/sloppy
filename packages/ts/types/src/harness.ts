// What the harness's runner records of a run, and where a provider's key comes
// from — note 1e12b.

import { z } from "zod";
import { ChatSpendSchema } from "./chat.js";
import { WindowAskSchema } from "./window.js";

/** Long enough for any act a model can name, including one that does not
 *  exist — which is refused, not unparsable. */
export const ACT_NAME_MAX = 128;

const ACT_ASKED = {
  act: z.string().min(1).max(ACT_NAME_MAX),
  input: z.record(z.string(), z.unknown()),
};

/** One act the model asked for, and what it came to. */
export const HarnessActSchema = z.discriminatedUnion("outcome", [
  z.object({
    ...ACT_ASKED,
    outcome: z.literal("answered"),
    answer: z.string(),
  }),
  z.object({
    ...ACT_ASKED,
    outcome: z.literal("refused"),
    reason: z.string(),
  }),
]);
export type HarnessAct = z.infer<typeof HarnessActSchema>;

/** One turn. `sent` is the window on the first turn and what the acts answered
 *  after it; `acts` are in the order the model asked for them, and **a turn
 *  with none is an answer**. */
export const HarnessTurnSchema = z.object({
  sent: z.string(),
  reply: z.string(),
  acts: z.array(HarnessActSchema),
  spent: ChatSpendSchema,
});
export type HarnessTurn = z.infer<typeof HarnessTurnSchema>;

export const HARNESS_STOPS = [
  "answered",
  "turns_spent",
  "spend_spent",
  "act_refused",
  "error",
] as const;
export const HarnessStopSchema = z.enum(HARNESS_STOPS);
export type HarnessStop = z.infer<typeof HarnessStopSchema>;

const TurnLimitSchema = z.int().min(1);
/** In US dollars, as {@link ChatSpendSchema}'s `cost` is. */
const SpendLimitSchema = z.number().positive();

/** What a run may spend before it stops: turns, spend, or both. **An absent
 *  limit is no limit on that axis**; a budget naming neither is refused. */
export const HarnessBudgetSchema = z.union([
  z.object({ turns: TurnLimitSchema, spend: SpendLimitSchema.optional() }),
  z.object({ turns: TurnLimitSchema.optional(), spend: SpendLimitSchema }),
]);
export type HarnessBudget = z.infer<typeof HarnessBudgetSchema>;

export const MODEL_NAME_MAX = 256;

const RUN = {
  ask: WindowAskSchema,
  /** The model as the provider names it. */
  model: z.string().min(1).max(MODEL_NAME_MAX),
  budget: HarnessBudgetSchema,
  turns: z.array(HarnessTurnSchema),
};

/** A run as the runner left it. Only a run that ended in `error` carries what
 *  went wrong, in words a person can act on. */
export const HarnessRunSchema = z.discriminatedUnion("stop", [
  z.object({ ...RUN, stop: z.literal("error"), error: z.string().min(1) }),
  z.object({ ...RUN, stop: HarnessStopSchema.exclude(["error"]) }),
]);
export type HarnessRun = z.infer<typeof HarnessRunSchema>;

/** Where a provider's key is read from — never a file in the folder. */
export const KEY_SOURCE_KINDS = ["environment", "keychain"] as const;
export const KeySourceKindSchema = z.enum(KEY_SOURCE_KINDS);
export type KeySourceKind = z.infer<typeof KeySourceKindSchema>;
