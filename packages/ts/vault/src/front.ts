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

/** A field written as a list of blocks — one entry per group of lines, each
 *  entry's first field on the `-` line. The entries keep the order given. */
export type FrontEntries = readonly FrontBlock[];

/** One item of a list, held as it was typed and — where it opens `name: value`
 *  — as the fields under its dash. Both readings stand until a caller takes
 *  one, so what one item is read as costs the items beside it nothing. */
export interface FrontItem {
  plain: string;
  fields?: FrontBlock;
}

/** What a field is written as. */
export type FrontWritten = string | string[] | FrontBlock | FrontEntries;

/** What a field reads back as. */
export type FrontValue = string | FrontBlock | readonly FrontItem[];

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

function isBlock(value: FrontValue | FrontWritten): value is FrontBlock {
  return value instanceof Map;
}

function isEntries(value: FrontWritten): value is FrontEntries {
  return Array.isArray(value) && value.every(isBlock);
}

/** The fenced block, in the order the fields are given. A field with nothing in
 *  it is left out, which is what its absence means when it is read back. */
export function writeFront(
  fields: readonly (readonly [string, FrontWritten | undefined])[],
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
    if (isEntries(value)) {
      const written = value.flatMap(entryLines);
      if (written.length === 0) continue;
      lines.push(`${key}:`, ...written);
      continue;
    }
    lines.push(`${key}:`);
    for (const held of value as readonly string[]) {
      lines.push(`  - ${scalar(held)}`);
    }
  }
  lines.push(FENCE);
  return lines.join("\n");
}

/** One entry of a list of blocks: its first field opens the entry beside the
 *  dash and the rest sit under it. An entry with nothing in it writes nothing. */
function entryLines(entry: FrontBlock): string[] {
  const lines: string[] = [];
  for (const [name, held] of entry) {
    const written = typeof held === "number" ? `${held}` : leaf(String(held));
    lines.push(
      lines.length === 0
        ? `  - ${name}: ${written}`
        : `    ${name}: ${written}`,
    );
  }
  return lines;
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
  let block: Map<string, FrontLeaf> | null = null;
  let inner: string[] | null = null;
  let items: FrontItem[] | null = null;
  let fields: Map<string, FrontLeaf> | null = null;
  const close = (): void => {
    opened = null;
    block = null;
    inner = null;
    items = null;
    fields = null;
  };
  for (const line of lines) {
    if (opened !== null) {
      const deep = /^ {4}- (.*)$/.exec(line);
      if (deep && inner) {
        inner.push(readScalar(deep[1]));
        continue;
      }
      const within = /^ {4}([A-Za-z0-9_]+): (.*)$/.exec(line);
      if (within && fields) {
        fields.set(within[1], readLeaf(within[2]));
        continue;
      }
      const item = /^ {2}- (.*)$/.exec(line);
      if (item && !block) {
        if (!items) {
          items = [];
          front.set(opened, items);
        }
        const opens = /^([A-Za-z0-9_]+): (.*)$/.exec(item[1]);
        fields = opens ? new Map([[opens[1], readLeaf(opens[2])]]) : null;
        items.push({
          plain: readScalar(item[1]),
          ...(fields ? { fields } : {}),
        });
        continue;
      }
      const field = /^ {2}([A-Za-z0-9_]+):(?: (.*))?$/.exec(line);
      if (field && !items) {
        if (!block) {
          block = new Map();
          front.set(opened, block);
        }
        const said = field[2];
        if (said === undefined) {
          inner = [];
          block.set(field[1], inner);
        } else {
          inner = null;
          block.set(field[1], readLeaf(said));
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

function itemsOf(held: FrontValue | undefined): readonly FrontItem[] {
  return typeof held === "object" && !isBlock(held) ? held : [];
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
  return itemsOf(front.get(key)).map((item) => item.plain);
}

/** The `name: value` groups under a list, for a caller that parses each one
 *  into something. An item that opens no field is not one of them. */
export function frontEntries(
  front: ReadonlyMap<string, FrontValue>,
  key: string,
): Record<string, FrontLeaf>[] {
  return itemsOf(front.get(key)).flatMap((item) =>
    item.fields ? [Object.fromEntries(item.fields)] : [],
  );
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
