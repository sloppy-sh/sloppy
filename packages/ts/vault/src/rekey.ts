// Moving a graph into another identity — docs/ARCHITECTURE.md § "A graph on
// disk". The ULID half of every ref is kept, which is what makes a second
// import a replace rather than a copy of everything.

import { type DidSyr } from "@sloppy/types";
import { splitNoteFile } from "./front.js";
import {
  amendmentAt,
  decodeText,
  encodeText,
  GRAPH_FILE,
  graphFile,
  noteAt,
  readGraphFile,
  type Vault,
} from "./layout.js";
import { rekeyMarkdown } from "./markdown.js";

/**
 * The same vault under another identity: the owner, every note's own ref, its
 * parent, its links, every reference in its writing, and the note an offered
 * change amends. The aliases ride the note, so its ref carries them.
 *
 * **Whose writing a note carries is a PERSON and is never moved** — `authors`,
 * `contributors` and an offer's `by` are what somebody wrote, and carrying a
 * graph somewhere else does not rewrite that. A note's `owner` is a gate rather
 * than writing, and the graph owner's gate moves with the graph exactly as
 * `graph.json`'s owner does, so a person's own graph comes back writable.
 * Somebody else's gate stays theirs.
 *
 * A file this cannot read is carried through untouched rather than dropped.
 */
export function rekey(vault: Vault, from: DidSyr, to: DidSyr): Vault {
  const moved: Vault = new Map();
  for (const [path, bytes] of vault) {
    if (path === GRAPH_FILE) {
      moved.set(path, rekeyGraph(bytes, from, to));
      continue;
    }
    const keyed = noteAt(path) !== undefined || amendmentAt(path) !== undefined;
    moved.set(path, keyed ? rekeyRefs(bytes, from, to) : bytes);
  }
  return moved;
}

function rekeyGraph(bytes: Uint8Array, from: DidSyr, to: DidSyr): Uint8Array {
  try {
    const graph = readGraphFile(bytes);
    return graph.owner === from ? graphFile({ ...graph, owner: to }) : bytes;
  } catch {
    return bytes;
  }
}

const REF_FIELD = /^((?:ref|parent|amends): | {2}- )/;
const GATE_FIELD = "owner: ";

function rekeyRefs(bytes: Uint8Array, from: DidSyr, to: DidSyr): Uint8Array {
  const text = decodeText(bytes);
  let note: ReturnType<typeof splitNoteFile>;
  try {
    note = splitNoteFile(text);
  } catch {
    return bytes;
  }
  const front = note.frontLines.map((line) => {
    if (line === `${GATE_FIELD}${from}`) return `${GATE_FIELD}${to}`;
    const field = REF_FIELD.exec(line);
    if (!field || !line.startsWith(`${from}/`, field[0].length)) return line;
    return `${field[0]}${to}/${line.slice(field[0].length + from.length + 1)}`;
  });
  const body = rekeyMarkdown(note.body.join("\n"), from, to).split("\n");
  return encodeText(["---", ...front, "---", ...body].join("\n"));
}
