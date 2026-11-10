// Subject variants; README.md § "Variants" is the doc of record.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSubject } from "./config.mjs";
import { removeNotes } from "./place.mjs";

/** Removed from every variant: the suite itself, with its answer keys. */
export const HARNESS_PATHS = ["bench"];

/** Files an agent picks up from a parent folder; a work root under one would leak them into every variant. */
const CONTEXT_MARKERS = [
  "AI.md",
  "CLAUDE.md",
  "AGENTS.md",
  ".sloppy",
  ".mcp.json",
];

const MARKER = "bench-variant.json";
const MARKER_VERSION = 2;

const SNAPSHOT_ENV = {
  GIT_AUTHOR_NAME: "bench",
  GIT_AUTHOR_EMAIL: "bench@localhost",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "bench",
  GIT_COMMITTER_EMAIL: "bench@localhost",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

function git(cwd, args, opts = {}) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      env: { ...process.env, ...SNAPSHOT_ENV },
      maxBuffer: 1 << 30,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    },
  );
}

/** Not the temporary folder: macOS empties files there that go unread for days, which breaks a variant between batches. */
export function defaultWorkRoot() {
  return (
    process.env.SLOPPY_BENCH_WORK ??
    path.join(os.homedir(), ".cache", "sloppy-bench")
  );
}

/** Throws where a folder at or above `workRoot` holds a file an agent would read as context. */
export function assertIsolated(workRoot) {
  let dir = path.resolve(workRoot);
  for (;;) {
    const found = CONTEXT_MARKERS.find((m) => fs.existsSync(path.join(dir, m)));
    if (found)
      throw new Error(
        `Variants cannot be made under ${workRoot}: ${path.join(dir, found)} sits above it, and an agent working there would read it. Set SLOPPY_BENCH_WORK to a folder outside any project.`,
      );
    const up = path.dirname(dir);
    if (up === dir) return;
    dir = up;
  }
}

export function resolveSha(subjectPath, rev = "HEAD") {
  return git(subjectPath, ["rev-parse", "--verify", `${rev}^{commit}`])
    .toString()
    .trim();
}

/**
 * One folder per variant, and per lane where a batch runs several at once. Lane 0 keeps the name a
 * one-lane batch has always used, so a prepared copy is not thrown away by raising the lane count.
 */
export function variantDir(workRoot, subjectName, variant, sha, lane = 0) {
  const at = `${subjectName}-${variant}-${sha.slice(0, 12)}`;
  return path.join(workRoot, lane > 0 ? `${at}-lane${lane}` : at);
}

function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".git", MARKER), "utf8"));
  } catch {
    return undefined;
  }
}

const lexists = (p) => fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;

function symlinksTo(root, targetRel) {
  const target = path.join(root, targetRel);
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (path.resolve(dir, fs.readlinkSync(full)) === target)
          found.push(path.relative(root, full));
      } else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found.sort();
}

/** The paths `variant` removes by name, beside the symlinks to the subject's `context_links`. */
export function listedPaths(subject, variant) {
  if (variant === "nodocs")
    return [
      ...HARNESS_PATHS,
      ...subject.docs,
      subject.container,
      subject.mcp_file,
    ];
  if (variant === "notes-only")
    return [...HARNESS_PATHS, ...subject.docs, subject.mcp_file];
  return [...HARNESS_PATHS];
}

/** Variant-relative paths `prepareVariant` removes from `variant`, given the extracted tree at `root`. */
export function removedPaths(root, variant, subject) {
  const listed = listedPaths(subject, variant).filter((p) =>
    lexists(path.join(root, p)),
  );
  const outsideListed = (link) =>
    !listed.some((p) => link === p || link.startsWith(`${p}/`));
  const links =
    variant === "nodocs" || variant === "notes-only"
      ? subject.context_links
          .flatMap((file) => symlinksTo(root, file))
          .filter(outsideListed)
      : [];
  return [...new Set([...listed, ...links])];
}

/**
 * A variant of `subject` (a loaded subject file; the default subject where absent) at `sha`: the tree of that commit with the variant's paths removed,
 * committed as the only commit of a fresh repository under `workRoot`, so no history or
 * pointer back to the subject reaches the agent. Idempotent: an existing variant at the same
 * sha, made under the same removal lists, is reset to its snapshot and reused.
 * @returns {{ dir: string, variant: string, sha: string, snapshot: string, removed: string[] }}
 */
export function prepareVariant(
  subjectPath,
  variant,
  sha,
  { workRoot = defaultWorkRoot(), subject = loadSubject(), lane = 0 } = {},
) {
  assertIsolated(workRoot);
  const fullSha = resolveSha(subjectPath, sha);
  const dir = variantDir(workRoot, subject.name, variant, fullSha, lane);
  const listed = listedPaths(subject, variant);
  const marker = readMarker(dir);
  if (
    marker?.version === MARKER_VERSION &&
    marker.variant === variant &&
    marker.sha === fullSha &&
    JSON.stringify(marker.listed) === JSON.stringify(listed) &&
    JSON.stringify(marker.context_links) ===
      JSON.stringify(subject.context_links)
  ) {
    resetVariant(dir);
    return {
      dir,
      variant,
      sha: fullSha,
      snapshot: marker.snapshot,
      removed: marker.removed,
    };
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Through a file, not memory: a large tree's archive outgrows any buffer.
  const tar = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sloppy-tree-")),
    "tree.tar",
  );
  git(subjectPath, ["archive", "--format=tar", `--output=${tar}`, fullSha]);
  execFileSync("tar", ["-x", "-f", tar, "-C", dir]);
  fs.rmSync(path.dirname(tar), { recursive: true, force: true });

  const removed = removedPaths(dir, variant, subject);
  for (const rel of removed) {
    const full = path.join(dir, rel);
    if (fs.lstatSync(full).isSymbolicLink()) fs.unlinkSync(full);
    else fs.rmSync(full, { recursive: true });
  }

  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "Snapshot"]);
  const snapshot = git(dir, ["rev-parse", "HEAD"]).toString().trim();
  fs.writeFileSync(
    path.join(dir, ".git", MARKER),
    JSON.stringify({
      version: MARKER_VERSION,
      variant,
      sha: fullSha,
      snapshot,
      removed,
      listed,
      context_links: subject.context_links,
    }),
  );
  return { dir, variant, sha: fullSha, snapshot, removed };
}

/** Returns a variant to its snapshot: every change and every untracked file, ignored or not, is gone. */
export function resetVariant(dir) {
  const marker = readMarker(dir);
  if (!marker) throw new Error(`${dir} is not a prepared variant.`);
  git(dir, ["reset", "-q", "--hard", marker.snapshot]);
  git(dir, ["clean", "-q", "-ffdx"]);
}

/** Where a place task's setup leaves its tree, so the grader can tell the notes it kept from the ones written since. */
const SETUP_REF = "refs/bench/setup";

/**
 * Applies a task's setup. A patch is committed on top of the snapshot. Notes taken out are
 * committed as a fresh snapshot with no parent and the reflog emptied, so the history holds no copy
 * of them; the old snapshot stays in the object store for the next reset, and no ref names it.
 */
export function applySetup(dir, setup) {
  if (setup.remove_notes) {
    removeNotes(dir, setup.remove_notes);
    git(dir, ["config", "gc.auto", "0"]);
    git(dir, ["add", "-A"]);
    const tree = git(dir, ["write-tree"]).toString().trim();
    const commit = git(dir, ["commit-tree", tree, "-m", "Snapshot"])
      .toString()
      .trim();
    git(dir, ["update-ref", "refs/heads/main", commit]);
    git(dir, ["update-ref", SETUP_REF, commit]);
    git(dir, ["reflog", "expire", "--expire=now", "--all"]);
    return;
  }
  git(dir, ["apply", "--index", "-"], { input: setup.patch });
  git(dir, ["commit", "-q", "-m", setup.message]);
}

/** The ULIDs of the notes a place task's setup left in `container`; empty where no such setup ran. */
export function setupNotes(dir, container) {
  try {
    return new Set(
      git(dir, ["ls-tree", "--name-only", `${SETUP_REF}:${container}/notes`])
        .toString()
        .split("\n")
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3)),
    );
  } catch {
    return new Set();
  }
}

/** Commits every change and untracked file in `dir` (ignored ones aside) as one commit, even an empty one. */
export function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-F", "-"], { input: message });
  return headOf(dir);
}

export function headOf(dir) {
  return git(dir, ["rev-parse", "HEAD"]).toString().trim();
}

/** Paths changed since `base`, committed or not, plus untracked files, relative to the variant root. */
export function changedFiles(dir, base) {
  const lines = (args) => git(dir, args).toString().split("\n").filter(Boolean);
  const tracked = lines(["diff", "--name-only", base]);
  const untracked = lines(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].sort();
}

/** Removes every prepared variant under `workRoot`, and nothing else there. */
export function cleanVariants({ workRoot = defaultWorkRoot() } = {}) {
  if (!fs.existsSync(workRoot)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(workRoot, { withFileTypes: true })) {
    const dir = path.join(workRoot, entry.name);
    if (entry.isDirectory() && readMarker(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    }
  }
  return removed;
}
