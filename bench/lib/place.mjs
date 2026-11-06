// The place family: notes taken out of a container and written back where they belong.
// README.md § "Tasks and grading" is the doc of record.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
/** A note's ref, `<did>/<ulid>`, wherever a file names one; group 1 is the ULID. */
const REF = new RegExp(`did:[a-z0-9]+:[A-Za-z0-9._%-]+/(${ULID})`, "g");
const NOTE_FILE = new RegExp(`^(${ULID})\\.md$`);
const BLOCK = new RegExp(`^<!-- block ${ULID} -->$`, "m");

const ulidOf = (ref) => ref?.match(new RegExp(`(${ULID})$`))?.[1];

function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return v;
}

/**
 * One note file read for what placement needs: its ULID, its parent's ULID and ref, its title, its
 * sections, and every note it names anywhere but its own `ref` and `parent` lines.
 */
export function readNote(text, file = "") {
  const lines = text.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const front = end > 0 ? lines.slice(1, end) : [];
  const body = end > 0 ? lines.slice(end + 1).join("\n") : text;
  const field = (name) => {
    const line = front.find((l) => l.startsWith(`${name}:`));
    return line === undefined ? undefined : scalar(line.slice(name.length + 1));
  };
  const parentRef = field("parent") || undefined;
  const ref = field("ref") || undefined;
  const named = [...front.filter((l) => !/^(ref|parent):/.test(l)), body].join(
    "\n",
  );
  const names = [...new Set([...named.matchAll(REF)].map((m) => m[1]))];
  return {
    ulid: ulidOf(ref) ?? path.basename(file).match(NOTE_FILE)?.[1],
    ref,
    parent: ulidOf(parentRef),
    parentRef,
    title: field("title") ?? "",
    sections: body
      .split(BLOCK)
      .map((s) => s.trim())
      .filter(Boolean),
    names,
  };
}

/** Every note in a container's `notes/` folder on disk, by ULID. */
export function readContainer(dir, container) {
  const notesDir = path.join(dir, container, "notes");
  const notes = new Map();
  if (!fs.existsSync(notesDir)) return notes;
  for (const file of fs.readdirSync(notesDir).sort()) {
    if (!NOTE_FILE.test(file)) continue;
    const note = readNote(
      fs.readFileSync(path.join(notesDir, file), "utf8"),
      file,
    );
    if (note.ulid) notes.set(note.ulid, note);
  }
  return notes;
}

/** The note the project's tree hangs from: the parentless note the most notes spring out of, the first ULID on a tie. */
export function rootOf(notes) {
  const children = (ulid) =>
    [...notes.values()].filter((n) => n.parent === ulid).length;
  return [...notes.values()]
    .filter((n) => !n.parent)
    .sort(
      (a, b) =>
        children(b.ulid) - children(a.ulid) || (a.ulid < b.ulid ? -1 : 1),
    )[0];
}

/**
 * A note's sections as the agent is given them: every citation of its own parent taken out, since
 * it would name the answer. A cited link keeps its words; a compass slot left empty goes, and so
 * does any line still naming the parent.
 */
export function givenSections(note) {
  if (!note.parent) return note.sections;
  const ref = `[^\\s\\]\\)"]*/${note.parent}`;
  return note.sections
    .map((section) =>
      section
        .replace(new RegExp(`\\[([^\\]]*)\\]\\(sloppy:${ref}\\)`, "g"), "$1")
        .replace(new RegExp(`\\s*\\[\\[${ref}\\]\\]`, "g"), "")
        .split("\n")
        .filter((line) => !/^(north|south|east|west):\s*$/.test(line))
        .filter((line) => !line.includes(note.parent))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

/** Past this a note's given text is a document pasted in rather than a note handed over. */
export const MOST_GIVEN_CHARS = 12000;

const givenChars = (note) => givenSections(note).join("\n").length;

const rank = (ulid) =>
  createHash("sha256").update(`place:${ulid}`).digest("hex");

/** The rule `selectNotes` applies, in words, as a task file records it. */
export const SELECTION_RULE = {
  thoughts:
    "Notes whose parent is a note other than the project's root (the parentless note the most notes spring out of), with a title and between 1 and 12000 characters of sections left once citations of the parent are taken out. Grouped by parent, the groups taken in order of sha256('place:' + parent ULID), and from each in turn the member lowest by sha256('place:' + ULID), round after round, skipping a note that is the parent or the child of one already taken, until `count` are taken.",
  root: "Notes whose parent is the project's root (the parentless note the most notes spring out of), with a title and between 1 and 12000 characters of sections left once citations of the parent are taken out, taken in order of sha256('place:' + ULID), skipping a note that is the parent or the child of one already taken, until `count` are taken.",
};

/** The notes a place task takes out, by `SELECTION_RULE[kind]`. */
export function selectNotes(notes, kind, count) {
  const root = rootOf(notes);
  if (!root) return [];
  const eligible = [...notes.values()].filter(
    (n) =>
      n.title.trim() !== "" &&
      n.parent &&
      notes.has(n.parent) &&
      (kind === "root" ? n.parent === root.ulid : n.parent !== root.ulid) &&
      givenSections(n).length > 0 &&
      givenChars(n) <= MOST_GIVEN_CHARS,
  );
  const groups = new Map();
  for (const n of eligible)
    groups.set(n.parent, [...(groups.get(n.parent) ?? []), n]);
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => (rank(a) < rank(b) ? -1 : 1))
    .map(([, members]) =>
      members.sort((a, b) => (rank(a.ulid) < rank(b.ulid) ? -1 : 1)),
    );
  const taken = [];
  const clashes = (n) =>
    taken.some((t) => t.ulid === n.parent || t.parent === n.ulid);
  for (let round = 0; taken.length < count; round++) {
    const offered = ordered.map((members) => members[round]).filter(Boolean);
    if (offered.length === 0) break;
    for (const n of offered) {
      if (taken.length === count) break;
      if (!clashes(n)) taken.push(n);
    }
  }
  return taken;
}

/** The text of the notes handed to the agent, the same under every condition. */
export function placePrompt(container, picked) {
  const notes = picked.map((n, i) =>
    [
      `=== Note ${i + 1} ===`,
      `Title: ${n.title}`,
      ...givenSections(n).flatMap((s, j) => [`--- section ${j + 1} ---`, s]),
    ].join("\n"),
  );
  return [
    `This project's notes are in \`${container}/\`; \`${container}/AGENT.md\` says how one is written. The ${picked.length} notes below belong among them and are not there yet. Write each one into the project's notes where it belongs: under the note it springs out of, and linked to the notes it should be linked to. Keep each note's title and sections as they are given here.`,
    ...notes,
  ].join("\n\n");
}

/** A place task over the container `notes` were read from, at `sha`. */
export function placeTask({ id, container, sha, kind, count, notes }) {
  const picked = selectNotes(notes, kind, count);
  const removed = new Set(picked.map((n) => n.ulid));
  const titleOf = (ulid) => notes.get(ulid)?.title ?? ulid;
  const expected = picked.map((n) => ({
    ulid: n.ulid,
    title: n.title,
    parent: n.parent,
    parent_title: titleOf(n.parent),
    grandparent: notes.get(n.parent)?.parent ?? null,
    links: n.names.filter(
      (u) => u !== n.parent && u !== n.ulid && notes.has(u) && !removed.has(u),
    ),
  }));
  return {
    id,
    family: "place",
    prompt: placePrompt(container, picked),
    tools: "write",
    key: `Each note written under the note it was taken from, linked to the notes it named: ${expected
      .map((e) => `"${e.title}" under "${e.parent_title}"`)
      .join("; ")}.`,
    rubric: [
      {
        criterion:
          "Each note is written under the note it springs out of, and linked to the notes it names.",
        points: 1,
      },
    ],
    selection: { sha, kind, count, rule: SELECTION_RULE[kind] },
    setup: { remove_notes: { container, notes: picked.map((n) => n.ulid) } },
    grader: { kind: "placement", container, notes: expected },
  };
}

/**
 * Takes the named notes out of the container at `dir`, and hangs each of their children from the
 * removed note's own parent, through any removed in between, so the tree stays whole.
 */
export function removeNotes(dir, { container, notes: ulids }) {
  const notesDir = path.join(dir, container, "notes");
  const removed = new Map();
  for (const ulid of ulids) {
    const file = path.join(notesDir, `${ulid}.md`);
    if (!fs.existsSync(file)) continue;
    removed.set(ulid, readNote(fs.readFileSync(file, "utf8"), file).parentRef);
    fs.rmSync(file);
  }
  const hungFrom = (ref) => {
    let at = ref;
    while (at && removed.has(ulidOf(at))) at = removed.get(ulidOf(at));
    return at;
  };
  if (!fs.existsSync(notesDir)) return;
  for (const file of fs.readdirSync(notesDir)) {
    if (!NOTE_FILE.test(file)) continue;
    const full = path.join(notesDir, file);
    const text = fs.readFileSync(full, "utf8");
    const { parent, parentRef } = readNote(text, file);
    if (!removed.has(parent)) continue;
    const to = hungFrom(parentRef);
    const line = /^parent:.*\n/m;
    fs.writeFileSync(
      full,
      to ? text.replace(line, `parent: ${to}\n`) : text.replace(line, ""),
    );
  }
}

const words = (title) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function overlap(a, b) {
  const x = new Set(words(a).split(" ").filter(Boolean));
  const y = new Set(words(b).split(" ").filter(Boolean));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (new Set([...x, ...y]).size || 1);
}

/** The written note each expected one is matched to: the same title, else the closest sharing at least half its words. */
function match(expected, written) {
  const pool = [...written];
  return expected.map((e) => {
    let at = pool.findIndex((n) => words(n.title) === words(e.title));
    if (at === -1) {
      const scored = pool.map((n) => overlap(n.title, e.title));
      const best = Math.max(-1, ...scored);
      at = best >= 0.5 ? scored.indexOf(best) : -1;
    }
    return at === -1 ? undefined : pool.splice(at, 1)[0];
  });
}

/** 1 under the note it was taken from; 0.5 under that note's own parent, or under a sibling of it; 0 anywhere else. */
function placed(e, note, notes) {
  if (note.parent === e.parent) return 1;
  const grand = e.grandparent ?? undefined;
  if (note.parent === grand) return 0.5;
  const above = notes.get(note.parent);
  if (above && above.ulid !== e.parent && above.parent === grand) return 0.5;
  return 0;
}

/**
 * Scores a run of a place task on the container as the agent left it. `kept` is the ULIDs the task
 * left in the container; a written note is looked for among the others.
 */
export function gradePlacement(grader, dir, kept = new Set()) {
  const notes = readContainer(dir, grader.container);
  const written = [...notes.values()].filter((n) => !kept.has(n.ulid));
  const found = match(grader.notes, written);
  const rows = grader.notes.map((e, i) => {
    const note = found[i];
    const place = note ? placed(e, note, notes) : 0;
    const linked = note
      ? e.links.filter((u) => note.names.includes(u)).length
      : 0;
    const links = e.links.length ? linked / e.links.length : undefined;
    const score = links === undefined ? place : (place + links) / 2;
    const under = note
      ? note.parent
        ? (notes.get(note.parent)?.title ?? note.parent)
        : "nothing"
      : undefined;
    return {
      score,
      place,
      links,
      line: note
        ? `"${e.title}": under "${under}", placement ${place}${e.links.length ? `, links ${linked}/${e.links.length}` : ""}`
        : `"${e.title}": not written`,
    };
  });
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const withLinks = rows.filter((r) => r.links !== undefined);
  return {
    score: mean(rows.map((r) => r.score)),
    notes: [
      `placement ${mean(rows.map((r) => r.place)).toFixed(3)} over ${rows.length}; links ${
        withLinks.length
          ? mean(withLinks.map((r) => r.links)).toFixed(3)
          : "none"
      } over ${withLinks.length}`,
      ...rows.map((r) => r.line),
    ].join("\n"),
  };
}

/** A mock answer that writes every note of `task` back where it was, as a run scoring 1 would. */
export function placedFixture(task, did) {
  const writes = {};
  for (const [i, e] of task.grader.notes.entries()) {
    const ulid = `${e.ulid.slice(0, 22)}${String(i).padStart(4, "Z")}`;
    const front = [
      "---",
      `ref: ${did}/${ulid}`,
      `parent: ${did}/${e.parent}`,
      `title: ${JSON.stringify(e.title)}`,
      ...(e.links.length
        ? ["links:", ...e.links.map((u) => `  - ${did}/${u}`)]
        : []),
      "---",
    ];
    writes[`${task.grader.container}/notes/${ulid}.md`] =
      `${front.join("\n")}\n\n<!-- block ${ulid} -->\n\nWritten back.\n`;
  }
  return writes;
}

/** The notes of `container` in the subject's commit `sha`, by ULID, read without checking anything out. */
export function containerAt(subjectPath, sha, container) {
  const run = (...args) =>
    execFileSync("git", args, {
      cwd: subjectPath,
      maxBuffer: 1 << 28,
    }).toString();
  const notes = new Map();
  for (const file of run(
    "ls-tree",
    "--name-only",
    `${sha}:${container}/notes`,
  ).split("\n")) {
    if (!NOTE_FILE.test(file)) continue;
    const note = readNote(
      run("show", `${sha}:${container}/notes/${file}`),
      file,
    );
    if (note.ulid) notes.set(note.ulid, note);
  }
  return notes;
}

const KINDS = ["thoughts", "root"];

/**
 * Writes a subject's two place tasks into its pack, and their mock answers: the thoughts task's
 * writes every note back where it was and scores 1, the root task's writes nothing and scores 0.
 * @returns {string[]} the files written
 */
export function writePlaceTasks({
  subject,
  sha,
  count,
  tasksDir,
  fixturesDir,
}) {
  const fullSha = execFileSync(
    "git",
    ["rev-parse", "--verify", `${sha}^{commit}`],
    {
      cwd: subject.path,
    },
  )
    .toString()
    .trim();
  const notes = containerAt(subject.path, fullSha, subject.container);
  const did = rootOf(notes)?.ref?.replace(/\/[^/]+$/, "");
  const written = [];
  for (const kind of KINDS) {
    const id = `${subject.name}-place-${kind}`;
    const task = placeTask({
      id,
      container: subject.container,
      sha: fullSha.slice(0, 8),
      kind,
      count,
      notes,
    });
    if (task.grader.notes.length === 0)
      throw new Error(
        `${subject.name} at ${sha} has no notes the ${kind} rule picks.`,
      );
    const file = path.join(tasksDir, subject.default_pack, `${id}.json`);
    fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
    const fixture = path.join(fixturesDir, `${id}.json`);
    fs.writeFileSync(
      fixture,
      `${JSON.stringify(
        {
          text:
            kind === "thoughts"
              ? "Written: each note under the note it springs out of."
              : "I could not tell where these belong, so I wrote nothing.",
          tokens: {
            input: 1000,
            cache_write: 2000,
            cache_read: 4000,
            output: 300,
            reasoning: 0,
          },
          cost_reported: 0.03,
          turns: 3,
          tool_calls: {
            Read: 2,
            Write: kind === "thoughts" ? task.grader.notes.length : 0,
          },
          mcp_calls: { relate: 1, write_note: 1 },
          ...(kind === "thoughts" ? { writes: placedFixture(task, did) } : {}),
        },
        null,
        2,
      )}\n`,
    );
    written.push(file, fixture);
  }
  return written;
}
