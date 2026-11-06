import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { gradeObjective } from "../lib/grade.mjs";
import {
  containerAt,
  givenSections,
  placeTask,
  readContainer,
  readNote,
  removeNotes,
  rootOf,
  selectNotes,
} from "../lib/place.mjs";
import { runBatch } from "../lib/runner.mjs";
import {
  applySetup,
  prepareVariant,
  resetVariant,
  setupNotes,
} from "../lib/subject.mjs";
import { gitIn, tempDir, testSubject, write } from "./helpers.mjs";

const DID = "did:syr:z6MkTEST";
const ref = (ulid) => `${DID}/${ulid}`;
const U = (n) => `01TEST${String(n).padStart(20, "0")}`;

/** A note file as a container holds one. */
function noteFile({ ulid, parent, title, links = [], sections }) {
  return [
    "---",
    `ref: ${ref(ulid)}`,
    ...(parent ? [`parent: ${ref(parent)}`] : []),
    `title: ${JSON.stringify(title)}`,
    ...(links.length ? ["links:", ...links.map((u) => `  - ${ref(u)}`)] : []),
    "---",
    "",
    ...sections.flatMap((s, i) => [`<!-- block ${U(900 + i)} -->`, "", s, ""]),
  ].join("\n");
}

/**
 * root 0
 *   hub 1 ── a 11, b 12 (cites hub 1 and links c 21) ── b's child 121
 *   hub 2 ── c 21, d 22
 *   leaf 3, and 4, titled as 21 is
 */
const CRAFTED = [
  { ulid: U(0), title: "The project", sections: ["## What this is\n\nIt."] },
  {
    ulid: U(1),
    parent: U(0),
    title: "Storage",
    sections: ["Where things are kept."],
  },
  {
    ulid: U(2),
    parent: U(0),
    title: "Rendering",
    sections: ["How things are drawn."],
  },
  {
    ulid: U(3),
    parent: U(0),
    title: "The folder src",
    sections: ["[src](code:src)"],
  },
  {
    ulid: U(4),
    parent: U(0),
    title: "The layout worker",
    sections: ["Another."],
  },
  {
    ulid: U(11),
    parent: U(1),
    title: "The vault format",
    sections: ["Markdown files."],
  },
  {
    ulid: U(12),
    parent: U(1),
    title: "Why sections are blocks",
    links: [U(21)],
    sections: [
      `north: [[${ref(U(1))}]]`,
      `It grew out of [storage](sloppy:${ref(U(1))}) and is drawn by [layout](sloppy:${ref(U(21))}).`,
    ],
  },
  {
    ulid: U(121),
    parent: U(12),
    title: "Ink in a block",
    sections: ["Strokes."],
  },
  {
    ulid: U(21),
    parent: U(2),
    title: "The layout worker",
    sections: ["Positions."],
  },
  {
    ulid: U(22),
    parent: U(2),
    title: "Colour is selection",
    sections: ["Tags light."],
  },
];
const B = CRAFTED.find((n) => n.ulid === U(12));

function craftedProject() {
  const root = tempDir("sloppy-bench-place-");
  for (const n of CRAFTED)
    write(root, `.sloppy/notes/${n.ulid}.md`, noteFile(n));
  return root;
}

function committed(dir) {
  const git = gitIn(dir);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Snapshot");
  return dir;
}

test("a note is read for its parent, its title, its sections and the notes it names", () => {
  const n = readNote(noteFile(B));
  assert.equal(n.ulid, U(12));
  assert.equal(n.parent, U(1));
  assert.equal(n.title, "Why sections are blocks");
  assert.equal(n.sections.length, 2);
  assert.deepEqual(n.names.sort(), [U(1), U(21)].sort());
});

test("the text given to the agent names no parent, and keeps every other citation", () => {
  const given = givenSections(readNote(noteFile(B)));
  assert.ok(!given.join("\n").includes(U(1)), given.join("\n"));
  assert.match(
    given.join("\n"),
    /It grew out of storage and is drawn by \[layout\]\(sloppy:/,
  );
  assert.equal(given.length, 1, "the compass naming only the parent goes");
});

test("selection is deterministic, keeps to its kind, and never takes a note with its parent or child", () => {
  const notes = readContainer(craftedProject(), ".sloppy");
  assert.equal(rootOf(notes).ulid, U(0));
  const thoughts = selectNotes(notes, "thoughts", 5);
  assert.deepEqual(
    thoughts.map((n) => n.ulid),
    selectNotes(notes, "thoughts", 5).map((n) => n.ulid),
  );
  assert.ok(thoughts.length >= 3);
  for (const n of thoughts) assert.notEqual(n.parent, U(0));
  for (const a of thoughts)
    for (const b of thoughts) assert.notEqual(a.parent, b.ulid);
  const roots = selectNotes(notes, "root", 2);
  assert.equal(roots.length, 2);
  for (const n of roots) assert.equal(n.parent, U(0));
});

test("taking notes out hangs their children from the removed note's parent, through a removed note between", () => {
  const dir = craftedProject();
  removeNotes(dir, { container: ".sloppy", notes: [U(1), U(12)] });
  const notes = readContainer(dir, ".sloppy");
  assert.ok(!notes.has(U(1)) && !notes.has(U(12)));
  assert.equal(notes.get(U(11)).parent, U(0));
  assert.equal(notes.get(U(121)).parent, U(0));
  assert.equal(notes.get(U(21)).parent, U(2));
});

test("a place setup leaves no copy of the notes in the history, and the variant resets to its snapshot", () => {
  const subjectDir = craftedProject();
  write(subjectDir, "README.md", "# crafted\n");
  committed(subjectDir);
  const subject = {
    ...testSubject(),
    name: "crafted",
    path: subjectDir,
    docs: [],
  };
  const v = prepareVariant(subjectDir, "full", "HEAD", {
    workRoot: tempDir(),
    subject,
  });
  applySetup(v.dir, { remove_notes: { container: ".sloppy", notes: [U(12)] } });
  const inVariant = gitIn(v.dir);
  assert.equal(
    inVariant("rev-list", "--all").toString().trim().split("\n").length,
    1,
  );
  assert.equal(
    inVariant(
      "log",
      "--all",
      "--format=%H",
      "--",
      `.sloppy/notes/${U(12)}.md`,
    ).toString(),
    "",
  );
  assert.equal(inVariant("reflog").toString(), "");
  const kept = setupNotes(v.dir, ".sloppy");
  assert.equal(kept.size, CRAFTED.length - 1);
  assert.ok(!kept.has(U(12)));
  resetVariant(v.dir);
  assert.ok(fs.existsSync(path.join(v.dir, ".sloppy/notes", `${U(12)}.md`)));
});

/** A place task over the one crafted note `ulid`, its expectation worked out as placeTask works one out. */
function single(ulid) {
  const notes = readContainer(craftedProject(), ".sloppy");
  const n = notes.get(ulid);
  return {
    id: "crafted-place-one",
    family: "place",
    setup: { remove_notes: { container: ".sloppy", notes: [ulid] } },
    grader: {
      kind: "placement",
      container: ".sloppy",
      notes: [
        {
          ulid,
          title: n.title,
          parent: n.parent,
          parent_title: notes.get(n.parent).title,
          grandparent: notes.get(n.parent).parent ?? null,
          links: n.names.filter((u) => u !== n.parent && notes.has(u)),
        },
      ],
    },
  };
}

/** The crafted project with the task's notes taken out and `written` added, graded as the task would be. */
function graded(task, written) {
  const dir = committed(craftedProject());
  applySetup(dir, task.setup);
  for (const n of written)
    write(dir, `.sloppy/notes/${n.ulid}.md`, noteFile(n));
  return gradeObjective({ task, dir, output: { text: "", files_changed: [] } })
    .score;
}

test("placement scores 1 under the parent, 0.5 under its parent or a sibling of it, 0 elsewhere or unwritten", () => {
  const task = single(U(11));
  const at = (parent, title = "The vault format") => [
    { ulid: U(500), parent, title, sections: ["Markdown files."] },
  ];
  assert.equal(graded(task, at(U(1))), 1);
  assert.equal(graded(task, at(U(1), "the vault FORMAT!")), 1);
  assert.equal(graded(task, at(U(0))), 0.5);
  assert.equal(graded(task, at(U(2))), 0.5);
  assert.equal(graded(task, at(U(21))), 0);
  assert.equal(graded(task, at(undefined)), 0);
  assert.equal(graded(task, at(U(1), "Something else entirely")), 0);
  assert.equal(graded(task, []), 0);
});

test("a note's links count half its score, and a kept note of the same title is never taken for it", () => {
  const task = single(U(12));
  assert.deepEqual(task.grader.notes[0].links, [U(21)]);
  const note = (links, parent = U(1)) => [
    {
      ulid: U(501),
      parent,
      title: "Why sections are blocks",
      links,
      sections: ["x"],
    },
  ];
  assert.equal(graded(task, note([U(21)])), 1);
  assert.equal(graded(task, note([])), 0.5);
  assert.equal(graded(task, note([U(21)], U(2))), 0.75);

  const layout = single(U(21));
  assert.equal(
    graded(layout, []),
    0,
    "the kept note of the same title is not the written one",
  );
  assert.equal(
    graded(layout, [
      {
        ulid: U(503),
        parent: U(2),
        title: "The layout worker",
        sections: ["x"],
      },
    ]),
    1,
  );
});

test("a container read at a commit is the container read from the folder", () => {
  const dir = committed(craftedProject());
  const head = gitIn(dir)("rev-parse", "HEAD").toString().trim();
  assert.deepEqual(
    containerAt(dir, head, ".sloppy"),
    readContainer(dir, ".sloppy"),
  );
});

test("a mock batch takes the notes out, lets the answer write them back, and grades the container", async () => {
  const subjectDir = craftedProject();
  write(subjectDir, "README.md", "# crafted\n");
  committed(subjectDir);
  const task = placeTask({
    id: "crafted-place-thoughts",
    container: ".sloppy",
    sha: "0",
    kind: "thoughts",
    count: 5,
    notes: readContainer(subjectDir, ".sloppy"),
  });
  const tasksDir = tempDir();
  write(tasksDir, "crafted/crafted-place-thoughts.json", JSON.stringify(task));
  const fixtures = tempDir();
  const writes = Object.fromEntries(
    task.grader.notes.map((e, i) => [
      `.sloppy/notes/${U(700 + i)}.md`,
      noteFile({
        ulid: U(700 + i),
        parent: e.parent,
        title: e.title,
        links: e.links,
        sections: ["x"],
      }),
    ]),
  );
  write(
    fixtures,
    "crafted-place-thoughts.json",
    JSON.stringify({ text: "Done.", writes }),
  );
  const previous = process.env.SLOPPY_BENCH_MOCK_FIXTURES;
  process.env.SLOPPY_BENCH_MOCK_FIXTURES = fixtures;
  try {
    const { records } = await runBatch({
      backend: "mock",
      subjectConfig: {
        ...testSubject(),
        name: "crafted",
        path: subjectDir,
        docs: [],
        default_pack: "crafted",
      },
      tasksDir,
      conditions: ["bare"],
      seed: 1,
      budgetUsd: 1,
      outDir: tempDir(),
      workRoot: tempDir(),
      objective: gradeObjective,
      log: () => {},
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "ok");
    assert.equal(records[0].grade.objective, 1, records[0].grade.notes);
  } finally {
    if (previous === undefined) delete process.env.SLOPPY_BENCH_MOCK_FIXTURES;
    else process.env.SLOPPY_BENCH_MOCK_FIXTURES = previous;
  }
});
