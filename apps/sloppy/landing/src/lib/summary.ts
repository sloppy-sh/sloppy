// The benchmark's summary as bench/ exports it to bench/results/summary.json, and the
// part of it the pages ship. bench/README.md § "The export" is what each field means.

export type Tier = 'small' | 'medium' | 'large';
export type Setting = 'default' | 'lean';

export const TIERS: Tier[] = ['small', 'medium', 'large'];

export interface Subject {
	label: string;
	/** Null for a private subject. */
	sha: string | null;
	/** A project that may not be quoted; bench/README.md § "The export". */
	private?: boolean;
	code_files: number | null;
	code_lines: number | null;
	docs_files: number | null;
	docs_words: number | null;
	notes: number | null;
	commits: number | null;
	research_words: number | null;
}

export interface Model {
	backend: string;
	model: string;
	tier: Tier;
}

export interface GroupTask {
	task: string;
	family: string;
	n: number;
	scored: number;
	score: number | null;
	input: number | null;
	cost: number | null;
	/** Seconds over the runs that finished; absent in an export made before it was kept. */
	wall_ok?: number | null;
}

/** One subject, model tier, server setting and condition. */
export interface Group {
	subject: string;
	backend: string;
	tier: Tier;
	setting: Setting;
	condition: string;
	models: string[];
	n: number;
	scored: number;
	tasks: GroupTask[];
	score_mean: number | null;
	score_lo: number | null;
	score_hi: number | null;
	score_task_min: number | null;
	score_task_max: number | null;
	input_mean: number | null;
	input_lo: number | null;
	input_hi: number | null;
	cost_mean: number | null;
	cost_lo: number | null;
	cost_hi: number | null;
	turns_mean: number | null;
	mcp_calls_mean: number | null;
	subagents_mean: number | null;
	runs_with_subagents: number;
	/** Whether the condition reaches Sloppy's server; one that does not has the same runs under both settings. */
	served: boolean;
	/** Distinct files and notes a run opened before answering, over the runs where that is known. */
	opened_mean?: number | null;
	/** Absent in an export made before the overall score. */
	overall?: Overall;
}

export type OverallPart = 'quality' | 'handoff' | 'tokens' | 'time';

/** bench/README.md § "What counts as better": a null total means a part is absent. */
export interface Overall {
	score: number | null;
	partial: number | null;
	parts: Record<OverallPart, number | null>;
	absent: OverallPart[];
}

export interface CurvePoint {
	run_id?: string;
	task: string;
	rep: number;
	score: number | null;
}

export interface Curve {
	subject: string;
	backend: string;
	model: string;
	config: string;
	condition: string;
	points: CurvePoint[];
}

export interface Figure {
	id: string;
	title: string;
	caption: string;
	file: string;
}

/** A condition as the notebook's figures draw it (bench/figures.json); the page reads only its order. */
export interface ConditionStyle {
	id: string;
	colour: string;
	marker: string;
}

export interface Summary {
	generated_at: string;
	subjects: Record<string, Subject>;
	models: Model[];
	conditions: ConditionStyle[];
	curves: Curve[];
	groups: Group[];
	figures: Figure[];
}

export type PagePoint = Pick<CurvePoint, 'run_id' | 'task' | 'score'>;

export interface PageCurve {
	subject: string;
	model: string;
	config: string;
	condition: string;
	points: PagePoint[];
}

/** The summary cut to what the pages read, since it ships inside them for hydration. */
export interface PageSummary extends Omit<Summary, 'curves'> {
	curves: PageCurve[];
}

export function forThePage(summary: Summary, withRuns = false): PageSummary {
	return {
		...summary,
		curves: withRuns
			? summary.curves.map(({ subject, model, config, condition, points }) => ({
					subject,
					model,
					config,
					condition,
					points: points.map(({ run_id, task, score }) => ({ run_id, task, score }))
				}))
			: []
	};
}

export const score = (x: number | null | undefined) =>
	x === null || x === undefined ? '–' : x.toFixed(2);

export function tokens(x: number | null | undefined): string {
	if (x === null || x === undefined) return '–';
	if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	if (x >= 1_000) return `${Math.round(x / 1_000)}k`;
	return String(Math.round(x));
}

export function dollars(x: number | null | undefined): string {
	if (x === null || x === undefined) return '–';
	return `$${x.toFixed(x >= 0.1 ? 2 : 3)}`;
}

export const count = (x: number | null | undefined) =>
	x === null || x === undefined ? '–' : x.toLocaleString('en-GB');

export const seconds = (x: number | null | undefined) =>
	x === null || x === undefined ? '–' : `${Math.round(x)} s`;

/** A group's mean seconds a task, over its tasks, as its other means are. */
export function timeOf(g: Group): number | null {
	const walls = g.tasks.flatMap((t) => (typeof t.wall_ok === 'number' ? [t.wall_ok] : []));
	return walls.length ? walls.reduce((a, b) => a + b) / walls.length : null;
}
