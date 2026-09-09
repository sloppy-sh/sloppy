// What a fence opens a diagram in, which the editor and a vault read the same
// way — docs/ARCHITECTURE.md § "Blocks and ink".

/** The languages a fence opens a diagram in, drawable here or not. */
export const DIAGRAM_LANGUAGES: readonly string[] = ["mermaid"];

export function opensDiagram(language: string): boolean {
  return DIAGRAM_LANGUAGES.includes(language);
}
