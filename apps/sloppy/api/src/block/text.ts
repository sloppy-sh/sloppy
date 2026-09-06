// The plain words of a section, derived from the document it stores.
// docs/ARCHITECTURE.md § "Data model".

/**
 * Every run of writing a section's document holds, in the order it holds them,
 * with runs of whitespace collapsed — what a search of somebody's writing
 * reads.
 *
 * A run is found by the key `text` wherever it sits, the way `citedNotes` finds
 * a citation: an element kind this build has no renderer for still gives up its
 * words. Writing kept before a block held the editor's own document is a bare
 * string, which is already its own words.
 */
export function wordsOf(content: unknown): string {
  if (typeof content === "string") return collapse(content);
  const written: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, held] of Object.entries(value)) {
      if (key === "text" && typeof held === "string") written.push(held);
      else walk(held);
    }
  };
  walk(content);
  return collapse(written.join(" "));
}

function collapse(words: string): string {
  return words.replace(/\s+/gu, " ").trim();
}
