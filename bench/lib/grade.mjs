// The objective graders; README.md § "Tasks and grading" is the doc of record.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BENCH_DIR } from "./config.mjs";
import { gradePlacement } from "./place.mjs";
import { setupNotes } from "./subject.mjs";

const lower = (s) => s.toLowerCase();

function contains(grader, text) {
  const t = lower(text);
  const checks = [
    ...grader.all.map((s) => t.includes(lower(s))),
    ...(grader.any.length
      ? [grader.any.some((s) => t.includes(lower(s)))]
      : []),
    ...grader.none.map((s) => !t.includes(lower(s))),
  ];
  const score = checks.length
    ? checks.filter(Boolean).length / checks.length
    : 0;
  return { score };
}

function facts(grader, text) {
  const has = (fact) => new RegExp(fact.pattern, "i").test(text);
  const missing = grader.required.filter((f) => !has(f));
  const stated = grader.forbidden.filter(has);
  const share = 1 / grader.required.length;
  const score = Math.max(
    0,
    (grader.required.length - missing.length) * share - stated.length * share,
  );
  const notes = [
    ...missing.map((f) => `missing: ${f.pattern}`),
    ...stated.map((f) => `states what is not so: ${f.pattern}`),
  ];
  return { score, notes: notes.join("\n") || undefined };
}

function files(grader, text) {
  const missing = grader.names.filter(
    (n) => !n.any.some((name) => text.includes(name)),
  );
  return {
    score: (grader.names.length - missing.length) / grader.names.length,
    notes: missing.length
      ? missing.map((n) => `missing: ${n.any.join(" or ")}`).join("\n")
      : undefined,
  };
}

/** The environment a check runs in, without the marker that makes a nested `node --test` skip its files. */
function checkEnv() {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return env;
}

/** Copies the hidden files in, runs the command in the variant, and takes them out again. */
function command(grader, dir) {
  const placed = [];
  try {
    for (const [rel, source] of Object.entries(grader.hidden)) {
      const to = path.join(dir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.resolve(BENCH_DIR, source), to);
      placed.push(to);
    }
    const [program, ...args] = grader.command;
    const run = spawnSync(
      program === "node" ? process.execPath : program,
      args,
      {
        cwd: dir,
        env: checkEnv(),
        encoding: "utf8",
        timeout: grader.timeout_ms,
        maxBuffer: 1 << 26,
      },
    );
    const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`
      .trim()
      .split("\n")
      .slice(-15)
      .join("\n");
    if (run.error?.code === "ETIMEDOUT")
      return {
        score: 0,
        notes: `The check had not finished after ${grader.timeout_ms / 1000} seconds.\n${tail}`,
      };
    return { score: run.status === 0 ? 1 : 0, notes: tail || undefined };
  } finally {
    for (const file of placed) fs.rmSync(file, { force: true });
  }
}

/**
 * The objective score of one run, or undefined where the task has no objective grader.
 * @param {{ task: object, dir: string, output: { text: string, files_changed: string[] } }} run
 */
export function gradeObjective({ task, dir, output }) {
  const grader = task.grader;
  if (!grader || grader.kind === "none") return undefined;
  if (grader.kind === "contains") return contains(grader, output.text);
  if (grader.kind === "facts") return facts(grader, output.text);
  if (grader.kind === "files") return files(grader, output.text);
  if (grader.kind === "command") return command(grader, dir);
  if (grader.kind === "placement")
    return gradePlacement(grader, dir, setupNotes(dir, grader.container));
  throw new Error(`There is no grader called "${grader.kind}".`);
}
