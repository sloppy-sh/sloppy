// Findability: the distinct files and notes a run opened, read from its transcript; README.md § "Metrics".
import path from "node:path";
import { appendFindability, readFindability, readRecords } from "./record.mjs";
import { readTranscript } from "./transcript.mjs";

const SLOPPY = "mcp__sloppy__";
/** A commit or a log read for its messages counts as one place opened, as a file or a note does. */
const HISTORY = "mcp__history__";

/** The calls of a run, `{ name, input, result, isError }`, in the order they were made, subagents' included. */
const CALLS = {
  "claude-code": claudeCodeCalls,
  api: apiCalls,
  harness: toolEventCalls,
  mock: toolEventCalls,
};

/**
 * `{ files, notes, opened }` for a run on `backend` from its transcript events, or undefined where
 * that backend's stream does not say what was read.
 */
export function findabilityOf(backend, events) {
  const calls = CALLS[backend];
  if (!calls || !events?.length) return undefined;
  const { list, cwd } = calls(events);
  return countOpened(list, cwd);
}

export function countOpened(calls, cwd) {
  const files = new Set();
  const notes = new Set();
  const file = (p) => {
    const rel = relative(p, cwd);
    if (rel) files.add(rel);
  };
  for (const call of calls) {
    if (call.isError) continue;
    const name = call.name ?? "";
    const input = call.input ?? {};
    if (name === "Read" || name === "read") file(input.file_path ?? input.path);
    else if (name === "Grep" || name === "grep") {
      if (name === "Grep" && input.output_mode !== "content") continue;
      for (const p of grepFiles(call.result, input.path)) file(p);
    } else if (name === "Bash" || name === "bash") {
      for (const p of shellReads(input.command)) file(p);
      if (/\b(grep|rg)\b/.test(input.command ?? ""))
        for (const p of grepFiles(call.result)) file(p);
    } else if (name === `${HISTORY}git_show`)
      files.add(`commit:${input.commit ?? ""}`);
    else if (name === `${HISTORY}git_log`) files.add(`log:${input.path ?? ""}`);
    else if (name === `${HISTORY}git_blame`) file(input.path);
    else if (name.startsWith(SLOPPY))
      for (const ref of notesOpened(
        name.slice(SLOPPY.length),
        input,
        call.result,
      ))
        notes.add(ref);
  }
  return {
    files: files.size,
    notes: notes.size,
    opened: files.size + notes.size,
  };
}

const ulidOf = (ref) =>
  typeof ref === "string" && ref.trim()
    ? ref.trim().split("/").at(-1)
    : undefined;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The notes an act handed back with their text; a search hit or a neighbour's gist is not one. */
export function notesOpened(act, input, result) {
  const j = parseJson(result ?? "");
  if (act === "read_note" || act === "read_around") {
    const ref =
      ulidOf(j?.note ?? j?.ref) ?? (j ? ulidOf(input.note) : undefined);
    return ref ? [ref] : [];
  }
  if (act === "brief")
    return (j?.notes ?? [])
      .filter((n) => n && (n.text?.length || n.sections?.length || n.body))
      .map((n) => ulidOf(n.ref ?? n.note))
      .filter(Boolean);
  return [];
}

/** Files whose lines a content search returned: `path:line:` and `path-line-` prefixes, else the one file searched. */
export function grepFiles(result, searched) {
  const text = typeof result === "string" ? result : "";
  if (!text.trim() || /^no (matches|files)/i.test(text.trim())) return [];
  const found = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(/^(.+?)(?::\d+:|-\d+-)/);
    if (m && /[./]/.test(m[1]) && !/\s/.test(m[1])) found.add(m[1]);
  }
  if (found.size === 0 && searched && path.extname(searched))
    found.add(searched);
  return [...found];
}

const READERS = new Set([
  "cat",
  "head",
  "tail",
  "sed",
  "nl",
  "less",
  "more",
  "bat",
]);

/** Files a shell command printed: the path arguments of cat, head, tail, sed, nl and their like, in each piece of a pipeline. */
export function shellReads(command) {
  if (typeof command !== "string") return [];
  const found = [];
  for (const piece of command.split(/&&|\|\||;|\|/)) {
    const words = piece.trim().split(/\s+/);
    if (!READERS.has(words[0])) continue;
    for (const w of words.slice(1)) {
      const bare = w.replace(/^["']|["']$/g, "");
      if (bare.startsWith("-") || bare.includes(">") || /^\d/.test(bare))
        continue;
      if (/^[\w./@~-]+\.[\w]+$/.test(bare) || bare.includes("/"))
        found.push(bare);
    }
  }
  return found;
}

const stripPrivate = (p) => p.replace(/^\/private(?=\/)/, "");

function relative(p, cwd) {
  if (typeof p !== "string" || !p.trim()) return undefined;
  let q = p.trim();
  if (cwd && path.isAbsolute(q)) {
    const rel = path.relative(stripPrivate(cwd), stripPrivate(q));
    if (rel.startsWith("..")) return q;
    q = rel;
  }
  return path.normalize(q).replace(/^\.\//, "");
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c?.type === "text" ? c.text : "")).join("\n")
      : "";

function claudeCodeCalls(events) {
  const byId = new Map();
  const list = [];
  let cwd;
  for (const { event } of events) {
    if (event?.type === "system" && event.subtype === "init") cwd ??= event.cwd;
    if (event?.type === "assistant")
      for (const b of event.message?.content ?? [])
        if (b.type === "tool_use") {
          const call = { name: b.name, input: b.input };
          byId.set(b.id, call);
          list.push(call);
        }
    if (event?.type === "user")
      for (const b of event.message?.content ?? [])
        if (b?.type === "tool_result" && byId.has(b.tool_use_id)) {
          const call = byId.get(b.tool_use_id);
          call.result = textOf(b.content);
          call.isError = b.is_error === true;
        }
  }
  return { list, cwd };
}

function apiCalls(events) {
  const byId = new Map();
  const list = [];
  for (const { event } of events) {
    if (event?.type !== "exchange") continue;
    for (const m of event.request?.messages ?? []) {
      if (m.role === "tool" && byId.has(m.tool_call_id))
        byId.get(m.tool_call_id).result = textOf(m.content);
      if (m.role === "user" && Array.isArray(m.content))
        for (const b of m.content)
          if (b?.type === "tool_result" && byId.has(b.tool_use_id)) {
            const call = byId.get(b.tool_use_id);
            call.result = textOf(b.content);
            call.isError = b.is_error === true;
          }
    }
    const r = event.response ?? {};
    const uses = [
      ...(r.content ?? []).filter((b) => b.type === "tool_use"),
      ...(r.choices?.[0]?.message?.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function?.name,
        input: parseJson(c.function?.arguments ?? "") ?? {},
      })),
    ];
    for (const u of uses) {
      const call = { name: u.name, input: u.input };
      byId.set(u.id, call);
      list.push(call);
    }
  }
  return { list, cwd: undefined };
}

function toolEventCalls(events) {
  return {
    list: events
      .map(({ event }) => event)
      .filter((e) => e?.type === "tool")
      .map((e) => ({
        name: e.name,
        input: e.input,
        result: e.result,
        isError: e.is_error === true,
      })),
    cwd: undefined,
  };
}

/**
 * Findability for every record in `resultsDir` that has none and no row yet, read from its kept
 * transcript, appended to `findability/<date>.jsonl` unless `dryRun`. Records are never rewritten.
 * @returns {{ rows: object[], file: string, missing: number, untold: number }}
 */
export function backfillFindability({
  resultsDir,
  dryRun = false,
  now = new Date(),
}) {
  const done = new Set(readFindability(resultsDir).map((r) => r.run_id));
  const file = path.join(
    resultsDir,
    "findability",
    `${now.toISOString().slice(0, 10)}.jsonl`,
  );
  const rows = [];
  let missing = 0;
  let untold = 0;
  for (const r of readRecords(resultsDir)) {
    if (r.findability || done.has(r.run_id) || !r.sent) continue;
    const events = readTranscript(resultsDir, r.run_id);
    if (!events) {
      missing++;
      continue;
    }
    const f = findabilityOf(r.backend.kind, events);
    if (!f) {
      untold++;
      continue;
    }
    const row = { run_id: r.run_id, timestamp: now.toISOString(), ...f };
    rows.push(dryRun ? row : appendFindability(file, row));
  }
  return { rows, file, missing, untold };
}
