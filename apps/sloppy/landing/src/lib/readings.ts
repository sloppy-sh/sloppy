// What the pages read from the summary's groups. Every function returns null or [] where its
// inputs are missing, and the page leaves the sentence out.
import { approach, APPROACHES, type Approach } from './approaches';
import { ratioSign, scoreSign } from './said';
import { timeOf, TIERS, type Group, type PageSummary, type Tier } from './summary';

/** Sloppy as it ships; bench/README.md § "What counts as better". */
/**
 * The reported comparison where a project has been measured under it, and the documents as the
 * project keeps them everywhere else. bench/README.md § "The comparison that is reported".
 */
const SETTINGS = ['recommended', 'lean'] as const;

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);

const joined = (xs: string[], last: string) =>
	xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${last} ${xs.at(-1)}`;
export const andList = (xs: string[]) => joined(xs, 'and');
export const orList = (xs: string[]) => joined(xs, 'or');

export const FAMILY: Record<Tier, string> = { small: 'Haiku', medium: 'Sonnet', large: 'Opus' };

/** The subject `sloppy` is this repository, and one of the approaches is also called Sloppy. */
const SUBJECT_LABELS: Record<string, string> = { sloppy: "Sloppy's own repo" };

export const labelOf = (summary: PageSummary, subject: string) =>
	SUBJECT_LABELS[subject] ?? summary.subjects[subject]?.label ?? subject;

/** The label as it reads mid-sentence: a private subject's "A private app" is "the private app". */
export const nameOf = (summary: PageSummary, subject: string) => {
	const label = labelOf(summary, subject);
	return summary.subjects[subject]?.private ? label.replace(/^an? /i, 'the ') : label;
};

export const shortLabelOf = (summary: PageSummary, subject: string) =>
	subject === 'sloppy' ? "Sloppy's repo" : labelOf(summary, subject);

/** The bench's mock backend answers from fixtures with no model, so its runs are never results. */
const real = (g: Group) => g.backend !== 'mock';

const scored = (g: Group | undefined): g is Group => !!g && real(g) && g.score_mean !== null;

/**
 * A scored group that ran more than the handoff tasks. One that ran only those has a mean over
 * a different, smaller set of tasks, so it is not set beside the others.
 */
const comparable = (g: Group | undefined): g is Group =>
	scored(g) && g.tasks.some((t) => t.family !== 'handoff' && t.scored > 0);

/** Repositories small enough that the docs alone already reach the answers: measured, and out of the site's scope. */
export const SMALL_REPOS = ['syr', 'sloppy'];
export const isSmallRepo = (subject: string) => SMALL_REPOS.includes(subject);

/** Words of design documents a project was chosen by; bench/SURVEY.md § "The rule". */
export const WORD_FLOOR = 350_000;

/** A project measured because it was asked for, with fewer documents than the floor: on its own page, in no average. */
export const belowFloor = (summary: PageSummary, subject: string) =>
	(summary.subjects[subject]?.docs_words ?? Infinity) < WORD_FLOOR;

/** The large open-source projects with runs for a tier, or for any, smallest documentation first. */
export function subjectsWithRuns(summary: PageSummary, tier?: Tier): string[] {
	const ran = new Set(
		summary.groups.filter((g) => real(g) && (!tier || g.tier === tier)).map((g) => g.subject)
	);
	const size = (s: string) => summary.subjects[s]?.docs_words ?? Infinity;
	return Object.keys(summary.subjects)
		.filter((s) => ran.has(s) && !isSmallRepo(s) && !summary.subjects[s]?.private)
		.sort((a, b) => size(a) - size(b) || a.localeCompare(b));
}

/** The approaches with scored runs on any large project, in legend order. */
export const approachesRun = (summary: PageSummary): Approach[] =>
	APPROACHES.filter((a) =>
		subjectsWithRuns(summary).some((s) => TIERS.some((t) => groupOf(summary, s, t, a)))
	);

/** How many runs stand behind one of a subject's tasks, the most any of them had. */
const runsPerTask = (summary: PageSummary, subject: string, tier: Tier = 'medium') =>
	Math.max(
		0,
		...summary.groups
			.filter((g) => g.subject === subject && g.tier === tier)
			.flatMap((g) => g.tasks.map((t) => t.n))
	);

/** How many times each task was run, naming the subjects run more often than the rest. */
export function runsNote(summary: PageSummary): string | null {
	const runs = subjectsWithRuns(summary)
		.map((s) => ({ s, n: runsPerTask(summary, s) }))
		.filter((r) => r.n > 0);
	if (!runs.length) return null;
	const low = Math.min(...runs.map((r) => r.n));
	const high = Math.max(...runs.map((r) => r.n));
	if (high === low) return `Each approach ran every task ${inWords(low)} times.`;
	const more = runs.filter((r) => r.n === high).map((r) => labelOf(summary, r.s));
	return `Each approach ran every task ${inWords(low)} times, and ${andList(more)} ${inWords(high)} times, after a first result too close to call.`;
}

/** The tiers with scored runs, on one subject or on any. */
export const tiersWithRuns = (summary: PageSummary, subject?: string): Tier[] =>
	TIERS.filter((t) =>
		summary.groups.some((g) => g.tier === t && (!subject || g.subject === subject) && comparable(g))
	);

export function groupOf(
	summary: PageSummary,
	subject: string,
	tier: Tier,
	a: Approach
): Group | undefined {
	for (const setting of SETTINGS) {
		const g = summary.groups.find(
			(x) =>
				real(x) &&
				x.subject === subject &&
				x.tier === tier &&
				x.setting === setting &&
				x.condition === a.condition
		);
		if (comparable(g)) return g;
	}
	return undefined;
}

/** Whether a project was measured with its documents shaped the way the practices set out. */
export const underRecommended = (summary: PageSummary, subject: string) =>
	summary.groups.some(
		(g) => g.subject === subject && g.setting === 'recommended' && g.condition === 'mcp'
	);

/** The projects measured that way, for a page that must say which. */
export const recommendedProjects = (summary: PageSummary) =>
	subjectsWithRuns(summary).filter((s) => underRecommended(summary, s));

/** `claude-sonnet-5-5` reads as "Claude Sonnet 5.5". */
export function modelLabel(id: string): string {
	const claude = id.startsWith('claude-');
	const parts = id.replace(/^claude-/, '').split('-');
	const version: string[] = [];
	while (parts.length > 1 && /^\d+$/.test(parts.at(-1)!)) version.unshift(parts.pop()!);
	const family = parts.map((p) => `${p[0].toUpperCase()}${p.slice(1)}`).join(' ');
	return [claude ? 'Claude' : '', family, version.join('.')].filter(Boolean).join(' ');
}

/** The model of a tier as its runs name it, the full name where one does. */
export function modelOf(summary: PageSummary, tier: Tier): string | null {
	const ids = summary.models.filter((m) => m.tier === tier).map((m) => m.model);
	const full = ids.find((id) => /\d/.test(id)) ?? ids[0];
	return full ? modelLabel(full) : null;
}

export type Metric = 'score' | 'input' | 'cost' | 'time';
export const METRICS: Metric[] = ['score', 'input', 'cost', 'time'];

export const valueOf = (g: Group, metric: Metric): number | null =>
	metric === 'score'
		? g.score_mean
		: metric === 'input'
			? (g.fresh_mean ?? g.input_mean)
			: metric === 'cost'
				? g.cost_mean
				: timeOf(g);

export const BETTER: Record<Metric, 'higher' | 'lower'> = {
	score: 'higher',
	input: 'lower',
	cost: 'lower',
	time: 'lower'
};

/** Better or worse for Sloppy, from the reader's side of the metric, as `said.ts` rounds it. */
export type Verdict = 'better' | 'level' | 'worse';

function verdictOf(metric: Metric, sloppy: number, plain: number): Verdict {
	const ahead = metric === 'score' ? scoreSign(sloppy - plain) : -ratioSign(sloppy / plain - 1);
	return ahead > 0 ? 'better' : ahead < 0 ? 'worse' : 'level';
}

const SLOPPY = approach('sloppy');
const PLAIN = approach('plain');

export interface Pair {
	sloppy: Group;
	plain: Group;
}

export function pairOf(summary: PageSummary, subject: string, tier: Tier): Pair | null {
	const sloppy = groupOf(summary, subject, tier, SLOPPY);
	const plain = groupOf(summary, subject, tier, PLAIN);
	return sloppy && plain ? { sloppy, plain } : null;
}

export function compare(pair: Pair, metric: Metric) {
	const s = valueOf(pair.sloppy, metric);
	const p = valueOf(pair.plain, metric);
	return s === null || p === null
		? null
		: { sloppy: s, plain: p, verdict: verdictOf(metric, s, p) };
}

/** Each subject the middle model ran, with how Sloppy came out against the docs alone. */
export function verdicts(summary: PageSummary, metric: Metric, tier: Tier = 'medium') {
	return subjectsWithRuns(summary, tier).flatMap((subject) => {
		const pair = pairOf(summary, subject, tier);
		const c = pair && compare(pair, metric);
		return c ? [{ subject, name: nameOf(summary, subject), ...c }] : [];
	});
}
