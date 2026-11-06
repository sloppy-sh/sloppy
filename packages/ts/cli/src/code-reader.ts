// The project's code as `find_code` reads it: the files git keeps or would
// keep, and what each defines — docs/ARCHITECTURE.md § "An assistant outside
// the app". What a file defines is kept outside the project, by the content
// git names it with, so a second start reads only what changed.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_KINDS, type CodeKind } from "@sloppy/types";
import {
  CONTAINER_DIR,
  type CodeFile,
  type CodeIndex,
  type CodeReader,
  type CodeSymbol,
  codeIndexOf,
  readsDefinitions,
  symbolsIn,
} from "@sloppy/local";
import { git } from "./git.js";

/** Bigger than a file somebody wrote by hand. */
const MOST_BYTES = 1024 * 1024;

/** Longer, on average, than a line somebody wrote by hand. */
const MOST_MEAN_LINE = 300;

/** Files read at once. */
const AT_ONCE = 64;

/** Changes whenever what is kept per file changes shape or meaning. */
const KEPT_AS = 2;

const VENDORED =
  /(?:^|\/)(?:node_modules|vendor|vendored|third[_-]party|bower_components|Pods|\.yarn|\.pnpm-store|dist|build|out|target|coverage|\.next|\.nuxt|\.svelte-kit|__generated__|generated)\//;

const GENERATED =
  /\.min\.[a-z]+$|\.map$|\.pb\.go$|_pb2(?:_grpc)?\.pyi?$|\.generated\.[a-z]+$|\.g\.dart$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|go\.sum|poetry\.lock|composer\.lock)$/;

const BINARY =
  /\.(?:png|jpe?g|gif|bmp|ico|icns|webp|avif|tiff?|psd|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|class|so|dylib|dll|exe|o|a|lib|bin|dat|db|sqlite3?|wasm|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|flac|mov|avi|mkv|webm|heic|pyc|node|keystore|p12|der|crt)$/i;

/** Whether `path` is the project's own writing rather than something brought
 *  in, made by a tool, or not text. */
export function isOwnCode(path: string): boolean {
  return (
    !path.startsWith(`${CONTAINER_DIR}/`) &&
    !VENDORED.test(path) &&
    !GENERATED.test(path) &&
    !BINARY.test(path)
  );
}

type KeptSymbol = [name: string, kind: number, from: number, to: number];

/** Per path: the content git named it by, and what it defines, or null where
 *  it is not code to read. */
type Kept = Record<string, [id: string, symbols: KeptSymbol[] | null]>;

interface Listed {
  path: string;
  /** Absent where the working tree may differ from what git holds. */
  id?: string;
}

/** A reader that builds each project's index once per process. */
export function codeReader(
  keptIn: string = join(tmpdir(), "sloppy-code"),
): CodeReader {
  const built = new Map<string, Promise<CodeIndex>>();
  return (root) => {
    const held = built.get(root);
    if (held) return held;
    const building = indexAt(root, keptIn);
    built.set(root, building);
    building.catch(() => built.delete(root));
    return building;
  };
}

async function indexAt(root: string, keptIn: string): Promise<CodeIndex> {
  const listed = (await listedAt(root)).filter((one) => isOwnCode(one.path));
  const keptAt = join(keptIn, `${digest(root)}.json`);
  const kept = await keptFrom(keptAt);
  const next: Kept = {};
  const files: CodeFile[] = [];
  const reading: Listed[] = [];
  for (const one of listed) {
    if (!readsDefinitions(one.path)) {
      files.push({ path: one.path, symbols: [] });
      continue;
    }
    const was = one.id === undefined ? undefined : kept[one.path];
    if (was !== undefined && was[0] === one.id) {
      next[one.path] = was;
      if (was[1] !== null) {
        files.push({ path: one.path, symbols: was[1].map(unkept) });
      }
      continue;
    }
    reading.push(one);
  }
  await eachAtOnce(reading, async (one) => {
    const symbols = await definedIn(root, one.path);
    if (one.id !== undefined) {
      next[one.path] = [one.id, symbols?.map(keptOf) ?? null];
    }
    if (symbols !== undefined) files.push({ path: one.path, symbols });
  });
  if (reading.length > 0) await keep(keptAt, next).catch(() => undefined);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return codeIndexOf(files);
}

/** Every file git keeps here and every one it would, each once. */
async function listedAt(root: string): Promise<Listed[]> {
  const [staged, untracked, changed] = await Promise.all([
    git(root, ["ls-files", "-z", "-s", "--cached"]),
    git(root, ["ls-files", "-z", "--others", "--exclude-standard"]),
    git(root, ["diff", "--name-only", "-z", "--relative"]),
  ]);
  const differs = new Set(changed.split("\0").filter((path) => path !== ""));
  const held = new Map<string, Listed>();
  for (const entry of staged.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const [mode, id] = entry.slice(0, tab).split(" ");
    if (mode === "160000" || mode === "120000") continue;
    const path = entry.slice(tab + 1);
    held.set(
      path,
      differs.has(path) || id === undefined ? { path } : { path, id },
    );
  }
  for (const path of untracked.split("\0")) {
    if (path !== "" && !held.has(path)) held.set(path, { path });
  }
  return [...held.values()];
}

/** What a file defines, or absent where it is not text somebody wrote. */
async function definedIn(
  root: string,
  path: string,
): Promise<CodeSymbol[] | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(root, path));
  } catch {
    return undefined;
  }
  if (bytes.length > MOST_BYTES || bytes.subarray(0, 8192).includes(0)) {
    return undefined;
  }
  const text = bytes.toString("utf8");
  const lines = text.split("\n", 2000);
  const mean = text.length / Math.max(1, lines.length);
  if (lines.length < 2000 && mean > MOST_MEAN_LINE) return undefined;
  return symbolsIn(path, text);
}

async function eachAtOnce<T>(
  items: readonly T[],
  each: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await each(item);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, lane));
}

async function keptFrom(at: string): Promise<Kept> {
  try {
    const held = JSON.parse(await readFile(at, "utf8")) as {
      as?: unknown;
      files?: Kept;
    };
    return held.as === KEPT_AS && held.files ? held.files : {};
  } catch {
    return {};
  }
}

async function keep(at: string, files: Kept): Promise<void> {
  await mkdir(join(at, ".."), { recursive: true });
  const writing = `${at}.${process.pid}`;
  await writeFile(writing, JSON.stringify({ as: KEPT_AS, files }));
  await rename(writing, at);
}

function keptOf(symbol: CodeSymbol): KeptSymbol {
  return [symbol.name, CODE_KINDS.indexOf(symbol.kind), symbol.from, symbol.to];
}

function unkept([name, kind, from, to]: KeptSymbol): CodeSymbol {
  return {
    name,
    kind: (CODE_KINDS[kind] ?? "function") as Exclude<CodeKind, "file">,
    from,
    to,
  };
}

function digest(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 32);
}
