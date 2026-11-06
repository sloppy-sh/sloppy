// What /how draws: Sloppy from the notes up, a stage at a time, each stage a labelled region of
// one canvas. docs/ARCHITECTURE.md § "A project's container", § "Tooling" and § "An assistant
// outside the app" are what each card says.

/** `whole` is every stage at once, and has no region of its own. */
export type StageId = 'notes' | 'code' | 'shape' | 'serve' | 'loop' | 'whole';

export interface Stage {
	id: StageId;
	title: string;
	says: string;
}

export const STAGES: Stage[] = [
	{
		id: 'notes',
		title: 'Notes, for people and agents.',
		says: 'At its root Sloppy is a place to write down why: one decision per note, placed under the one it sprang out of. You write in the app; your agent writes through the same acts, under the same rules. Every note is a markdown file in your repository.'
	},
	{
		id: 'code',
		title: 'Kept beside the code.',
		says: 'A note links to the code it explains, down to the lines. sloppy check says when a link no longer lands or a quote no longer reads as the code does, and a note whose code changed after somebody confirmed it is marked.'
	},
	{
		id: 'shape',
		title: 'Shaped from what is there.',
		says: "You don't start from nothing. sloppy init writes a note per package from the tree, sloppy draft a detailed one for each file you name, and sloppy organise proposes better places and links, applied on a branch you review. What an agent searches is worked out from the notes each time it asks."
	},
	{
		id: 'serve',
		title: 'Served to your agent.',
		says: 'Commit one .mcp.json and every agent opened in the repository starts sloppy mcp itself. Given a task, it answers with one short brief: the note that answers it, and the exact lines to open.'
	},
	{
		id: 'loop',
		title: 'In the loop.',
		says: 'The agent reads the brief, opens only those lines, makes the change and writes the reason back as a note, where the next person or the next agent finds it.'
	},
	{
		id: 'whole',
		title: 'The whole loop.',
		says: 'People and agents write the same notes, the notes stay beside the code, and the agent reads them first and writes back what it learns.'
	}
];

export type Point = [number, number];
export type RegionId = Exclude<StageId, 'whole'> | 'example';

/** A bounded, labelled part of the canvas: one per stage, and the one the flow points at. */
export interface Region {
	id: RegionId;
	/** The step that lights it. */
	stage: Exclude<StageId, 'whole'>;
	label: string;
	/** Drawn apart from the flow: an illustration, not a step in it. */
	aside?: boolean;
	/** Top-left corner, wide layout then narrow. */
	at: { wide: Point; narrow: Point };
}

export const REGIONS: Region[] = [
	{ id: 'notes', stage: 'notes', label: '1 Written', at: { wide: [0, 0], narrow: [0, 0] } },
	{
		id: 'example',
		stage: 'notes',
		label: 'An example: one project’s notes',
		aside: true,
		at: { wide: [0, 330], narrow: [160, 400] }
	},
	{
		id: 'code',
		stage: 'code',
		label: '2 Beside the code',
		at: { wide: [600, 0], narrow: [0, 800] }
	},
	{ id: 'shape', stage: 'shape', label: '3 Shaped', at: { wide: [1250, 0], narrow: [0, 1360] } },
	{ id: 'serve', stage: 'serve', label: '4 Served', at: { wide: [600, 520], narrow: [0, 2020] } },
	{
		id: 'loop',
		stage: 'loop',
		label: '5 In the loop',
		at: { wide: [1250, 520], narrow: [0, 2560] }
	}
];

/** Inside a region's border: the top band carries its label. */
export const PAD = { side: 20, top: 46, bottom: 20 };

export type CardKind = 'actor' | 'note' | 'mini' | 'tool' | 'code' | 'step' | 'result';

export type IconName =
	| 'user'
	| 'bot'
	| 'message-square'
	| 'file-text'
	| 'network'
	| 'file-code'
	| 'terminal'
	| 'scroll-text'
	| 'triangle-alert'
	| 'trending-up'
	| 'chevron-right'
	| 'book-open'
	| 'crosshair'
	| 'pencil'
	| 'reply';

/** The example's notes wear their address instead, so `mini` has none. */
export const KIND_ICON: Partial<Record<CardKind, IconName>> = {
	actor: 'user',
	note: 'file-text',
	tool: 'terminal',
	code: 'file-code',
	step: 'chevron-right',
	result: 'trending-up'
};

export interface Card {
	id: string;
	region: RegionId;
	kind: CardKind;
	title: string;
	body?: string;
	/** Monospace, as it is typed or stored. */
	code?: string;
	/** Where its kind's icon is not the one to draw. */
	icon?: IconName;
	/** Top-left corner inside its region, wide layout then narrow. */
	at: { wide: Point; narrow: Point };
}

export const CARDS: Card[] = [
	{
		id: 'person',
		region: 'notes',
		kind: 'actor',
		title: 'You',
		body: 'Write in the graph or the outline.',
		at: { wide: [0, 0], narrow: [0, 0] }
	},
	{
		id: 'agent',
		region: 'notes',
		kind: 'actor',
		icon: 'bot',
		title: 'Your agent',
		body: 'Writes the same notes, by the same rules.',
		at: { wide: [0, 120], narrow: [180, 0] }
	},
	{
		id: 'note',
		region: 'notes',
		kind: 'note',
		title: 'Why it works this way, and what was ruled out',
		code: '.sloppy/notes/01JQ7X….md',
		body: 'Sprang out of 1 · numbered 1a · tagged with the system it is about · links into the code',
		at: { wide: [230, 40], narrow: [0, 130] }
	},
	{
		id: 'g1',
		region: 'example',
		kind: 'mini',
		title: '1 A system in your project',
		at: { wide: [85, 0], narrow: [85, 0] }
	},
	{
		id: 'g1a',
		region: 'example',
		kind: 'mini',
		title: '1a A decision in it',
		at: { wide: [0, 80], narrow: [0, 80] }
	},
	{
		id: 'g1a1',
		region: 'example',
		kind: 'mini',
		title: '1a1 What it led to',
		at: { wide: [0, 160], narrow: [0, 160] }
	},
	{
		id: 'g1b',
		region: 'example',
		kind: 'mini',
		title: '1b Another decision',
		at: { wide: [180, 160], narrow: [180, 160] }
	},
	{
		id: 'repo',
		region: 'code',
		kind: 'code',
		title: 'Your code',
		code: 'src/module/file.ts#L12-L40',
		body: 'Read, never written.',
		at: { wide: [0, 0], narrow: [0, 0] }
	},
	{
		id: 'check',
		region: 'code',
		kind: 'tool',
		title: 'sloppy check',
		body: 'Every link still lands; every quote still reads as the code does.',
		at: { wide: [0, 170], narrow: [0, 170] }
	},
	{
		id: 'drift',
		region: 'code',
		kind: 'result',
		icon: 'triangle-alert',
		title: 'Changed since confirmed',
		body: 'The note is marked until somebody reads it against the code again.',
		at: { wide: [300, 170], narrow: [0, 330] }
	},
	{
		id: 'init',
		region: 'shape',
		kind: 'tool',
		title: 'sloppy init',
		body: 'A note per package, pointing at its folder and entry points.',
		at: { wide: [0, 0], narrow: [0, 0] }
	},
	{
		id: 'draft',
		region: 'shape',
		kind: 'tool',
		title: 'sloppy draft',
		body: 'A detailed note per file: what it imports and exports, a link to each symbol.',
		at: { wide: [0, 150], narrow: [0, 140] }
	},
	{
		id: 'organise',
		region: 'shape',
		kind: 'tool',
		title: 'sloppy organise',
		body: 'Better places and links, proposed; applied on a branch you review.',
		at: { wide: [0, 320], narrow: [0, 300] }
	},
	{
		id: 'graph',
		region: 'shape',
		kind: 'note',
		icon: 'network',
		title: 'Your notes',
		body: 'Ranked when asked: by their words, titles and tags first, and by the code they point at.',
		at: { wide: [300, 150], narrow: [0, 450] }
	},
	{
		id: 'mcpjson',
		region: 'serve',
		kind: 'code',
		title: 'Committed once',
		code: '.mcp.json → sloppy mcp',
		at: { wide: [0, 0], narrow: [0, 0] }
	},
	{
		id: 'mcp',
		region: 'serve',
		kind: 'tool',
		title: 'sloppy mcp',
		body: 'Started by the agent. Its acts read, search and relate notes, find code, and write.',
		at: { wide: [0, 130], narrow: [0, 120] }
	},
	{
		id: 'brief',
		region: 'serve',
		kind: 'result',
		icon: 'scroll-text',
		title: 'One short brief',
		body: 'The note that answers, its key sections, the lines to open:',
		code: 'src/module/file.ts#L12-L40',
		at: { wide: [300, 110], narrow: [0, 280] }
	},
	{
		id: 'task',
		region: 'loop',
		kind: 'actor',
		icon: 'message-square',
		title: 'A task',
		body: '“A task that touches that code.”',
		at: { wide: [0, 20], narrow: [0, 0] }
	},
	{
		id: 'read',
		region: 'loop',
		kind: 'step',
		icon: 'book-open',
		title: '1 Reads the brief',
		at: { wide: [220, 0], narrow: [0, 140] }
	},
	{
		id: 'open',
		region: 'loop',
		kind: 'step',
		icon: 'crosshair',
		title: '2 Opens only those lines',
		at: { wide: [220, 70], narrow: [0, 210] }
	},
	{
		id: 'change',
		region: 'loop',
		kind: 'step',
		icon: 'pencil',
		title: '3 Makes the change',
		at: { wide: [220, 140], narrow: [0, 280] }
	},
	{
		id: 'back',
		region: 'loop',
		kind: 'step',
		icon: 'reply',
		title: '4 Writes the why back',
		at: { wide: [220, 210], narrow: [0, 350] }
	},
	{
		id: 'next',
		region: 'loop',
		kind: 'actor',
		title: 'The next reader',
		body: 'A person or an agent finds the reason where the code is.',
		at: { wide: [520, 190], narrow: [0, 420] }
	},
	{
		id: 'outcome',
		region: 'loop',
		kind: 'result',
		title: 'What it came to',
		at: { wide: [520, 0], narrow: [0, 550] }
	}
];

export interface Link {
	from: string;
	to: string;
	label?: string;
}

/** Each stage's lines; a line runs while its stage is shown. */
export const LINKS: Record<StageId, Link[]> = {
	notes: [
		{ from: 'person', to: 'note' },
		{ from: 'agent', to: 'note' },
		{ from: 'note', to: 'example' },
		{ from: 'g1', to: 'g1a' },
		{ from: 'g1', to: 'g1b' },
		{ from: 'g1a', to: 'g1a1' }
	],
	code: [
		{ from: 'note', to: 'repo', label: 'points at' },
		{ from: 'repo', to: 'check' },
		{ from: 'check', to: 'drift' }
	],
	shape: [
		{ from: 'repo', to: 'init' },
		{ from: 'repo', to: 'draft' },
		{ from: 'init', to: 'graph' },
		{ from: 'draft', to: 'graph' },
		{ from: 'organise', to: 'graph' }
	],
	serve: [
		{ from: 'graph', to: 'mcp' },
		{ from: 'mcpjson', to: 'mcp' },
		{ from: 'mcp', to: 'brief' }
	],
	loop: [
		{ from: 'brief', to: 'read' },
		{ from: 'task', to: 'read' },
		{ from: 'read', to: 'open' },
		{ from: 'open', to: 'change' },
		{ from: 'change', to: 'back' },
		{ from: 'back', to: 'next' }
	],
	whole: []
};

const REGION_OF = new Map(REGIONS.map((r) => [r.id, r]));
const CARD_OF = new Map(CARDS.map((c) => [c.id, c]));

/** Where a card or a region sits on the canvas, which is what decides the side a line leaves by. */
export function corner(id: string, layout: 'wide' | 'narrow'): Point {
	const region = REGION_OF.get(id as RegionId);
	if (region) return region.at[layout];
	const card = CARD_OF.get(id)!;
	const [rx, ry] = REGION_OF.get(card.region)!.at[layout];
	const [x, y] = card.at[layout];
	return [rx + PAD.side + x, ry + PAD.top + y];
}

/** Widths are the card's CSS; heights are a first-frame guess, measured away on the next. */
const WIDTH: Record<CardKind, number> = {
	actor: 160,
	note: 240,
	mini: 152,
	tool: 240,
	code: 240,
	step: 240,
	result: 240
};

export function guess(card: Card): { width: number; height: number } {
	const width = WIDTH[card.kind];
	const text = `${card.title} ${card.body ?? ''} ${card.code ?? ''}`.trim();
	const lines = Math.ceil(text.length / ((width - 34) / 6.4));
	return { width, height: 36 + lines * 22 };
}
