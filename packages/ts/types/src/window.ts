// The window a harness puts in front of a model: a region of the graph composed
// whole for one ask, to a budget — note 1e12a.

import { z } from "zod";
import { AnchorStandingSchema, ProjectPathSchema } from "./code-anchor.js";
import { OwnedRefSchema } from "./common.js";

export const WINDOW_PART_KINDS = [
  "note",
  "ancestor",
  "sibling",
  "code",
  "instructions",
] as const;
export const WindowPartKindSchema = z.enum(WINDOW_PART_KINDS);
export type WindowPartKind = z.infer<typeof WindowPartKindSchema>;

/** Counted in the tokens of the model that will read the window. */
const TokensSchema = z.number().int().nonnegative();

const NOTE_FROM = { ref: OwnedRefSchema };
const INSTRUCTIONS_FROM = { path: ProjectPathSchema };

const sourced = <K extends WindowPartKind, S extends z.ZodRawShape>(
  kind: K,
  from: S,
) => z.object({ kind: z.literal(kind), ...from, tokens: TokensSchema });

const NoteSourceSchema = sourced("note", NOTE_FROM);
const AncestorSourceSchema = sourced("ancestor", NOTE_FROM);
const SiblingSourceSchema = sourced("sibling", NOTE_FROM);
const CodeSourceSchema = sourced("code", AnchorStandingSchema.shape);
const InstructionsSourceSchema = sourced("instructions", INSTRUCTIONS_FROM);

const TEXT = { text: z.string() };

/** One thing in a window: its kind, where it came from, what it holds, and the
 *  tokens that takes. */
export const WindowPartSchema = z.discriminatedUnion("kind", [
  NoteSourceSchema.extend(TEXT),
  AncestorSourceSchema.extend(TEXT),
  SiblingSourceSchema.extend(TEXT),
  CodeSourceSchema.extend(TEXT),
  InstructionsSourceSchema.extend(TEXT),
]);
export type WindowPart = z.infer<typeof WindowPartSchema>;

/**
 * What the budget took out of a window: the part's kind and where it came from,
 * and the tokens cutting it saved. A part shortened rather than dropped — the
 * best note cut down to its opening — is in the window's parts as it was left
 * AND here, with the tokens the shortening saved.
 */
export const WindowCutSchema = z.discriminatedUnion("kind", [
  NoteSourceSchema,
  AncestorSourceSchema,
  SiblingSourceSchema,
  CodeSourceSchema,
  InstructionsSourceSchema,
]);
export type WindowCut = z.infer<typeof WindowCutSchema>;

/** More than any model reads at once. */
export const WINDOW_BUDGET_MAX = 10_000_000;
/** How many parents up the chain a window reaches when the ask names no depth
 *  — ancestors only, unlike `MOST_HOPS`, which counts a hop over any relation. */
export const WINDOW_DEPTH = 3;
export const WINDOW_DEPTH_MAX = 64;
export const WINDOW_ASK_MAX = 100_000;

const BudgetSchema = z.number().int().positive().max(WINDOW_BUDGET_MAX);

/** One window: the parts in the order a model reads them, the budget it was
 *  composed to, and what was cut in the order it was cut. */
export const WindowSchema = z.object({
  parts: z.array(WindowPartSchema),
  budget: BudgetSchema,
  cut: z.array(WindowCutSchema),
});
export type Window = z.infer<typeof WindowSchema>;

/** What a window is composed for. `depth` counts parents up the chain, as
 *  {@link WINDOW_DEPTH} does. */
export const WindowAskSchema = z.object({
  ask: z.string().trim().min(1).max(WINDOW_ASK_MAX),
  budget: BudgetSchema,
  depth: z.number().int().min(0).max(WINDOW_DEPTH_MAX).default(WINDOW_DEPTH),
});
export type WindowAsk = z.infer<typeof WindowAskSchema>;

/** The seam a runner takes a composer through. */
export type WindowComposer = (ask: WindowAsk) => Promise<Window>;
