// The questions the front page shows the agent's steps on: Sloppy's three largest gains over the
// docs alone and its largest loss, on the large projects, each from a different project where the
// results allow.
import { largeProjects } from '$lib/aggregate';
import { labelOf } from '$lib/readings';
import type { PageSummary } from '$lib/summary';
import type { Answer, Featured, FeaturedRun, QuestionRow } from '$lib/questions/types';
import { questionDetail, questionRows } from './questions';
import { runIds } from './runs';

const GAINS = 3;
const QUESTION = 90;

/** The prompt up to its first sentence or clause break, cut to a line. */
function firstClause(prompt: string) {
	const clause = prompt
		.replace(/\s+/g, ' ')
		.trim()
		.split(/(?<=[.?!])\s|[,;:]\s|\s[—–]\s/)[0];
	return clause.length > QUESTION ? `${clause.slice(0, QUESTION - 1).trimEnd()}…` : clause;
}

/** Up to `n` rows, a new project each before any project twice. */
function spread(rows: QuestionRow[], n: number, taken: Set<string>) {
	const picked: QuestionRow[] = [];
	for (const r of rows)
		if (picked.length < n && !taken.has(r.project)) {
			picked.push(r);
			taken.add(r.project);
		}
	for (const r of rows) if (picked.length < n && !picked.includes(r)) picked.push(r);
	return picked;
}

export function featured(summary: PageSummary): Featured[] {
	const large = new Set(largeProjects(summary));
	const shown = new Set(runIds());
	const runOf = (a: Answer | undefined): FeaturedRun | null =>
		a?.trace && shown.has(a.runId)
			? {
					runId: a.runId,
					score: a.mean,
					steps: a.trace.length,
					firstSession: a.firstSession,
					subagentCalls: a.subagentCalls
				}
			: null;
	const candidates = questionRows().flatMap((row) => {
		if (!large.has(row.project)) return [];
		const answers = questionDetail(row.task)?.answers ?? [];
		const plain = runOf(answers.find((a) => a.condition === 'bare'));
		const sloppy = runOf(answers.find((a) => a.condition === 'mcp'));
		return plain && sloppy ? [{ row, plain, sloppy }] : [];
	});
	const byRow = new Map(candidates.map((c) => [c.row, c]));
	const rows = candidates.map((c) => c.row);
	const taken = new Set<string>();
	const gains = spread(
		rows.filter((r) => r.gain > 0),
		GAINS,
		taken
	);
	const loss = spread(rows.filter((r) => r.gain < 0).reverse(), 1, taken);
	return [...gains, ...loss].map((row) => {
		const { plain, sloppy } = byRow.get(row)!;
		return {
			task: row.task,
			slug: row.slug,
			label: labelOf(summary, row.project),
			family: row.family,
			question: firstClause(row.question),
			gain: row.gain,
			plain,
			sloppy
		};
	});
}
