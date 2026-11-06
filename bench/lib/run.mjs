// One run opened by its id: what it was sent, what it did and when, and how it was graded.
import { readSent } from "./reconstruct.mjs";
import { readTranscript } from "./transcript.mjs";

/** Every tool call a transcript holds, once each, at the time it first arrived: Claude Code's, codex's and a provider's alike. */
export function transcriptCalls(events = []) {
  const seen = new Map();
  const visit = (node, ms) => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, ms));
    if (!node || typeof node !== "object") return;
    const name =
      node.type === "tool_use"
        ? node.name
        : node.type === "function"
          ? node.function?.name
          : undefined;
    if (name && node.id && !(seen.get(node.id)?.ms <= ms))
      seen.set(node.id, { ms, name });
    for (const value of Object.values(node)) visit(value, ms);
  };
  for (const { ms, event } of events) visit(event, ms);
  return [...seen.values()].sort((a, b) => a.ms - b.ms);
}

/** The run's moments in order: each model call, each tool call the transcript holds, the first tool and the answer. */
export function timeline(record, transcript) {
  const moments = record.iterations.map((it, i) => ({
    ms: it.at_ms,
    what: `model call ${i + 1}: ${it.input + it.cache_write + it.cache_read} tokens in, ${it.output} out`,
  }));
  for (const call of transcriptCalls(transcript))
    moments.push({ ms: call.ms, what: `tool call: ${call.name}` });
  const { first_tool_ms, answer_ms, wall_ms } = record.timing;
  if (first_tool_ms !== undefined && !transcript)
    moments.push({ ms: first_tool_ms, what: "first tool call" });
  if (answer_ms !== undefined)
    moments.push({ ms: answer_ms, what: "answer began" });
  moments.push({ ms: wall_ms, what: `run ended: ${record.status}` });
  return moments.sort((a, b) => a.ms - b.ms);
}

/** Everything kept about one run: the record, what it was sent, its transcript where one was kept, and its grades. */
export function openRun(resultsDir, record, grades = []) {
  return {
    record,
    sent: readSent(resultsDir, record),
    transcript: readTranscript(resultsDir, record.run_id),
    grades: grades.filter((g) => g.run_id === record.run_id),
  };
}

const counts = (calls) =>
  Object.entries(calls)
    .map(([name, n]) => `${name} ${n}`)
    .join(", ") || "none";

/** A run as plain text; the system prompt is cut at `systemChars` unless `full`. */
export function formatRun(
  { record, sent, transcript, grades },
  { full = false, systemChars = 1200 } = {},
) {
  const r = record;
  const out = [
    `${r.run_id}  ${r.subject.name ?? "sloppy"} at ${r.subject.sha.slice(0, 12)}  ${r.condition}  ${r.task.pack}/${r.task.id}  rep ${r.rep}  ${r.status}`,
    `${r.backend.kind} ${r.backend.model}${r.backend.version ? ` ${r.backend.version}` : ""}, ${r.timestamp}`,
    "",
  ];
  if (!sent) out.push("What this run was sent was not kept.");
  else {
    out.push(
      sent.reconstructed
        ? `Sent (rebuilt from the bench at ${sent.from.bench_commit.slice(0, 12)}): model ${sent.model}, tools ${sent.tools.join(", ") || "none"}, sloppy tools ${sent.mcp ? "offered" : "not offered"}`
        : `Sent: model ${sent.model}, tools ${sent.tools.join(", ") || "none"}, sloppy tools ${sent.mcp ? "offered" : "not offered"}`,
      "",
      `System prompt (${sent.system.length} characters):`,
      full || sent.system.length <= systemChars
        ? sent.system
        : `${sent.system.slice(0, systemChars)}\n… ${sent.system.length - systemChars} more characters; --full prints them.`,
      "",
      "Task:",
      sent.prompt,
    );
  }
  out.push("", "Timeline:");
  for (const m of timeline(r, transcript))
    out.push(`  ${(m.ms / 1000).toFixed(1).padStart(7)}s  ${m.what}`);
  out.push(
    "",
    `Tool calls: ${counts(r.tool_calls)}`,
    `Sloppy calls: ${counts(r.mcp_calls)}`,
    ...(r.subagents_spawned
      ? [
          `Subagents: ${r.subagents_spawned}, their calls ${counts(r.subagent_calls)}`,
        ]
      : []),
    transcript
      ? `Transcript: ${transcript.length} events`
      : "Transcript: not kept for this run",
    "",
    "Answer:",
    r.output.text || "(none)",
  );
  if (r.error) out.push("", `Error: ${r.error}`);
  out.push("", "Grades:");
  if (r.grade) out.push(`  at run time: ${JSON.stringify(r.grade)}`);
  for (const g of grades)
    out.push(
      `  ${g.grader}${g.judge ? ` (${g.judge.kind} ${g.judge.model})` : ""}: ${g.score}${g.notes ? `, ${g.notes}` : ""}`,
    );
  if (!r.grade && grades.length === 0) out.push("  none");
  return out.join("\n");
}
