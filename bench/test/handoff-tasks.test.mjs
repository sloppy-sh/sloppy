import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { judgePrompt } from "../judge/rubric.mjs";
import { BENCH_DIR, loadSubject } from "../lib/config.mjs";
import { gradeObjective } from "../lib/grade.mjs";
import { loadPack } from "../lib/task.mjs";

const CASES = JSON.parse(
  fs.readFileSync(
    path.join(BENCH_DIR, "test", "fixtures", "handoff-answers.json"),
    "utf8",
  ),
);
const SUBJECTS = ["gitlab", "milvus", "pulsar", "carbon", "llvm", "dotnet"];
const handoffs = SUBJECTS.flatMap((s) =>
  loadPack(s).filter((t) => t.family === "handoff"),
);
const score = (task, text) =>
  gradeObjective({
    task,
    dir: "/nonexistent",
    output: { text, files_changed: [] },
  }).score;

test("every subject's pack holds two handoff tasks, each with a mock answer for both stages", () => {
  for (const s of SUBJECTS)
    assert.equal(
      loadPack(s).filter((t) => t.family === "handoff").length,
      2,
      s,
    );
  assert.deepEqual(handoffs.map((t) => t.id).sort(), Object.keys(CASES).sort());
  for (const t of handoffs)
    for (const name of [`${t.id}.a.json`, `${t.id}.json`])
      assert.ok(
        fs.existsSync(path.join(BENCH_DIR, "fixtures", "mock", name)),
        name,
      );
});

test("each grader gives right paraphrases full marks and wrong answers a third at most", () => {
  for (const t of handoffs) {
    assert.equal(t.grader.kind, "facts");
    assert.ok(
      t.grader.required.length >= 3,
      `${t.id} needs three facts for one stray hit to stay at a third`,
    );
    for (const text of CASES[t.id].right)
      assert.equal(score(t, text), 1, `${t.id}: ${text}`);
    for (const text of CASES[t.id].wrong)
      assert.ok(
        score(t, text) <= 1 / 3 + 1e-9,
        `${t.id} scores ${score(t, text)}: ${text}`,
      );
  }
});

test("stage A is given the reason, and stage B and the judge are not", () => {
  for (const t of handoffs) {
    for (const f of t.grader.required) {
      const re = new RegExp(f.pattern, "i");
      assert.ok(re.test(t.prompt_a), `${t.id}: prompt_a lacks ${f.pattern}`);
      assert.ok(
        t.prompt_a.includes(f.source.quote),
        `${t.id}: prompt_a does not hold "${f.source.quote}"`,
      );
      assert.ok(
        !re.test(t.prompt_b),
        `${t.id}: prompt_b gives away ${f.pattern}`,
      );
    }
    assert.ok(
      !t.prompt_b.toLowerCase().includes(CASES[t.id].novel.toLowerCase()),
    );
    const judged = judgePrompt({ task: t, text: "an answer" });
    assert.ok(judged.includes(t.prompt_b));
    assert.ok(!judged.includes(t.prompt_a));
  }
});

const repoOf = (pack) => {
  try {
    const p = loadSubject(pack).path;
    return fs.existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
};

test("each change names code that holds what it says at the subject's commit, and each reason is new to the project", (t) => {
  for (const task of handoffs) {
    const c = CASES[task.id];
    const repo = repoOf(c.pack);
    if (!repo) {
      t.diagnostic(
        `${c.pack} is not on this machine; ${task.id} not checked against it`,
      );
      continue;
    }
    let source;
    try {
      source = execFileSync("git", ["show", `${c.sha}:${c.file}`], {
        cwd: repo,
        maxBuffer: 1 << 26,
      }).toString();
    } catch {
      t.diagnostic(
        `${c.pack} has no commit ${c.sha} here; ${task.id} not checked against it`,
      );
      continue;
    }
    assert.ok(
      source.includes(c.holds),
      `${task.id}: ${c.file} does not hold ${c.holds}`,
    );
    const named = path.basename(c.file, path.extname(c.file));
    assert.ok(
      task.prompt_a.includes(c.file) && task.prompt_b.includes(named),
      `${task.id}: stage A must be told ${c.file}, and stage B pointed at ${named}`,
    );
    const already = (() => {
      try {
        execFileSync(
          "git",
          [
            "grep",
            "-q",
            "-i",
            "-w",
            "-F",
            "-I",
            c.novel,
            c.sha,
            "--",
            ".",
            ":!bench",
          ],
          {
            cwd: repo,
            stdio: "ignore",
            maxBuffer: 1 << 26,
          },
        );
        return true;
      } catch {
        return false;
      }
    })();
    assert.ok(
      !already,
      `${task.id}: "${c.novel}" is already in ${c.pack} at ${c.sha}`,
    );
  }
});
