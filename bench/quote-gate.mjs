#!/usr/bin/env node
// Every passage a subject's graders quote from its documents must still be in them, word for word.
// Arm B's gate: SURVEY.md § "Arm B: the documents shaped for Sloppy".
//
//   node bench/quote-gate.mjs <subject>
import fs from "node:fs";
import path from "node:path";
import { BENCH_DIR, loadSubject } from "./lib/config.mjs";
import { listPacks, loadPack, TASKS_DIR } from "./lib/task.mjs";

const name = process.argv[2];
if (!name) {
  console.error("usage: node bench/quote-gate.mjs <subject>");
  process.exit(2);
}
const subject = loadSubject(name);
const flat = (s) => s.replace(/\s+/g, " ").trim();

const quotes = [];
for (const file of fs.readdirSync(path.join(TASKS_DIR, subject.default_pack))) {
  if (!file.endsWith(".json")) continue;
  const task = JSON.parse(
    fs.readFileSync(path.join(TASKS_DIR, subject.default_pack, file), "utf8"),
  );
  const sources = [
    ...(task.sources ?? []),
    ...(task.grader?.required ?? []).map((r) => r.source),
    ...(task.grader?.forbidden ?? []).map((r) => r.source),
  ];
  for (const s of sources)
    if (s?.doc && s?.quote && s.doc !== "prompt_a")
      quotes.push({ task: task.id, doc: s.doc, quote: s.quote });
}

const held = new Map();
const textOf = (doc) => {
  if (!held.has(doc)) {
    const at = path.join(subject.path, doc);
    held.set(doc, fs.existsSync(at) ? flat(fs.readFileSync(at, "utf8")) : null);
  }
  return held.get(doc);
};

const lost = quotes.filter((q) => {
  const text = textOf(q.doc);
  return text === null || !text.includes(flat(q.quote));
});

process.stdout.write(
  `${quotes.length} quoted passages, ${quotes.length - lost.length} resolving in ${subject.path}\n`,
);
for (const q of lost)
  process.stdout.write(
    `  LOST  ${q.task}  ${q.doc}\n        “${q.quote.slice(0, 90)}”\n`,
  );
if (lost.length) process.exitCode = 1;
