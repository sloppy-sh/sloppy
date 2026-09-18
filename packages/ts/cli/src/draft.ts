// `sloppy draft`: a note about one file, in as much detail as the file itself
// can be read for — docs/ARCHITECTURE.md § "Tooling and the review".
//
// What a compass might hold is written as CANDIDATES in the note's own writing.
// The compass stays empty: which of them is really what this is part of is a
// reading, and a reading is the person's.

import { type Files, LocalApi } from "@sloppy/local";
import type { BlockDocument, DocumentNode, OwnedRef } from "@sloppy/types";
import { decodeText } from "@sloppy/vault";
import { noteForProject, noteReaching, notesIn } from "./folder.js";
import { PROJECT_TAG, WALKTHROUGH_TAG } from "./init.js";
import { type ModuleFacts, readModule } from "./modules.js";
import { type ProjectPart, projectParts } from "./tree.js";
import { fileOf, type WrittenNote, writeNote, writeOnto } from "./writer.js";
import {
  anchor,
  bullets,
  cites,
  diagram,
  paragraph,
  section,
  text,
} from "./writing.js";

/** How many names a drawing carries before it stops being one. The whole list
 *  is in the note under it either way. */
const MOST_DRAWN = 12;

/** What an import of a file beside this one may leave off. */
const ENDINGS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** A note written about one file, and which file it was. */
export interface DraftedNote extends WrittenNote {
  /** From the project root. */
  path: string;
}

export interface DraftResult {
  notes: DraftedNote[];
  /** A path nothing could be written about, and what to do about it. */
  missed: { path: string; said: string }[];
}

export interface DraftAsked {
  container: Files;
  project: Files;
  api: LocalApi;
  /** The files to write about, as paths from the project root. */
  paths: readonly string[];
}

export async function draft(asked: DraftAsked): Promise<DraftResult> {
  const notes = await notesIn(asked.container);
  // A way INTO a part of the project points at its openings, and is not the
  // note about the file it opens at: a detailed note about that file goes
  // under it rather than into it.
  const about: Cited[] = notes
    .filter(
      (held) =>
        !held.note.tags.includes(WALKTHROUGH_TAG) &&
        !held.note.tags.includes(PROJECT_TAG),
    )
    .map((held) => ({
      ref: held.note.ref,
      title: held.note.title,
      anchors: held.anchors,
    }));
  const parts = await projectParts(asked.project);
  const top = noteForProject(notes, PROJECT_TAG);
  const written: DraftedNote[] = [];
  const missed: DraftResult["missed"] = [];
  for (const path of asked.paths) {
    const bytes = await asked.project.read(path);
    if (!bytes) {
      missed.push({
        path,
        said: (await asked.project.exists(path))
          ? "That is a folder. Name the files in it."
          : "There is no such file in this project.",
      });
      continue;
    }
    const facts = readModule(path, decodeText(bytes));
    const within = partOf(parts, path);
    const above = within ? noteReaching(notes, within.path) : undefined;
    const sections = draftSections(path, facts, {
      ...(above
        ? { partOf: { ref: above.note.ref, title: above.note.title } }
        : {}),
      madeOf: madeOf(about, path, facts),
    });
    const standing = about.find((one) => one.anchors.includes(path));
    if (standing) {
      const held = await asked.api.getNode(standing.ref);
      if (!held) {
        missed.push({ path, said: "The note about it is not here any more." });
        continue;
      }
      written.push({ ...(await writeOnto(asked.api, held, sections)), path });
      continue;
    }
    const under = above?.note.ref ?? top;
    const note = await writeNote(asked.api, {
      from:
        under === undefined
          ? { relation: "free" }
          : { relation: "under", note: under },
      title: path,
      sections,
    });
    // A file written about in this same run is a candidate for the next one.
    about.push({ ref: note.ref, title: note.title, anchors: [path] });
    written.push({
      path,
      title: note.title,
      file: fileOf(note.ref),
      offered: false,
    });
  }
  return { notes: written, missed };
}

/** A note as a citation of it is written: the ref it holds, and the title a
 *  reader without that note sees. */
interface Cited {
  ref: OwnedRef;
  title: string;
  anchors: readonly string[];
}

interface Candidates {
  /** The note about the part of the project this file is in. */
  partOf?: Omit<Cited, "anchors">;
  /** The notes about the files it reaches for. */
  madeOf: Omit<Cited, "anchors">[];
}

function draftSections(
  path: string,
  facts: ModuleFacts,
  candidates: Candidates,
): BlockDocument[] {
  const drawn = drawing(path, facts);
  const sections = [
    section(
      "The file",
      paragraph(anchor(path, { path })),
      ...(drawn === undefined ? [] : [diagram(drawn)]),
    ),
  ];
  if (facts.read) sections.push(exported(path, facts));
  const offered = candidateBullets(candidates);
  if (offered) sections.push(section("Candidates", offered));
  return sections;
}

function exported(path: string, facts: ModuleFacts): BlockDocument {
  if (facts.exports.length === 0) {
    return section(
      "What it exports",
      paragraph(text("Nothing. Everything in it is its own.")),
    );
  }
  return section(
    "What it exports",
    bullets(
      facts.exports.map((name) => [
        anchor(name, { path, fragment: { kind: "symbol", name } }),
      ]),
    ),
  );
}

/** What a compass on this note might hold, said as the words a person reads
 *  beside those slots — and left for them to move there. */
function candidateBullets(candidates: Candidates): DocumentNode | undefined {
  const items: DocumentNode[][] = [];
  const held = candidates.partOf;
  if (held) items.push([text("Part of — "), cites(held.ref, held.title)]);
  for (const note of candidates.madeOf) {
    items.push([text("Made of — "), cites(note.ref, note.title)]);
  }
  return items.length === 0 ? undefined : bullets(items);
}

function drawing(path: string, facts: ModuleFacts): string | undefined {
  if (!facts.read) return undefined;
  if (facts.imports.length === 0 && facts.exports.length === 0)
    return undefined;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lines = ["flowchart LR", `  file[${label(name)}]`];
  facts.imports.slice(0, MOST_DRAWN).forEach((held, at) => {
    lines.push(`  in${at}[${label(held)}] --> file`);
  });
  facts.exports.slice(0, MOST_DRAWN).forEach((held, at) => {
    lines.push(`  file --> out${at}[${label(held)}]`);
  });
  return lines.join("\n");
}

/** A drawing carries its labels as its own source, so a quote in one would end
 *  the label early. */
function label(said: string): string {
  return `"${said.replaceAll('"', "'")}"`;
}

/** The notes about the files this one reaches for, without repeats. A name
 *  that is not a file beside this one is a package, and this project has
 *  nothing to point at for it. */
function madeOf(
  notes: readonly Cited[],
  path: string,
  facts: ModuleFacts,
): Omit<Cited, "anchors">[] {
  const about = (one: string): Cited | undefined =>
    notes.find((held) => held.anchors.includes(one));
  const found: Omit<Cited, "anchors">[] = [];
  for (const held of facts.imports) {
    if (!held.startsWith(".")) continue;
    const at = beside(path, held);
    const named =
      at === undefined
        ? undefined
        : fileNamed(at, (one) => about(one) !== undefined);
    const note = named === undefined ? undefined : about(named);
    if (note && !found.some((one) => one.ref === note.ref)) {
      found.push({ ref: note.ref, title: note.title });
    }
  }
  return found;
}

/** Where an import of a file beside this one lands, as a path from the project
 *  root. Absent where it climbs out of the project. */
function beside(path: string, said: string): string | undefined {
  const held = path.split("/").slice(0, -1);
  for (const segment of said.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      held.push(segment);
      continue;
    }
    if (held.length === 0) return undefined;
    held.pop();
  }
  return held.join("/");
}

/** The declared part or top-level folder a file is in. */
function partOf(
  parts: readonly ProjectPart[],
  path: string,
): ProjectPart | undefined {
  let found: ProjectPart | undefined;
  for (const part of parts) {
    if (!path.startsWith(`${part.path}/`)) continue;
    if (found === undefined || part.path.length > found.path.length) {
      found = part;
    }
  }
  return found;
}

/** The file an import names, as this project spells it: a specifier ending
 *  `.js` is how a TypeScript module names the file beside it. */
export function fileNamed(
  said: string,
  has: (path: string) => boolean,
): string | undefined {
  if (has(said)) return said;
  const dot = said.lastIndexOf(".");
  const stem = dot > said.lastIndexOf("/") ? said.slice(0, dot) : said;
  for (const ending of ENDINGS) {
    if (has(`${stem}${ending}`)) return `${stem}${ending}`;
    if (has(`${stem}/index${ending}`)) return `${stem}/index${ending}`;
  }
  return undefined;
}
