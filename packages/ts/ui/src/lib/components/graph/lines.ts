// The lines a reader turns off, row by row — DESIGN.md § Edges, "Lines a reader
// can turn off".

import { EDGE_KINDS, type EdgeKind } from '@sloppy/types';
import { type GraphHiddenLines, type GraphLines, UNLABELLED_LINE } from '@sloppy/graph';

/** What each kind of line is called where a reader turns it off. */
export const EDGE_KIND_LABELS: Record<EdgeKind, string> = {
	link: 'Drawn by hand',
	run: 'Carries on',
	reference: 'Mentions',
	genealogy: 'Sprang from'
};

/** What the row for hand links nobody labelled is called. */
export const UNLABELLED_LINE_LABEL = 'No label';

export const NOTHING_HIDDEN: GraphHiddenLines = { kinds: new Set(), labels: new Set() };

export interface KindRow {
	kind: EdgeKind;
	count: number;
	on: boolean;
}

export interface LabelRow {
	label: string;
	count: number;
	on: boolean;
}

/** One row per kind the canvas draws, and per kind turned off whether or not it
 *  draws any — that row is how it is turned back on. */
export function kindRows(lines: GraphLines, hidden: GraphHiddenLines): KindRow[] {
	return EDGE_KINDS.filter((kind) => lines.kinds[kind] > 0 || hidden.kinds.has(kind)).map(
		(kind) => ({ kind, count: lines.kinds[kind], on: !hidden.kinds.has(kind) })
	);
}

/** One row per label the hand links on the canvas carry, in the count's order. */
export function labelRows(lines: GraphLines, hidden: GraphHiddenLines): LabelRow[] {
	return [...lines.labels].map(([label, count]) => ({
		label,
		count,
		on: !hidden.labels.has(label)
	}));
}

export function withKind(hidden: GraphHiddenLines, kind: EdgeKind, on: boolean): GraphHiddenLines {
	const kinds = new Set(hidden.kinds);
	if (on) kinds.delete(kind);
	else kinds.add(kind);
	return { kinds, labels: hidden.labels };
}

export function withLabels(
	hidden: GraphHiddenLines,
	labels: Iterable<string>,
	on: boolean
): GraphHiddenLines {
	const kept = new Set(hidden.labels);
	for (const label of labels) {
		if (on) kept.delete(label);
		else kept.add(label);
	}
	return { kinds: hidden.kinds, labels: kept };
}

/** A label as its row names it. */
export function labelSaid(label: string): string {
	return label === UNLABELLED_LINE ? UNLABELLED_LINE_LABEL : label;
}
