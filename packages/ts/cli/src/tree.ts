// What a project's own files say it is made of — docs/ARCHITECTURE.md
// § "Tooling and the review". Read once, and handed to whichever command
// wants it: `init` writes a note per part, `review` asks which part no note
// reaches.

import type { Files } from "@sloppy/local";
import {
  decodeText,
  folderWorthReading,
  PROJECT_MANIFESTS,
} from "@sloppy/vault";

/** One top-level part of a project: a package it declares, or a folder at the
 *  top of it. */
export interface ProjectPart {
  /** From the project root, spelled with `/`. */
  path: string;
  /** What its own manifest calls it, or the path where nothing does. */
  name: string;
  /** Where somebody starts reading it. The part's own folder where nothing in
   *  it says. */
  entries: string[];
}

/** How many openings a note is given before the list stops being a way in. */
const MOST_OPENINGS = 6;

/** Where a part is read from where its manifest names nothing that is there. */
const OPENINGS = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/main.ts",
  "src/main.js",
  "src/lib.rs",
  "src/main.rs",
  "src/main.py",
  "src/mod.rs",
  "index.ts",
  "index.js",
  "main.ts",
  "main.py",
  "main.go",
  "__init__.py",
  "mod.rs",
  "lib.rs",
];

/** The folders directly inside `path`, without walking what is under them.
 *  `NodeFiles` answers it; anything else is read from what it lists, which is
 *  what a folder held in memory can afford. */
async function foldersIn(files: Files, path: string): Promise<string[]> {
  const own = files as Partial<{ folders(path: string): Promise<string[]> }>;
  if (own.folders) return (await own.folders(path)).filter(folderWorthReading);
  const prefix = path === "" ? "" : `${path}/`;
  const found = new Set<string>();
  for (const held of await files.list(path)) {
    const under = held.slice(prefix.length);
    const at = under.indexOf("/");
    if (at > 0) found.add(under.slice(0, at));
  }
  return [...found].filter(folderWorthReading);
}

/** A file inside a part, or at the top of the project where the part is it. */
function at(path: string, name: string): string {
  return path === "" ? name : `${path}/${name}`;
}

async function readJson(
  files: Files,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const bytes = await files.read(path);
  if (!bytes) return undefined;
  try {
    const said: unknown = JSON.parse(decodeText(bytes));
    return said && typeof said === "object"
      ? (said as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The parts a project declares and the folders at the top of it, in path
 * order and without repeats. A workspace's packages come first, so a folder
 * that holds nothing but them — `packages/` — is not itself a part.
 */
export async function projectParts(project: Files): Promise<ProjectPart[]> {
  const declared = await declaredPaths(project);
  const paths = [...declared];
  for (const folder of await foldersIn(project, "")) {
    if (
      declared.some((path) => path === folder || path.startsWith(`${folder}/`))
    ) {
      continue;
    }
    paths.push(folder);
  }
  const parts: ProjectPart[] = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!(await project.exists(path))) continue;
    parts.push({
      path,
      name: (await declaredName(project, path)) ?? path,
      entries: await openingsOf(project, path),
    });
  }
  return parts;
}

/** Every path a workspace manifest names, expanded against what is there. */
async function declaredPaths(project: Files): Promise<string[]> {
  const patterns = [
    ...(await npmWorkspaces(project)),
    ...(await pnpmWorkspaces(project)),
    ...(await cargoMembers(project)),
  ];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const path of await expand(project, pattern)) found.push(path);
  }
  return found;
}

async function npmWorkspaces(project: Files): Promise<string[]> {
  const said = await readJson(project, "package.json");
  const held = said?.workspaces;
  const list = Array.isArray(held)
    ? held
    : Array.isArray((held as { packages?: unknown })?.packages)
      ? ((held as { packages: unknown[] }).packages as unknown[])
      : [];
  return list.filter((one): one is string => typeof one === "string");
}

/** The `packages:` list of a pnpm workspace, read as the lines it is written
 *  as: a list of quoted patterns is the whole of what that file holds that
 *  this needs, and a YAML parser for it would be a dependency for one key. */
async function pnpmWorkspaces(project: Files): Promise<string[]> {
  const bytes = await project.read("pnpm-workspace.yaml");
  if (!bytes) return [];
  const found: string[] = [];
  let inside = false;
  for (const line of decodeText(bytes).split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item) {
      if (line.trim() !== "" && !line.startsWith(" ")) inside = false;
      continue;
    }
    found.push(item[1].replace(/^["']|["']$/g, ""));
  }
  return found;
}

/** The `members` of a Cargo workspace, read the same way and for the same
 *  reason. */
async function cargoMembers(project: Files): Promise<string[]> {
  const bytes = await project.read("Cargo.toml");
  if (!bytes) return [];
  const said = decodeText(bytes);
  const members = /(^|\n)\s*members\s*=\s*\[([^\]]*)\]/.exec(said);
  if (!members) return [];
  return [...members[2].matchAll(/["']([^"']+)["']/g)].map((one) => one[1]);
}

/** A pattern with a `*` in a segment, against the folders that are there. A
 *  segment of `**` is read as one level, which is what a workspace naming it
 *  means everywhere a package sits one folder down. */
async function expand(project: Files, pattern: string): Promise<string[]> {
  let held = [""];
  for (const segment of pattern.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment.includes("*")) {
      const matches = expression(segment);
      const next: string[] = [];
      for (const at of held) {
        for (const folder of await foldersIn(project, at)) {
          if (matches.test(folder))
            next.push(at === "" ? folder : `${at}/${folder}`);
        }
      }
      held = next;
      continue;
    }
    held = held.map((at) => (at === "" ? segment : `${at}/${segment}`));
  }
  return held.filter((path) => path !== "");
}

function expression(segment: string): RegExp {
  const spelled = segment
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${spelled}$`);
}

/** What the project calls itself in its own manifest. Absent is one that says
 *  nothing, and the folder's name is what it is called then. */
export async function projectName(project: Files): Promise<string | undefined> {
  return declaredName(project, "");
}

async function declaredName(
  project: Files,
  path: string,
): Promise<string | undefined> {
  const said = await readJson(project, at(path, "package.json"));
  if (typeof said?.name === "string" && said.name !== "") return said.name;
  const bytes = await project.read(at(path, "Cargo.toml"));
  if (!bytes) return undefined;
  const named = /(^|\n)\s*name\s*=\s*["']([^"']+)["']/.exec(decodeText(bytes));
  return named?.[2];
}

/** Where a part is read from: what its manifest points at, and otherwise the
 *  first opening that is there. The folder itself where nothing is. */
async function openingsOf(project: Files, path: string): Promise<string[]> {
  const named: string[] = [];
  const said = await readJson(project, `${path}/package.json`);
  if (said) {
    for (const key of ["main", "module", "types", "bin", "exports"]) {
      for (const held of leaves(said[key])) named.push(held);
    }
  }
  const wanted = [...named, ...OPENINGS, ...PROJECT_MANIFESTS]
    .filter((one) => !one.startsWith("/") && !one.includes(".."))
    .map((one) => `${path}/${one.replace(/^\.\//, "")}`);
  const found = await thoseThatAreThere(project, wanted);
  return found.length > 0 ? found : [path];
}

/** What somebody reads first at the top of a project. Never a part's own
 *  folder, so a note pointing at one of these is not a note about a part. */
const TOP = [
  "README.md",
  "readme.md",
  "CONTRIBUTING.md",
  "package.json",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "Makefile",
];

/** The files at the top of the project that say what it is, in the order
 *  somebody would open them. Empty is a folder that says nothing about
 *  itself. */
export async function projectOpenings(project: Files): Promise<string[]> {
  return thoseThatAreThere(project, TOP);
}

/**
 * Which of these files the project has, in the order they were asked for and
 * at most {@link MOST_OPENINGS} of them. Two spellings of one name count once:
 * a disk that does not mind the case answers to both, and a note pointing at
 * the same file twice under two names would then point at neither on a disk
 * that does.
 */
async function thoseThatAreThere(
  project: Files,
  wanted: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  const taken = new Set<string>();
  for (const one of wanted) {
    if (found.length >= MOST_OPENINGS) break;
    const same = one.toLowerCase();
    if (taken.has(same) || !(await project.exists(one))) continue;
    taken.add(same);
    found.push(one);
  }
  return found;
}

/** Every string under a manifest field, however it is nested — `exports` is a
 *  map of maps and `bin` is a name or a map of them. */
function leaves(held: unknown): string[] {
  if (typeof held === "string") return [held];
  if (held === null || typeof held !== "object") return [];
  return Object.values(held).flatMap(leaves);
}
