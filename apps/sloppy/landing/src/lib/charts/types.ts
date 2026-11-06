import type { ApproachId } from '$lib/approaches';

/** One project on a chart's x axis. */
export interface XPoint {
	subject: string;
	label: string;
	labelShort: string;
	/** The tick's second line, and the shorter form drawn on a narrow chart. */
	sub: string;
	subShort: string;
}

export interface Value {
	v: number;
	/** Runs behind the value. */
	n: number;
	/** The 95% interval drawn over tasks, where there are two tasks or more. */
	lo: number | null;
	hi: number | null;
}

/** One line on a chart: an approach under one server setting. */
export interface SeriesData {
	key: string;
	approach: ApproachId;
	label: string;
	short: string;
	colour: string;
	width: number;
	dash: string;
	/** One per XPoint, null where it has no runs there. */
	values: (Value | null)[];
}

/** One approach's bar on a project's chart. */
export interface Bar {
	key: string;
	label: string;
	colour: string;
	/** Drawn as an outline rather than filled. */
	hollow: boolean;
	value: number | null;
	runs: number;
}
