// A note file's front matter: the note as the protocol holds it, in the one
// YAML shape a vault writes — docs/ARCHITECTURE.md § "A graph on disk".

import { VaultFormatError } from "./layout.js";

const FENCE = "---";
/** A scalar that needs no quoting: nothing in it can be read as YAML. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ._/:+@#-]*$/;

export type FrontValue = string | string[];

function scalar(value: string): string {
  const plain =
    PLAIN.test(value) &&
    !value.endsWith(" ") &&
    !value.includes(": ") &&
    !value.includes(" #");
  return plain ? value : JSON.stringify(value);
}

function readScalar(value: string): string {
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value) as string;
  } catch {
    return value;
  }
}

/** The fenced block, in the order the fields are given. A field with nothing in
 *  it is left out, which is what its absence means when it is read back. */
export function writeFront(
  fields: readonly (readonly [string, FrontValue | undefined])[],
): string {
  const lines = [FENCE];
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      lines.push(`${key}: ${scalar(value)}`);
      continue;
    }
    if (value.length === 0) continue;
    lines.push(`${key}:`);
    for (const held of value) lines.push(`  - ${scalar(held)}`);
  }
  lines.push(FENCE);
  return lines.join("\n");
}

export interface NoteFile {
  front: Map<string, FrontValue>;
  /** The front matter as it stands, so a rewrite of one field leaves the rest
   *  of the file's bytes alone. */
  frontLines: string[];
  body: string[];
}

export function splitNoteFile(text: string): NoteFile {
  const lines = text.split("\n");
  if (lines[0] !== FENCE) {
    throw new VaultFormatError("This file isn't a note.");
  }
  const closes = lines.indexOf(FENCE, 1);
  if (closes === -1) {
    throw new VaultFormatError("This file isn't a note.");
  }
  const frontLines = lines.slice(1, closes);
  return {
    front: readFront(frontLines),
    frontLines,
    body: lines.slice(closes + 1),
  };
}

function readFront(lines: readonly string[]): Map<string, FrontValue> {
  const front = new Map<string, FrontValue>();
  let list: string[] | null = null;
  for (const line of lines) {
    const item = /^ {2}- (.*)$/.exec(line);
    if (item && list) {
      list.push(readScalar(item[1]));
      continue;
    }
    list = null;
    const field = /^([A-Za-z0-9_]+):(?: (.*))?$/.exec(line);
    if (!field) continue;
    if (field[2] === undefined) {
      list = [];
      front.set(field[1], list);
      continue;
    }
    front.set(field[1], readScalar(field[2]));
  }
  return front;
}

export function frontString(
  front: ReadonlyMap<string, FrontValue>,
  key: string,
): string | undefined {
  const held = front.get(key);
  return typeof held === "string" ? held : undefined;
}

export function frontList(
  front: ReadonlyMap<string, FrontValue>,
  key: string,
): string[] {
  const held = front.get(key);
  return Array.isArray(held) ? held : [];
}
