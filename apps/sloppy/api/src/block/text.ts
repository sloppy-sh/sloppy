// The plain words of a section, derived from the document it stores.
// docs/ARCHITECTURE.md § "Data model".

/** The keys a run of writing sits under, wherever in a document it sits:
 *  `text` for writing, `description` and `alt` for what somebody said a drawing
 *  or a picture is. */
const SAYS = new Set(["text", "description", "alt"]);

/**
 * Every run of writing a section's document holds, in the order it holds them,
 * with runs of whitespace collapsed — what a search of somebody's writing
 * reads.
 *
 * {@link SAYS} is read as a convention across elements rather than a list of
 * them, the way `citedNotes` finds a citation, so an element kind this build has
 * no renderer for still gives up its words. Writing kept before a block held the
 * editor's own document is a bare string, which is already its own words.
 */
export function wordsOf(content: unknown): string {
  if (typeof content === "string") return collapse(content);
  const written: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, held] of Object.entries(value)) {
      if (SAYS.has(key) && typeof held === "string") written.push(held);
      else walk(held);
    }
  };
  walk(content);
  return collapse(written.join(" "));
}

function collapse(words: string): string {
  return words.replace(/\s+/gu, " ").trim();
}
