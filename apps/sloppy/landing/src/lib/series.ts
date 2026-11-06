// The lines and bars a chart draws: each approach, Sloppy as it ships (lean).
import { scaleLinear } from 'd3-scale';
import type { SeriesData, Value, XPoint } from './charts/types';
import { approachesRun, groupOf, labelOf, shortLabelOf, valueOf, type Metric } from './readings';
import { tokens, type Group, type PageSummary, type Tier } from './summary';

const BOUNDS: Partial<Record<Metric, (g: Group) => [number | null, number | null]>> = {
	score: (g) => [g.score_lo, g.score_hi],
	input: (g) => [g.input_lo, g.input_hi],
	cost: (g) => [g.cost_lo, g.cost_hi]
};

function pointOf(g: Group | undefined, metric: Metric): Value | null {
	if (!g) return null;
	const v = valueOf(g, metric);
	if (v === null) return null;
	const [lo, hi] = BOUNDS[metric]?.(g) ?? [null, null];
	return { v, lo, hi, n: metric === 'score' ? g.scored : g.n };
}

export function seriesOf(
	summary: PageSummary,
	subjects: string[],
	tier: Tier,
	metric: Metric
): SeriesData[] {
	return approachesRun(summary).map((a) => ({
		key: a.id,
		approach: a.id,
		label: a.label,
		short: a.label,
		colour: a.colour,
		width: a.width,
		dash: a.dash,
		values: subjects.map((s) => pointOf(groupOf(summary, s, tier, a), metric))
	}));
}

/** The projects along the cross-project charts' x axis, each with its words of docs. */
export const xsOf = (summary: PageSummary, subjects: string[]): XPoint[] =>
	subjects.map((subject) => {
		const words = summary.subjects[subject]?.docs_words ?? null;
		return {
			subject,
			label: labelOf(summary, subject),
			labelShort: shortLabelOf(summary, subject),
			sub: words === null ? '' : `${tokens(words)} words of docs`,
			subShort: words === null ? '' : `${tokens(words)} words`
		};
	});

/** The smallest span a zoomed score axis is drawn over, so a hair's difference never fills the chart. */
const SCORE_SPAN = 0.2;
/** Ticks and ends land on tenths, the step the axis labels are written to. */
const STEP = 0.1;

/**
 * The score axis, drawn over the scores it holds rather than from zero: every answer scores well
 * above zero, so 0 to 1 leaves the differences in a band too thin to read. Its title says the range.
 */
function scoreAxis(series: SeriesData[]) {
	// The points as drawn: no score chart draws its intervals, so holding room for them wastes the axis.
	const vs = series.flatMap((s) => s.values.flatMap((v) => (v ? [v.v] : [])));
	if (!vs.length) return { domain: [0, 1] as [number, number], ticks: [0, 0.5, 1] };
	let lo = Math.max(0, Math.floor(Math.min(...vs) / STEP) * STEP);
	let hi = Math.min(1, Math.ceil(Math.max(...vs) / STEP) * STEP);
	if (hi - lo < SCORE_SPAN) {
		lo = Math.max(0, Math.min(lo, hi - SCORE_SPAN));
		hi = Math.min(1, Math.max(hi, lo + SCORE_SPAN));
	}
	const ticks = [];
	for (let v = lo; v <= hi + 1e-9; v += STEP) ticks.push(Math.round(v / STEP) * STEP);
	return { domain: [lo, hi] as [number, number], ticks };
}

/** A metric's y axis: score over the scores it draws, the rest from zero to a nice top over the series. */
export function axisOf(metric: Metric, series: SeriesData[]) {
	if (metric === 'score') return scoreAxis(series);
	const top = Math.max(...series.flatMap((s) => s.values.flatMap((v) => (v ? [v.v] : []))), 0.001);
	const scale = scaleLinear().domain([0, top]).nice(4);
	return { domain: scale.domain() as [number, number], ticks: scale.ticks(4) };
}
