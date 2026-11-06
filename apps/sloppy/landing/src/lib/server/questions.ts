// The final test's questions and answers, read from bench/results and bench/tasks at build. The
// final test is the batch run with seed 30 (bench/README.md § "The export"); a run is scored as
// bench/lib/report.mjs scoreOf scores it, and its cost, tokens and time are summed over a handoff's
// two stages as bench/lib/record.mjs sums them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECTS } from '$lib/projects';
import { labelOf } from '$lib/readings';
import { WHY } from '$lib/questions/why';
import {
	CONDITIONS,
	type Answer,
	type Fact,
	type Condition,
	type JudgeItem,
	type QuestionDetail,
	type QuestionRow
} from '$lib/questions/types';
import { HIDDEN, unnamed } from './private';
import { loadSummary } from './summary';

/** The seeds the published export reads, so a question's runs are the ones its charts count. */
export const FINAL_SEEDS = [30, 31, 32];

/** The builds run from this package's folder. */
const BENCH = resolve(process.cwd(), '../../../bench');
const RESULTS = join(BENCH, 'results');

interface Tokens {
	input: number;
	cache_write: number;
	cache_read: number;
	output: number;
	reasoning: number;
}
interface Stage {
	status: string;
	sent?: { prompt: string };
	timing: { wall_ms: number };
	tokens: Tokens;
	tokens_unknown?: string[];
	cost_usd: { computed?: number; reported?: number };
}
interface Run extends Stage {
	run_id: string;
	seed?: number;
	rep: number;
	condition: string;
	subject: { name?: string };
	task: { pack: string; id: string; family: string };
	output?: { text?: string };
	grade?: { objective?: number; judge?: number; score?: number; notes?: string };
	stage_a?: Stage;
}
interface Grade {
	run_id: string;
	grader: string;
	score: number;
	items?: JudgeItem[];
}
interface Pattern {
	pattern: string;
	source?: { quote?: string };
}
interface Task {
	family: string;
	grader?: { required?: Pattern[]; forbidden?: Pattern[] };
	prompt_a?: string;
	reason?: string;
}

const readJsonl = <T>(dir: string): T[] =>
	readdirSync(dir)
		.filter((f) => f.endsWith('.jsonl'))
		.sort()
		.flatMap((f) =>
			readFileSync(join(dir, f), 'utf8')
				.split('\n')
				.filter((l) => l.trim())
				.map((l) => JSON.parse(l) as T)
		);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const stagesOf = (r: Run) => [r.stage_a, r].filter((s): s is Stage => !!s?.sent);

function costOf(r: Run) {
	const costs = stagesOf(r).map((s) => s.cost_usd.computed ?? s.cost_usd.reported);
	return costs.some((c) => c === undefined) ? null : (costs as number[]).reduce((a, b) => a + b, 0);
}

function tokensOf(r: Run, classes: (keyof Tokens)[]) {
	const stages = stagesOf(r);
	if (stages.some((s) => classes.some((c) => s.tokens_unknown?.includes(c)))) return null;
	return stages.reduce((n, s) => n + classes.reduce((m, c) => m + s.tokens[c], 0), 0);
}

const conditionOf = (c: string): c is Condition => (CONDITIONS as string[]).includes(c);

/** The change a handoff's first session was asked to make: its prompt up to the reason it was told. */
const changeOf = (promptA: string) => promptA.split(/\s+The reason, which you know/)[0];

/** The facts check's notes (bench/lib/grade.mjs), each pattern put as the sentence it was written from. */
function factsOf(notes: string, task: Task | undefined): Fact[] {
	const quoteOf = (pattern: string, among: Pattern[] = []) =>
		among.find((p) => p.pattern === pattern)?.source?.quote;
	return notes.split('\n').flatMap((line): Fact[] => {
		const missing = line.match(/^missing: (.*)$/s)?.[1];
		if (missing !== undefined) {
			const quote = quoteOf(missing, task?.grader?.required);
			return [quote ? { kind: 'missing', said: quote } : { kind: 'unnamed', said: missing }];
		}
		const stated = line.match(/^states what is not so: (.*)$/s)?.[1];
		const quote = stated !== undefined && quoteOf(stated, task?.grader?.forbidden);
		return quote ? [{ kind: 'false', said: quote }] : [];
	});
}

let cache: { rows: QuestionRow[]; details: Map<string, QuestionDetail> } | undefined;

function load() {
	if (cache) return cache;
	const subjects = new Map(
		PROJECTS.filter((p) => !HIDDEN.has(p.subject)).map((p) => [p.subject, p.slug])
	);
	const runs = readJsonl<Run>(RESULTS).filter(
		(r) =>
			r.seed !== undefined &&
			FINAL_SEEDS.includes(r.seed) &&
			subjects.has(r.subject.name ?? '') &&
			conditionOf(r.condition) &&
			r.status !== 'budget'
	);
	const grades = new Map<string, Grade[]>();
	for (const g of readJsonl<Grade>(join(RESULTS, 'grades')))
		grades.set(g.run_id, [...(grades.get(g.run_id) ?? []), g]);

	const latest = (r: Run, grader: string) =>
		(grades.get(r.run_id) ?? []).filter((g) => g.grader === grader).at(-1);
	const scoreOf = (r: Run) => {
		if (r.status !== 'ok') return 0;
		const parts = ['objective', 'judge' as const]
			.map((k) => latest(r, k)?.score ?? r.grade?.[k as 'objective' | 'judge'])
			.filter((s): s is number => s !== undefined);
		return parts.length ? mean(parts) : (r.grade?.score ?? 0);
	};

	const byTask = new Map<string, Run[]>();
	for (const r of runs) byTask.set(r.task.id, [...(byTask.get(r.task.id) ?? []), r]);

	const rows: QuestionRow[] = [];
	const details = new Map<string, QuestionDetail>();
	for (const [id, taskRuns] of byTask) {
		const first = taskRuns[0];
		const file = join(BENCH, 'tasks', first.task.pack, `${id}.json`);
		const task = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Task) : undefined;
		const of = (c: Condition) =>
			taskRuns.filter((r) => r.condition === c).sort((a, b) => a.rep - b.rep);
		if (CONDITIONS.some((c) => of(c).length === 0)) continue;

		const score = {} as Record<Condition, number>;
		const answers: Answer[] = CONDITIONS.map((c) => {
			const rs = of(c);
			const scores = rs.map(scoreOf);
			const m = (score[c] = mean(scores));
			const at = scores.reduce(
				(best, s, i) => (Math.abs(s - m) < Math.abs(scores[best] - m) ? i : best),
				0
			);
			const r = rs[at];
			return {
				condition: c,
				runId: r.run_id,
				score: scores[at],
				mean: m,
				text: r.output?.text ?? '',
				tokensIn: tokensOf(r, ['input', 'cache_write', 'cache_read']),
				tokensOut: tokensOf(r, ['output', 'reasoning']),
				costUsd: costOf(r),
				wallS: stagesOf(r).reduce((n, s) => n + s.timing.wall_ms, 0) / 1000,
				items: latest(r, 'judge')?.items ?? [],
				facts: factsOf(r.grade?.notes ?? '', task)
			};
		});
		const gain = score.mcp - score.bare;
		const said = WHY[id];
		const winner = Math.abs(gain) < 0.0005 ? 'level' : gain > 0 ? 'mcp' : 'bare';
		rows.push({
			task: id,
			slug: subjects.get(first.subject.name ?? '')!,
			project: first.subject.name ?? '',
			family: first.task.family,
			question: first.sent?.prompt ?? '',
			stageA:
				task?.prompt_a && task.reason
					? { change: changeOf(task.prompt_a), reason: task.reason }
					: null,
			score,
			runs: Object.fromEntries(CONDITIONS.map((c) => [c, of(c).length])) as Record<
				Condition,
				number
			>,
			gain,
			why: said?.winner === winner ? said.why : null
		});
		details.set(id, { task: id, answers });
	}
	rows.sort((a, b) => b.gain - a.gain || a.task.localeCompare(b.task));
	const clean = <T>(x: T) => JSON.parse(unnamed(JSON.stringify(x))) as T;
	return (cache = {
		rows: clean(rows),
		details: new Map([...details].map(([k, v]) => [k, clean(v)]))
	});
}

/** Every task of the final test, Sloppy's largest gain over the docs alone first. */
export const questionRows = (slug?: string) =>
	load().rows.filter((r) => slug === undefined || r.slug === slug);

export const questionDetail = (task: string) => load().details.get(task);

/** What a questions page ships: its rows, each project's label, and the export's date. */
export function questionsPage(slug?: string) {
	const { summary, isSample } = loadSummary(false);
	const rows = questionRows(slug);
	const labels = Object.fromEntries(rows.map((r) => [r.project, labelOf(summary, r.project)]));
	return { rows, labels, isSample, generatedAt: summary.generated_at };
}
