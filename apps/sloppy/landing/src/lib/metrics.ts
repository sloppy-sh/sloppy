// How each metric is named and written on every page.
import type { Metric } from './readings';
import { dollars, score, seconds, tokens } from './summary';

export const TITLE: Record<Metric, string> = {
	score: 'Score',
	input: 'Tokens',
	cost: 'Cost',
	time: 'Time'
};

/** A chart's title, naming the range its axis is drawn over, since the score axis is not always 0 to 1. */
export const chartTitle = (metric: Metric, domain: [number, number]) =>
	metric === 'score'
		? `Answer quality, ${score(domain[0])} to ${score(domain[1])}`
		: CHART_TITLE[metric];

export const CHART_TITLE: Record<Metric, string> = {
	score: 'Answer quality, 0 to 1',
	input: 'Tokens read per task',
	cost: 'Cost per task, US dollars',
	time: 'Seconds per task'
};

export const FORMAT: Record<Metric, (v: number) => string> = {
	score,
	input: tokens,
	cost: dollars,
	time: seconds
};

/** One more place, for two values `FORMAT` writes the same though `said.ts` tells them apart. */
export const FINER: Record<Metric, (v: number) => string> = {
	score: (v) => v.toFixed(3),
	input: (v) => `${(v / 1_000).toFixed(1)}k`,
	cost: (v) => `$${v.toFixed(4)}`,
	time: (v) => `${v.toFixed(1)} s`
};

export const AXIS_FORMAT: Record<Metric, (v: number) => string> = {
	score: (v) => v.toFixed(1),
	input: tokens,
	cost: (v) => `$${v.toFixed(2)}`,
	time: (v) => `${v} s`
};
