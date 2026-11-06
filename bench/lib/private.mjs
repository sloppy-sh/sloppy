// What a private subject leaves in an export: its numbers under its label, and nothing a page could
// quote. README.md § "The export". Node built-ins only, so a page's build can import it.
import fs from "node:fs";
import path from "node:path";

const UNNAMED = "A private project";

/** Each subject whose file says `"private": true`, by name, with the label a page may show. */
export function privateSubjects(
  dir = path.resolve(import.meta.dirname, "../subjects"),
) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const subject = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const name = file.slice(0, -".json".length);
    if (subject.private === true)
      found.set(
        name,
        subject.label && subject.label !== name ? subject.label : UNNAMED,
      );
  }
  return found;
}

/**
 * The summary with each private subject keyed `private-<n>`, its tasks `private-<n>-<family>-<k>`,
 * its `sha` null, and no `run_id` on its curves' points. A summary with no private subject under
 * its own name comes back as it was, so applying this twice changes nothing.
 * @template {{
 *   subjects: Record<string, any>,
 *   cells?: { subject: string, task: string, family: string }[],
 *   curves: { subject: string, points: { task: string, run_id?: string }[] }[],
 *   groups: { subject: string, tasks: { task: string, family: string }[] }[],
 * }} S
 * @param {S} summary
 * @param {Map<string, string>} names each private subject's label, by name
 * @returns {S}
 */
export function withoutPrivate(summary, names) {
  const hidden = Object.keys(summary.subjects)
    .filter((name) => names.has(name))
    .sort();
  if (hidden.length === 0) return summary;
  const subjectAlias = new Map(
    hidden.map((name, i) => [name, `private-${i + 1}`]),
  );

  /** @type {Map<string, string>} */
  const taskAlias = new Map();
  for (const name of hidden) {
    /** @type {Map<string, string>} */
    const families = new Map();
    for (const c of summary.cells ?? [])
      if (c.subject === name) families.set(c.task, c.family);
    for (const g of summary.groups)
      if (g.subject === name)
        for (const t of g.tasks) families.set(t.task, t.family);
    for (const c of summary.curves)
      if (c.subject === name)
        for (const p of c.points)
          if (!families.has(p.task)) families.set(p.task, "task");
    /** @type {Record<string, number>} */
    const counted = {};
    for (const [task, family] of [...families].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      counted[family] = (counted[family] ?? 0) + 1;
      taskAlias.set(
        task,
        `${subjectAlias.get(name)}-${family}-${counted[family]}`,
      );
    }
  }

  /** @param {string} subject */
  const subjectOf = (subject) => subjectAlias.get(subject) ?? subject;
  /** @param {string} subject @param {string} task */
  const taskOf = (subject, task) =>
    names.has(subject) ? (taskAlias.get(task) ?? task) : task;

  return {
    ...summary,
    subjects: Object.fromEntries(
      Object.entries(summary.subjects).map(([name, facts]) =>
        names.has(name)
          ? [
              subjectOf(name),
              {
                ...facts,
                label: names.get(name),
                sha: null,
                private: true,
              },
            ]
          : [name, facts],
      ),
    ),
    ...(summary.cells
      ? {
          cells: summary.cells.map((c) => ({
            ...c,
            subject: subjectOf(c.subject),
            task: taskOf(c.subject, c.task),
          })),
        }
      : {}),
    curves: summary.curves.map((c) =>
      names.has(c.subject)
        ? {
            ...c,
            subject: subjectOf(c.subject),
            points: c.points.map(({ run_id, ...p }) => ({
              ...p,
              task: taskOf(c.subject, p.task),
            })),
          }
        : c,
    ),
    groups: summary.groups.map((g) =>
      names.has(g.subject)
        ? {
            ...g,
            subject: subjectOf(g.subject),
            tasks: g.tasks.map((t) => ({
              ...t,
              task: taskOf(g.subject, t.task),
            })),
          }
        : g,
    ),
  };
}
