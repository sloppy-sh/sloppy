// What `sloppy mcp` needs of Node beside the serving loop in
// `@sloppy/local` — docs/ARCHITECTURE.md § "An assistant outside the app".

import { readFile } from "node:fs/promises";

/** A stream read a line at a time, blank lines passed over. A line can arrive
 *  in pieces, and the last one need not end in a newline. */
export async function* linesOf(
  stream: AsyncIterable<string | Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let held = "";
  for await (const chunk of stream) {
    held +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    for (;;) {
      const at = held.indexOf("\n");
      if (at === -1) break;
      const line = held.slice(0, at).replace(/\r$/, "");
      held = held.slice(at + 1);
      if (line.trim() !== "") yield line;
    }
  }
  held += decoder.decode();
  if (held.trim() !== "") yield held;
}

/** The version this package says it is, and "0" where it cannot be read. */
export async function ownVersion(): Promise<string> {
  try {
    const held: unknown = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const said =
      typeof held === "object" && held !== null
        ? (held as Record<string, unknown>).version
        : undefined;
    return typeof said === "string" ? said : "0";
  } catch {
    return "0";
  }
}
