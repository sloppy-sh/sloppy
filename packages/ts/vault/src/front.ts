// A note file's front matter: the note as the protocol holds it, in the one
// YAML shape a vault writes — docs/ARCHITECTURE.md § "A graph on disk".

import { VaultFormatError } from "./layout.js";

const FENCE = "---";
/** A scalar that needs no quoting: nothing in it can be read as YAML. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ._/:+@#-]*$/;

/** One field under a block. A number and a string are different values here,
 *  where at the top level everything is a string. */
export type FrontLeaf = string | number | readonly string[];

/** A field written as a block of its own, in the order its fields are given. */
export type FrontBlock = ReadonlyMap<string, FrontLeaf>;

export type FrontValue = string | string[] | FrontBlock;

/** Text that reads back as a number rather than as itself. */
const NUMERIC = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

function scalar(value: string): string {
  const plain =
    PLAIN.test(value) &&
    !value.endsWith(" ") &&
    !value.includes(": ") &&
    !value.includes(" #");
  return plain ? value : JSON.stringify(value);
}

/** A string inside a block, quoted where it would otherwise read back as the
 *  number it is spelt like. */
function leaf(value: string): string {
  const written = scalar(value);
  return written === value && NUMERIC.test(value)
    ? JSON.stringify(value)
    : written;
}

function readScalar(value: string): string {
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value) as string;
  } catch {
    return value;
  }
}

function readLeaf(value: string): string | number {
  return NUMERIC.test(value) ? Number(value) : readScalar(value);
}

function isBlock(value: FrontValue): value is FrontBlock {
  return value instanceof Map;
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
    if (isBlock(value)) {
      if (value.size === 0) continue;
      lines.push(`${key}:`);
      for (const [name, held] of value) lines.push(...blockLines(name, held));
      continue;
    }
    if (value.length === 0) continue;
    lines.push(`${key}:`);
    for (const held of value) lines.push(`  - ${scalar(held)}`);
  }
  lines.push(FENCE);
  return lines.join("\n");
}

function blockLines(name: string, held: FrontLeaf): string[] {
  if (typeof held === "number") return [`  ${name}: ${held}`];
  if (typeof held === "string") return [`  ${name}: ${leaf(held)}`];
  if (held.length === 0) return [];
  return [`  ${name}:`, ...held.map((one) => `    - ${leaf(one)}`)];
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

/** A field with nothing after its colon opens either a list or a block; which
 *  one it is, is what the first line under it says. */
function readFront(lines: readonly string[]): Map<string, FrontValue> {
  const front = new Map<string, FrontValue>();
  let opened: string | null = null;
  let list: string[] | null = null;
  let block: Map<string, FrontLeaf> | null = null;
  let inner: string[] | null = null;
  const close = (): void => {
    opened = null;
    list = null;
    block = null;
    inner = null;
  };
  for (const line of lines) {
    if (opened !== null) {
      const deep = /^ {4}- (.*)$/.exec(line);
      if (deep && inner) {
        inner.push(readScalar(deep[1]));
        continue;
      }
      const item = /^ {2}- (.*)$/.exec(line);
      if (item && !block) {
        if (!list) {
          list = [];
          front.set(opened, list);
        }
        list.push(readScalar(item[1]));
        continue;
      }
      const under = /^ {2}([A-Za-z0-9_]+):(?: (.*))?$/.exec(line);
      if (under && !list) {
        if (!block) {
          block = new Map();
          front.set(opened, block);
        }
        const said = under[2];
        if (said === undefined) {
          inner = [];
          block.set(under[1], inner);
        } else {
          inner = null;
          block.set(under[1], readLeaf(said));
        }
        continue;
      }
    }
    close();
    const field = /^([A-Za-z0-9_]+):(?: (.*))?$/.exec(line);
    if (!field) continue;
    if (field[2] === undefined) {
      opened = field[1];
      front.set(opened, []);
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

/** The fields under a block, for a caller that parses them into something. */
export function frontBlock(
  front: ReadonlyMap<string, FrontValue>,
  key: string,
): Record<string, FrontLeaf> | undefined {
  const held = front.get(key);
  return held !== undefined && isBlock(held)
    ? Object.fromEntries(held)
    : undefined;
}
