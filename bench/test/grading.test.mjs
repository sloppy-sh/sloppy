import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { judgeRecords, ungraded } from "../judge/judge.mjs";
import { judgePrompt, mockVerdict, parseVerdict } from "../judge/rubric.mjs";
import { loadConditions } from "../lib/condition.mjs";
import { BENCH_DIR, loadSubject, subjectNames } from "../lib/config.mjs";
import { gradeObjective } from "../lib/grade.mjs";
import { readGrades, readRecords } from "../lib/record.mjs";
import { runBatch } from "../lib/runner.mjs";
import { prepareVariant } from "../lib/subject.mjs";
import { loadPack } from "../lib/task.mjs";
import {
  makeSubject,
  NO_AGENTS,
  tempDir,
  testSubject,
  write,
} from "./helpers.mjs";

const fixture = (id) =>
  JSON.parse(
    fs.readFileSync(
      path.join(BENCH_DIR, "fixtures", "mock", `${id}.json`),
      "utf8",
    ),
  );

/** Every single-stage task of every subject's pack. */
const shipped = subjectNames()
  .flatMap((name) => loadPack(loadSubject(name).default_pack))
  .filter((t) => t.family !== "place" && t.family !== "handoff");

const source = { doc: "AI.md", quote: "The ref identifies a note." };
const rubric = [{ criterion: "Answers the question", points: 1 }];

/** A pack of one task per objective grader, written over `makeSubject`'s tree. */
function craftedPack() {
  const checks = tempDir();
  write(
    checks,
    "a.check.mjs",
    [
      'import assert from "node:assert/strict";',
      'import fs from "node:fs";',
      'import { test } from "node:test";',
      'test("a is 3", () => assert.equal(fs.readFileSync("src/a.js", "utf8"), "export const a = 3;\\n"));',
      "",
    ].join("\n"),
  );
  const tasks = [
    {
      id: "crafted-why",
      family: "why",
      prompt: "What identifies a note?",
      tools: "read",
      key: "Its ref, and never its address.",
      sources: [source],
      grader: {
        kind: "facts",
        required: [
          { pattern: "\\bref\\b", source },
          { pattern: "\\blabel\\b", source },
        ],
        forbidden: [{ pattern: "address is (the|its) identifier", source }],
      },
      rubric,
    },
    {
      id: "crafted-locate",
      family: "locate",
      prompt: "Where is a defined?",
      tools: "read",
      key: "a in src/a.js; b in src/b.js.",
      grader: {
        kind: "files",
        names: [{ any: ["src/a.js"] }, { any: ["src/b.js"] }],
      },
      rubric,
    },
    {
      id: "crafted-change",
      family: "change",
      prompt: "Make a 3.",
      tools: "write",
      key: "src/a.js exports a = 3.",
      grader: {
        kind: "command",
        command: ["node", "--test", ".bench-hidden/a.check.mjs"],
        hidden: {
          ".bench-hidden/a.check.mjs": path.join(checks, "a.check.mjs"),
        },
        timeout_ms: 60000,
      },
      rubric,
    },
    {
      id: "crafted-brief",
      family: "brief",
      prompt: "Brief me on this project.",
      tools: "read",
      key: "A project with two modules.",
      rubric,
    },
  ];
  const tasksDir = tempDir();
  for (const t of tasks)
    write(tasksDir, `crafted/${t.id}.json`, JSON.stringify(t));
  const fixtures = tempDir();
  const answers = {
    "crafted-why": {
      text: "The ref identifies a note; the address is a label.",
    },
    "crafted-locate": { text: "a is in src/a.js." },
    "crafted-change": {
      text: "Done.",
      writes: { "src/a.js": "export const a = 3;\n" },
    },
    "crafted-brief": { text: "Two modules, a and b." },
  };
  for (const [id, answer] of Object.entries(answers))
    write(
      fixtures,
      `${id}.json`,
      JSON.stringify({ ...answer, cost_reported: 0.01 }),
    );
  return { tasksDir, fixtures, tasks: loadPack("crafted", tasksDir) };
}

const crafted = craftedPack();
const task = (id) => crafted.tasks.find((t) => t.id === id);
const grade = (id, text, dir = tempDir()) =>
  gradeObjective({ task: task(id), dir, output: { text, files_changed: [] } });

/** A mock batch over the crafted pack on a throwaway subject. */
async function craftedBatch(options) {
  const previous = process.env.SLOPPY_BENCH_MOCK_FIXTURES;
  process.env.SLOPPY_BENCH_MOCK_FIXTURES = crafted.fixtures;
  try {
    return await runBatch({
      backend: "mock",
      subject: makeSubject(),
      subjectConfig: testSubject(),
      tasksDir: crafted.tasksDir,
      pack: "crafted",
      seed: 1,
      budgetUsd: 1,
      workRoot: tempDir(),
      agents: NO_AGENTS,
      log: () => {},
      ...options,
    });
  } finally {
    if (previous === undefined) delete process.env.SLOPPY_BENCH_MOCK_FIXTURES;
    else process.env.SLOPPY_BENCH_MOCK_FIXTURES = previous;
  }
}

test("every task of every subject's pack has a mock answer", () => {
  for (const name of subjectNames())
    for (const t of loadPack(loadSubject(name).default_pack))
      for (const id of t.family === "handoff" ? [`${t.id}.a`, t.id] : [t.id])
        assert.ok(
          fs.existsSync(path.join(BENCH_DIR, "fixtures", "mock", `${id}.json`)),
          `${name}: ${id} has no mock answer`,
        );
});

test("a drift or why grader gives its written right answers full marks, and its wrong ones and its own prompt a third at most", () => {
  const written = ["drift", "why"].flatMap((family) =>
    Object.entries(
      JSON.parse(
        fs.readFileSync(
          path.join(BENCH_DIR, "test", "fixtures", `${family}-answers.json`),
          "utf8",
        ),
      ),
    ).map(([id, cases]) => [id, cases, family]),
  );
  for (const [id, cases, family] of written) {
    const t = loadPack(cases.pack).find((x) => x.id === id);
    assert.ok(t, `${id} is not in ${cases.pack}'s pack`);
    assert.equal(t.family, family);
    assert.equal(t.grader.kind, "facts");
    const score = (text) =>
      gradeObjective({
        task: t,
        dir: "/nonexistent",
        output: { text, files_changed: [] },
      }).score;
    assert.equal(score(t.key), 1, `${id}: its own key`);
    for (const text of cases.right)
      assert.equal(score(text), 1, `${id}: ${text}`);
    for (const text of [t.prompt, ...cases.wrong])
      assert.ok(
        score(text) <= 1 / 3 + 1e-9,
        `${id} scores ${score(text)}: ${text}`,
      );
  }
});

test("the facts grader counts what an answer states and takes off for what is not so", () => {
  assert.equal(grade("crafted-why", "The ref, not the label.").score, 1);
  assert.equal(grade("crafted-why", "I do not know.").score, 0);
  const half = grade("crafted-why", "The ref.");
  assert.equal(half.score, 0.5);
  assert.match(half.notes, /missing: \\blabel\\b/);
  const wrong = grade(
    "crafted-why",
    "The ref is a cache; the address is the identifier, a label.",
  );
  assert.equal(wrong.score, 0.5);
  assert.match(wrong.notes, /states what is not so/);
});

test("the files grader scores the fraction of names an answer gives", () => {
  assert.equal(grade("crafted-locate", "src/a.js and src/b.js").score, 1);
  const half = grade("crafted-locate", "a, in src/a.js");
  assert.equal(half.score, 0.5);
  assert.match(half.notes, /missing: src\/b\.js/);
});

test("the command grader runs its hidden check in the variant and leaves no trace of it", () => {
  const { dir } = prepareVariant(makeSubject(), "full", "HEAD", {
    workRoot: tempDir(),
    subject: testSubject(),
  });
  const change = task("crafted-change");
  const hidden = Object.keys(change.grader.hidden);
  const before = gradeObjective({
    task: change,
    dir,
    output: { text: "", files_changed: [] },
  });
  assert.equal(before.score, 0, before.notes);
  fs.writeFileSync(path.join(dir, "src/a.js"), "export const a = 3;\n");
  const after = gradeObjective({
    task: change,
    dir,
    output: { text: "", files_changed: [] },
  });
  assert.equal(after.score, 1, after.notes);
  for (const rel of hidden)
    assert.ok(
      !fs.existsSync(path.join(dir, rel)),
      `${rel} was left in the variant`,
    );
});

test("the judge's prompt carries the task, rubric, key and answer and nothing about the condition", () => {
  const conditions = loadConditions().conditions;
  for (const t of shipped) {
    const prompt = judgePrompt({ task: t, text: fixture(t.id).text });
    assert.ok(
      prompt.includes(t.prompt) &&
        prompt.includes(t.key) &&
        prompt.includes(fixture(t.id).text),
    );
    for (const r of t.rubric) assert.ok(prompt.includes(r.criterion));
    for (const c of conditions) {
      assert.ok(
        !new RegExp(`\\b${c.id.replace("+", "\\+")}\\b`).test(
          t.rubric
            .reduce((p, r) => p.replace(r.criterion, ""), prompt)
            .replace(t.prompt, "")
            .replace(t.key, "")
            .replace(fixture(t.id).text, ""),
        ),
        `${t.id} names ${c.id}`,
      );
      for (const line of c.lines)
        assert.ok(!prompt.includes(line), `${t.id} carries ${c.id}'s line`);
    }
    const frame = t.rubric
      .reduce((p, r) => p.replace(r.criterion, ""), prompt)
      .replace(t.prompt, "")
      .replace(t.key, "")
      .replace(fixture(t.id).text, "");
    assert.ok(
      !/condition|backend|cost|token|folder|variant|mcp|sloppy/i.test(frame),
      frame,
    );
  }
});

test("a verdict is read strictly and weighted by points", () => {
  const rubric = [
    { criterion: "a", points: 3 },
    { criterion: "b", points: 1 },
  ];
  const v = parseVerdict(
    '```json\n{"items":[{"score":1,"reason":"yes"},{"score":0,"reason":"no"}]}\n```',
    rubric,
  );
  assert.equal(v.score, 0.75);
  assert.deepEqual(v.items[1], { criterion: "b", score: 0, reason: "no" });
  assert.throws(
    () => parseVerdict("Looks good: 1", rubric),
    /did not answer with JSON/,
  );
  assert.throws(
    () => parseVerdict('{"items":[{"score":1,"reason":"x"}]}', rubric),
    /1 items where the rubric has 2/,
  );
  assert.throws(
    () =>
      parseVerdict(
        '{"items":[{"score":2,"reason":"x"},{"score":0,"reason":"y"}]}',
        rubric,
      ),
    /item 1/,
  );
  assert.equal(
    parseVerdict(mockVerdict({ task: { rubric }, text: "" }), rubric).score,
    0,
  );
});

test("a verdict wrapped in prose or a fence is read, and one scored on points is still refused", () => {
  const rubric = [
    { criterion: "Names the function", points: 2 },
    { criterion: "Names its caller", points: 2 },
    { criterion: "Names a test", points: 1 },
    { criterion: "Every path given exists", points: 1 },
  ];
  const verdict =
    '{"items":[{"score":1,"reason":"Names movedSubtree in packages/ts/types/src/address.ts."},{"score":1,"reason":"Names NodeService.move in node.service.ts, which calls it at line 621."},{"score":1,"reason":"Names packages/ts/types/src/address.test.ts."},{"score":0.8,"reason":"Paths match the key; line numbers like \\"address.ts:250\\" are unverified."}]}';
  for (const raw of [
    verdict,
    `\`\`\`json\n${verdict}\n\`\`\``,
    `Grading against the key:\n\n\`\`\`json\n${verdict}\n\`\`\``,
    `${verdict}\n\nThe answer's line numbers could not be checked without the repository.`,
  ])
    assert.equal(parseVerdict(raw, rubric).score, 0.966667, raw);

  const onPoints = verdict
    .replace(
      '"score":1,"reason":"Names movedSubtree',
      '"score":2,"reason":"Names movedSubtree',
    )
    .replace(
      '"score":1,"reason":"Names NodeService',
      '"score":2,"reason":"Names NodeService',
    );
  assert.throws(
    () => parseVerdict(onPoints, rubric),
    /item 1 has no score in \[0, 1\] and a reason: \{"score":2,/,
  );
  assert.throws(
    () => parseVerdict(`${verdict}\nOn reflection:\n${onPoints}`, rubric),
    /2 different verdicts/,
  );
  assert.throws(
    () => parseVerdict('{"items":[{"score":1,"reason":"cut off', rubric),
    /did not answer with JSON/,
  );
});

test("a mock batch grades objectively, and the mock judge grades what is left", async () => {
  const out = tempDir();
  const { records } = await craftedBatch({
    conditions: ["bare", "mcp"],
    outDir: out,
    objective: gradeObjective,
    config: "shipped",
  });
  assert.equal(records.length, 8);
  for (const r of records) {
    assert.equal(r.status, "ok");
    assert.equal(r.config, "shipped");
    if (r.task.id === "crafted-brief")
      assert.equal(r.grade?.objective, undefined);
    else assert.equal(typeof r.grade.objective, "number");
  }
  const by = (id) => records.find((r) => r.task.id === id).grade.objective;
  assert.equal(by("crafted-why"), 1);
  assert.equal(by("crafted-locate"), 0.5);
  assert.equal(by("crafted-change"), 1);

  assert.equal(ungraded(readRecords(out), readGrades(out)).length, 8);
  const first = await judgeRecords({
    outDir: out,
    kind: "mock",
    model: "mock",
    tasksDir: crafted.tasksDir,
    log: () => {},
  });
  assert.equal(first.graded, 8);
  assert.equal(readGrades(out).length, 8);
  assert.ok(
    readGrades(out).every((g) => g.grader === "judge" && g.items.length > 0),
  );
  const again = await judgeRecords({
    outDir: out,
    kind: "mock",
    model: "mock",
    tasksDir: crafted.tasksDir,
    log: () => {},
  });
  assert.equal(again.graded, 0);
});

test("an installed judge is refused unless agents.json allows it", async () => {
  const out = tempDir();
  await craftedBatch({
    tasks: ["crafted-why"],
    conditions: ["bare"],
    outDir: out,
  });
  const res = await judgeRecords({
    outDir: out,
    tasksDir: crafted.tasksDir,
    kind: "claude-code",
    model: "haiku",
    agents: NO_AGENTS,
    log: () => {},
  }).catch((e) => e);
  assert.match(
    String(res.message ?? ""),
    /does not allow the benchmark to run it/,
  );
});

test("the judge command grades a results folder through the CLI", async () => {
  const out = tempDir();
  await runBatch({
    backend: "mock",
    subject: makeSubject(),
    subjectConfig: testSubject(),
    pack: "example",
    conditions: ["mcp"],
    seed: 1,
    budgetUsd: 1,
    outDir: out,
    workRoot: tempDir(),
    agents: NO_AGENTS,
    log: () => {},
  });
  execFileSync(
    process.execPath,
    [
      path.join(BENCH_DIR, "bench.mjs"),
      "judge",
      "--judge-backend",
      "mock",
      "--out",
      out,
    ],
    { stdio: "pipe" },
  );
  assert.equal(readGrades(out).length, 1);
  const report = execFileSync(process.execPath, [
    path.join(BENCH_DIR, "bench.mjs"),
    "report",
    "--out",
    out,
  ]).toString();
  assert.match(report, /mcp/);
});

test('a stray `,"` before a closing brace, which the judge sometimes writes, is dropped', () => {
  const rubric = [
    { criterion: "a", points: 1 },
    { criterion: "b", points: 1 },
  ];
  const raw =
    '{"items":[{"score":0.8,"reason":"Says it.","},{"score":1,"reason":"Says the other.","}]}';
  const verdict = parseVerdict(raw, rubric);
  assert.equal(verdict.score, 0.9);
});
