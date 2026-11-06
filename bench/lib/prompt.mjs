// The one prompt builder: every run's prompt comes from here, so no condition gets wording the others lack.
import fs from "node:fs";
import path from "node:path";

/** "A", "A and B", "A, B and C". */
const naming = (files) =>
  files.length < 2
    ? files.join("")
    : `${files.slice(0, -1).join(", ")} and ${files.at(-1)}`;

/** The line a pointed condition adds, naming the subject's documents of record. */
export const pointedLine = (files) =>
  `${naming(files)} are this project's documents of record; read what you need from them.`;

/** Reads a variant-relative file from `variantDir`; undefined where there is none. */
export const readFrom = (variantDir) => (rel) => {
  const file = path.join(variantDir, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
};

/**
 * The user prompt is the task text alone, identical under every condition; the condition's
 * additions go to the system prompt after `baseSystem`. Where the condition points, `pointed` (the
 * subject's list) is named; where it dumps, `dump` (the subject's list) is read through `read`,
 * from `variantDir` at call time where `read` is absent.
 */
export function buildPrompt({
  task,
  condition,
  baseSystem,
  variantDir,
  dump,
  pointed,
  read = readFrom(variantDir),
}) {
  const parts = [
    baseSystem,
    ...(condition.pointed ? [pointedLine(pointed)] : []),
    ...condition.lines,
  ];
  for (const rel of condition.dump ? dump : []) {
    const text = read(rel);
    if (text === undefined)
      throw new Error(
        `The ${condition.id} condition appends ${rel}, and the ${condition.variant} variant has no such file.`,
      );
    parts.push(`# ${rel}\n\n${text}`);
  }
  return {
    systemPrompt: parts.filter((p) => p !== "").join("\n\n"),
    prompt: task.prompt,
  };
}
