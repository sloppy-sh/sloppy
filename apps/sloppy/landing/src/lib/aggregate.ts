// Sloppy against each other approach over the large projects, each project weighing the same.
import { approach, type Approach } from './approaches';
import { andList, FAMILY, groupOf, modelOf, nameOf, subjectsWithRuns } from './readings';
import { belowFloor, isSmallRepo } from './readings';
export { isSmallRepo, SMALL_REPOS } from './readings';
import type { RatioMetric } from './said';
import { count, timeOf, type Group, type PageSummary, type Tier } from './summary';

export type AggregateMetric = RatioMetric;

export const AGGREGATE_LABEL: Record<AggregateMetric, string> = {
	cost: 'Cost',
	time: 'Time',
	turns: 'Round trips to the model',
	input: 'New text read*'
};
export const AGGREGATE_METRICS = Object.keys(AGGREGATE_LABEL) as AggregateMetric[];

export interface Aggregate {
	against: Approach;
	subjects: string[];
	/** Runs behind Sloppy's side, and behind the other's. */
	runs: { sloppy: number; other: number };
	/** Sloppy's mean score less the other's, 0 to 1. */
	score: number;
	/** Sloppy's mean score over the other's, less one: 0.02 is 2% higher. */
	scoreRatio: number;
	/** Sloppy's value over the other's, less one: -0.16 is 16% less. */
	ratio: Record<AggregateMetric, number | null>;
}

const VALUE: Record<AggregateMetric, (g: Group) => number | null> = {
	cost: (g) => g.cost_mean,
	time: timeOf,
	turns: (g) => g.turns_mean,
	input: (g) => g.fresh_mean ?? g.input_mean
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b) / xs.length : null);

export function aggregate(
	summary: PageSummary,
	against: 'plain' | 'agents',
	tier: Tier = 'medium'
): Aggregate | null {
	const other = approach(against);
	const pairs = subjectsWithRuns(summary, tier).flatMap((subject) => {
		if (isSmallRepo(subject) || belowFloor(summary, subject)) return [];
		const s = groupOf(summary, subject, tier, approach('sloppy'));
		const o = groupOf(summary, subject, tier, other);
		return s && o ? [{ subject, s, o }] : [];
	});
	const score = mean(pairs.map(({ s, o }) => s.score_mean! - o.score_mean!));
	const scoreRatio = mean(pairs.map(({ s, o }) => s.score_mean! / o.score_mean! - 1));
	if (score === null || scoreRatio === null) return null;
	const ratioOf = (m: AggregateMetric) => {
		const rs = pairs.flatMap(({ s, o }) => {
			const a = VALUE[m](s);
			const b = VALUE[m](o);
			return a !== null && b ? [a / b - 1] : [];
		});
		return rs.length === pairs.length ? mean(rs) : null;
	};
	return {
		against: other,
		subjects: pairs.map((p) => p.subject),
		runs: {
			sloppy: pairs.reduce((n, { s }) => n + s.n, 0),
			other: pairs.reduce((n, { o }) => n + o.n, 0)
		},
		score,
		scoreRatio,
		ratio: {
			cost: ratioOf('cost'),
			time: ratioOf('time'),
			turns: ratioOf('turns'),
			input: ratioOf('input')
		}
	};
}

/** The projects the aggregates average: large, and above the documentation floor; smallest documentation first. */
export const largeProjects = (summary: PageSummary) => aggregate(summary, 'plain')?.subjects ?? [];

/** Sloppy against the docs alone and against subagents, where each has runs. */
export const aggregates = (summary: PageSummary) =>
	(['plain', 'agents'] as const).flatMap((id) => {
		const a = aggregate(summary, id);
		return a ? [a] : [];
	});

/** The projects, model and runs behind a set of aggregates, as a caption. */
export function aggregateNote(summary: PageSummary, columns: Aggregate[]): string | null {
	const first = columns[0];
	if (!first) return null;
	const runs = first.runs.sloppy + columns.reduce((n, c) => n + c.runs.other, 0);
	return `Averages across ${andList(first.subjects.map((s) => nameOf(summary, s)))}, each project weighing the same. ${modelOf(summary, 'medium') ?? FAMILY.medium}, ${count(runs)} runs.`;
}
