// What a source file reaches for and what it hands out, read by the line —
// docs/ARCHITECTURE.md § "Tooling".
//
// There is no language server behind this and there is not meant to be: a name
// it misses is a name a person adds, and a wrong one is a link that draws as
// its own label. `.sloppy/AGENT.md` says the same thing to whoever reads the
// notes it writes.

/** A file's own account of itself. `read` false is a language this build does
 *  not take apart, and its note is an anchor to the whole file. */
export interface ModuleFacts {
  read: boolean;
  /** What it names in an `import` or a `require`, in the order it names them. */
  imports: string[];
  /** The symbols it exports, in the order it exports them. */
  exports: string[];
}

const READS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

const FROM = /\bfrom\s*["']([^"']+)["']/;
const BARE_IMPORT = /^\s*import\s*["']([^"']+)["']/;
const REQUIRE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const DECLARED =
  /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const DEFAULT_EXPORT = /^\s*export\s+default\b/;
const OPENS_LIST = /^\s*export\s+(?:type\s+)?\{/;

export function readsModule(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && READS.has(name.slice(dot + 1).toLowerCase());
}

export function readModule(path: string, source: string): ModuleFacts {
  if (!readsModule(path)) return { read: false, imports: [], exports: [] };
  const imports = new Set<string>();
  const exports = new Set<string>();
  const lines = source.split("\n");
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const bare = BARE_IMPORT.exec(line);
    if (bare) imports.add(bare[1]);
    if (/^\s*(?:import|export)\b/.test(line)) {
      const from = FROM.exec(line);
      if (from) imports.add(from[1]);
    }
    for (const held of line.matchAll(REQUIRE)) imports.add(held[1]);
    const declared = DECLARED.exec(line);
    if (declared) {
      exports.add(declared[1]);
      continue;
    }
    if (DEFAULT_EXPORT.test(line)) {
      exports.add("default");
      continue;
    }
    if (!OPENS_LIST.test(line)) continue;
    const list = listFrom(lines, at);
    for (const name of named(list.said)) exports.add(name);
    const from = FROM.exec(list.said);
    if (from) imports.add(from[1]);
    at = list.ends;
  }
  return { read: true, imports: [...imports], exports: [...exports] };
}

/** An export list is as many lines as it takes to close its brace. */
function listFrom(
  lines: readonly string[],
  at: number,
): { said: string; ends: number } {
  const held: string[] = [];
  for (let cursor = at; cursor < lines.length; cursor++) {
    held.push(lines[cursor]);
    if (lines[cursor].includes("}"))
      return { said: held.join(" "), ends: cursor };
  }
  return { said: held.join(" "), ends: lines.length - 1 };
}

/** The names a `{ … }` hands out: what each one is called on the way out,
 *  which is the half after `as` where there is one. */
function named(said: string): string[] {
  const braced = /\{([^}]*)\}/.exec(said);
  if (!braced) return [];
  const found: string[] = [];
  for (const one of braced[1].split(",")) {
    const words = one
      .trim()
      .replace(/^type\s+/, "")
      .split(/\s+as\s+/);
    const name = (words[1] ?? words[0]).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) found.push(name);
  }
  return found;
}
