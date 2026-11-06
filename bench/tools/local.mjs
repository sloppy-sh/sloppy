// The tools the api backend gives a model, each confined to the run's folder.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HISTORY_SPECS, runHistory } from "./history.mjs";

const MAX_CHARS = 60_000;
const BASH_TIMEOUT_MS = 60_000;

const clip = (text) =>
  text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n[cut at ${MAX_CHARS} characters]`
    : text;

/** `rel` resolved under `cwd`, refusing anything that lands outside it, through a link or otherwise. */
export function inside(cwd, rel) {
  if (typeof rel !== "string" || rel === "")
    throw new Error("Name a path relative to the project.");
  const root = fs.realpathSync(cwd);
  const full = path.resolve(root, rel);
  let probe = full;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = path.join(fs.realpathSync(probe), path.relative(probe, full));
  if (real !== root && !real.startsWith(root + path.sep))
    throw new Error(`${rel} is outside the project.`);
  return real;
}

const SPECS = {
  read: {
    description:
      "Read a text file in the project. Lines come back numbered. Use offset and limit for a long file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the project root.",
        },
        offset: {
          type: "integer",
          description: "First line to return, from 1.",
        },
        limit: {
          type: "integer",
          description: "How many lines to return; 2000 at most.",
        },
      },
      required: ["path"],
    },
  },
  grep: {
    description:
      "Search the project's files for a regular expression (extended syntax). Answers path:line:text.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: {
          type: "string",
          description:
            "Folder or file to search under; the whole project when absent.",
        },
        ignore_case: { type: "boolean" },
      },
      required: ["pattern"],
    },
  },
  glob: {
    description:
      "List the project's files matching a glob pattern, such as src/**/*.ts.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  bash: {
    description:
      "Run a shell command in the project root and get its output. Stopped after 60 seconds.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  edit: {
    description:
      "Replace one exact occurrence of old_string with new_string in a file. old_string must appear exactly once.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  write: {
    description: "Write a whole file, creating it or replacing what it held.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
};

export const TOOL_SETS = {
  none: [],
  read: ["read", "grep", "glob"],
  write: ["read", "grep", "glob", "bash", "edit", "write"],
  edit: ["read", "grep", "glob", "edit", "write"],
  history: ["read", "grep", "glob", ...Object.keys(HISTORY_SPECS)],
};

const specOf = (name) => SPECS[name] ?? HISTORY_SPECS[name];

export function toolSpecs(set) {
  const names = TOOL_SETS[set];
  if (!names) throw new Error(`There is no tool set called "${set}".`);
  return names.map((name) => ({ name, ...specOf(name) }));
}

function listFiles(cwd) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
}

const IMPLS = {
  read({ path: rel, offset = 1, limit = 2000 }, cwd) {
    const lines = fs.readFileSync(inside(cwd, rel), "utf8").split("\n");
    const from = Math.max(1, offset);
    const take = Math.min(Math.max(1, limit), 2000);
    return clip(
      lines
        .slice(from - 1, from - 1 + take)
        .map((line, i) => `${from + i}\t${line}`)
        .join("\n"),
    );
  },
  grep({ pattern, path: rel, ignore_case }, cwd) {
    const where = rel
      ? path.relative(fs.realpathSync(cwd), inside(cwd, rel)) || "."
      : ".";
    const run = spawnSync(
      "git",
      [
        "grep",
        "--untracked",
        "-n",
        "-I",
        "-E",
        ...(ignore_case ? ["-i"] : []),
        "-e",
        pattern,
        "--",
        where,
      ],
      { cwd, encoding: "utf8", maxBuffer: 1 << 28 },
    );
    if (run.status === 1) return "No matches.";
    if (run.status !== 0) throw new Error(run.stderr.trim() || "grep failed.");
    const lines = run.stdout.split("\n").filter(Boolean);
    return clip(
      lines.length > 300
        ? `${lines.slice(0, 300).join("\n")}\n[${lines.length - 300} more matches]`
        : lines.join("\n"),
    );
  },
  glob({ pattern }, cwd) {
    const found = listFiles(cwd).filter((f) => path.matchesGlob(f, pattern));
    return found.length ? clip(found.join("\n")) : "No files match.";
  },
  bash({ command }, cwd) {
    const run = spawnSync("/bin/sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      timeout: BASH_TIMEOUT_MS,
      maxBuffer: 1 << 26,
    });
    const out =
      `${run.stdout ?? ""}${run.stderr ? `\n${run.stderr}` : ""}`.trim();
    if (run.error?.code === "ETIMEDOUT")
      return clip(`${out}\n[stopped after 60 seconds]`);
    return clip(`exit ${run.status}\n${out}`);
  },
  edit({ path: rel, old_string, new_string }, cwd) {
    const file = inside(cwd, rel);
    const text = fs.readFileSync(file, "utf8");
    const at = text.indexOf(old_string);
    if (old_string === "" || at === -1)
      throw new Error(`old_string does not appear in ${rel}.`);
    if (text.indexOf(old_string, at + 1) !== -1)
      throw new Error(
        `old_string appears more than once in ${rel}; give more of the text around it.`,
      );
    fs.writeFileSync(
      file,
      text.slice(0, at) + new_string + text.slice(at + old_string.length),
    );
    return `Edited ${rel}.`;
  },
  write({ path: rel, content }, cwd) {
    const file = inside(cwd, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return `Wrote ${rel}.`;
  },
};

/** Runs one tool; a failure comes back as words for the model, never as a thrown error. */
export function runTool(name, input, cwd, set) {
  if (!TOOL_SETS[set]?.includes(name))
    return { text: `There is no tool called ${name} here.`, isError: true };
  if (HISTORY_SPECS[name]) return runHistory(name, input, cwd);
  try {
    return { text: IMPLS[name](input ?? {}, cwd), isError: false };
  } catch (err) {
    return {
      text: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}
