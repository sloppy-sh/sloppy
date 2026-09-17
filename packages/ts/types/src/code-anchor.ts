// An anchor from a note into the code it is about, carried as an ordinary link
// — docs/ARCHITECTURE.md § "A project's container".

import type { BlockDocument } from "./document.js";

/** What a link holds to point at code rather than at a page. */
export const CODE_SCHEME = "code:";

/**
 * Where in a project a note is pointing. `path` is from the PROJECT root and
 * is spelled with `/`; an absent `fragment` is the whole file.
 *
 * A `symbol` is a name to find by searching the file — there is no language
 * server behind it, and a name that stops matching is itself worth saying.
 */
export interface CodeAnchor {
  path: string;
  fragment?:
    | { kind: "lines"; from: number; to: number }
    | { kind: "symbol"; name: string };
}

const LINES = /^L(\d+)(?:-L(\d+))?$/;

/**
 * The anchor an href holds, or absent where it is not one. A path that climbs
 * out of the project or starts at the top of a disk names something the project
 * does not own, and is refused here rather than resolved and then regretted.
 */
export function parseCodeAnchor(href: string): CodeAnchor | undefined {
  if (!href.startsWith(CODE_SCHEME)) return undefined;
  const held = href.slice(CODE_SCHEME.length);
  const hash = held.indexOf("#");
  const path = hash === -1 ? held : held.slice(0, hash);
  if (!insideProject(path)) return undefined;
  const fragment = fragmentOf(hash === -1 ? "" : held.slice(hash + 1));
  return { path, ...(fragment === undefined ? {} : { fragment }) };
}

/** A fragment that is not a run of lines is a name. */
function fragmentOf(held: string): CodeAnchor["fragment"] {
  if (held === "") return undefined;
  const lines = LINES.exec(held);
  if (!lines) return { kind: "symbol", name: held };
  const from = Number(lines[1]);
  const to = lines[2] === undefined ? from : Number(lines[2]);
  return from >= 1 && to >= from
    ? { kind: "lines", from, to }
    : { kind: "symbol", name: held };
}

function insideProject(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** What tells one anchor from another, whichever href each was written as. */
function sameness(anchor: CodeAnchor): string {
  return JSON.stringify([anchor.path, anchor.fragment ?? null]);
}

/**
 * Every place in the code a section's document points at, in the order it names
 * them and without repeats.
 *
 * An anchor is an `href` like any other link's, which is a convention across
 * elements rather than a list of them — exactly as `citedNotes` in
 * `document.ts` reads a citation, so an element kind this build has no renderer
 * for is walked like any other and a link inside it still counts.
 */
export function anchorsOf(content: BlockDocument): CodeAnchor[] {
  const found = new Map<string, CodeAnchor>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    for (const [key, held] of Object.entries(value)) {
      if (key === "href") {
        const anchor =
          typeof held === "string" ? parseCodeAnchor(held) : undefined;
        if (anchor) found.set(sameness(anchor), anchor);
      } else {
        walk(held);
      }
    }
  };
  walk(content.content);
  return [...found.values()];
}
