// `sloppy init`: the notes started in a project, and what the tree can be read
// for written into them — docs/ARCHITECTURE.md § "Tooling and the review".
//
// Facts only. What a part of the project is FOR, what was chosen instead of it
// and why are the person's to write, and nothing here writes a word of them.

import {
  BIN_DIR,
  BIN_FILE,
  containerOf,
  CREDENTIALS_FILE,
  type Files,
  GIT_DEFAULTS_FILE,
  holdDeviceIdentity,
  IDENTITIES_FILE,
  IDENTITY_FILE,
  LocalApi,
  readCarriedIdentity,
  VAULTS_FILE,
  keepOut,
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

/** Where an agent working in this project finds how to write in it. */
export const AGENT_FILE = "AGENT.md";

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
  const openings = await projectOpenings(project);
  if (parts.length === 0 && openings.length === 0) {
    return { started, notes: [] };
  }
  const notes = await notesIn(container);
  const written: WrittenNote[] = [];
  const top = await forProject(
    api,
    notes,
    (await projectName(project)) ?? graph.title,
    { parts: parts.map((part) => part.path), openings, written },
  );
  for (const part of parts) {
    if (reaches(notes, part.path)) continue;
    const note = await writeNote(api, {
      from: { relation: "under", note: top },
      title: part.name,
      sections: partSections(part, top),
    });
    written.push({
      title: note.title,
      file: fileOf(note.ref),
      done: "written",
    });
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
  asked: {
    parts: readonly string[];
    openings: readonly string[];
    written: WrittenNote[];
  },
): Promise<OwnedRef> {
  const held = noteForProject(notes, asked);
  if (held) return held;
  const note = await writeNote(api, {
    from: { relation: "free" },
    title,
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
    done: "written",
  });
  return note.ref;
}

/** A way into one part: what it is part of, where it is, and where somebody
 *  starts reading it. */
function partSections(part: ProjectPart, top: OwnedRef): BlockDocument[] {
  const openings = part.entries.filter((at) => at !== part.path);
  return [
    { type: "doc", content: [compass({ north: [top] })] },
    section("The folder", paragraph(anchor(part.path, { path: part.path }))),
    ...(openings.length === 0
      ? []
      : [
          section(
            "Start here",
            bullets(
              openings.map((at) => [
                anchor(at.slice(part.path.length + 1), { path: at }),
              ]),
            ),
          ),
        ]),
  ];
}
