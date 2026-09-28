// An anchor from a note into the code it is about, carried as an ordinary link
// — docs/ARCHITECTURE.md § "A project's container".

import { z } from "zod";
import type { BlockDocument } from "./document.js";

/** What a link holds to point at code rather than at a page. */
export const CODE_SCHEME = "code:";

/**
 * Where in a project a note is pointing. `path` is from the PROJECT root and
 * is spelled with `/`; an absent `fragment` is the whole file, and a `symbol`
 * is a name to find by searching that file.
 */
export interface CodeAnchor {
  path: string;
  fragment?:
    | { kind: "lines"; from: number; to: number }
    | { kind: "symbol"; name: string };
}

const LINES = /^L(\d+)(?:-L(\d+))?$/;

/** The anchor an href holds, or absent where it is not one — which a path
 *  climbing out of the project, or starting at the top of a disk, is not. */
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

/** A control or format character makes a path that shows one thing and names
 *  another, and a newline in one makes a second line wherever it is read. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

/** A path reaches programs, and every one of them reads a leading dash as an
 *  option rather than as a name. */
function readsAsOption(segment: string): boolean {
  return segment.startsWith("-");
}

/**
 * Whether a path names somewhere inside the project: said from its root, with
 * `/`, and climbing out of it nowhere. An anchor holds one, and so does a place
 * somebody asks for notes about — and both are handed on, so a path that would
 * read as an option, or that hides what it says, is refused here rather than
 * wherever it lands.
 */
export function insideProject(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (INVISIBLE.test(path)) return false;
  return path
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !readsAsOption(segment),
    );
}

/** Longer than any path a project holds, and short enough that a place is one
 *  line wherever it is shown. */
export const PROJECT_PATH_MAX = 1024;

/**
 * Somewhere in the project. A path can arrive from a tool reading somebody's
 * repository rather than from a person typing, so what one may hold is settled
 * where both ends of a seam parse it: inside the project, nothing that reads as
 * an option to a program, nothing invisible ({@link insideProject}), and
 * bounded.
 */
export const ProjectPathSchema = z
  .string()
  .max(
    PROJECT_PATH_MAX,
    `A place's path is at most ${PROJECT_PATH_MAX} characters.`,
  )
  .refine(insideProject, "That place is outside this project.");

function sameness(anchor: CodeAnchor): string {
  return JSON.stringify([anchor.path, anchor.fragment ?? null]);
}

/** Every place in the code a section's document points at, in the order it
 *  names them and without repeats — read off every `href` in it, the way
 *  `citedNotes` in `document.ts` reads a citation. */
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

/** What this build spells a digest of a file's bytes with. A second algorithm
 *  is a second entry in {@link DIGEST_HEX_LENGTH}, never a second field. */
export const CODE_DIGEST_ALGORITHM = "sha256";

/** How long each algorithm's hex is. One this build does not know is held to
 *  the shape alone, so a reading written by a later one arrives intact. */
const DIGEST_HEX_LENGTH: Readonly<Record<string, number>> = {
  [CODE_DIGEST_ALGORITHM]: 64,
};

const DIGEST = /^([a-z0-9-]{1,32}):([0-9a-f]{16,128})$/;

/**
 * Whether a digest is spelled the way the algorithm it names spells one. The
 * algorithm is written down so that a reading this build cannot reproduce is
 * carried untouched and read as UNREAD rather than as drift: saying a file has
 * moved because a spelling changed is worse than saying nothing.
 */
export function digestIsSpelled(digest: string): boolean {
  const said = DIGEST.exec(digest);
  if (!said) return false;
  const hex = DIGEST_HEX_LENGTH[said[1]];
  return hex === undefined || said[2].length === hex;
}

/** A digest of a file's bytes: the algorithm that produced it, a colon, and
 *  lowercase hex. */
export const CodeDigestSchema = z
  .string()
  .refine(digestIsSpelled, "Sloppy is out of date. Update it and try again.");

/**
 * One file as it stood when somebody last read a note against it: where it is
 * in the project, and a digest of its bytes. Only a person writes one —
 * docs/ARCHITECTURE.md § "A project's container".
 */
export const CodeReadingSchema = z.object({
  path: ProjectPathSchema,
  digest: CodeDigestSchema,
});
export type CodeReading = z.infer<typeof CodeReadingSchema>;

/**
 * The readings a reader takes off a list: one per path, the first of two
 * naming a path winning, in path order rather than the order they were
 * written — so two notes read against the same files hold byte-identical
 * lists, which is what keeps a file's round trip stable.
 */
export function readingsRead(readings: readonly CodeReading[]): CodeReading[] {
  const byPath = new Map<string, CodeReading>();
  for (const reading of readings) {
    if (!byPath.has(reading.path)) byPath.set(reading.path, reading);
  }
  // Codepoint order, never a locale's: two peers must sort one list one way.
  return [...byPath.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/** What a note was read against, held to {@link readingsRead} on the way in
 *  and on the way out. */
export const CodeReadingsSchema = z
  .array(CodeReadingSchema)
  .transform(readingsRead);
