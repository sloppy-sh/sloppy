// What the blind judge reads, and how its verdict is read back; README.md § "Tasks and grading".

export const JUDGE_SYSTEM =
  'You grade one answer to one task against a rubric and an answer key. Score each rubric item from 0 to 1: 1 where the answer fully meets it, 0 where it does not, a fraction where it partly does. An item\'s points are its weight in the total, never its scale: an item worth 2 points that is fully met scores 1. Judge only what the answer says; length and confidence earn nothing, and a claim the key contradicts counts against the item it touches. Reply with JSON alone, no prose and no code fence, in exactly this shape: {"items":[{"score":<0..1>,"reason":"<one line>"}, ...]}, one entry per rubric item, in the rubric\'s order.';

/** The judge's prompt: the task, the rubric, the key and the answer, and nothing about how the answer was produced. */
export function judgePrompt({ task, text }) {
  const rubric = task.rubric
    .map(
      (r, i) =>
        `${i + 1}. (${r.points} point${r.points === 1 ? "" : "s"}) ${r.criterion}`,
    )
    .join("\n");
  return [
    "# Task given",
    task.prompt,
    "# Rubric",
    rubric,
    "# Answer key",
    task.key,
    "# Answer to grade",
    text.trim() === "" ? "(empty)" : text,
  ].join("\n\n");
}

const isScore = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Every top-level `{...}` in `text` that parses as JSON, in order; prose and fences around them are skipped. */
export function jsonObjectsIn(text) {
  const found = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (depth > 0 && c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        try {
          found.push(JSON.parse(text.slice(start, i + 1)));
        } catch {}
      }
    }
  }
  return found;
}

/**
 * Reads a verdict: the one JSON object in the reply carrying `items`, wherever a fence or prose
 * around it puts it, with an item per rubric entry each holding a score in [0, 1] and a reason.
 * Throws on anything else, two different verdicts in one reply included.
 * @returns {{ score: number, items: Array<{ criterion: string, score: number, reason: string }> }}
 */
/** A `,"` straight before a closing brace is never JSON; the model writes it after a
 *  reason now and then, and dropping it loses nothing a valid reply could hold. */
const STRAY_COMMA_QUOTE = /,"\s*\}/g;

export function parseVerdict(raw, rubric) {
  const verdicts = [
    ...new Set(
      jsonObjectsIn(raw.replace(STRAY_COMMA_QUOTE, "}"))
        .filter((o) => o !== null && typeof o === "object" && "items" in o)
        .map((o) => JSON.stringify(o)),
    ),
  ];
  if (verdicts.length === 0)
    throw new Error(`The judge did not answer with JSON: ${raw.slice(0, 200)}`);
  if (verdicts.length > 1)
    throw new Error(
      `The judge gave ${verdicts.length} different verdicts in one reply: ${raw.slice(0, 200)}`,
    );
  const { items } = JSON.parse(verdicts[0]);
  if (!Array.isArray(items) || items.length !== rubric.length)
    throw new Error(
      `The judge scored ${Array.isArray(items) ? items.length : "no"} items where the rubric has ${rubric.length}.`,
    );
  for (const [i, item] of items.entries())
    if (!isScore(item?.score) || typeof item.reason !== "string")
      throw new Error(
        `The judge's item ${i + 1} has no score in [0, 1] and a reason: ${JSON.stringify(item).slice(0, 200)}`,
      );
  const total = rubric.reduce((sum, r) => sum + r.points, 0);
  const score =
    items.reduce((sum, item, i) => sum + item.score * rubric[i].points, 0) /
    total;
  return {
    score: Math.round(score * 1e6) / 1e6,
    items: items.map((item, i) => ({
      criterion: rubric[i].criterion,
      score: item.score,
      reason: item.reason,
    })),
  };
}

/** The mock judge's verdict: full marks for an answer with any text, none for an empty one. */
export function mockVerdict({ task, text }) {
  const score = text.trim() === "" ? 0 : 1;
  return JSON.stringify({
    items: task.rubric.map(() => ({
      score,
      reason: score ? "mock: answered" : "mock: empty",
    })),
  });
}
