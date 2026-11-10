// A quick plain-text look at results/; analysis.ipynb is the full reading.
import { providerFailed, runCost, runTokens, runWallMs } from "./record.mjs";

const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

const INPUT_CLASSES = ["input", "cache_write", "cache_read"];
const OUTPUT_CLASSES = ["output", "reasoning"];

/** Runs whose every class in `classes` was told, each summed over those classes and over a handoff's two stages. */
function toldSums(runs, classes) {
  return runs.map((r) => runTokens(r, classes)).filter((n) => n !== undefined);
}

/**
 * A run's score: the mean of its objective and judge components, where each component is the
 * latest grade record written for that grader, else the one the run was recorded with. A grade
 * appended after the run therefore replaces the run-time one for its grader and never the other.
 * A run that started and did not finish `ok` scores 0: it delivered nothing.
 */
export function scoreOf(record, gradesByRun) {
  // A run that answered badly scores 0. One that never began answering, or that the provider
  // failed mid-answer, is not an answer at all and is left unscored, so a flake or an outage cannot
  // be read as a condition doing poorly; the runner ran each of them again.
  if (record.status !== "ok")
    return (record.turns ?? 0) === 0 || providerFailed(record) ? undefined : 0;
  const grades = gradesByRun.get(record.run_id) ?? [];
  const component = (grader) =>
    grades.filter((g) => g.grader === grader).at(-1)?.score ??
    record.grade?.[grader];
  const parts = [component("objective"), component("judge")].filter(
    (s) => s !== undefined,
  );
  return parts.length ? mean(parts) : record.grade?.score;
}

/**
 * One row per subject, subject commit, configuration, task pack, backend, model and condition, so runs on
 * different subjects, configurations or packs are never averaged together. Runs the budget
 * stopped, and runs the provider failed, are counted and left out of every mean; every other
 * started run, failed or not, is in the cost, token and time means, except a token mean summing a
 * class the run could not tell, and a cost mean where it has no cost.
 */
export function summarize(records, grades = []) {
  const gradesByRun = new Map();
  for (const g of grades)
    gradesByRun.set(g.run_id, [...(gradesByRun.get(g.run_id) ?? []), g]);
  const groups = new Map();
  for (const r of records) {
    const key = [
      r.subject.name ?? "sloppy",
      r.subject.sha,
      r.config ?? "",
      r.task.pack,
      r.backend.kind,
      r.backend.model,
      r.condition,
    ].join("\t");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rs]) => {
      const [subject, sha, config, pack, backend, model, condition] =
        key.split("\t");
      const started = rs.filter(
        (r) => r.status !== "budget" && !providerFailed(r),
      );
      const costs = started.map(runCost).filter((c) => c !== undefined);
      const inputs = toldSums(started, INPUT_CLASSES);
      const outputs = toldSums(started, OUTPUT_CLASSES);
      const contexts = started
        .map((r) => r.context_final)
        .filter((c) => c !== undefined);
      const scores = started
        .map((r) => scoreOf(r, gradesByRun))
        .filter((s) => s !== undefined);
      return {
        subject,
        sha,
        config: config || undefined,
        pack,
        backend,
        model,
        condition,
        runs: rs.length,
        started: started.length,
        ok: started.filter((r) => r.status === "ok").length,
        priced: costs.length,
        cost_usd: mean(costs),
        input_told: inputs.length,
        input_tokens: mean(inputs),
        output_told: outputs.length,
        output_tokens: mean(outputs),
        context_told: contexts.length,
        context_final: mean(contexts),
        wall_s: mean(started.map((r) => runWallMs(r) / 1000)),
        graded: scores.length,
        score: mean(scores),
      };
    });
}

const fmt = (v, digits) => (v === undefined ? "-" : v.toFixed(digits));

/** A mean over only `counted` of `started` runs names how many it is over. */
const partial = (v, digits, counted, started, word) =>
  counted > 0 && counted < started
    ? `${fmt(v, digits)} (${counted} ${word})`
    : fmt(v, digits);

export function formatSummary(rows) {
  if (rows.length === 0) return "No runs recorded yet.";
  const configs = rows.some((r) => r.config !== undefined);
  const header = [
    "subject",
    "commit",
    ...(configs ? ["config"] : []),
    "pack",
    "backend",
    "model",
    "condition",
    "runs",
    "ok",
    "mean $",
    "in tok",
    "out tok",
    "ctx",
    "wall s",
    "score",
  ];
  const body = rows.map((r) => [
    r.subject,
    r.sha.slice(0, 12),
    ...(configs ? [r.config ?? "-"] : []),
    r.pack,
    r.backend,
    r.model,
    r.condition,
    `${r.started}/${r.runs}`,
    String(r.ok),
    partial(r.cost_usd, 4, r.priced, r.started, "priced"),
    partial(r.input_tokens, 0, r.input_told, r.started, "told"),
    partial(r.output_tokens, 0, r.output_told, r.started, "told"),
    partial(r.context_final, 0, r.context_told, r.started, "told"),
    fmt(r.wall_s, 1),
    partial(r.score, 2, r.graded, r.started, "graded"),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );
  const line = (cells) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [
    line(header),
    line(widths.map((w) => "-".repeat(w))),
    ...body.map(line),
    "",
    "runs: started/recorded; a run the budget stopped or the provider failed is counted but in no mean. Every other started run, failed or not, is in the cost, token and time means, except where its cost or tokens could not be told. ctx: the prompt size of the last model call, over the runs that kept their calls.",
  ].join("\n");
}
