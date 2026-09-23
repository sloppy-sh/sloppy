// `sloppy check`: every note in a container read, and what does not hold said
// once — docs/ARCHITECTURE.md § "Tooling and the review".

import { BIN_DIR, binAt, type Files, projectRootOf } from "@sloppy/local";
import {
  AddressSchema,
  anchorsOf,
  citedNotes,
  CommitIdSchema,
  PrincipalSchema,
  type OwnedRef,
  OwnedRefSchema,
  splitOwnedRef,
  TimestampSchema,
} from "@sloppy/types";
import {
  decodeText,
  type FrontValue,
  frontList,
  frontString,
  GRAPH_FILE,
  noteAt,
  notePath,
  NOTES_DIR,
  readGraphFile,
  splitNoteFile,
  VaultFormatError,
  vaultToNote,
} from "@sloppy/vault";

/**
 * What a defect is. `not-a-note` and `front-matter` are a file somebody's hand
 * has been in; `missing-note` and `missing-code` are a note pointing at
 * something that is not there.
 */
export const CHECK_DEFECTS = [
  "not-a-note",
  "front-matter",
  "missing-note",
  "missing-code",
] as const;
export type CheckDefectKind = (typeof CHECK_DEFECTS)[number];

export interface CheckDefect {
  kind: CheckDefectKind;
  /** The file it is in, as a path from the container. */
  file: string;
  /** The note it is in. Absent where the file does not say which note that is. */
  note?: OwnedRef;
  /** The line a person reads. */
  said: string;
}

export interface CheckResult {
  /** How many files in `notes/` read as notes. */
  notes: number;
  defects: CheckDefect[];
}

/** What a front matter field is held to, which is the schema the rest of
 *  Sloppy holds the same value to. */
interface Holds {
  safeParse(value: unknown): { success: boolean };
}

const FIELDS: readonly (readonly [string, Holds, string])[] = [
  ["parent", OwnedRefSchema, "`parent` doesn't name a note."],
  ["address", AddressSchema, "`address` isn't an address."],
  ["owner", PrincipalSchema, "`owner` doesn't name anybody."],
  ["created", TimestampSchema, "`created` isn't a time."],
  ["updated", TimestampSchema, "`updated` isn't a time."],
  ["checked", CommitIdSchema, "`checked` doesn't name a commit."],
];

const LISTS: readonly (readonly [string, Holds, string])[] = [
  ["aliases", AddressSchema, "isn't an address"],
  ["authors", PrincipalSchema, "doesn't name anybody"],
  ["contributors", PrincipalSchema, "doesn't name anybody"],
  ["links", OwnedRefSchema, "doesn't name a note"],
];

interface Read {
  file: string;
  ref: OwnedRef;
  cites: OwnedRef[];
  anchors: string[];
}

/**
 * The container read end to end: every note file parsed, every citation of a
 * note in this graph resolved, every anchor looked for in the project.
 *
 * A citation of a note in somebody ELSE'S graph is left alone — this folder is
 * not where that note lives, so its absence here says nothing. A note in the
 * bin is still there, so a citation of one resolves. A graph that is nobody's
 * project has nowhere to look for an anchor, and none is looked for.
 *
 * Throws {@link VaultFormatError} where the folder holds no graph this build
 * can read, which is the one thing that stops the check rather than failing it.
 */
export async function check(container: Files): Promise<CheckResult> {
  const bytes = await container.read(GRAPH_FILE);
  if (!bytes) throw new VaultFormatError("There is no graph in that folder.");
  const graph = readGraphFile(bytes);
  const project = projectRootOf(container, graph);

  const defects: CheckDefect[] = [];
  const here = new Set<string>();
  const read: Read[] = [];

  for (const path of (await container.list(NOTES_DIR)).sort()) {
    if (noteAt(path) === undefined) continue;
    const held = await container.read(path);
    if (!held) continue;
    const one = readNote(path, decodeText(held), defects);
    if (!one) continue;
    here.add(one.ref);
    read.push(one);
  }
  for (const path of await container.list(BIN_DIR)) {
    if (binAt(path) === undefined) continue;
    const held = await container.read(path);
    const ref = held && refOf(decodeText(held));
    if (ref) here.add(ref);
  }

  for (const note of read) {
    for (const cited of note.cites) {
      if (splitOwnedRef(cited).owner !== graph.owner || here.has(cited))
        continue;
      defects.push({
        kind: "missing-note",
        file: note.file,
        note: note.ref,
        said: `Points at a note this graph hasn't got: ${cited}`,
      });
    }
    if (project === undefined) continue;
    for (const path of note.anchors) {
      if (await project.exists(path)) continue;
      defects.push({
        kind: "missing-code",
        file: note.file,
        note: note.ref,
        said: `Points at code that isn't there: ${path}`,
      });
    }
  }
  return { notes: read.length, defects };
}

/** The note a file says it is, or absent where it says nothing readable. */
function refOf(markdown: string): OwnedRef | undefined {
  let front: ReadonlyMap<string, FrontValue>;
  try {
    front = splitNoteFile(markdown).front;
  } catch {
    return undefined;
  }
  const ref = OwnedRefSchema.safeParse(frontString(front, "ref"));
  return ref.success ? ref.data : undefined;
}

function readNote(
  file: string,
  markdown: string,
  defects: CheckDefect[],
): Read | undefined {
  let front: ReadonlyMap<string, FrontValue>;
  try {
    front = splitNoteFile(markdown).front;
  } catch {
    defects.push({ kind: "not-a-note", file, said: "This file isn't a note." });
    return undefined;
  }
  const held = OwnedRefSchema.safeParse(frontString(front, "ref"));
  if (!held.success) {
    defects.push({
      kind: "front-matter",
      file,
      said: "`ref` doesn't name a note, so nothing else here can be read.",
    });
    return undefined;
  }
  const ref = held.data;
  const wrong = (line: string): void => {
    defects.push({ kind: "front-matter", file, note: ref, said: line });
  };
  if (notePath(splitOwnedRef(ref).localId) !== file) {
    wrong("This file's name and the note in it disagree.");
  }
  for (const [key, holds, line] of FIELDS) {
    const said = frontString(front, key);
    if (said !== undefined && !holds.safeParse(said).success) wrong(line);
  }
  for (const [key, holds, line] of LISTS) {
    for (const said of frontList(front, key)) {
      if (!holds.safeParse(said).success) {
        wrong(`\`${key}\`: ${JSON.stringify(said)} ${line}.`);
      }
    }
  }

  const cites = new Set<OwnedRef>();
  const anchors = new Set<string>();
  const parent = OwnedRefSchema.safeParse(frontString(front, "parent"));
  if (parent.success) cites.add(parent.data);
  for (const link of frontList(front, "links")) {
    const named = OwnedRefSchema.safeParse(link);
    if (named.success) cites.add(named.data);
  }
  for (const section of vaultToNote({ markdown }).sections) {
    for (const cited of citedNotes(section.content)) cites.add(cited);
    for (const anchor of anchorsOf(section.content)) anchors.add(anchor.path);
  }
  return { file, ref, cites: [...cites], anchors: [...anchors] };
}
