// Read-only access to a variant's git history, the handoff `history` set; README.md § "Backends".
// Every call runs `git` with an argument list, never a shell, so no project code runs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_CHARS = 60_000;

const clip = (text) =>
  text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n[cut at ${MAX_CHARS} characters]`
    : text;

/** Options that keep git from running a configured diff driver, text filter or pager. */
const SAFE = ["-c", "core.pager=cat", "-c", "diff.external=", "--no-pager"];

function relInside(cwd, rel) {
  if (typeof rel !== "string" || rel === "")
    throw new Error("Name a path relative to the project.");
  const root = fs.realpathSync(cwd);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep))
    throw new Error(`${rel} is outside the project.`);
  return path.relative(root, full) || ".";
}

function rev(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_./~^@{}-]{1,200}$/.test(value) ||
    value.startsWith("-")
  )
    throw new Error("Name a commit by its sha, or HEAD, HEAD~1 and the like.");
  return value;
}

function git(cwd, args) {
  const run = spawnSync("git", [...SAFE, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 26,
    env: { ...process.env, GIT_EXTERNAL_DIFF: "", GIT_PAGER: "cat" },
  });
  if (run.status !== 0)
    throw new Error(run.stderr.trim() || `git ${args[0]} failed.`);
  return clip(run.stdout.trim() || "Nothing.");
}

export const HISTORY_SPECS = {
  git_log: {
    description:
      "The project's commit history, newest first: each commit's sha, author, date and whole message. Give a path to see only the commits that touched it.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "A file or folder, relative to the project root.",
        },
        max_count: {
          type: "integer",
          description: "How many commits; 50 at most.",
        },
      },
    },
  },
  git_show: {
    description: "One commit: its message and the changes it made.",
    parameters: {
      type: "object",
      properties: {
        commit: {
          type: "string",
          description: "A sha, or HEAD, HEAD~1 and the like.",
        },
      },
      required: ["commit"],
    },
  },
  git_blame: {
    description: "Which commit last changed each line of a file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "A file, relative to the project root.",
        },
        start: { type: "integer", description: "First line, from 1." },
        end: { type: "integer", description: "Last line." },
      },
      required: ["path"],
    },
  },
};

const IMPLS = {
  git_log({ path: rel, max_count = 20 } = {}, cwd) {
    const n = Math.min(Math.max(1, Number(max_count) || 20), 50);
    return git(cwd, [
      "log",
      "--no-ext-diff",
      `--max-count=${n}`,
      "--format=commit %H%nAuthor: %an%nDate:   %ad%n%n%B",
      ...(rel ? ["--", relInside(cwd, rel)] : []),
    ]);
  },
  git_show({ commit } = {}, cwd) {
    return git(cwd, [
      "show",
      "--no-ext-diff",
      "--no-textconv",
      "--stat",
      "--patch",
      rev(commit),
      "--",
    ]);
  },
  git_blame({ path: rel, start, end } = {}, cwd) {
    const range =
      Number.isInteger(start) && start > 0
        ? [`-L${start},${Number.isInteger(end) && end >= start ? end : ""}`]
        : [];
    return git(cwd, [
      "blame",
      "--no-textconv",
      ...range,
      "--",
      relInside(cwd, rel),
    ]);
  },
};

/** Runs one history tool in `cwd`; a failure comes back as words, never as a thrown error. */
export function runHistory(name, input, cwd) {
  const impl = IMPLS[name];
  if (!impl)
    return { text: `There is no tool called ${name} here.`, isError: true };
  try {
    return { text: impl(input ?? {}, cwd), isError: false };
  } catch (err) {
    return {
      text: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}
