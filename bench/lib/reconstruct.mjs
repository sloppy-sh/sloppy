// What a run recorded before `sent` was kept had been sent, rebuilt from the commits that made it; README.md § "The record".
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { loadBackend, sentTools } from "./backend.mjs";
import { BACKENDS } from "./kinds.mjs";
import { buildPrompt } from "./prompt.mjs";
import { RecordSchema } from "./record.mjs";

const gitText = (repo, args) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** A reader of `repo` at `commit`: repository-relative path to text, symlinks followed, undefined where there is no file. */
export function gitTree(repo, commit) {
  const cache = new Map();
  const readOnce = (rel) => {
    let at = rel;
    for (let hops = 0; hops < 8; hops++) {
      const entry = gitText(repo, ["ls-tree", commit, "--", at]).trim();
      if (!entry) return undefined;
      const [mode] = entry.split(" ");
      if (mode === "040000") return undefined;
      const text = gitText(repo, ["cat-file", "-p", `${commit}:${at}`]);
      if (mode !== "120000") return text;
      at = path.posix.normalize(path.posix.join(path.posix.dirname(at), text));
    }
    return undefined;
  };
  return (rel) => {
    if (!cache.has(rel)) cache.set(rel, readOnce(rel));
    return cache.get(rel);
  };
}

/**
 * The condition in today's shape, with the lists it is built from: a conditions.json from before
 * subjects were named holds the dump list on the condition and the pointed line among its `lines`.
 */
function currentShape(condition, subject) {
  const ownDump = Array.isArray(condition.dump);
  return {
    condition: {
      ...condition,
      pointed: condition.pointed === true,
      dump: ownDump ? condition.dump.length > 0 : condition.dump === true,
    },
    dump: ownDump ? condition.dump : (subject?.dump ?? []),
    pointed: subject?.pointed ?? [],
  };
}

/**
 * `sent` for `record`, from `readBench` (bench-relative paths at the commit that ran it) and
 * `readSubject` (the subject at the record's sha), through the one prompt builder.
 */
export function reconstructSent({
  record,
  readBench,
  readSubject,
  backend,
  model,
}) {
  const conditions = JSON.parse(readBench("conditions.json"));
  const condition = conditions.conditions.find(
    (c) => c.id === record.condition,
  );
  if (!condition)
    throw new Error(
      `The bench then had no condition called "${record.condition}".`,
    );
  const subjectText = readBench(
    `subjects/${record.subject.name ?? "sloppy"}.json`,
  );
  const subject = subjectText ? JSON.parse(subjectText) : undefined;
  const taskText = readBench(
    `tasks/${record.task.pack}/${record.task.id}.json`,
  );
  if (!taskText)
    throw new Error(
      `The bench then had no task ${record.task.pack}/${record.task.id}.`,
    );
  const task = JSON.parse(taskText);
  const shaped = currentShape(condition, subject);
  const { systemPrompt, prompt } = buildPrompt({
    task,
    condition: shaped.condition,
    baseSystem: conditions.base_system,
    dump: shaped.dump,
    pointed: shaped.pointed,
    read: readSubject,
  });
  return {
    system: systemPrompt,
    prompt,
    mcp: condition.mcp === true,
    tools: sentTools(backend, {
      tools: task.tools,
      subagents: condition.subagents === true,
    }),
    model,
  };
}

/** The model a results file was asked for, from its name `<backend>-<model>-<YYYY-MM-DD>[-…].jsonl`. */
export function modelOfFile(file, kind) {
  const base = path.basename(file);
  const m = new RegExp(
    `^${kind}-(.+?)-\\d{4}-\\d{2}-\\d{2}(?:-.*)?\\.jsonl$`,
  ).exec(base);
  return m ? m[1] : "default";
}

/** The full sha of the commit that wrote each line of `rel` in `repo`, by line; undefined for a line not yet committed. */
export function lineCommits(repo, rel) {
  const shas = [];
  let blame;
  try {
    blame = gitText(repo, ["blame", "--line-porcelain", "--", rel]);
  } catch {
    return shas;
  }
  for (const line of blame.split("\n")) {
    const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (m) shas[Number(m[2]) - 1] = /^0+$/.test(m[1]) ? undefined : m[1];
  }
  return shas;
}

export const promptsDir = (resultsDir) => path.join(resultsDir, "prompts");
export const promptFile = (resultsDir, runId) =>
  path.join(promptsDir(resultsDir), `${runId}.json`);

/** JSON as the repository's formatter leaves it: two-space indent, a short list of strings on one line. */
const asFormatted = (value) =>
  JSON.stringify(value, null, 2).replace(
    /\[\n\s+("[^\n]*",?(?:\n\s+"[^\n]*",?)*)\n\s+\]/g,
    (_, items) => `[${items.split(/\n\s+/).join(" ")}]`,
  );

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const jsonlIn = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => path.join(dir, f))
    : [];

/**
 * Writes `prompts/<run_id>.json` under `resultsDir` for every committed record of `resultsDir` and
 * its `superseded/` that has no `sent` and was started, each system prompt once under
 * `prompts/systems/<sha256>.txt.gz`. A record is rebuilt from the bench at the commit that wrote its
 * line; a superseded batch, set aside in the commit that fixed what it ran under, from the commit
 * before that one. `subjectRepo(name)` is the repository a subject's sha is read from.
 */
export async function backfillPrompts({ resultsDir, repo, subjectRepo }) {
  const benchReaders = new Map();
  const subjectReaders = new Map();
  const backends = new Map();
  const reader = (cache, key, make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };
  const written = [];
  const skipped = [];
  const files = [
    ...jsonlIn(resultsDir),
    ...jsonlIn(path.join(resultsDir, "superseded")),
  ];
  for (const file of files) {
    const rel = path.relative(repo, file);
    const superseded = path.basename(path.dirname(file)) === "superseded";
    const commits = lineCommits(repo, rel);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      if (line.trim() === "") continue;
      const record = RecordSchema.parse(JSON.parse(line));
      if (record.sent || record.status === "budget") continue;
      if (!commits[i]) {
        skipped.push(record.run_id);
        continue;
      }
      const benchCommit = superseded
        ? gitText(repo, ["rev-parse", `${commits[i]}^`]).trim()
        : commits[i];
      const readBench = reader(benchReaders, benchCommit, () => {
        const read = gitTree(repo, benchCommit);
        return (p) => read(`bench/${p}`);
      });
      const name = record.subject.name ?? "sloppy";
      const readSubject = reader(
        subjectReaders,
        `${name}\t${record.subject.sha}`,
        () => gitTree(subjectRepo(name), record.subject.sha),
      );
      const kind = record.backend.kind;
      if (!BACKENDS.includes(kind))
        throw new Error(`${file}:${i + 1} names no known backend.`);
      const backend = await reader(backends, kind, () => loadBackend(kind));
      const { system, ...sent } = reconstructSent({
        record,
        readBench,
        readSubject,
        backend,
        model: modelOfFile(file, kind),
      });
      const systemFile = `systems/${sha256(system)}.txt.gz`;
      const systemPath = path.join(promptsDir(resultsDir), systemFile);
      if (!fs.existsSync(systemPath)) {
        fs.mkdirSync(path.dirname(systemPath), { recursive: true });
        fs.writeFileSync(systemPath, zlib.gzipSync(system, { level: 9 }));
      }
      const out = {
        run_id: record.run_id,
        reconstructed: true,
        from: {
          results_file: path.relative(resultsDir, file),
          bench_commit: benchCommit,
          subject_sha: record.subject.sha,
        },
        sent: { system_file: systemFile, ...sent },
      };
      fs.writeFileSync(
        promptFile(resultsDir, record.run_id),
        `${asFormatted(out)}\n`,
      );
      written.push(record.run_id);
    }
  }
  return { written, skipped };
}

/**
 * What a run was sent, as the record's `sent` holds it, plus `reconstructed` and, for a rebuilt one,
 * `from`; undefined where the record has none and nothing was rebuilt.
 */
export function readSent(resultsDir, record) {
  if (record.sent) return { ...record.sent, reconstructed: false };
  const file = promptFile(resultsDir, record.run_id);
  if (!fs.existsSync(file)) return undefined;
  const kept = JSON.parse(fs.readFileSync(file, "utf8"));
  const { system_file, ...sent } = kept.sent;
  const system = zlib
    .gunzipSync(fs.readFileSync(path.join(promptsDir(resultsDir), system_file)))
    .toString("utf8");
  return { system, ...sent, reconstructed: true, from: kept.from };
}
