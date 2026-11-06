// What a file in the project defines, found line by line — docs/ARCHITECTURE.md
// § "An assistant outside the app". A reading, not a parse: a definition the
// patterns miss is a file found by its path alone.

import type { CodeKind } from "@sloppy/types";

/** One thing a file defines, and the lines it runs over, from 1. */
export interface CodeSymbol {
  name: string;
  kind: Exclude<CodeKind, "file">;
  from: number;
  to: number;
}

type Kind = CodeSymbol["kind"];

/** A pattern for one line, with the group holding the name. `indented` is the
 *  kind the same line takes inside another definition. */
interface Rule {
  test: RegExp;
  kind: Kind;
  indented?: Kind;
  /** A line this rule would otherwise read as a definition and is not one. */
  not?: RegExp;
  /** Reads a name before `(`, where a keyword can stand: a call, not a definition. */
  callShaped?: boolean;
}

const NOT_NAMES = new Set(
  "if else for while switch catch return new throw typeof await yield do try finally with function delete void case default sizeof elif except lambda super this self unless until begin rescue ensure when then".split(
    " ",
  ),
);

const TS: Rule[] = [
  {
    test: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: "function",
  },
  {
    test: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: "class",
  },
  {
    test: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
    kind: "interface",
  },
  {
    test: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<.*>)?\s*=/,
    kind: "type",
  },
  {
    test: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
    kind: "enum",
  },
  {
    test: /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>)/,
    kind: "function",
  },
  {
    test: /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    kind: "constant",
  },
  {
    test: /^\s+(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;=]+)?\{(?:\s*$|.*\}\s*;?\s*$)/,
    kind: "method",
    not: /\bfunction\b|=>/,
    callShaped: true,
  },
];

const GO: Rule[] = [
  { test: /^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, kind: "method" },
  { test: /^func\s+([A-Za-z_]\w*)/, kind: "function" },
  { test: /^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+struct\b/, kind: "struct" },
  {
    test: /^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+interface\b/,
    kind: "interface",
  },
  { test: /^type\s+([A-Za-z_]\w*)\b/, kind: "type" },
  { test: /^(?:const|var)\s+([A-Za-z_]\w*)\b/, kind: "constant" },
];

const RUST: Rule[] = [
  {
    test: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/,
    kind: "function",
    indented: "method",
  },
  {
    test: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/,
    kind: "struct",
  },
  { test: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum" },
  {
    test: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)/,
    kind: "trait",
  },
  { test: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, kind: "type" },
  { test: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, kind: "module" },
  {
    test: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([A-Za-z_]\w*)\s*:/,
    kind: "constant",
  },
  { test: /^\s*macro_rules!\s*([A-Za-z_]\w*)/, kind: "function" },
];

const JAVA_MODIFIERS =
  "(?:(?:public|private|protected|internal|static|final|abstract|sealed|non-sealed|open|override|data|inline|suspend|synchronized|native|default|virtual|async|partial|readonly|unsafe|extern|new)\\s+)*";

const JAVA: Rule[] = [
  {
    test: new RegExp(
      `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*${JAVA_MODIFIERS}(?:class|record|object)\\s+([A-Za-z_]\\w*)`,
    ),
    kind: "class",
  },
  {
    test: new RegExp(
      `^\\s*${JAVA_MODIFIERS}(?:interface|@interface)\\s+([A-Za-z_]\\w*)`,
    ),
    kind: "interface",
  },
  {
    test: new RegExp(
      `^\\s*${JAVA_MODIFIERS}enum(?:\\s+class)?\\s+([A-Za-z_]\\w*)`,
    ),
    kind: "enum",
  },
  {
    test: new RegExp(
      `^\\s*${JAVA_MODIFIERS}fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?([A-Za-z_]\\w*)\\s*\\(`,
    ),
    kind: "function",
    indented: "method",
  },
  {
    test: new RegExp(
      `^\\s+${JAVA_MODIFIERS}(?:<[^>]+>\\s+)?[A-Za-z_][\\w.<>\\[\\],? ]*[\\w>\\]]\\s+([A-Za-z_]\\w*)\\s*\\([^;]*$`,
    ),
    kind: "method",
    not: /^\s*(?:return|new|throw|else|case|await|yield|package|import)\b/,
    callShaped: true,
  },
  {
    test: /^\s+(?:(?:public|private|protected)\s+)?static\s+final\s+[\w.<>[\], ]+\s+([A-Z][A-Z0-9_]*)\s*=/,
    kind: "constant",
  },
];

const PYTHON: Rule[] = [
  {
    test: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    kind: "function",
    indented: "method",
  },
  { test: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
  { test: /^([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/, kind: "constant" },
];

const RUBY: Rule[] = [
  {
    test: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?|\[\]=?|[+\-*/%<>=!~^&|]+)/,
    kind: "method",
  },
  { test: /^\s*class\s+(?!<<)([A-Z][\w:]*)/, kind: "class" },
  { test: /^\s*module\s+([A-Z][\w:]*)/, kind: "module" },
  { test: /^\s*([A-Z][A-Z0-9_]+)\s*=(?!=)/, kind: "constant" },
];

const C: Rule[] = [
  {
    test: /^\s*(?:typedef\s+)?(?:template\s*<[^>]*>\s*)?(struct|class|union)\s+(?:\w+\s+)*?([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^;{]*)?\{?\s*$/,
    kind: "struct",
  },
  {
    test: /^\s*(?:typedef\s+)?enum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)\s*(?::[^;{]*)?\{?\s*$/,
    kind: "enum",
  },
  { test: /^\s*namespace\s+([A-Za-z_][\w:]*)\s*\{?\s*$/, kind: "module" },
  { test: /^#\s*define\s+([A-Za-z_]\w*)/, kind: "constant" },
  {
    test: /^(?:[A-Za-z_][\w:<>,*&\s]*?[\s*&])([A-Za-z_~][\w~]*(?:::[A-Za-z_~][\w~]*)*)\s*\([^;]*$/,
    kind: "function",
    callShaped: true,
  },
];

/** Which rules read a file, by what its name ends with. */
const BY_EXTENSION: Record<string, Rule[]> = {
  ts: TS,
  tsx: TS,
  mts: TS,
  cts: TS,
  js: TS,
  jsx: TS,
  mjs: TS,
  cjs: TS,
  go: GO,
  rs: RUST,
  java: JAVA,
  kt: JAVA,
  kts: JAVA,
  scala: JAVA,
  cs: JAVA,
  py: PYTHON,
  pyi: PYTHON,
  rb: RUBY,
  rake: RUBY,
  c: C,
  h: C,
  cc: C,
  cpp: C,
  cxx: C,
  hh: C,
  hpp: C,
  hxx: C,
};

/** The kind `kind` reads as for C, where the struct rule names its keyword. */
function cKind(keyword: string): Kind {
  return keyword === "class" ? "class" : "struct";
}

/** Whether this build reads the definitions in a file at `path`. */
export function readsDefinitions(path: string): boolean {
  return rulesFor(path) !== undefined;
}

function rulesFor(path: string): Rule[] | undefined {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot < path.lastIndexOf("/")) return undefined;
  return BY_EXTENSION[path.slice(dot + 1).toLowerCase()];
}

/** What a file at `path` holding `text` defines, in the order it says them. */
export function symbolsIn(path: string, text: string): CodeSymbol[] {
  const rules = rulesFor(path);
  if (rules === undefined) return [];
  const lines = text.split("\n");
  const found: CodeSymbol[] = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] as string;
    if (line.length > MOST_LINE || !mayDefine(line)) continue;
    const named = definedOn(line, rules, rules === C);
    if (named === undefined) continue;
    found.push({ ...named, from: at + 1, to: endOf(lines, at) + 1 });
  }
  return found;
}

/** Longer than a line that defines something is written. */
const MOST_LINE = 400;

/** Whether a line could open a definition at all, before any rule is tried. */
function mayDefine(line: string): boolean {
  const first = line.trimStart()[0];
  return (
    first !== undefined &&
    first !== "/" &&
    first !== "*" &&
    first !== "}" &&
    first !== ")" &&
    first !== "." &&
    first !== "(" &&
    first !== "'" &&
    first !== '"' &&
    first !== "`" &&
    !(first === "#" && !/^#\s*define/.test(line))
  );
}

function definedOn(
  line: string,
  rules: readonly Rule[],
  c: boolean,
): { name: string; kind: Kind } | undefined {
  const indented = /^\s/.test(line);
  for (const rule of rules) {
    const match = rule.test.exec(line);
    if (!match || rule.not?.test(line)) continue;
    if (c && rule.kind === "struct") {
      return { name: match[2] as string, kind: cKind(match[1] as string) };
    }
    const name = match[1] as string;
    if (rule.callShaped && NOT_NAMES.has(name)) return undefined;
    return { name, kind: indented ? (rule.indented ?? rule.kind) : rule.kind };
  }
  return undefined;
}

/** Closes a block on the line it starts at the indentation it was opened at. */
const CLOSES = /^(?:\}|end\b|\];?$)/;

/** Goes on with the block it is written at the indentation of. */
const GOES_ON =
  /^(?:\{$|\)|rescue\b|ensure\b|else\b|elsif\b|when\b|catch\b|finally\b)/;

/**
 * The last line of the definition opening at `start`: where the brace its line
 * ends with closes, else up to the first line after it written no deeper — that
 * line itself where it closes the block at the same depth — with blank lines
 * before it left out. A brace opened alone on the next line is read through.
 */
function endOf(lines: readonly string[], start: number): number {
  if ((lines[start] as string).trimEnd().endsWith("{")) {
    const closed = braceClosing(lines, start);
    if (closed !== undefined) return closed;
  }
  const depth = indentOf(lines[start] as string);
  let last = start;
  for (let at = start + 1; at < lines.length; at++) {
    const line = lines[at] as string;
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const indent = indentOf(line);
    if (indent > depth) {
      last = at;
      continue;
    }
    if (indent < depth) return last;
    if (GOES_ON.test(trimmed)) {
      last = at;
      continue;
    }
    if (CLOSES.test(trimmed)) return at;
    return last;
  }
  return last;
}

/** Further than one definition runs. */
const MOST_SPAN = 5000;

/** The line the brace opened at the end of `start` closes on, counting the
 *  braces between as written. */
function braceClosing(
  lines: readonly string[],
  start: number,
): number | undefined {
  let depth = 0;
  const end = Math.min(lines.length, start + MOST_SPAN);
  for (let at = start; at < end; at++) {
    for (const char of lines[at] as string) {
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return at;
      }
    }
  }
  return undefined;
}

function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return width;
}
