// The four approaches the benchmark compares, each one bench condition (bench/README.md), with
// how it is drawn on every chart.

export type ApproachId = 'plain' | 'agents' | 'sloppy' | 'notes';

export interface Approach {
	id: ApproachId;
	condition: string;
	label: string;
	/** What it is, in one line, for the methodology page. */
	means: string;
	colour: string;
	/** Stroke width in px. */
	width: number;
	/** SVG dash pattern; '' is solid. */
	dash: string;
}

/** In legend order. */
export const APPROACHES: Approach[] = [
	{
		id: 'plain',
		condition: 'bare',
		label: 'Docs alone',
		means: 'Claude Code in the project with its code, its documents and its instructions file.',
		colour: 'var(--series-plain)',
		width: 2,
		dash: ''
	},
	{
		id: 'agents',
		condition: 'agents',
		label: 'Subagents allowed',
		means: 'The same, and allowed to hand parts of a task to helper agents.',
		colour: 'var(--series-agents)',
		width: 2,
		dash: ''
	},
	{
		id: 'sloppy',
		condition: 'mcp',
		label: 'With Sloppy',
		means: "The same as docs alone, plus the project's notes through Sloppy.",
		colour: 'var(--series-sloppy)',
		width: 2.5,
		dash: ''
	},
	{
		id: 'notes',
		condition: 'notes-only',
		label: 'Notes only',
		means: 'The documents taken out; the notes written from them, through Sloppy, instead.',
		colour: 'var(--series-sloppy)',
		width: 2,
		dash: '1 4'
	}
];

/** Bottom to top, so Sloppy is drawn last and sits on every other line. */
export const DRAW_ORDER: ApproachId[] = ['agents', 'plain', 'notes', 'sloppy'];

export const approach = (id: ApproachId) => APPROACHES.find((a) => a.id === id)!;
