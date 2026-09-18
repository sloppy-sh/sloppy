// `sloppy init`: the notes started in a project, and what the tree can be read
// for written into them — docs/ARCHITECTURE.md § "Tooling and the review".
//
// Facts only. What a part of the project is FOR, what was chosen instead of it
// and why are the person's to write, and nothing here writes a word of them.

import {
  containerOf,
  type Files,
  holdDeviceIdentity,
  LocalApi,
  readCarriedIdentity,
} from "@sloppy/local";
import type { BlockDocument, OwnedRef } from "@sloppy/types";
import { decodeText, encodeText, GRAPH_FILE } from "@sloppy/vault";
import { AGENT_MD } from "./agent-md.js";
import { type HeldNote, noteForProject, notesIn, reaches } from "./folder.js";
import {
  type ProjectPart,
  projectName,
  projectOpenings,
  projectParts,
} from "./tree.js";
import { fileOf, type WrittenNote, writeNote } from "./writer.js";
import { anchor, bullets, compass, paragraph, section } from "./writing.js";

/** What marks the note a project's own writing starts at, and what marks a way
 *  into one part of it. */
export const PROJECT_TAG = "project";
export const WALKTHROUGH_TAG = "walkthrough";

/** Where an agent working in this project finds how to write in it. */
export const AGENT_FILE = "AGENT.md";

/**
 * What this device keeps to itself, as the project's history is told to pass
 * over it. The container sits inside somebody's repository, so the identity
 * the CLI writes under lands in a folder that is about to be committed unless
 * the ignore is there first — and a key committed is a key pushed.
 */
const KEPT_OUT = [
  "/.sloppy/identities.json",
  "/.sloppy/identity.json",
  "/.sloppy/*.key",
  "/.sloppy/*.key.pub",
  "/.sloppy/vaults.json",
  "/.sloppy/git.json",
  "/.sloppy/credentials.json",
  "/.sloppy/signing-in.json",
  "/.sloppy/bin.json",
  "/.sloppy/bin/",
  "sloppy-identity",
  "sloppy-identity*.json",
];

const IGNORE_FILE = ".gitignore";

export interface InitResult {
  /** Whether the notes were started here, rather than already being here. */
  started: boolean;
  /** What was written, in the order it was written. */
  notes: WrittenNote[];
}

/** A folder `init` will not work in, said in words fit to show somebody. */
export class InitRefused extends Error {}

export interface InitAsked {
  /** The project's own root folder. */
  files: Files;
  /** The same folder, as this device spells it. */
  root: string;
  /** An identity carried here from another device, to write under instead of
   *  one made for this project. */
  identity?: Uint8Array;
}

export async function init(asked: InitAsked): Promise<InitResult> {
  const { files, root } = asked;
  if (await files.exists(GRAPH_FILE)) {
    throw new InitRefused(
      "That folder is already a graph of its own. Run this in the project the notes are about.",
    );
  }
  if (asked.identity) {
    await holdDeviceIdentity(files, readCarriedIdentity(asked.identity));
  }
  const started = (await containerOf(files)) === undefined;
  const api = new LocalApi(files);
  const graph = await api.openProject(root);
  // A container is owned, so a note the person writes is theirs and a machine
  // changes it by offering — docs/ARCHITECTURE.md § "Tooling and the review".
  // A container that was already here keeps whatever it was set to.
  if (started) {
    await api.updateGraph(graph.ref, {
      title: graph.title,
      ownership: "owned",
    });
  }

  const container = await containerOf(files);
  const project = await api.projectFolder(graph.ref);
  if (!container || !project) {
    throw new InitRefused("These notes are not about any code.");
  }
  await keepOut(container);
  if (!(await container.exists(AGENT_FILE))) {
    await container.write(AGENT_FILE, encodeText(AGENT_MD));
  }

  const parts = await projectParts(project);
  const notes = await notesIn(container);
  const written: WrittenNote[] = [];
  const top = await forProject(
    api,
    notes,
    (await projectName(project)) ?? graph.title,
    {
      openings: await projectOpenings(project),
      written,
    },
  );
  for (const part of parts) {
    if (reaches(notes, part.path)) continue;
    const note = await writeNote(api, {
      from: { relation: "under", note: top },
      title: part.name,
      tags: [WALKTHROUGH_TAG],
      sections: partSections(part, top),
    });
    written.push({ title: note.title, file: fileOf(note.ref), offered: false });
  }
  return { started, notes: written };
}

/**
 * The note the project's own writing starts at, written where there is none.
 * It points at the files at the TOP of the project and never at a part: every
 * part is a note of its own under this one, and an anchor here would stand in
 * for the note that part has not got yet.
 */
async function forProject(
  api: LocalApi,
  notes: readonly HeldNote[],
  title: string,
  asked: { openings: readonly string[]; written: WrittenNote[] },
): Promise<OwnedRef> {
  const held = noteForProject(notes, PROJECT_TAG);
  if (held) return held;
  const note = await writeNote(api, {
    from: { relation: "free" },
    title,
    tags: [PROJECT_TAG],
    sections: [
      section(
        "Start here",
        asked.openings.length === 0
          ? paragraph()
          : bullets(asked.openings.map((at) => [anchor(at, { path: at })])),
      ),
    ],
  });
  asked.written.push({
    title: note.title,
    file: fileOf(note.ref),
    offered: false,
  });
  return note.ref;
}

/** A way into one part: what it is part of, and where somebody starts reading
 *  it. */
function partSections(part: ProjectPart, top: OwnedRef): BlockDocument[] {
  return [
    { type: "doc", content: [compass({ north: [top] })] },
    section(
      "Start here",
      bullets(
        part.entries.map((at) => [anchor(shortly(part, at), { path: at })]),
      ),
    ),
  ];
}

/** An opening under the part it is in, said as the part's own reader would say
 *  it. */
function shortly(part: ProjectPart, at: string): string {
  return at === part.path ? at : at.slice(part.path.length + 1);
}

/** The project's history told to pass over what is this device's alone. A file
 *  somebody wrote themselves stays theirs: the lines that are not there are
 *  added, and nothing already in it is touched. */
async function keepOut(container: Files): Promise<void> {
  const bytes = await container.read(IGNORE_FILE);
  const held = bytes ? decodeText(bytes) : "";
  const lines = held.split("\n").map((line) => line.trim());
  const missing = KEPT_OUT.filter((line) => !lines.includes(line));
  if (missing.length === 0) return;
  const before = held === "" || held.endsWith("\n") ? held : `${held}\n`;
  await container.write(
    IGNORE_FILE,
    encodeText(`${before}${missing.join("\n")}\n`),
  );
}
