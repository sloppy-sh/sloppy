// Searches after Sloppy answered: how often an agent went looking for a file a Sloppy answer had
// already named; README.md § "Searches after Sloppy answered" is the doc of record.
import fs from "node:fs";
import path from "node:path";
import { readTranscript } from "./transcript.mjs";

const SLOPPY_PREFIX = "mcp__sloppy__";

/** A shell command that looks for something, as the head of a pipeline: `sed … | grep` reads a
 *  file and filters it, which is not a search. */
const SHELL_SEARCH =
  /^\(?\s*(?:grep|egrep|rg|ag|ack|find|fd|locate|git\s+grep|git\s+ls-files)\b/;

/** The searches a shell command makes: each command it runs that starts with one. */
function shellSearches(command) {
  return command
    .split(/;|&&|\|\||\n/)
    .map((segment) => segment.split("|")[0].trim())
    .filter((head) => SHELL_SEARCH.test(head));
}

/** A path with at least one folder or an extension, as an answer names a file. */
const PATH_IN_TEXT =
  /[\w@.-]*[\w@-](?:\/[\w@.-]+)*\.[A-Za-z][\w]*|[\w@.-]+(?:\/[\w@.-]+)+/g;

/**
 * The agent's own tool calls in a Claude Code transcript, in order, each with its result's text;
 * a subagent's calls are left out, since it never saw the agent's answers.
 */
export function claudeCodeCalls(events) {
  const calls = [];
  const byId = new Map();
  for (const { event } of events) {
    if (event.parent_tool_use_id) continue;
    for (const block of event.message?.content ?? []) {
      if (event.type === "assistant" && block.type === "tool_use") {
        const call = { name: block.name, input: block.input ?? {}, result: "" };
        calls.push(call);
        byId.set(block.id, call);
      }
      if (event.type === "user" && block.type === "tool_result") {
        const call = byId.get(block.tool_use_id);
        if (call) call.result = textOf(block.content);
      }
    }
  }
  return calls;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((part) => part?.text ?? "").join("\n");
  return "";
}

/** The files a piece of text names, as written: no line range, no leading `./`. */
export function filesNamed(text) {
  const named = new Set();
  for (const match of text.match(PATH_IN_TEXT) ?? []) {
    const file = match.replace(/^\.\//, "").replace(/[.,:;]+$/, "");
    if (file.includes("/") || /\.[A-Za-z]\w*$/.test(file)) named.add(file);
  }
  return named;
}

/**
 * Whether `target`, as a call names it, is the file `named` says: the same path, one ending in it
 * (a call's paths are often absolute), or the end of it (`**\/merge.rb` or a bare name looked for).
 */
function isFile(target, named) {
  const spelled = target.replace(/^(?:\*\*\/)+/, "").replace(/^\.\//, "");
  if (spelled === "" || /[*?[\]{}]/.test(spelled)) return false;
  return (
    spelled === named ||
    spelled.endsWith(`/${named}`) ||
    named.endsWith(`/${spelled}`)
  );
}

function kindOf(call) {
  if (call.name.startsWith(SLOPPY_PREFIX)) return "sloppy";
  if (call.name === "Grep" || call.name === "Glob") return "search";
  if (call.name === "Bash" && shellSearches(call.input.command ?? "").length)
    return "search";
  if (call.name === "Read") return "read";
  return "other";
}

/** What a search was pointed at: its path, its glob, or every path its command names. */
function searchTargets(call) {
  if (call.name === "Bash")
    return shellSearches(call.input.command ?? "").flatMap((one) => [
      ...filesNamed(one),
    ]);
  const pathPattern = call.name === "Grep" ? undefined : call.input.pattern;
  return [call.input.path, pathPattern, call.input.glob].filter(
    (one) => typeof one === "string",
  );
}

/**
 * Of the Grep, Glob and shell searches in `calls`, how many were made once a Sloppy answer had
 * already named the file the search was pointed at or the file the agent read next, before its
 * next search. Undefined where no Sloppy call was made.
 */
export function searchesAfterSloppy(calls) {
  if (!calls.some((call) => kindOf(call) === "sloppy")) return undefined;
  const named = new Set();
  const answered = (target) => [...named].some((file) => isFile(target, file));
  let count = 0;
  calls.forEach((call, at) => {
    const kind = kindOf(call);
    if (kind === "sloppy") {
      for (const file of filesNamed(call.result)) named.add(file);
      return;
    }
    if (kind !== "search" || named.size === 0) return;
    const next = calls
      .slice(at + 1)
      .find((one) => ["read", "search"].includes(kindOf(one)));
    const readNext =
      next && kindOf(next) === "read" ? [next.input.file_path ?? ""] : [];
    if ([...searchTargets(call), ...readNext].some(answered)) count += 1;
  });
  return count;
}

/** The measure for one run's events, by the backend that made them; undefined where this cannot read them. */
export function afterSloppyOf(kind, events) {
  if (kind !== "claude-code" || !events?.length) return undefined;
  return searchesAfterSloppy(claudeCodeCalls(events));
}

export const afterSloppyFile = (resultsDir) =>
  path.join(resultsDir, "derived", "after-sloppy.jsonl");

/**
 * Writes `derived/after-sloppy.jsonl` under `resultsDir`: one `{ run_id, searches_after_sloppy }`
 * per record that made a Sloppy call, carries no count of its own and has a transcript to count
 * from. The records themselves are never rewritten. Returns the run ids written.
 */
export function backfillAfterSloppy(resultsDir, records) {
  const kept = readAfterSloppy(resultsDir);
  const written = [];
  for (const record of records) {
    if (record.searches_after_sloppy !== undefined || kept.has(record.run_id))
      continue;
    if (Object.keys(record.mcp_calls).length === 0) continue;
    const count = afterSloppyOf(
      record.backend.kind,
      readTranscript(resultsDir, record.run_id),
    );
    if (count === undefined) continue;
    kept.set(record.run_id, count);
    written.push(record.run_id);
  }
  if (written.length > 0) {
    const file = afterSloppyFile(resultsDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      written
        .map(
          (run_id) =>
            `${JSON.stringify({ run_id, searches_after_sloppy: kept.get(run_id) })}\n`,
        )
        .join(""),
    );
  }
  return written;
}

/** What the backfill counted, by run id. */
export function readAfterSloppy(resultsDir) {
  const file = afterSloppyFile(resultsDir);
  const kept = new Map();
  if (!fs.existsSync(file)) return kept;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const { run_id, searches_after_sloppy } = JSON.parse(line);
    kept.set(run_id, searches_after_sloppy);
  }
  return kept;
}

/** `records` with each one's count, its own or the backfill's; one with neither is left as it is. */
export function withAfterSloppy(resultsDir, records) {
  const kept = readAfterSloppy(resultsDir);
  return records.map((record) =>
    record.searches_after_sloppy === undefined && kept.has(record.run_id)
      ? { ...record, searches_after_sloppy: kept.get(record.run_id) }
      : record,
  );
}
