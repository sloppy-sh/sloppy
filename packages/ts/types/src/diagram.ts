// A diagram element inside a block's document: the language somebody wrote it
// in, beside their source. Never the picture drawn from it —
// docs/ARCHITECTURE.md § "Blocks and ink".

import { z } from "zod";

export const DiagramElementDataSchema = z.object({
  language: z.string().min(1),
  source: z.string(),
});
export type DiagramElementData = z.infer<typeof DiagramElementDataSchema>;

/**
 * The languages a fence opens a diagram in. Which of them a build can DRAW is a
 * separate question that `diagrams.ts` in `@sloppy/ui` answers: a language with
 * no renderer here is still a diagram, still stored whole and still written
 * into a vault as a fence, so a later build draws it.
 */
export const DIAGRAM_LANGUAGES: readonly string[] = ["mermaid"];

export function opensDiagram(language: string): boolean {
  return DIAGRAM_LANGUAGES.includes(language);
}
